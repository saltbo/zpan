import { Hono } from 'hono'
import type { Env } from '../middleware/platform'
import { requireAuth } from '../middleware/auth'

const app = new Hono<Env>()
  .use(requireAuth)
  .get('/', async (c) => {
    // TODO: list trashed files
    return c.json({ items: [], total: 0 })
  })
  .put('/:alias', async (c) => {
    // TODO: restore file
    return c.json({ message: 'not implemented' }, 501)
  })
  .delete('/:alias', async (c) => {
    // TODO: permanent delete
    return c.json({ message: 'not implemented' }, 501)
  })
  .delete('/', async (c) => {
    // TODO: empty recycle bin
    return c.json({ message: 'not implemented' }, 501)
  })

export default app
