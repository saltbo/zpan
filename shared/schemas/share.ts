import { z } from 'zod'

export const shareKindSchema = z.enum(['landing', 'direct'])

export type ShareKind = z.infer<typeof shareKindSchema>

export const shareRecipientSchema = z.object({
  recipientUserId: z.string().optional(),
  recipientEmail: z.string().email().optional(),
})

export const shareRecipientViewSchema = z.object({
  id: z.string(),
  shareId: z.string(),
  recipientUserId: z.string().nullable(),
  recipientEmail: z.string().nullable(),
  createdAt: z.string(),
})

export const createShareSchema = z.object({
  matterId: z.string().min(1),
  orgId: z.string().min(1),
  creatorId: z.string().min(1),
  kind: shareKindSchema,
  password: z.string().optional(),
  expiresAt: z.date().optional(),
  downloadLimit: z.number().int().positive().optional(),
  recipients: z.array(shareRecipientSchema).optional(),
  showOnProfile: z.boolean().optional(),
})

export type CreateShareInput = z.infer<typeof createShareSchema>

export const listSharesQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().default(20),
  status: z.enum(['active', 'revoked']).optional(),
  box: z.enum(['sent', 'received']).default('sent'),
})

export const createShareRequestSchema = z.object({
  matterId: z.string().min(1),
  kind: shareKindSchema,
  password: z.string().optional(),
  expiresAt: z.string().datetime({ offset: true }).optional(),
  downloadLimit: z.number().int().positive().optional(),
  recipients: z.array(shareRecipientSchema).optional(),
  showOnProfile: z.boolean().optional(),
})

export type CreateShareRequest = z.infer<typeof createShareRequestSchema>

export const shareObjectItemSchema = z.object({
  ref: z.string(),
  name: z.string(),
  type: z.string(),
  size: z.number().int().nullable(),
  isFolder: z.boolean(),
})

export const shareObjectsResponseSchema = z.object({
  items: z.array(shareObjectItemSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  breadcrumb: z.array(z.object({ name: z.string(), path: z.string() })),
})

export type ShareObjectItem = z.infer<typeof shareObjectItemSchema>
export type ShareObjectsResponse = z.infer<typeof shareObjectsResponseSchema>

export const saveShareRequestSchema = z.object({
  targetOrgId: z.string().min(1),
  targetParent: z.string().default(''),
  targetSubpath: z.array(z.string()).optional(),
})

export type SaveShareRequest = z.infer<typeof saveShareRequestSchema>
