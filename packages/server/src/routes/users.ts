import { Hono } from 'hono'
import type { Env } from '../middleware/platform'
import { requireAuth } from '../middleware/auth'

const app = new Hono<Env>()
  .use(requireAuth)
  .get('/', async (c) => {
    // TODO: list users (admin only)
    return c.json({ items: [], total: 0 })
  })
  .put('/:id/status', async (c) => {
    // TODO: update user status (admin only)
    return c.json({ message: 'not implemented' }, 501)
  })

export default app
