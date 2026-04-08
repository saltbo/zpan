import { DirType } from '@zpan/shared/constants'
import { copyMatterSchema, createMatterSchema, updateMatterSchema } from '@zpan/shared/schemas'
import type { Storage as S3Storage } from '@zpan/shared/types'
import { Hono } from 'hono'
import { requireAuth } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import {
  confirmUpload,
  copyMatter,
  createMatter,
  deleteMatter,
  getMatter,
  listMatters,
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
  .post('/', async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) return c.json({ error: 'No active organization' }, 400)

    const raw = await c.req.json()
    const parsed = createMatterSchema.safeParse(raw)
    if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400)

    const db = c.get('platform').db
    const userId = c.get('userId')!
    const { name, type, size, parent, dirtype } = parsed.data
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
  .patch('/:id', async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) return c.json({ error: 'No active organization' }, 400)

    const raw = await c.req.json()
    const parsed = updateMatterSchema.safeParse(raw)
    if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400)

    const db = c.get('platform').db
    const matter = await updateMatter(db, c.req.param('id'), orgId, parsed.data)
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
  .delete('/:id', async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) return c.json({ error: 'No active organization' }, 400)

    const db = c.get('platform').db
    const matter = await deleteMatter(db, c.req.param('id'), orgId)
    if (!matter) return c.json({ error: 'Not found' }, 404)

    if (matter.object) {
      const storage = (await getStorage(db, matter.storageId)) as unknown as S3Storage
      if (storage) await s3.deleteObject(storage, matter.object)
    }

    return c.json({ id: matter.id, deleted: true })
  })
  .post('/:id/copy', async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) return c.json({ error: 'No active organization' }, 400)

    const raw = await c.req.json()
    const parsed = copyMatterSchema.safeParse(raw)
    if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400)

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

    const copy = await copyMatter(db, source, parsed.data.parent, newObject)
    return c.json(copy, 201)
  })

export default app
