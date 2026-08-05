import { z } from 'zod'
import { opaqueIdSchema } from './id'
import { cursorPageQuerySchema } from './pagination'

export const shareKindSchema = z.enum(['landing', 'direct'])

export type ShareKind = z.infer<typeof shareKindSchema>

export const shareRecipientSchema = z.object({
  recipientUserId: opaqueIdSchema.optional(),
  recipientEmail: z.string().email().optional(),
})

export const shareRecipientViewSchema = z.object({
  id: opaqueIdSchema,
  shareId: opaqueIdSchema,
  recipientUserId: opaqueIdSchema.nullable(),
  recipientEmail: z.string().nullable(),
  createdAt: z.string(),
})

export const createShareSchema = z.object({
  matterId: opaqueIdSchema,
  orgId: opaqueIdSchema,
  creatorId: opaqueIdSchema,
  kind: shareKindSchema,
  password: z.string().optional(),
  expiresAt: z.date().optional(),
  downloadLimit: z.number().int().positive().optional(),
  recipients: z.array(shareRecipientSchema).optional(),
  private: z.boolean().default(false),
})

export type CreateShareInput = z.input<typeof createShareSchema>

export const listSharesQuerySchema = cursorPageQuerySchema.extend({
  status: z.enum(['active', 'revoked']).optional(),
  box: z.enum(['sent', 'received']).default('sent'),
})

export const createShareRequestSchema = z.object({
  matterId: opaqueIdSchema,
  kind: shareKindSchema,
  password: z.string().optional(),
  expiresAt: z.string().datetime({ offset: true }).optional(),
  downloadLimit: z.number().int().positive().optional(),
  recipients: z.array(shareRecipientSchema).optional(),
  private: z.boolean().default(false),
})

export type CreateShareRequest = z.input<typeof createShareRequestSchema>

export const shareObjectItemSchema = z.object({
  ref: z.string(),
  name: z.string(),
  type: z.string(),
  size: z.number().int().nullable(),
  isFolder: z.boolean(),
})

export const shareObjectsResponseSchema = z.object({
  items: z.array(shareObjectItemSchema),
  nextPageToken: z.string().nullable(),
  breadcrumb: z.array(z.object({ name: z.string(), path: z.string() })),
})

export type ShareObjectItem = z.infer<typeof shareObjectItemSchema>
export type ShareObjectsResponse = z.infer<typeof shareObjectsResponseSchema>

export const shareReadmeResponseSchema = z.object({
  content: z.string(),
})

export type ShareReadmeResponse = z.infer<typeof shareReadmeResponseSchema>

export const saveShareRequestSchema = z.object({
  targetOrgId: opaqueIdSchema,
  targetParent: z.string().default(''),
  targetSubpath: z.array(z.string()).optional(),
})

export type SaveShareRequest = z.infer<typeof saveShareRequestSchema>
