import { createStorageSchema, updateStorageSchema } from '@zpan/shared/schemas'
import { Hono } from 'hono'
import { requireAdmin } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import { createStorage, deleteStorage, getStorage, listStorages, updateStorage } from '../services/storage'

const app = new Hono<Env>()
  .use(requireAdmin)
  .get('/', async (c) => {
    const db = c.get('platform').db
    const result = await listStorages(db)
    return c.json(result)
  })
  .post('/', async (c) => {
    const db = c.get('platform').db
    const raw = await c.req.json()
    const parsed = createStorageSchema.safeParse(raw)
    if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400)
    const storage = await createStorage(db, parsed.data)
    return c.json(storage, 201)
  })
  .get('/:id', async (c) => {
    const db = c.get('platform').db
    const id = c.req.param('id')
    const storage = await getStorage(db, id)
    if (!storage) return c.json({ error: 'Storage not found' }, 404)
    return c.json(storage)
  })
  .put('/:id', async (c) => {
    const db = c.get('platform').db
    const id = c.req.param('id')
    const raw = await c.req.json()
    const parsed = updateStorageSchema.safeParse(raw)
    if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400)
    const storage = await updateStorage(db, id, parsed.data)
    if (!storage) return c.json({ error: 'Storage not found' }, 404)
    return c.json(storage)
  })
  .delete('/:id', async (c) => {
    const db = c.get('platform').db
    const id = c.req.param('id')
    const result = await deleteStorage(db, id)
    if (result === 'not_found') return c.json({ error: 'Storage not found' }, 404)
    if (result === 'in_use') return c.json({ error: 'Storage is referenced by existing files' }, 409)
    return c.json({ id, deleted: true })
  })

export default app
