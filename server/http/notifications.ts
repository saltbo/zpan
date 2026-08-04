import { OpenAPIHono, z } from '@hono/zod-openapi'
import { AuthorizationScope } from '@shared/authorization'
import { cursorPageSchema, listNotificationsQuerySchema } from '@shared/schemas'
import { opaqueIdSchema } from '@shared/schemas/identifiers'
import type { Env } from '../middleware/platform'
import {
  getUnreadCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../usecases/notification'
import { type NotificationRecord, notFound } from '../usecases/ports'
import { authRoute, errorResponse, jsonContent } from './openapi'
import {
  createdAtIdCursorCodec,
  decodeOptionalPageToken,
  encodeNextPageToken,
  pageQueryFingerprint,
} from './page-token'

const notificationSchema = z
  .object({
    id: opaqueIdSchema,
    userId: opaqueIdSchema,
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
const notificationPageSchema = cursorPageSchema(notificationSchema, 'NotificationPage')

const listRoute = authRoute(
  { scopes: [AuthorizationScope.NOTIFICATIONS_READ] },
  {
    operationId: 'listNotifications',
    summary: 'List notifications',
    tags: ['Notifications'],
    method: 'get',
    path: '/',
    request: { query: listNotificationsQuerySchema },
    responses: { 200: jsonContent(notificationPageSchema, 'Notifications') },
  },
)

const statsRoute = authRoute(
  { scopes: [AuthorizationScope.NOTIFICATIONS_READ] },
  {
    operationId: 'getNotificationStats',
    summary: 'Get unread notification count',
    tags: ['Notifications'],
    method: 'get',
    path: '/stats',
    responses: { 200: jsonContent(z.object({ count: z.number().int() }), 'Unread count') },
  },
)

const markReadRoute = authRoute(
  { scopes: [AuthorizationScope.NOTIFICATIONS_UPDATE] },
  {
    operationId: 'markNotificationRead',
    summary: 'Mark a notification read',
    tags: ['Notifications'],
    method: 'patch',
    path: '/{id}',
    request: { params: z.object({ id: opaqueIdSchema }) },
    responses: {
      204: { description: 'Marked read' },
      404: errorResponse('Not found'),
    },
  },
)

const markAllReadRoute = authRoute(
  { scopes: [AuthorizationScope.NOTIFICATIONS_UPDATE] },
  {
    operationId: 'markAllNotificationsRead',
    summary: 'Mark all notifications read',
    tags: ['Notifications'],
    method: 'patch',
    path: '/',
    responses: { 200: jsonContent(z.object({ count: z.number().int() }), 'Number marked read') },
  },
)

const app = new OpenAPIHono<Env>()

export const notifications = app
  .openapi(listRoute, async (c) => {
    const { pageToken, pageSize, unread } = c.req.valid('query')
    const userId = c.get('userId')!
    const fingerprint = await pageQueryFingerprint({ userId, unread: unread === 'true', pageSize })
    const after = await decodeOptionalPageToken(c.get('platform'), pageToken, {
      query: fingerprint,
      codec: createdAtIdCursorCodec,
    })
    const result = await listNotifications(c.get('deps'), c.get('userId')!, {
      pageSize,
      unreadOnly: unread === 'true',
      after,
    })
    return c.json(
      {
        items: result.items.map(toNotificationDTO),
        nextPageToken: await encodeNextPageToken(c.get('platform'), result.nextBoundary, {
          query: fingerprint,
          codec: createdAtIdCursorCodec,
        }),
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
