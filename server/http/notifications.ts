import { zValidator } from '@hono/zod-validator'
import { listNotificationsQuerySchema } from '@shared/schemas'
import { Hono } from 'hono'
import { requireAuth } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import {
  getUnreadCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../usecases/notification'

export const notifications = new Hono<Env>()
  .use(requireAuth)
  .get('/', zValidator('query', listNotificationsQuerySchema), async (c) => {
    const { page: pageStr, pageSize: pageSizeStr, unread } = c.req.valid('query')
    const page = Number(pageStr ?? '1')
    const pageSize = Number(pageSizeStr ?? '20')
    const result = await listNotifications(c.get('deps'), c.get('userId')!, {
      page,
      pageSize,
      unreadOnly: unread === 'true',
    })
    return c.json({ ...result, page, pageSize })
  })
  .get('/stats', async (c) => {
    const count = await getUnreadCount(c.get('deps'), c.get('userId')!)
    return c.json({ count })
  })
  .patch('/:id', async (c) => {
    const found = await markNotificationRead(c.get('deps'), c.get('userId')!, c.req.param('id'))
    if (!found) return c.json({ error: 'Not found' }, 404)
    return new Response(null, { status: 204 })
  })
  .patch('/', async (c) => c.json(await markAllNotificationsRead(c.get('deps'), c.get('userId')!)))
