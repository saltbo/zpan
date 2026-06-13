import { zValidator } from '@hono/zod-validator'
import type { Context } from 'hono'
import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import { DirType } from '../../shared/constants'
import { attachmentContentDisposition } from '../../shared/content-disposition'
import {
  copyMatterSchema,
  createMatterSchema,
  createObjectUploadSessionSchema,
  patchMatterSchema,
  patchObjectUploadSessionSchema,
  presignObjectUploadPartsSchema,
  transferMatterSchema,
} from '../../shared/schemas'
import { mapDomainError } from '../lib/http-errors'
import { buildObjectKey, fileExt } from '../lib/path-template'
import { requireTeamRole } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import { assertTaskUploadAllowed } from '../services/downloads'
import {
  cancelDraftMatter,
  collectForPurge,
  confirmUpload,
  copyMatter,
  createMatter,
  getMatter,
  listMatters,
  restoreMatter,
  trashMatter,
  updateMatter,
} from '../services/matter'
import { S3Service } from '../services/s3'
import {
  createObjectUploadSession,
  ObjectUploadSessionError,
  patchObjectUploadSession,
  presignObjectUploadParts,
} from '../usecases/object-upload-session'
import type { StorageRecord as S3Storage } from '../usecases/ports'
import { purgeRecursively } from '../usecases/purge'
import { copyMatterToOrg } from '../usecases/save-to-drive'
import { withStorageUsageReservation } from '../usecases/storage-usage'
import { consumeAndReportDownloadTraffic } from './traffic-metering-utils'

const s3 = new S3Service()

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
    let orgId = c.get('orgId')
    if (!orgId) return c.json({ error: 'No active organization' }, 400)

    // Optional org override so pickers (e.g. cross-space transfer) can browse
    // folders of another space the user has access to.
    const orgOverride = c.req.query('orgId')
    if (orgOverride && orgOverride !== orgId) {
      if (!(await c.get('deps').org.canReadOrg(c.get('userId')!, orgOverride))) {
        return c.json({ error: 'Forbidden' }, 403)
      }
      orgId = orgOverride
    }

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
      storage = await c.get('deps').storages.select('private')
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
      const contentDisposition = attachmentContentDisposition(name)
      const uploadUrl = await s3.presignUpload(storage, objectKey, type, name)
      return c.json({ ...matter, uploadUrl, contentDisposition }, 201)
    } catch (e) {
      const mapped = mapDomainError(e)
      if (mapped) return c.json(mapped.json, mapped.status)
      throw e
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
        const storage = await c.get('deps').storages.get(matter.storageId)
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
        return createObjectUploadSession(c.get('deps'), {
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
        const storage = await c.get('deps').storages.get(matter.storageId)
        if (!storage) throw new ObjectUploadSessionError('not_found')
        return presignObjectUploadParts(c.get('deps'), {
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
        const storage = await c.get('deps').storages.get(matter.storageId)
        if (!storage) throw new ObjectUploadSessionError('not_found')
        return patchObjectUploadSession(c.get('deps'), {
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

    const storage = await c.get('deps').storages.get(matter.storageId)
    if (!storage) return c.json({ error: 'Storage not found' }, 404)

    const trafficError = await consumeAndReportDownloadTraffic(c, {
      orgId,
      bytes: matter.size ?? 0,
      storage,
      source: 'object_download',
      sourceId: matter.id,
      quotaExceeded: () => c.json({ error: 'Traffic quota exceeded' }, 422),
    })
    if (trafficError) return trafficError

    let downloadUrl: string
    try {
      downloadUrl = await s3.presignDownload(storage, matter.object, matter.name)
    } catch (e) {
      await c.get('deps').quota.refundTraffic(orgId, matter.size ?? 0)
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
          const mapped = mapDomainError(e)
          if (mapped) return c.json(mapped.json, mapped.status)
          return c.json({ error: (e as Error).message }, 400)
        }
      }
      case 'confirm': {
        try {
          const { matter, quotaExceeded } = await confirmUpload(db, c.req.param('id'), orgId, {
            onConflict: body.onConflict,
            userId,
            purgeReplaced: (incumbent) => purgeRecursively(c.get('deps'), db, orgId, [incumbent]).then(() => undefined),
          })
          if (quotaExceeded) return c.json({ error: 'Quota exceeded' }, 422)
          if (!matter) return c.json({ error: 'Not found or not in draft status' }, 404)
          return c.json(matter)
        } catch (e) {
          const mapped = mapDomainError(e)
          if (mapped) return c.json(mapped.json, mapped.status)
          throw e
        }
      }
      case 'cancel': {
        const matter = await cancelDraftMatter(db, c.req.param('id'), orgId, userId)
        if (!matter) return c.json({ error: 'Not found or not in draft status' }, 404)
        if (matter.object) {
          const storage = await c.get('deps').storages.get(matter.storageId)
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
          const mapped = mapDomainError(e)
          if (mapped) return c.json(mapped.json, mapped.status)
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
    const purged = await purgeRecursively(c.get('deps'), db, orgId, ms)
    await c.get('deps').activity.record({
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
    const storage = source.object ? await c.get('deps').storages.get(source.storageId) : null
    if (source.object && !storage) return c.json({ error: 'Storage not found' }, 404)

    try {
      const copy = await withStorageUsageReservation(
        c.get('deps'),
        { orgId, storageId: source.storageId, bytes: sourceSize },
        async (ctx) => {
          let newObject = ''
          if (source.object) {
            // storage is non-null here: line 424 returns 404 when source.object
            // is set but storage is missing.
            const objectStorage = storage as S3Storage
            newObject = buildObjectKey({
              uid: userId,
              orgId,
              rawExt: fileExt(source.name),
            })
            await s3.copyObject(objectStorage, source.object, objectStorage, newObject)
            ctx.onRollback(() => s3.deleteObject(objectStorage, newObject))
          }
          return copyMatter(db, source, parent, newObject, { onConflict, userId })
        },
      )
      return c.json(copy, 201)
    } catch (e) {
      const mapped = mapDomainError(e)
      if (mapped) return c.json(mapped.json, mapped.status)
      throw e
    }
  })
  .post('/:id/transfers', requireTeamRole('viewer'), zValidator('json', transferMatterSchema), async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) return c.json({ error: 'No active organization' }, 400)

    const db = c.get('platform').db
    const userId = c.get('userId')!
    const { targetOrgId, targetParent, mode } = c.req.valid('json')
    if (targetOrgId === orgId) return c.json({ error: 'Target must be a different space', code: 'SAME_ORG' }, 400)

    const source = await getMatter(db, c.req.param('id'), orgId)
    if (!source || source.status !== 'active') return c.json({ error: 'Not found' }, 404)

    // Copying out only needs read access on the source space (granted by the
    // route middleware); moving also trashes the source, which needs editor.
    if (mode === 'move' && !(await hasEditorAccess(c))) {
      return c.json({ error: 'Forbidden' }, 403)
    }
    if (!(await c.get('deps').org.canWriteToOrg(userId, targetOrgId))) {
      return c.json({ error: 'Forbidden' }, 403)
    }

    const totalBytes = await c.get('deps').share.computeSourceBytes(source)
    if (!(await c.get('deps').share.hasQuotaForBytes(targetOrgId, totalBytes))) {
      return c.json({ error: 'Quota exceeded', code: 'QUOTA_EXCEEDED' }, 422)
    }

    const result = await copyMatterToOrg(c.get('deps'), db, {
      sourceMatter: source,
      currentUserId: userId,
      targetOrgId,
      targetParent,
      activity: {
        action: mode === 'move' ? 'moved_from_org' : 'copied_from_org',
        metadata: { sourceOrgId: orgId, sourceMatterId: source.id },
      },
    })

    // Move = copy + delete source. Only delete when every file copied — a
    // partial copy must never destroy the originals. The source is purged (not
    // trashed) so its quota is actually released: trashed files still count
    // toward usage, which would otherwise double-charge the moved bytes in both
    // spaces. The independent copy already lives in the target space.
    let sourceDeleted = false
    if (mode === 'move' && result.skipped.length === 0) {
      const subtree = await collectForPurge(db, orgId, source)
      await purgeRecursively(c.get('deps'), db, orgId, subtree)
      sourceDeleted = true
      await c.get('deps').activity.record({
        orgId,
        userId,
        action: 'moved_to_org',
        targetType: source.dirtype === DirType.FILE ? 'file' : 'folder',
        targetId: source.id,
        targetName: source.name,
        metadata: { targetOrgId },
      })
    }

    return c.json({ ...result, sourceDeleted }, 201)
  })

export default app

async function hasEditorAccess(c: Context<Env>): Promise<boolean> {
  const orgId = c.get('orgId')
  const userId = c.get('userId')
  if (!orgId || !userId) return false
  const role = await c.get('deps').org.getMemberRole(orgId, userId)
  if (role !== null) return (ROLE_LEVELS[role] ?? 0) >= ROLE_LEVELS.editor
  return c.get('deps').org.isPersonalOrg(orgId)
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
