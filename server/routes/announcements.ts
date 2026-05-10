import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import {
  announcementInputSchema,
  listAdminAnnouncementsQuerySchema,
  listAnnouncementsQuerySchema,
} from '../../shared/schemas'
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
} from '../services/announcement'

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
    const db = c.get('platform').db
    const query = c.req.valid('query')
    const result = await listUserAnnouncements(db, {
      activeOnly: query.scope === 'active',
      ...pagination(query),
    })
    return c.json(result)
  })

export const adminAnnouncements = new Hono<Env>()
  .use(requireAdmin)
  .use(requireFeature('site_announcements'))
  .get('/', zValidator('query', listAdminAnnouncementsQuerySchema), async (c) => {
    const db = c.get('platform').db
    const query = c.req.valid('query')
    const result = await listAdminAnnouncements(db, { status: query.status, ...pagination(query) })
    return c.json(result)
  })
  .post('/', zValidator('json', announcementInputSchema), async (c) => {
    const db = c.get('platform').db
    const userId = c.get('userId')!
    const announcement = await createAnnouncement(db, c.req.valid('json'), userId)
    return c.json(announcement, 201)
  })
  .get('/:id', async (c) => {
    const db = c.get('platform').db
    const id = c.req.param('id')
    const announcement = await getAnnouncement(db, id)
    if (!announcement) return c.json({ error: 'Announcement not found' }, 404)
    return c.json(announcement)
  })
  .put('/:id', zValidator('json', announcementInputSchema), async (c) => {
    const db = c.get('platform').db
    const id = c.req.param('id')
    const announcement = await updateAnnouncement(db, id, c.req.valid('json'))
    if (!announcement) return c.json({ error: 'Announcement not found' }, 404)
    return c.json(announcement)
  })
  .delete('/:id', async (c) => {
    const db = c.get('platform').db
    const id = c.req.param('id')
    const deleted = await deleteAnnouncement(db, id)
    if (!deleted) return c.json({ error: 'Announcement not found' }, 404)
    return c.json({ id, deleted: true })
  })
