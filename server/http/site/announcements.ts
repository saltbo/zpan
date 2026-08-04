import { OpenAPIHono, z } from '@hono/zod-openapi'
import { AuthorizationScope } from '@shared/authorization'
import { announcementInputSchema, announcementStatusSchema, pageQuerySchema, pageSchema } from '@shared/schemas'
import { opaqueIdSchema } from '@shared/schemas/identifiers'
import type { Env } from '../../middleware/platform'
import { requireFeature } from '../../middleware/require-feature'
import { type AnnouncementRecord, forbidden, notFound } from '../../usecases/ports'
import {
  createAnnouncement,
  deleteAnnouncement,
  getAnnouncement,
  listAdminAnnouncements,
  listUserAnnouncements,
  updateAnnouncement,
} from '../../usecases/site/announcement'
import { authRoute, errorResponse, jsonBody, jsonContent } from '../openapi'

const announcementSchema = z
  .object({
    id: opaqueIdSchema,
    title: z.string(),
    body: z.string(),
    status: z.string(),
    priority: z.number().int(),
    publishedAt: z.string().nullable(),
    expiresAt: z.string().nullable(),
    createdBy: opaqueIdSchema,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('Announcement')

type AnnouncementDTO = z.infer<typeof announcementSchema>

function toAnnouncementDTO(a: AnnouncementRecord): AnnouncementDTO {
  return {
    ...a,
    publishedAt: a.publishedAt ? a.publishedAt.toISOString() : null,
    expiresAt: a.expiresAt ? a.expiresAt.toISOString() : null,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  }
}

const announcementListSchema = pageSchema(announcementSchema, 'AnnouncementList')

// `active` = the caller's live feed (any authed user); `all` = full management
// list (admin only). Absent = live feed.
const listAnnouncementsQuerySchema = pageQuerySchema.extend({
  scope: z.enum(['active', 'all']).optional(),
  status: announcementStatusSchema.optional(),
})

const listRoute = authRoute(
  { scopes: [AuthorizationScope.ANNOUNCEMENTS_READ] },
  {
    operationId: 'listAnnouncements',
    summary: 'List announcements',
    tags: ['Announcements'],
    method: 'get',
    path: '/',
    middleware: [requireFeature('site_announcements')] as const,
    request: { query: listAnnouncementsQuerySchema },
    responses: {
      200: jsonContent(announcementListSchema, 'Announcements'),
      403: errorResponse('Forbidden'),
    },
  },
)

const createAnnouncementRoute = authRoute(
  { scopes: [AuthorizationScope.ANNOUNCEMENTS_CREATE], siteRole: 'admin' },
  {
    operationId: 'createAnnouncement',
    summary: 'Create announcement',
    tags: ['Announcements'],
    method: 'post',
    path: '/',
    middleware: [requireFeature('site_announcements')] as const,
    request: jsonBody(announcementInputSchema),
    responses: { 201: jsonContent(announcementSchema, 'Created announcement') },
  },
)

const getAnnouncementRoute = authRoute(
  { scopes: [AuthorizationScope.ANNOUNCEMENTS_READ], siteRole: 'admin' },
  {
    operationId: 'getAnnouncement',
    summary: 'Get announcement',
    tags: ['Announcements'],
    method: 'get',
    path: '/{id}',
    middleware: [requireFeature('site_announcements')] as const,
    request: { params: z.object({ id: opaqueIdSchema }) },
    responses: {
      200: jsonContent(announcementSchema, 'Announcement'),
      404: errorResponse('Announcement not found'),
    },
  },
)

const updateAnnouncementRoute = authRoute(
  { scopes: [AuthorizationScope.ANNOUNCEMENTS_UPDATE], siteRole: 'admin' },
  {
    operationId: 'updateAnnouncement',
    summary: 'Update announcement',
    tags: ['Announcements'],
    method: 'put',
    path: '/{id}',
    middleware: [requireFeature('site_announcements')] as const,
    request: { params: z.object({ id: opaqueIdSchema }), ...jsonBody(announcementInputSchema) },
    responses: {
      200: jsonContent(announcementSchema, 'Updated announcement'),
      404: errorResponse('Announcement not found'),
    },
  },
)

const deleteAnnouncementRoute = authRoute(
  { scopes: [AuthorizationScope.ANNOUNCEMENTS_DELETE], siteRole: 'admin' },
  {
    operationId: 'deleteAnnouncement',
    summary: 'Delete announcement',
    tags: ['Announcements'],
    method: 'delete',
    path: '/{id}',
    middleware: [requireFeature('site_announcements')] as const,
    request: { params: z.object({ id: opaqueIdSchema }) },
    responses: {
      204: { description: 'Deleted announcement' },
      404: errorResponse('Announcement not found'),
    },
  },
)

const app = new OpenAPIHono<Env>()

// One announcements resource. GET / is the caller's live feed by default;
// `?scope=all` (or a `?status=` filter) returns the admin management list. Writes
// are admin-only.
export const announcements = app
  .openapi(listRoute, async (c) => {
    const query = c.req.valid('query')
    const { page, pageSize } = query
    const wantsManagement = query.scope === 'all' || query.status !== undefined
    if (wantsManagement) {
      if (c.get('userRole') !== 'admin') throw forbidden()
      const result = await listAdminAnnouncements(c.get('deps'), { status: query.status, page, pageSize })
      return c.json({ ...result, items: result.items.map(toAnnouncementDTO) }, 200)
    }
    const result = await listUserAnnouncements(c.get('deps'), {
      activeOnly: query.scope === 'active',
      page,
      pageSize,
    })
    return c.json({ ...result, items: result.items.map(toAnnouncementDTO) }, 200)
  })
  .openapi(createAnnouncementRoute, async (c) =>
    c.json(toAnnouncementDTO(await createAnnouncement(c.get('deps'), c.req.valid('json'), c.get('userId')!)), 201),
  )
  .openapi(getAnnouncementRoute, async (c) => {
    const announcement = await getAnnouncement(c.get('deps'), c.req.valid('param').id)
    if (!announcement) throw notFound('Announcement not found')
    return c.json(toAnnouncementDTO(announcement), 200)
  })
  .openapi(updateAnnouncementRoute, async (c) => {
    const announcement = await updateAnnouncement(c.get('deps'), c.req.valid('param').id, c.req.valid('json'))
    if (!announcement) throw notFound('Announcement not found')
    return c.json(toAnnouncementDTO(announcement), 200)
  })
  .openapi(deleteAnnouncementRoute, async (c) => {
    const id = c.req.valid('param').id
    const deleted = await deleteAnnouncement(c.get('deps'), id)
    if (!deleted) throw notFound('Announcement not found')
    return c.body(null, 204)
  })
