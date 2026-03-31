import { Hono } from 'hono'
import type { Env } from '../middleware/platform'
import { requireAuth } from '../middleware/auth'

const app = new Hono<Env>()
  .get('/options/:key', async (c) => {
    // TODO: get system option (public ones don't need auth)
    return c.json({ key: c.req.param('key'), value: '' })
  })
  .put('/options/:key', requireAuth, async (c) => {
    // TODO: update system option (admin only)
    return c.json({ message: 'not implemented' }, 501)
  })

export default app
