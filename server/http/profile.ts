import { Hono } from 'hono'
import type { Env } from '../middleware/platform'
import { getPublicProfile } from '../usecases/profile'

const app = new Hono<Env>()
  .get('/:username', async (c) => {
    const user = await getPublicProfile(c.get('deps'), c.req.param('username'))
    if (!user) return c.json({ error: 'User not found' }, 404)
    return c.json({ user, shares: [] })
  })
  .get('/:username/browse', async (c) => {
    const user = await getPublicProfile(c.get('deps'), c.req.param('username'))
    if (!user) return c.json({ error: 'User not found' }, 404)
    return c.json({ items: [], breadcrumb: [] })
  })

export default app
