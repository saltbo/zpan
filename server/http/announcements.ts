import { zValidator } from '@hono/zod-validator'
import {
  announcementInputSchema,
  listAdminAnnouncementsQuerySchema,
  listAnnouncementsQuerySchema,
} from '@shared/schemas'
import { Hono } from 'hono'
import { requireAdmin, requireAuth } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import { requireFeature } from '../middleware/require-feature'
import {
  createAnnouncement,
  deleteAnnouncement,
  getAnnouncement,
  listAdminAnnouncements,
  listUserAnnouncements,
  updateAnnouncement,
} from '../usecases/announcement'

function pagination(query: { page?: string; pageSize?: string }) {
  return {
    page: Math.max(1, Number(query.page ?? '1')),
    pageSize: Math.min(100, Math.max(1, Number(query.pageSize ?? '20'))),
  }
}

export const announcements = new Hono<Env>()
  .use(requireAuth)
  .use(requireFeature('site_announcements'))
  .get('/', zValidator('query', listAnnouncementsQuerySchema), async (c) => {
    const query = c.req.valid('query')
    return c.json(
      await listUserAnnouncements(c.get('deps'), { activeOnly: query.scope === 'active', ...pagination(query) }),
    )
  })

export const adminAnnouncements = new Hono<Env>()
  .use(requireAdmin)
  .use(requireFeature('site_announcements'))
  .get('/', zValidator('query', listAdminAnnouncementsQuerySchema), async (c) => {
    const query = c.req.valid('query')
    return c.json(await listAdminAnnouncements(c.get('deps'), { status: query.status, ...pagination(query) }))
  })
  .post('/', zValidator('json', announcementInputSchema), async (c) => {
    const announcement = await createAnnouncement(c.get('deps'), c.req.valid('json'), c.get('userId')!)
    return c.json(announcement, 201)
  })
  .get('/:id', async (c) => {
    const announcement = await getAnnouncement(c.get('deps'), c.req.param('id'))
    if (!announcement) return c.json({ error: 'Announcement not found' }, 404)
    return c.json(announcement)
  })
  .put('/:id', zValidator('json', announcementInputSchema), async (c) => {
    const announcement = await updateAnnouncement(c.get('deps'), c.req.param('id'), c.req.valid('json'))
    if (!announcement) return c.json({ error: 'Announcement not found' }, 404)
    return c.json(announcement)
  })
  .delete('/:id', async (c) => {
    const id = c.req.param('id')
    const deleted = await deleteAnnouncement(c.get('deps'), id)
    if (!deleted) return c.json({ error: 'Announcement not found' }, 404)
    return c.json({ id, deleted: true })
  })
