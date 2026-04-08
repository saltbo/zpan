import { Hono } from 'hono'
import { requireAdmin } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import { deleteUser, listUsers, setUserStatus } from '../services/user'

const app = new Hono<Env>()
  .use(requireAdmin)
  .get('/', async (c) => {
    const db = c.get('platform').db
    const page = Math.max(1, Number(c.req.query('page') ?? '1'))
    const pageSize = Math.min(100, Math.max(1, Number(c.req.query('pageSize') ?? '20')))

    const result = await listUsers(db, page, pageSize)
    return c.json(result)
  })
  .put('/:id/status', async (c) => {
    const db = c.get('platform').db
    const userId = c.req.param('id')
    const body = await c.req.json<{ status: string }>()

    if (body.status !== 'active' && body.status !== 'disabled') {
      return c.json({ error: 'status must be "active" or "disabled"' }, 400)
    }

    const updated = await setUserStatus(db, userId, body.status)
    if (!updated) {
      return c.json({ error: 'User not found' }, 404)
    }

    return c.json({ id: userId, status: body.status })
  })
  .delete('/:id', async (c) => {
    const db = c.get('platform').db
    const userId = c.req.param('id')

    const deleted = await deleteUser(db, userId)
    if (!deleted) {
      return c.json({ error: 'User not found' }, 404)
    }

    return c.json({ id: userId, deleted: true })
  })

export default app
