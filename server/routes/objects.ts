import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { DirType } from '../../shared/constants'
import {
  batchIdsSchema,
  batchMoveSchema,
  copyMatterSchema,
  createMatterSchema,
  updateMatterSchema,
} from '../../shared/schemas'
import type { Storage as S3Storage } from '../../shared/types'
import { requireAuth } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import {
  batchDelete,
  batchMove,
  batchTrash,
  collectForPurge,
  confirmUpload,
  copyMatter,
  createMatter,
  decrementUsage,
  getMatter,
  listMatters,
  purgeMatters,
  restoreMatter,
  trashMatter,
  updateMatter,
} from '../services/matter'
import { buildObjectKey } from '../services/path-template'
import { S3Service } from '../services/s3'
import { getStorage, selectStorage } from '../services/storage'

const s3 = new S3Service()

function fileExt(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot) : ''
}

async function purgeRecursively(
  db: import('../platform/interface').Database,
  orgId: string,
  matters: import('../services/matter').Matter[],
): Promise<number> {
  const keysByStorage = new Map<string, { storage: S3Storage | null; keys: string[] }>()
  const bytesByStorage = new Map<string, number>()
  let totalBytes = 0

  for (const m of matters) {
    if (m.dirtype === 0 && m.size > 0) {
      bytesByStorage.set(m.storageId, (bytesByStorage.get(m.storageId) ?? 0) + m.size)
      totalBytes += m.size
    }
    if (!m.object) continue
    let entry = keysByStorage.get(m.storageId)
    if (!entry) {
      const storage = (await getStorage(db, m.storageId)) as unknown as S3Storage | null
      entry = { storage, keys: [] }
      keysByStorage.set(m.storageId, entry)
    }
    entry.keys.push(m.object)
  }

  for (const { storage, keys } of keysByStorage.values()) {
    if (storage && keys.length > 0) await s3.deleteObjects(storage, keys)
  }

  await purgeMatters(
    db,
    orgId,
    matters.map((m) => m.id),
  )
  await decrementUsage(db, orgId, bytesByStorage, totalBytes)
  return matters.length
}

const app = new Hono<Env>()
  .use(requireAuth)
  .get('/', async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) return c.json({ error: 'No active organization' }, 400)

    const parent = c.req.query('parent') ?? ''
    const status = c.req.query('status') ?? 'active'
    const page = Number(c.req.query('page') ?? '1')
    const pageSize = Number(c.req.query('pageSize') ?? '20')

    const db = c.get('platform').db
    const result = await listMatters(db, orgId, { parent, status, page, pageSize })
    return c.json(result)
  })
  .post('/', zValidator('json', createMatterSchema), async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) return c.json({ error: 'No active organization' }, 400)

    const db = c.get('platform').db
    const userId = c.get('userId')!
    const { name, type, size, parent, dirtype } = c.req.valid('json')
    const isFolder = dirtype !== DirType.FILE

    const storage = (await selectStorage(db, 'private')) as unknown as S3Storage
    const objectKey = isFolder
      ? ''
      : buildObjectKey(storage.filePath, {
          uid: userId,
          orgId,
          rawName: name.replace(/\.[^.]+$/, '') || name,
          rawExt: fileExt(name),
          uuid: crypto.randomUUID(),
        })

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
    })

    if (isFolder) return c.json(matter, 201)

    const uploadUrl = await s3.presignUpload(storage, objectKey, type)
    return c.json({ ...matter, uploadUrl }, 201)
  })
  .post('/batch/move', zValidator('json', batchMoveSchema), async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) return c.json({ error: 'No active organization' }, 400)

    const { ids, parent } = c.req.valid('json')
    const db = c.get('platform').db
    try {
      const moved = await batchMove(db, orgId, ids, parent)
      return c.json({ moved: moved.length })
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400)
    }
  })
  .post('/batch/trash', zValidator('json', batchIdsSchema), async (c) => {
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
  .post('/batch/delete', zValidator('json', batchIdsSchema), async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) return c.json({ error: 'No active organization' }, 400)

    const { ids } = c.req.valid('json')
    const db = c.get('platform').db
    try {
      const deleted = await batchDelete(db, orgId, ids)

      const byStorage = new Map<string, string[]>()
      for (const m of deleted) {
        if (!m.object) continue
        const keys = byStorage.get(m.storageId) ?? []
        keys.push(m.object)
        byStorage.set(m.storageId, keys)
      }
      for (const [storageId, keys] of byStorage) {
        const storage = (await getStorage(db, storageId)) as unknown as S3Storage
        if (storage) await s3.deleteObjects(storage, keys)
      }

      return c.json({ deleted: deleted.length })
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400)
    }
  })
  .get('/:id', async (c) => {
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
  .patch('/:id', zValidator('json', updateMatterSchema), async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) return c.json({ error: 'No active organization' }, 400)

    const db = c.get('platform').db
    const matter = await updateMatter(db, c.req.param('id'), orgId, c.req.valid('json'))
    if (!matter) return c.json({ error: 'Not found' }, 404)
    return c.json(matter)
  })
  .patch('/:id/done', async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) return c.json({ error: 'No active organization' }, 400)

    const db = c.get('platform').db
    const matter = await confirmUpload(db, c.req.param('id'), orgId)
    if (!matter) return c.json({ error: 'Not found or not in draft status' }, 404)
    return c.json(matter)
  })
  .patch('/:id/trash', async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) return c.json({ error: 'No active organization' }, 400)
    const db = c.get('platform').db
    const matter = await trashMatter(db, orgId, c.req.param('id'))
    if (!matter) return c.json({ error: 'Not found' }, 404)
    return c.json(matter)
  })
  .patch('/:id/restore', async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) return c.json({ error: 'No active organization' }, 400)
    const db = c.get('platform').db
    const matter = await restoreMatter(db, orgId, c.req.param('id'))
    if (!matter) return c.json({ error: 'Not found' }, 404)
    return c.json(matter)
  })
  .delete('/:id', async (c) => {
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
  .post('/:id/copy', zValidator('json', copyMatterSchema), async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) return c.json({ error: 'No active organization' }, 400)

    const db = c.get('platform').db
    const source = await getMatter(db, c.req.param('id'), orgId)
    if (!source) return c.json({ error: 'Not found' }, 404)

    let newObject = ''
    if (source.object) {
      const storage = (await getStorage(db, source.storageId)) as unknown as S3Storage
      if (!storage) return c.json({ error: 'Storage not found' }, 404)
      newObject = buildObjectKey(storage.filePath, {
        uid: c.get('userId')!,
        orgId,
        rawName: source.name.replace(/\.[^.]+$/, '') || source.name,
        rawExt: fileExt(source.name),
        uuid: crypto.randomUUID(),
      })
      await s3.copyObject(storage, source.object, storage, newObject)
    }

    const copy = await copyMatter(db, source, c.req.valid('json').parent, newObject)
    return c.json(copy, 201)
  })

export default app
