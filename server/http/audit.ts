import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { listAdminAuditQuerySchema } from '../../shared/schemas'
import { requireAdmin } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import { requireFeature } from '../middleware/require-feature'
import { listAdminAuditEvents } from '../services/activity'

export const adminAudit = new Hono<Env>()
  .use(requireAdmin)
  .use(requireFeature('audit_log'))
  .get('/', zValidator('query', listAdminAuditQuerySchema), async (c) => {
    const db = c.get('platform').db
    const query = c.req.valid('query')
    const page = Math.max(1, Number(query.page ?? '1'))
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize ?? '20')))

    const result = await listAdminAuditEvents(db, {
      page,
      pageSize,
      orgId: query.orgId,
      userId: query.userId,
      action: query.action,
      targetType: query.targetType,
    })

    return c.json(result)
  })
