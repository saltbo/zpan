import { Hono } from 'hono'
import type { Env } from '../middleware/platform'
import { requireAuth } from '../middleware/auth'

const app = new Hono<Env>()
  .use(requireAuth)
  .get('/', async (c) => {
    // TODO: list storages
    return c.json({ items: [], total: 0 })
  })
  .post('/', async (c) => {
    // TODO: create storage
    return c.json({ message: 'not implemented' }, 501)
  })
  .get('/:id', async (c) => {
    // TODO: get storage detail
    return c.json({ message: 'not implemented' }, 501)
  })
  .put('/:id', async (c) => {
    // TODO: update storage
    return c.json({ message: 'not implemented' }, 501)
  })
  .delete('/:id', async (c) => {
    // TODO: delete storage
    return c.json({ message: 'not implemented' }, 501)
  })

export default app
