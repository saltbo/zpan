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
    const result = await c.get('deps').announcements.listUser({
      activeOnly: query.scope === 'active',
      ...pagination(query),
    })
    return c.json(result)
  })

export const adminAnnouncements = new Hono<Env>()
  .use(requireAdmin)
  .use(requireFeature('site_announcements'))
  .get('/', zValidator('query', listAdminAnnouncementsQuerySchema), async (c) => {
    const query = c.req.valid('query')
    const result = await c.get('deps').announcements.listAdmin({ status: query.status, ...pagination(query) })
    return c.json(result)
  })
  .post('/', zValidator('json', announcementInputSchema), async (c) => {
    const userId = c.get('userId')!
    const announcement = await c.get('deps').announcements.create(c.req.valid('json'), userId)
    return c.json(announcement, 201)
  })
  .get('/:id', async (c) => {
    const id = c.req.param('id')
    const announcement = await c.get('deps').announcements.get(id)
    if (!announcement) return c.json({ error: 'Announcement not found' }, 404)
    return c.json(announcement)
  })
  .put('/:id', zValidator('json', announcementInputSchema), async (c) => {
    const id = c.req.param('id')
    const announcement = await c.get('deps').announcements.update(id, c.req.valid('json'))
    if (!announcement) return c.json({ error: 'Announcement not found' }, 404)
    return c.json(announcement)
  })
  .delete('/:id', async (c) => {
    const id = c.req.param('id')
    const deleted = await c.get('deps').announcements.delete(id)
    if (!deleted) return c.json({ error: 'Announcement not found' }, 404)
    return c.json({ id, deleted: true })
  })
