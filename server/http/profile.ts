import { Hono } from 'hono'
import type { Env } from '../middleware/platform'

const app = new Hono<Env>()
  .get('/:username', async (c) => {
    const { username } = c.req.param()
    const profileUser = await c.get('deps').profiles.getUserByUsername(username)
    if (!profileUser) return c.json({ error: 'User not found' }, 404)
    return c.json({ user: profileUser, shares: [] })
  })
  .get('/:username/browse', async (c) => {
    const { username } = c.req.param()
    const profileUser = await c.get('deps').profiles.getUserByUsername(username)
    if (!profileUser) return c.json({ error: 'User not found' }, 404)
    return c.json({ items: [], breadcrumb: [] })
  })

export default app
