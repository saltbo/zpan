import { createStorageSchema, updateStorageSchema } from '@zpan/shared/schemas'
import { Hono } from 'hono'
import { requireAdmin } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import { StorageService } from '../services/storage'

const app = new Hono<Env>()
  .use(requireAdmin)
  .get('/', async (c) => {
    const service = new StorageService(c.get('platform').db)
    const result = await service.list()
    return c.json(result)
  })
  .post('/', async (c) => {
    const body = await c.req.json()
    const parsed = createStorageSchema.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400)
    }

    const service = new StorageService(c.get('platform').db)
    const storage = await service.create(parsed.data, c.get('userId')!)
    return c.json(storage, 201)
  })
  .get('/:id', async (c) => {
    const service = new StorageService(c.get('platform').db)
    const storage = await service.getById(c.req.param('id'))
    if (!storage) {
      return c.json({ error: 'Not found' }, 404)
    }
    return c.json(storage)
  })
  .put('/:id', async (c) => {
    const body = await c.req.json()
    const parsed = updateStorageSchema.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400)
    }

    const service = new StorageService(c.get('platform').db)
    const storage = await service.update(c.req.param('id'), parsed.data)
    if (!storage) {
      return c.json({ error: 'Not found' }, 404)
    }
    return c.json(storage)
  })
  .delete('/:id', async (c) => {
    const service = new StorageService(c.get('platform').db)
    const result = await service.delete(c.req.param('id'))
    if ('conflict' in result) {
      return c.json({ error: 'Storage is referenced by existing files' }, 409)
    }
    if ('notFound' in result) {
      return c.json({ error: 'Not found' }, 404)
    }
    return c.json({ deleted: true })
  })

export default app
