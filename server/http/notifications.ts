import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { listNotificationsQuerySchema, pageSchema } from '@shared/schemas'
import { requireAuth } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import {
  getUnreadCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../usecases/notification'
import { type NotificationRecord, notFound } from '../usecases/ports'
import { errorResponse, jsonContent } from './openapi'

const notificationSchema = z
  .object({
    id: z.string(),
    userId: z.string(),
    type: z.string(),
    title: z.string(),
    body: z.string(),
    refType: z.string().nullable(),
    refId: z.string().nullable(),
    metadata: z.string().nullable(),
    readAt: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi('Notification')

type NotificationDTO = z.infer<typeof notificationSchema>

// Serialize the domain record's `Date` timestamps to ISO strings — the one place
// the domain type crosses to the wire.
function toNotificationDTO(n: NotificationRecord): NotificationDTO {
  return {
    id: n.id,
    userId: n.userId,
    type: n.type,
    title: n.title,
    body: n.body,
    refType: n.refType,
    refId: n.refId,
    metadata: n.metadata,
    readAt: n.readAt ? n.readAt.toISOString() : null,
    createdAt: n.createdAt.toISOString(),
  }
}

// The unread count is intentionally NOT part of the list envelope — it lives only
// at GET /stats so the list shares the one Page<T> shape with every other resource.
const notificationPageSchema = pageSchema(notificationSchema, 'NotificationPage')

const listRoute = createRoute({
  operationId: 'listNotifications',
  summary: 'List notifications',
  tags: ['Notifications'],
  method: 'get',
  path: '/',
  request: { query: listNotificationsQuerySchema },
  responses: { 200: jsonContent(notificationPageSchema, 'Notifications') },
})

const statsRoute = createRoute({
  operationId: 'getNotificationStats',
  summary: 'Get unread notification count',
  tags: ['Notifications'],
  method: 'get',
  path: '/stats',
  responses: { 200: jsonContent(z.object({ count: z.number().int() }), 'Unread count') },
})

const markReadRoute = createRoute({
  operationId: 'markNotificationRead',
  summary: 'Mark a notification read',
  tags: ['Notifications'],
  method: 'patch',
  path: '/{id}',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    204: { description: 'Marked read' },
    404: errorResponse('Not found'),
  },
})

const markAllReadRoute = createRoute({
  operationId: 'markAllNotificationsRead',
  summary: 'Mark all notifications read',
  tags: ['Notifications'],
  method: 'patch',
  path: '/',
  responses: { 200: jsonContent(z.object({ count: z.number().int() }), 'Number marked read') },
})

const app = new OpenAPIHono<Env>()
app.use(requireAuth)

export const notifications = app
  .openapi(listRoute, async (c) => {
    const { page, pageSize, unread } = c.req.valid('query')
    const result = await listNotifications(c.get('deps'), c.get('userId')!, {
      page,
      pageSize,
      unreadOnly: unread === 'true',
    })
    return c.json(
      {
        items: result.items.map(toNotificationDTO),
        total: result.total,
        page,
        pageSize,
      },
      200,
    )
  })
  .openapi(statsRoute, async (c) => {
    const count = await getUnreadCount(c.get('deps'), c.get('userId')!)
    return c.json({ count }, 200)
  })
  .openapi(markReadRoute, async (c) => {
    const found = await markNotificationRead(c.get('deps'), c.get('userId')!, c.req.valid('param').id)
    if (!found) throw notFound()
    return c.body(null, 204)
  })
  .openapi(markAllReadRoute, async (c) => c.json(await markAllNotificationsRead(c.get('deps'), c.get('userId')!), 200))
