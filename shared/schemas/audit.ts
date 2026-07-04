import { z } from 'zod'

export const listAdminAuditQuerySchema = z.object({
  page: z.string().optional(),
  pageSize: z.string().optional(),
  orgId: z.string().optional(),
  userId: z.string().optional(),
  action: z.string().optional(),
  targetType: z.string().optional(),
  createdFrom: z.string().datetime().optional(),
  createdTo: z.string().datetime().optional(),
})

export type ListAdminAuditQuery = z.infer<typeof listAdminAuditQuerySchema>
