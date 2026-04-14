import { Hono } from 'hono'
import type { Env } from '../middleware/platform'
import { getUserByUsername } from '../services/profile'

const app = new Hono<Env>()
  .get('/:username', async (c) => {
    const db = c.get('platform').db
    const { username } = c.req.param()
    const profileUser = await getUserByUsername(db, username)
    if (!profileUser) return c.json({ error: 'User not found' }, 404)
    return c.json({ user: profileUser, shares: [] })
  })
  .get('/:username/browse', async (c) => {
    const db = c.get('platform').db
    const { username } = c.req.param()
    const profileUser = await getUserByUsername(db, username)
    if (!profileUser) return c.json({ error: 'User not found' }, 404)
    return c.json({ items: [], breadcrumb: [] })
  })

export default app
