import { zValidator } from '@hono/zod-validator'
import { announcementInputSchema, listAnnouncementsQuerySchema } from '@shared/schemas'
import { Hono } from 'hono'
import { requireAdmin, requireAuth } from '../../middleware/auth'
import type { Env } from '../../middleware/platform'
import { requireFeature } from '../../middleware/require-feature'
import {
  createAnnouncement,
  deleteAnnouncement,
  getAnnouncement,
  listAdminAnnouncements,
  listUserAnnouncements,
  updateAnnouncement,
} from '../../usecases/site/announcement'

function pagination(query: { page?: string; pageSize?: string }) {
  return {
    page: Math.max(1, Number(query.page ?? '1')),
    pageSize: Math.min(100, Math.max(1, Number(query.pageSize ?? '20'))),
  }
}

// One announcements resource. GET / is the caller's live feed by default;
// `?scope=all` (or a `?status=` filter) returns the admin management list.
// Writes are admin-only.
export const announcements = new Hono<Env>()
  .use(requireAuth)
  .use(requireFeature('site_announcements'))
  .get('/', zValidator('query', listAnnouncementsQuerySchema), async (c) => {
    const query = c.req.valid('query')
    const wantsManagement = query.scope === 'all' || query.status !== undefined
    if (wantsManagement) {
      if (c.get('userRole') !== 'admin') return c.json({ error: 'Forbidden' }, 403)
      return c.json(await listAdminAnnouncements(c.get('deps'), { status: query.status, ...pagination(query) }))
    }
    return c.json(
      await listUserAnnouncements(c.get('deps'), { activeOnly: query.scope === 'active', ...pagination(query) }),
    )
  })
  .post('/', requireAdmin, zValidator('json', announcementInputSchema), async (c) => {
    const announcement = await createAnnouncement(c.get('deps'), c.req.valid('json'), c.get('userId')!)
    return c.json(announcement, 201)
  })
  .get('/:id', requireAdmin, async (c) => {
    const announcement = await getAnnouncement(c.get('deps'), c.req.param('id'))
    if (!announcement) return c.json({ error: 'Announcement not found' }, 404)
    return c.json(announcement)
  })
  .put('/:id', requireAdmin, zValidator('json', announcementInputSchema), async (c) => {
    const announcement = await updateAnnouncement(c.get('deps'), c.req.param('id'), c.req.valid('json'))
    if (!announcement) return c.json({ error: 'Announcement not found' }, 404)
    return c.json(announcement)
  })
  .delete('/:id', requireAdmin, async (c) => {
    const id = c.req.param('id')
    const deleted = await deleteAnnouncement(c.get('deps'), id)
    if (!deleted) return c.json({ error: 'Announcement not found' }, 404)
    return c.json({ id, deleted: true })
  })
