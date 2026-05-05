import { z } from 'zod'

// ─── Admin: package CRUD ──────────────────────────────────────────────────────

export const createQuotaStorePackageSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).nullable().optional(),
  bytes: z.number().int().positive(),
  amount: z.number().positive(),
  currency: z.string().length(3),
  active: z.boolean().optional().default(true),
  sortOrder: z.number().int().default(0),
})

export type CreateQuotaStorePackageInput = z.infer<typeof createQuotaStorePackageSchema>

export const updateQuotaStorePackageSchema = createQuotaStorePackageSchema.partial()

export type UpdateQuotaStorePackageInput = z.infer<typeof updateQuotaStorePackageSchema>

// ─── Admin: store settings ────────────────────────────────────────────────────

export const putQuotaStoreSettingsSchema = z.object({
  enabled: z.boolean(),
  cloudBaseUrl: z.string().url().nullable().optional(),
  instancePublicUrl: z.string().url().nullable().optional(),
  webhookSigningSecret: z.string().min(8).max(512).nullable().optional(),
})

export type PutQuotaStoreSettingsInput = z.infer<typeof putQuotaStoreSettingsSchema>

// ─── User: checkout / redeem ──────────────────────────────────────────────────

export const checkoutSchema = z.object({
  packageId: z.string().min(1),
  targetOrgId: z.string().min(1),
})

export type CheckoutInput = z.infer<typeof checkoutSchema>

export const redeemSchema = z.object({
  code: z.string().min(1).max(128),
  targetOrgId: z.string().min(1),
})

export type RedeemInput = z.infer<typeof redeemSchema>

// ─── Cloud webhook ────────────────────────────────────────────────────────────

export const cloudDeliveryPayloadSchema = z.object({
  eventId: z.string().min(1),
  cloudOrderId: z.string().optional(),
  packageId: z.string().min(1),
  bytes: z.number().int().positive(),
  targetOrgId: z.string().min(1),
  source: z.enum(['stripe', 'redeem_code']),
  code: z.string().optional(),
  externalEventId: z.string().optional(),
})

export type CloudDeliveryPayload = z.infer<typeof cloudDeliveryPayloadSchema>
