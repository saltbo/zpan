import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { listNotificationsQuerySchema } from '../../shared/schemas'
import { requireAuth } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import { listNotifications, markAllAsRead, markAsRead, unreadCount } from '../services/notification'

export const notifications = new Hono<Env>()
  .use(requireAuth)
  .get('/', zValidator('query', listNotificationsQuerySchema), async (c) => {
    const db = c.get('platform').db
    const userId = c.get('userId')!
    const { page: pageStr, pageSize: pageSizeStr, unread } = c.req.valid('query')
    const page = Number(pageStr ?? '1')
    const pageSize = Number(pageSizeStr ?? '20')
    const unreadOnly = unread === 'true'

    const result = await listNotifications(db, userId, { page, pageSize, unreadOnly })
    return c.json({ ...result, page, pageSize })
  })
  .get('/unread-count', async (c) => {
    const db = c.get('platform').db
    const userId = c.get('userId')!
    const count = await unreadCount(db, userId)
    return c.json({ count })
  })
  .post('/:id/read', async (c) => {
    const db = c.get('platform').db
    const userId = c.get('userId')!
    const { id } = c.req.param()

    const found = await markAsRead(db, userId, id)
    if (!found) return c.json({ error: 'Not found' }, 404)

    return new Response(null, { status: 204 })
  })
  .post('/read-all', async (c) => {
    const db = c.get('platform').db
    const userId = c.get('userId')!
    const result = await markAllAsRead(db, userId)
    return c.json(result)
  })
