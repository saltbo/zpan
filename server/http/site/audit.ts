import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { pageQuerySchema, pageSchema } from '@shared/schemas'
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

const auditPageSchema = pageSchema(auditEventSchema, 'AuditEventPage')

const listAuditQuerySchema = pageQuerySchema.extend({
  orgId: z.string().optional(),
  userId: z.string().optional(),
  action: z.string().optional(),
  targetType: z.string().optional(),
})

const listRoute = createRoute({
  operationId: 'listAuditEvents',
  summary: 'List audit events',
  tags: ['Audit'],
  method: 'get',
  path: '/',
  middleware: [requireAdmin, requireFeature('audit_log')] as const,
  request: { query: listAuditQuerySchema },
  responses: { 200: jsonContent(auditPageSchema, 'Audit events') },
})

export const adminAudit = new OpenAPIHono<Env>().openapi(listRoute, async (c) => {
  const { page, pageSize, orgId, userId, action, targetType } = c.req.valid('query')
  const result = await listAuditEvents(c.get('deps'), {
    page,
    pageSize,
    orgId,
    userId,
    action,
    targetType,
  })
  return c.json({ ...result, items: result.items.map(toAuditEventDTO) }, 200)
})
