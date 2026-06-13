import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { listNotificationsQuerySchema } from '../../shared/schemas'
import { requireAuth } from '../middleware/auth'
import type { Env } from '../middleware/platform'

export const notifications = new Hono<Env>()
  .use(requireAuth)
  .get('/', zValidator('query', listNotificationsQuerySchema), async (c) => {
    const userId = c.get('userId')!
    const { page: pageStr, pageSize: pageSizeStr, unread } = c.req.valid('query')
    const page = Number(pageStr ?? '1')
    const pageSize = Number(pageSizeStr ?? '20')
    const unreadOnly = unread === 'true'

    const result = await c.get('deps').notifications.list(userId, { page, pageSize, unreadOnly })
    return c.json({ ...result, page, pageSize })
  })
  .get('/stats', async (c) => {
    const userId = c.get('userId')!
    const count = await c.get('deps').notifications.unreadCount(userId)
    return c.json({ count })
  })
  .patch('/:id', async (c) => {
    const userId = c.get('userId')!
    const { id } = c.req.param()

    const found = await c.get('deps').notifications.markAsRead(userId, id)
    if (!found) return c.json({ error: 'Not found' }, 404)

    return new Response(null, { status: 204 })
  })
  .patch('/', async (c) => {
    const userId = c.get('userId')!
    const result = await c.get('deps').notifications.markAllAsRead(userId)
    return c.json(result)
  })
