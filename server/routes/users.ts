import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import { requireAdmin } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import { deleteUser, listUsers, setUserStatus } from '../services/user'

const updateStatusSchema = z.object({
  status: z.enum(['active', 'disabled']),
})

const app = new Hono<Env>()
  .use(requireAdmin)
  .get('/', async (c) => {
    const db = c.get('platform').db
    const page = Math.max(1, Number(c.req.query('page') ?? '1'))
    const pageSize = Math.min(100, Math.max(1, Number(c.req.query('pageSize') ?? '20')))

    const result = await listUsers(db, page, pageSize)
    return c.json(result)
  })
  .put('/:id/status', zValidator('json', updateStatusSchema), async (c) => {
    const db = c.get('platform').db
    const userId = c.req.param('id')
    const { status } = c.req.valid('json')

    const updated = await setUserStatus(db, userId, status)
    if (!updated) {
      return c.json({ error: 'User not found' }, 404)
    }

    return c.json({ id: userId, status })
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
