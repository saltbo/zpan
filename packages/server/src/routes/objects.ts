import { Hono } from 'hono'
import { requireAuth } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import type { Database } from '../platform/interface'
import type { Matter } from '../services/matter'
import { collectForDeletion, collectTrash, permanentDelete, restore, trash } from '../services/matter'
import { getStorage } from '../services/storage'

async function deleteS3Objects(db: Database, matters: Matter[]): Promise<void> {
  const { S3Service } = await import('../services/s3')
  const s3 = new S3Service()

  const files = matters.filter((m) => m.dirtype === 0 && m.object)
  const storageIds = [...new Set(files.map((f) => f.storageId))]
  for (const storageId of storageIds) {
    const storage = await getStorage(db, storageId)
    if (!storage) continue
    const keys = files.filter((f) => f.storageId === storageId).map((f) => f.object)
    // Storage service type is structurally compatible at runtime
    await s3.deleteObjects(storage as unknown as import('@zpan/shared/types').Storage, keys)
  }
}

const app = new Hono<Env>()

app.use(requireAuth)

app.get('/', async (c) => {
  const _userId = c.get('userId')!
  const _parent = c.req.query('parent') ?? ''
  const _status = c.req.query('status') ?? 'active'
  const _type = c.req.query('type')
  const _search = c.req.query('search')
  const _page = Number(c.req.query('page') ?? '1')
  const _pageSize = Number(c.req.query('pageSize') ?? '20')
  // TODO: Drizzle query with filters
  return c.json({ items: [], total: 0, page: _page, pageSize: _pageSize })
})

app.post('/', async (c) => {
  // TODO: create object (file or folder), return presigned URL for files
  return c.json({ message: 'not implemented' }, 501)
})

app.get('/:id', async (c) => {
  // TODO: get object detail + download URL
  return c.json({ message: 'not implemented' }, 501)
})

app.patch('/:id', async (c) => {
  // TODO: update attributes (name, parent)
  return c.json({ message: 'not implemented' }, 501)
})

app.patch('/:id/status', async (c) => {
  // TODO: status transition (active, trashed)
  return c.json({ message: 'not implemented' }, 501)
})

app.delete('/:id', async (c) => {
  // TODO: permanent delete (DB record + S3 object)
  return c.json({ message: 'not implemented' }, 501)
})

app.post('/:id/copy', async (c) => {
  // TODO: copy object to target parent
  return c.json({ message: 'not implemented' }, 501)
})

// Recycle bin endpoints

app.patch('/:id/trash', async (c) => {
  const db = c.get('platform').db
  const orgId = c.get('orgId')!
  const matterId = c.req.param('id')

  const result = await trash(db, orgId, matterId)
  if (result === 'not_found') return c.json({ error: 'Not found' }, 404)
  if (result === 'already_trashed') return c.json({ error: 'Already trashed' }, 409)

  return c.json({ ok: true })
})

app.patch('/:id/restore', async (c) => {
  const db = c.get('platform').db
  const orgId = c.get('orgId')!
  const matterId = c.req.param('id')

  const result = await restore(db, orgId, matterId)
  if (result === 'not_found') return c.json({ error: 'Not found' }, 404)
  if (result === 'not_trashed') return c.json({ error: 'Not in trash' }, 409)

  return c.json({ ok: true })
})

app.delete('/:id/permanent', async (c) => {
  const db = c.get('platform').db
  const orgId = c.get('orgId')!
  const matterId = c.req.param('id')

  const collected = await collectForDeletion(db, orgId, matterId)
  if (collected.result !== 'ok') {
    const status = collected.result === 'not_found' ? 404 : 409
    const error = collected.result === 'not_found' ? 'Not found' : 'Must be trashed before permanent delete'
    return c.json({ error }, status)
  }

  await deleteS3Objects(db, collected.matters)
  await permanentDelete(db, collected.matters)
  return c.json({ ok: true })
})

// POST /api/objects/trash/empty — permanently delete all trashed items
// Uses /:id/empty pattern where id="trash" to work around Hono sub-router limits
app.post('/:id/empty', async (c) => {
  const id = c.req.param('id')
  if (id !== 'trash') return c.json({ error: 'Not found' }, 404)

  const db = c.get('platform').db
  const orgId = c.get('orgId')!

  const trashed = await collectTrash(db, orgId)
  if (trashed.length === 0) return c.json({ ok: true, deleted: 0 })

  await deleteS3Objects(db, trashed)
  await permanentDelete(db, trashed)
  return c.json({ ok: true, deleted: trashed.length })
})

export { deleteS3Objects }
export default app
