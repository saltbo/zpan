import { zValidator } from '@hono/zod-validator'
import type { Context } from 'hono'
import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import { DirType } from '../../shared/constants'
import {
  batchDeleteSchema,
  batchPatchSchema,
  copyMatterSchema,
  createMatterSchema,
  createObjectUploadSessionSchema,
  patchMatterSchema,
  patchObjectUploadSessionSchema,
  presignObjectUploadPartsSchema,
} from '../../shared/schemas'
import type { Storage as S3Storage } from '../../shared/types'
import { requireTeamRole } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import { recordActivity } from '../services/activity'
import { assertTaskUploadAllowed } from '../services/downloads'
import { consumeTrafficIfQuotaAllows, refundTraffic } from '../services/effective-quota'
import {
  batchMove,
  batchTrash,
  cancelDraftMatter,
  collectForPurge,
  confirmUpload,
  copyMatter,
  createMatter,
  getMatter,
  getMatters,
  listMatters,
  restoreMatter,
  trashMatter,
  updateMatter,
} from '../services/matter'
import { NameConflictError } from '../services/matter-name-conflict'
import {
  createObjectUploadSession,
  ObjectUploadSessionError,
  patchObjectUploadSession,
  presignObjectUploadParts,
} from '../services/object-upload-sessions'
import { getMemberRole, isPersonalOrg } from '../services/org'
import { buildObjectKey } from '../services/path-template'
import { purgeRecursively } from '../services/purge'
import { S3Service } from '../services/s3'
import { getStorage, selectStorage } from '../services/storage'
import { StorageQuotaExceededError, withStorageUsageReservation } from '../services/storage-usage'
import { reportTrafficForDownload } from './traffic-metering-utils'

const s3 = new S3Service()

function fileExt(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot) : ''
}

function conflictBody(err: NameConflictError) {
  return {
    error: err.message,
    code: 'NAME_CONFLICT' as const,
    conflictingName: err.conflictingName,
    conflictingId: err.conflictingId,
  }
}

function normalizeMatterPath(path: string): string {
  return path
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean)
    .join('/')
}

function isWithinDownloadTarget(parent: string, targetFolder: string): boolean {
  const normalizedParent = normalizeMatterPath(parent)
  const normalizedTarget = normalizeMatterPath(targetFolder)
  if (!normalizedTarget) return true
  return normalizedParent === normalizedTarget || normalizedParent.startsWith(`${normalizedTarget}/`)
}

const ROLE_LEVELS: Record<string, number> = { owner: 3, editor: 2, viewer: 1, member: 1 }

const requireObjectCreateAccess = createMiddleware<Env>(async (c, next) => {
  const principal = c.get('principal')
  if (principal?.kind === 'download-task-upload') {
    await next()
    return
  }
  if (!(await hasEditorAccess(c))) {
    return c.json({ error: c.get('userId') ? 'Forbidden' : 'Unauthorized' }, c.get('userId') ? 403 : 401)
  }
  await next()
})

const requireObjectPatchAccess = createMiddleware<Env>(async (c, next) => {
  const principal = c.get('principal')
  if (principal?.kind === 'download-task-upload') {
    await next()
    return
  }
  if (!(await hasEditorAccess(c))) {
    return c.json({ error: c.get('userId') ? 'Forbidden' : 'Unauthorized' }, c.get('userId') ? 403 : 401)
  }
  await next()
})

const app = new Hono<Env>()
  .use(async (c, next) => {
    const principal = c.get('principal')
    if (c.get('userId') || principal?.kind === 'download-task-upload') {
      await next()
      return
    }
    return c.json({ error: 'Unauthorized' }, 401)
  })
  .get('/', requireTeamRole('viewer'), async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) return c.json({ error: 'No active organization' }, 400)

    const parent = c.req.query('path') ?? c.req.query('parent') ?? ''
    const status = c.req.query('status') ?? 'active'
    const typeFilter = c.req.query('type')
    const search = c.req.query('search')
    const page = Number(c.req.query('page') ?? '1')
    const pageSize = Number(c.req.query('pageSize') ?? '20')

    const db = c.get('platform').db
    const result = await listMatters(db, orgId, { parent, status, typeFilter, search, page, pageSize })
    return c.json(result)
  })
  .post('/', requireObjectCreateAccess, zValidator('json', createMatterSchema), async (c) => {
    const principal = c.get('principal')
    const orgId = c.get('orgId')
    if (!orgId) return c.json({ error: 'No active organization' }, 400)

    const db = c.get('platform').db
    const userId = principal?.kind === 'download-task-upload' ? principal.createdByUserId : (c.get('userId') as string)
    const actorId =
      principal?.kind === 'download-task-upload' ? `downloader:${principal.downloaderId}` : (c.get('userId') as string)
    const { name, type, size, parent, dirtype, onConflict } = c.req.valid('json')
    const isFolder = dirtype !== DirType.FILE
    if (principal?.kind === 'download-task-upload') {
      if (!isWithinDownloadTarget(parent, principal.targetFolder))
        return c.json({ error: 'Target folder is outside task authorization' }, 403)
      await assertTaskUploadAllowed(c.get('platform'), {
        taskId: principal.taskId,
        downloaderId: principal.downloaderId,
      })
    }

    let storage: S3Storage
    try {
      storage = (await selectStorage(db, 'private')) as unknown as S3Storage
    } catch (error) {
      if (error instanceof Error && error.message === 'No available storage') {
        return c.json({ error: 'Storage not configured' }, 500)
      }
      throw error
    }
    const objectKey = isFolder
      ? ''
      : buildObjectKey({
          uid: userId,
          orgId,
          rawExt: fileExt(name),
        })

    try {
      const matter = await createMatter(db, {
        orgId,
        name,
        type: isFolder ? 'folder' : type,
        size: isFolder ? 0 : size,
        dirtype,
        parent,
        object: objectKey,
        storageId: storage.id,
        status: isFolder ? 'active' : 'draft',
        onConflict,
        userId: actorId,
      })
      if (isFolder) return c.json(matter, 201)
      const contentDisposition = `attachment; filename="${name.replace(/"/g, '\\"')}"; filename*=UTF-8''${encodeURIComponent(name)}`
      const uploadUrl = await s3.presignUpload(storage, objectKey, type, name)
      return c.json({ ...matter, uploadUrl, contentDisposition }, 201)
    } catch (e) {
      if (e instanceof NameConflictError) return c.json(conflictBody(e), 409)
      throw e
    }
  })
  .patch('/batch', requireTeamRole('editor'), zValidator('json', batchPatchSchema), async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) return c.json({ error: 'No active organization' }, 400)

    const body = c.req.valid('json')
    const db = c.get('platform').db

    switch (body.action) {
      case 'move': {
        const userId = c.get('userId')!
        try {
          const moved = await batchMove(db, orgId, body.ids, body.parent, userId, body.onConflict ?? 'fail')
          return c.json({ moved: moved.length })
        } catch (e) {
          if (e instanceof NameConflictError) return c.json(conflictBody(e), 409)
          return c.json({ error: (e as Error).message }, 400)
        }
      }
      case 'trash': {
        const userId = c.get('userId')!
        try {
          const trashed = await batchTrash(db, orgId, body.ids)
          await recordActivity(db, {
            orgId,
            userId,
            action: 'batch_trash',
            targetType: 'file',
            targetName: `${trashed.length} items`,
            metadata: { count: trashed.length, ids: body.ids },
          })
          return c.json({ trashed: trashed.length })
        } catch (e) {
          return c.json({ error: (e as Error).message }, 400)
        }
      }
    }
  })
  .delete('/batch', requireTeamRole('editor'), zValidator('json', batchDeleteSchema), async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) return c.json({ error: 'No active organization' }, 400)

    const userId = c.get('userId')!
    const { ids } = c.req.valid('json')
    const db = c.get('platform').db
    try {
      const uniqueIds = [...new Set(ids)]
      const items = await getMatters(db, orgId, uniqueIds)
      if (items.length !== uniqueIds.length) {
        return c.json({ error: 'Some IDs do not belong to this organization' }, 400)
      }
      if (items.some((m) => m.status !== 'trashed')) {
        return c.json({ error: 'Only trashed items can be permanently deleted' }, 400)
      }

      let purged = 0
      for (const item of items) {
        const ms = await collectForPurge(db, orgId, item)
        purged += await purgeRecursively(db, orgId, ms)
      }
      await recordActivity(db, {
        orgId,
        userId,
        action: 'batch_purge',
        targetType: 'file',
        targetName: `${purged} items`,
        metadata: { count: purged, ids: uniqueIds },
      })
      return c.json({ deleted: purged })
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400)
    }
  })
  .post('/:id/uploads', requireObjectCreateAccess, zValidator('json', createObjectUploadSessionSchema), async (c) =>
    objectUploadResponse(
      c,
      async () => {
        const orgId = c.get('orgId')
        if (!orgId) throw new ObjectUploadSessionError('not_found')
        const matter = await getMatter(c.get('platform').db, c.req.param('id'), orgId)
        if (!matter || matter.status !== 'draft' || matter.dirtype !== DirType.FILE || !matter.object) {
          throw new ObjectUploadSessionError('not_found')
        }
        const storage = (await getStorage(c.get('platform').db, matter.storageId)) as unknown as S3Storage | null
        if (!storage) throw new ObjectUploadSessionError('not_found')
        const principal = c.get('principal')
        if (principal?.kind === 'download-task-upload') {
          if (!isWithinDownloadTarget(matter.parent, principal.targetFolder))
            throw new ObjectUploadSessionError('invalid_state')
          await assertTaskUploadAllowed(c.get('platform'), {
            taskId: principal.taskId,
            downloaderId: principal.downloaderId,
          })
        }
        return createObjectUploadSession(c.get('platform').db, s3, {
          orgId,
          objectId: matter.id,
          storage,
          storageKey: matter.object,
          contentType: matter.type,
          partSize: c.req.valid('json').partSize,
          actorId: actorId(c),
        })
      },
      201,
    ),
  )
  .post(
    '/:id/uploads/:uploadSessionId/parts',
    requireObjectCreateAccess,
    zValidator('json', presignObjectUploadPartsSchema),
    async (c) =>
      objectUploadResponse(c, async () => {
        const orgId = c.get('orgId')
        if (!orgId) throw new ObjectUploadSessionError('not_found')
        const matter = await getMatter(c.get('platform').db, c.req.param('id'), orgId)
        if (!matter) throw new ObjectUploadSessionError('not_found')
        const storage = (await getStorage(c.get('platform').db, matter.storageId)) as unknown as S3Storage | null
        if (!storage) throw new ObjectUploadSessionError('not_found')
        return presignObjectUploadParts(c.get('platform').db, s3, {
          orgId,
          objectId: matter.id,
          sessionId: c.req.param('uploadSessionId'),
          storage,
          partNumbers: c.req.valid('json').partNumbers,
        })
      }),
  )
  .patch(
    '/:id/uploads/:uploadSessionId',
    requireObjectCreateAccess,
    zValidator('json', patchObjectUploadSessionSchema),
    async (c) =>
      objectUploadResponse(c, async () => {
        const orgId = c.get('orgId')
        if (!orgId) throw new ObjectUploadSessionError('not_found')
        const matter = await getMatter(c.get('platform').db, c.req.param('id'), orgId)
        if (!matter) throw new ObjectUploadSessionError('not_found')
        const storage = (await getStorage(c.get('platform').db, matter.storageId)) as unknown as S3Storage | null
        if (!storage) throw new ObjectUploadSessionError('not_found')
        return patchObjectUploadSession(c.get('platform').db, s3, {
          orgId,
          objectId: matter.id,
          sessionId: c.req.param('uploadSessionId'),
          storage,
          input: c.req.valid('json'),
        })
      }),
  )
  .get('/:id', requireTeamRole('viewer'), async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) return c.json({ error: 'No active organization' }, 400)

    const db = c.get('platform').db
    const matter = await getMatter(db, c.req.param('id'), orgId)
    if (!matter) return c.json({ error: 'Not found' }, 404)

    if (matter.dirtype !== DirType.FILE || !matter.object) {
      return c.json(matter)
    }

    const storage = (await getStorage(db, matter.storageId)) as unknown as S3Storage
    if (!storage) return c.json({ error: 'Storage not found' }, 404)

    const trafficAllowed = await consumeTrafficIfQuotaAllows(db, orgId, matter.size ?? 0)
    if (!trafficAllowed) return c.json({ error: 'Traffic quota exceeded' }, 422)

    const trafficReportError = await reportTrafficForDownload(c, {
      orgId,
      bytes: matter.size ?? 0,
      storage,
      source: 'object_download',
      sourceId: matter.id,
    })
    if (trafficReportError) return trafficReportError

    let downloadUrl: string
    try {
      downloadUrl = await s3.presignDownload(storage, matter.object, matter.name)
    } catch (e) {
      await refundTraffic(db, orgId, matter.size ?? 0)
      throw e
    }

    return c.json({ ...matter, downloadUrl })
  })
  .patch('/:id', requireObjectPatchAccess, zValidator('json', patchMatterSchema), async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) return c.json({ error: 'No active organization' }, 400)

    const db = c.get('platform').db
    const userId = actorId(c)
    const body = c.req.valid('json')
    const principal = c.get('principal')
    if (principal?.kind === 'download-task-upload') {
      if (body.action !== 'confirm')
        return c.json({ error: 'Download task upload token can only confirm uploads' }, 403)
      const matter = await getMatter(db, c.req.param('id'), orgId)
      if (!matter || !isWithinDownloadTarget(matter.parent, principal.targetFolder))
        return c.json({ error: 'Forbidden' }, 403)
      await assertTaskUploadAllowed(c.get('platform'), {
        taskId: principal.taskId,
        downloaderId: principal.downloaderId,
      })
    }

    switch (body.action) {
      case 'update': {
        try {
          const matter = await updateMatter(db, c.req.param('id'), orgId, body, userId)
          if (!matter) return c.json({ error: 'Not found' }, 404)
          return c.json(matter)
        } catch (e) {
          if (e instanceof NameConflictError) return c.json(conflictBody(e), 409)
          return c.json({ error: (e as Error).message }, 400)
        }
      }
      case 'confirm': {
        try {
          const { matter, quotaExceeded } = await confirmUpload(db, c.req.param('id'), orgId, {
            onConflict: body.onConflict,
            userId,
          })
          if (quotaExceeded) return c.json({ error: 'Quota exceeded' }, 422)
          if (!matter) return c.json({ error: 'Not found or not in draft status' }, 404)
          return c.json(matter)
        } catch (e) {
          if (e instanceof NameConflictError) return c.json(conflictBody(e), 409)
          throw e
        }
      }
      case 'cancel': {
        const matter = await cancelDraftMatter(db, c.req.param('id'), orgId, userId)
        if (!matter) return c.json({ error: 'Not found or not in draft status' }, 404)
        if (matter.object) {
          const storage = (await getStorage(db, matter.storageId)) as unknown as S3Storage | null
          if (storage) {
            try {
              await s3.deleteObject(storage, matter.object)
            } catch {
              // Best-effort cleanup: the browser may abort before S3 writes anything.
            }
          }
        }
        return c.json({ id: matter.id, cancelled: true })
      }
      case 'trash': {
        const matter = await trashMatter(db, orgId, c.req.param('id'), userId)
        if (!matter) return c.json({ error: 'Not found' }, 404)
        return c.json(matter)
      }
      case 'restore': {
        try {
          const matter = await restoreMatter(db, orgId, c.req.param('id'), userId, body.onConflict ?? 'fail')
          if (!matter) return c.json({ error: 'Not found' }, 404)
          return c.json(matter)
        } catch (e) {
          if (e instanceof NameConflictError) return c.json(conflictBody(e), 409)
          throw e
        }
      }
    }
  })
  .delete('/:id', requireTeamRole('editor'), async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) return c.json({ error: 'No active organization' }, 400)
    const userId = c.get('userId')!
    const db = c.get('platform').db
    const ms = await collectForPurge(db, orgId, c.req.param('id'))
    if (!ms) return c.json({ error: 'Not found' }, 404)
    if (ms[0].status !== 'trashed') {
      return c.json({ error: 'Object must be trashed before permanent deletion' }, 409)
    }
    const purged = await purgeRecursively(db, orgId, ms)
    await recordActivity(db, {
      orgId,
      userId,
      action: 'object_purge',
      targetType: ms[0].dirtype !== DirType.FILE ? 'folder' : 'file',
      targetId: ms[0].id,
      targetName: ms[0].name,
      metadata: { count: purged },
    })
    return c.json({ id: ms[0].id, deleted: true, purged })
  })
  .post('/copy', requireTeamRole('editor'), zValidator('json', copyMatterSchema), async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) return c.json({ error: 'No active organization' }, 400)

    const db = c.get('platform').db
    const userId = c.get('userId')!
    const { copyFrom, parent, onConflict } = c.req.valid('json')
    const source = await getMatter(db, copyFrom, orgId)
    if (!source) return c.json({ error: 'Not found' }, 404)

    const sourceSize = source.size ?? 0
    const storage = source.object ? ((await getStorage(db, source.storageId)) as unknown as S3Storage | null) : null
    if (source.object && !storage) return c.json({ error: 'Storage not found' }, 404)

    try {
      const copy = await withStorageUsageReservation(
        db,
        { orgId, storageId: source.storageId, bytes: sourceSize },
        async (ctx) => {
          let newObject = ''
          if (source.object) {
            newObject = buildObjectKey({
              uid: userId,
              orgId,
              rawExt: fileExt(source.name),
            })
            await s3.copyObject(storage as S3Storage, source.object, storage as S3Storage, newObject)
            ctx.onRollback(() => s3.deleteObject(storage as S3Storage, newObject))
          }
          return copyMatter(db, source, parent, newObject, { onConflict, userId })
        },
      )
      return c.json(copy, 201)
    } catch (e) {
      if (e instanceof StorageQuotaExceededError) return c.json({ error: 'Quota exceeded' }, 422)
      if (e instanceof NameConflictError) return c.json(conflictBody(e), 409)
      throw e
    }
  })

export default app

async function hasEditorAccess(c: Context<Env>): Promise<boolean> {
  const orgId = c.get('orgId')
  const userId = c.get('userId')
  if (!orgId || !userId) return false
  const role = await getMemberRole(c.get('platform').db, orgId, userId)
  if (role !== null) return (ROLE_LEVELS[role] ?? 0) >= ROLE_LEVELS.editor
  return isPersonalOrg(c.get('platform').db, orgId)
}

function actorId(c: Context<Env>): string {
  const principal = c.get('principal')
  if (principal?.kind === 'download-task-upload') return `downloader:${principal.downloaderId}`
  return c.get('userId') ?? 'system'
}

async function objectUploadResponse(c: Context<Env>, action: () => Promise<unknown>, status: 200 | 201 = 200) {
  try {
    return c.json(await action(), status)
  } catch (error) {
    if (error instanceof ObjectUploadSessionError) {
      if (error.code === 'storage_failure') {
        return c.json({ error: error.message }, 502)
      }
      return c.json(
        { error: error.code === 'not_found' ? 'Not found' : 'Invalid upload session state' },
        error.code === 'not_found' ? 404 : 409,
      )
    }
    throw error
  }
}
