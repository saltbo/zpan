import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { DirType } from '../../shared/constants'
import {
  batchIdsSchema,
  batchMoveSchema,
  confirmUploadSchema,
  copyMatterSchema,
  createMatterSchema,
  restoreMatterSchema,
  updateMatterSchema,
} from '../../shared/schemas'
import type { Storage as S3Storage } from '../../shared/types'
import { requireAuth, requireTeamRole } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import {
  batchMove,
  batchTrash,
  collectForPurge,
  confirmUpload,
  copyMatter,
  createMatter,
  getMatter,
  getMatters,
  incrementUsageIfAllowed,
  listMatters,
  restoreMatter,
  trashMatter,
  updateMatter,
} from '../services/matter'
import { NameConflictError } from '../services/matter-name-conflict'
import { buildObjectKey } from '../services/path-template'
import { purgeRecursively } from '../services/purge'
import { S3Service } from '../services/s3'
import { getStorage, selectStorage } from '../services/storage'

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

const app = new Hono<Env>()
  .use(requireAuth)
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
  .post('/', requireTeamRole('editor'), zValidator('json', createMatterSchema), async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) return c.json({ error: 'No active organization' }, 400)

    const db = c.get('platform').db
    const userId = c.get('userId')!
    const { name, type, size, parent, dirtype, onConflict } = c.req.valid('json')
    const isFolder = dirtype !== DirType.FILE

    const storage = (await selectStorage(db, 'private')) as unknown as S3Storage
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
        userId,
        name,
        type: isFolder ? 'folder' : type,
        size: isFolder ? 0 : size,
        dirtype,
        parent,
        object: objectKey,
        storageId: storage.id,
        status: isFolder ? 'active' : 'draft',
        onConflict,
      })
      if (isFolder) return c.json(matter, 201)
      const uploadUrl = await s3.presignUpload(storage, objectKey, type)
      return c.json({ ...matter, uploadUrl }, 201)
    } catch (e) {
      if (e instanceof NameConflictError) return c.json(conflictBody(e), 409)
      throw e
    }
  })
  .post('/batch/move', requireTeamRole('editor'), zValidator('json', batchMoveSchema), async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) return c.json({ error: 'No active organization' }, 400)

    const { ids, parent, onConflict } = c.req.valid('json')
    const db = c.get('platform').db
    const userId = c.get('userId')!
    try {
      const moved = await batchMove(db, orgId, ids, parent, userId, onConflict ?? 'fail')
      return c.json({ moved: moved.length })
    } catch (e) {
      if (e instanceof NameConflictError) return c.json(conflictBody(e), 409)
      return c.json({ error: (e as Error).message }, 400)
    }
  })
  .post('/batch/trash', requireTeamRole('editor'), zValidator('json', batchIdsSchema), async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) return c.json({ error: 'No active organization' }, 400)

    const { ids } = c.req.valid('json')
    const db = c.get('platform').db
    try {
      const trashed = await batchTrash(db, orgId, ids)
      return c.json({ trashed: trashed.length })
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400)
    }
  })
  .post('/batch/delete', requireTeamRole('editor'), zValidator('json', batchIdsSchema), async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) return c.json({ error: 'No active organization' }, 400)

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
      return c.json({ deleted: purged })
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400)
    }
  })
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

    const downloadUrl = await s3.presignDownload(storage, matter.object, matter.name)
    return c.json({ ...matter, downloadUrl })
  })
  .patch('/:id', requireTeamRole('editor'), zValidator('json', updateMatterSchema), async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) return c.json({ error: 'No active organization' }, 400)

    const db = c.get('platform').db
    const userId = c.get('userId')!
    try {
      const matter = await updateMatter(db, c.req.param('id'), orgId, c.req.valid('json'), userId)
      if (!matter) return c.json({ error: 'Not found' }, 404)
      return c.json(matter)
    } catch (e) {
      if (e instanceof NameConflictError) return c.json(conflictBody(e), 409)
      return c.json({ error: (e as Error).message }, 400)
    }
  })
  .patch('/:id/done', requireTeamRole('editor'), zValidator('json', confirmUploadSchema), async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) return c.json({ error: 'No active organization' }, 400)

    const db = c.get('platform').db
    const userId = c.get('userId')!
    const { onConflict } = c.req.valid('json')
    try {
      const { matter, quotaExceeded } = await confirmUpload(db, c.req.param('id'), orgId, { onConflict, userId })
      if (quotaExceeded) return c.json({ error: 'Quota exceeded' }, 422)
      if (!matter) return c.json({ error: 'Not found or not in draft status' }, 404)
      return c.json(matter)
    } catch (e) {
      if (e instanceof NameConflictError) return c.json(conflictBody(e), 409)
      throw e
    }
  })
  .patch('/:id/trash', requireTeamRole('editor'), async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) return c.json({ error: 'No active organization' }, 400)
    const db = c.get('platform').db
    const userId = c.get('userId')!
    const matter = await trashMatter(db, orgId, c.req.param('id'), userId)
    if (!matter) return c.json({ error: 'Not found' }, 404)
    return c.json(matter)
  })
  .patch('/:id/restore', requireTeamRole('editor'), zValidator('json', restoreMatterSchema), async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) return c.json({ error: 'No active organization' }, 400)
    const db = c.get('platform').db
    const userId = c.get('userId')!
    const { onConflict } = c.req.valid('json')
    try {
      const matter = await restoreMatter(db, orgId, c.req.param('id'), userId, onConflict ?? 'fail')
      if (!matter) return c.json({ error: 'Not found' }, 404)
      return c.json(matter)
    } catch (e) {
      if (e instanceof NameConflictError) return c.json(conflictBody(e), 409)
      throw e
    }
  })
  .delete('/:id', requireTeamRole('editor'), async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) return c.json({ error: 'No active organization' }, 400)
    const db = c.get('platform').db
    const ms = await collectForPurge(db, orgId, c.req.param('id'))
    if (!ms) return c.json({ error: 'Not found' }, 404)
    if (ms[0].status !== 'trashed') {
      return c.json({ error: 'Object must be trashed before permanent deletion' }, 409)
    }
    const purged = await purgeRecursively(db, orgId, ms)
    return c.json({ id: ms[0].id, deleted: true, purged })
  })
  .post('/:id/copy', requireTeamRole('editor'), zValidator('json', copyMatterSchema), async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) return c.json({ error: 'No active organization' }, 400)

    const db = c.get('platform').db
    const userId = c.get('userId')!
    const source = await getMatter(db, c.req.param('id'), orgId)
    if (!source) return c.json({ error: 'Not found' }, 404)

    const sourceSize = source.size ?? 0
    if (sourceSize > 0) {
      const allowed = await incrementUsageIfAllowed(db, orgId, source.storageId, sourceSize)
      if (!allowed) return c.json({ error: 'Quota exceeded' }, 422)
    }

    let newObject = ''
    if (source.object) {
      const storage = (await getStorage(db, source.storageId)) as unknown as S3Storage
      if (!storage) return c.json({ error: 'Storage not found' }, 404)
      newObject = buildObjectKey({
        uid: userId,
        orgId,
        rawExt: fileExt(source.name),
      })
      await s3.copyObject(storage, source.object, storage, newObject)
    }

    const { parent, onConflict } = c.req.valid('json')
    try {
      const copy = await copyMatter(db, source, parent, newObject, { onConflict, userId })
      return c.json(copy, 201)
    } catch (e) {
      if (e instanceof NameConflictError) return c.json(conflictBody(e), 409)
      throw e
    }
  })

export default app
