import { Hono } from 'hono'
import type { Env } from '../middleware/platform'
import { requireAuth } from '../middleware/auth'

const app = new Hono<Env>()
  .use(requireAuth)
  .get('/', async (c) => {
    // TODO: list users (admin only)
    return c.json({ items: [], total: 0 })
  })
  .get('/:id', async (c) => {
    // TODO: get user detail (admin only)
    return c.json({ message: 'not implemented' }, 501)
  })
  .patch('/:id', async (c) => {
    // TODO: update user role/status/quota (admin only)
    return c.json({ message: 'not implemented' }, 501)
  })
  .delete('/:id', async (c) => {
    // TODO: delete user (admin only)
    return c.json({ message: 'not implemented' }, 501)
  })

export default app
