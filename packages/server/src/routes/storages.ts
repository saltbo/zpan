import { createStorageSchema, updateStorageSchema } from '@zpan/shared/schemas'
import { Hono } from 'hono'
import { requireAdmin } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import { createStorage, deleteStorage, getStorage, listStorages, updateStorage } from '../services/storage.js'

const app = new Hono<Env>()
  .use(requireAdmin)
  .get('/', async (c) => {
    const db = c.get('platform').db
    const items = await listStorages(db)
    return c.json({ items, total: items.length })
  })
  .post('/', async (c) => {
    const db = c.get('platform').db
    const uid = c.get('userId')!
    const body = await c.req.json()
    const parsed = createStorageSchema.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0].message }, 400)
    }
    const storage = await createStorage(db, { ...parsed.data, uid })
    return c.json(storage, 201)
  })
  .get('/:id', async (c) => {
    const db = c.get('platform').db
    const storage = await getStorage(db, c.req.param('id'))
    if (!storage) return c.json({ error: 'Not found' }, 404)
    return c.json(storage)
  })
  .put('/:id', async (c) => {
    const db = c.get('platform').db
    const body = await c.req.json()
    const parsed = updateStorageSchema.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0].message }, 400)
    }
    const storage = await updateStorage(db, c.req.param('id'), parsed.data)
    if (!storage) return c.json({ error: 'Not found' }, 404)
    return c.json(storage)
  })
  .delete('/:id', async (c) => {
    const db = c.get('platform').db
    const result = await deleteStorage(db, c.req.param('id'))
    if (result === 'not_found') return c.json({ error: 'Not found' }, 404)
    if (result === 'referenced') return c.json({ error: 'Storage has referenced files' }, 409)
    return c.json({ id: c.req.param('id'), deleted: true })
  })

export default app
