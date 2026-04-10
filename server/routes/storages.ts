import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { createStorageSchema, updateStorageSchema } from '../../shared/schemas'
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
  .post('/', zValidator('json', createStorageSchema), async (c) => {
    const db = c.get('platform').db
    const storage = await createStorage(db, c.req.valid('json'))
    return c.json(storage, 201)
  })
  .get('/:id', async (c) => {
    const db = c.get('platform').db
    const id = c.req.param('id')
    const storage = await getStorage(db, id)
    if (!storage) return c.json({ error: 'Storage not found' }, 404)
    return c.json(storage)
  })
  .put('/:id', zValidator('json', updateStorageSchema), async (c) => {
    const db = c.get('platform').db
    const id = c.req.param('id')
    const storage = await updateStorage(db, id, c.req.valid('json'))
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
