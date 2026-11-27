import { z } from '@hono/zod-openapi'
import { opaqueIdSchema, opaqueTokenSchema } from './id'

export const inviteCodeSchema = z
  .object({
    id: opaqueIdSchema,
    code: opaqueTokenSchema,
    createdBy: opaqueIdSchema,
    usedBy: opaqueIdSchema.nullable(),
    usedAt: z.string().nullable(),
    expiresAt: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi('InviteCode')

export type InviteCode = z.infer<typeof inviteCodeSchema>

export const inviteCodeRedeemerSchema = z
  .object({
    name: z.string().openapi({ description: "The redeeming user's display name" }),
    email: z.string().openapi({ description: "The redeeming user's email address" }),
  })
  .openapi('InviteCodeRedeemer')

export const inviteCodeListItemSchema = inviteCodeSchema
  .extend({
    usedByUser: inviteCodeRedeemerSchema.optional().openapi({
      description: 'The user who redeemed the code. Omitted when the code is unused or that user was deleted.',
    }),
  })
  .openapi('InviteCodeListItem')

export type InviteCodeListItem = z.infer<typeof inviteCodeListItemSchema>
