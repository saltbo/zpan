import { z } from 'zod'

export const shareKindSchema = z.enum(['landing', 'direct'])

export type ShareKind = z.infer<typeof shareKindSchema>

export const shareRecipientSchema = z.object({
  recipientUserId: z.string().optional(),
  recipientEmail: z.string().email().optional(),
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
})

export type CreateShareInput = z.infer<typeof createShareSchema>

export const listSharesQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().default(20),
  status: z.enum(['active', 'revoked']).optional(),
})
