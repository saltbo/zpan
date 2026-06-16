import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { listAdminAuditQuerySchema } from '@shared/schemas'
import { requireAdmin } from '../../middleware/auth'
import type { Env } from '../../middleware/platform'
import { requireFeature } from '../../middleware/require-feature'
import type { AdminAuditEventWithOrg } from '../../usecases/ports'
import { listAuditEvents } from '../../usecases/site/audit'
import { jsonContent } from '../openapi'

const auditEventSchema = z
  .object({
    id: z.string(),
    orgId: z.string(),
    userId: z.string(),
    action: z.string(),
    targetType: z.string(),
    targetId: z.string().nullable(),
    targetName: z.string(),
    metadata: z.string().nullable(),
    createdAt: z.string(),
    user: z.object({ id: z.string(), name: z.string(), image: z.string().nullable() }),
    orgName: z.string().nullable(),
  })
  .openapi('AuditEvent')

type AuditEventDTO = z.infer<typeof auditEventSchema>

function toAuditEventDTO(e: AdminAuditEventWithOrg): AuditEventDTO {
  return { ...e, createdAt: e.createdAt.toISOString() }
}

const auditPageSchema = z
  .object({
    items: z.array(auditEventSchema),
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
  })
  .openapi('AuditEventPage')

const listRoute = createRoute({
  operationId: 'listAuditEvents',
  summary: 'List audit events',
  tags: ['Audit'],
  method: 'get',
  path: '/',
  middleware: [requireAdmin, requireFeature('audit_log')] as const,
  request: { query: listAdminAuditQuerySchema },
  responses: { 200: jsonContent(auditPageSchema, 'Audit events') },
})

export const adminAudit = new OpenAPIHono<Env>().openapi(listRoute, async (c) => {
  const query = c.req.valid('query')
  const page = Math.max(1, Number(query.page ?? '1'))
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize ?? '20')))
  const result = await listAuditEvents(c.get('deps'), {
    page,
    pageSize,
    orgId: query.orgId,
    userId: query.userId,
    action: query.action,
    targetType: query.targetType,
  })
  return c.json({ ...result, items: result.items.map(toAuditEventDTO) }, 200)
})
