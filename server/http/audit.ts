import { zValidator } from '@hono/zod-validator'
import { listAdminAuditQuerySchema } from '@shared/schemas'
import { Hono } from 'hono'
import { requireAdmin } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import { requireFeature } from '../middleware/require-feature'
import { listAuditEvents } from '../usecases/audit'

export const adminAudit = new Hono<Env>()
  .use(requireAdmin)
  .use(requireFeature('audit_log'))
  .get('/', zValidator('query', listAdminAuditQuerySchema), async (c) => {
    const query = c.req.valid('query')
    const page = Math.max(1, Number(query.page ?? '1'))
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize ?? '20')))
    return c.json(
      await listAuditEvents(c.get('deps'), {
        page,
        pageSize,
        orgId: query.orgId,
        userId: query.userId,
        action: query.action,
        targetType: query.targetType,
      }),
    )
  })
