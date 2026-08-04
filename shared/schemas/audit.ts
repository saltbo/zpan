import { z } from 'zod'
import { opaqueIdSchema } from './identifiers'

export const listAdminAuditQuerySchema = z.object({
  page: z.string().optional(),
  pageSize: z.string().optional(),
  orgId: opaqueIdSchema.optional(),
  userId: opaqueIdSchema.optional(),
  action: z.string().optional(),
  targetType: z.string().optional(),
  createdFrom: z.string().datetime().optional(),
  createdTo: z.string().datetime().optional(),
})

export type ListAdminAuditQuery = z.infer<typeof listAdminAuditQuerySchema>
