import { z } from 'zod'

export const quotaStoreSettingsSchema = z.object({
  enabled: z.boolean(),
})

const quotaStoreResourceTypeSchema = z.enum(['storage', 'traffic'])
export const quotaStoreCurrencySchema = z.string().min(1)
export const quotaStorePackagePriceSchema = z.object({
  currency: quotaStoreCurrencySchema,
  amount: z.number().int().positive(),
})

export const quotaStorePackageInputSchema = z
  .object({
    name: z.string().min(1).max(120),
    description: z.string().max(1000).default(''),
    storageBytes: z.number().int().min(0).default(0),
    trafficBytes: z.number().int().min(0).default(0),
    prices: z.array(quotaStorePackagePriceSchema).min(1),
    active: z.boolean().default(true),
    sortOrder: z.number().int().default(0),
  })
  .superRefine((data, ctx) => {
    if (data.storageBytes === 0 && data.trafficBytes === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['storageBytes'],
        message: 'At least one of storageBytes or trafficBytes must be greater than 0',
      })
    }
  })

export const quotaStorePackagePatchSchema = z
  .object({
    name: z.string().min(1).max(120),
    description: z.string().max(1000),
    storageBytes: z.number().int().min(0),
    trafficBytes: z.number().int().min(0),
    prices: z.array(quotaStorePackagePriceSchema).min(1),
    active: z.boolean(),
    sortOrder: z.number().int(),
  })
  .partial()

export const checkoutInputSchema = z.object({
  packageId: z.string().min(1),
  targetOrgId: z.string().min(1),
  currency: quotaStoreCurrencySchema.optional(),
})

export const redemptionInputSchema = z.object({
  code: z.string().min(1),
  targetOrgId: z.string().min(1),
})

export const storageCodeStatusSchema = z.enum(['active', 'redeemed', 'expired', 'revoked'])

export const generateStorageCodesInputSchema = z.object({
  resourceType: quotaStoreResourceTypeSchema,
  resourceBytes: z.number().int().positive(),
  maxUses: z.number().int().positive().default(1),
  expiresAt: z.string().datetime().optional(),
  count: z.number().int().min(1).max(100),
})

export const revokeStorageCodeSchema = z.object({
  revoked: z.literal(true),
})

export const cloudDeliveryEventSchema = z
  .object({
    eventId: z.string().min(1),
    cloudOrderId: z.string().min(1).optional(),
    cloudRedemptionId: z.string().min(1).optional(),
    targetOrgId: z.string().min(1),
    resourceType: z.enum(['storage', 'traffic']),
    operation: z.enum(['increase', 'decrease']),
    resourceBytes: z.number().int().positive(),
    source: z.string().min(1).optional(),
    packageId: z.string().min(1).optional(),
    code: z.string().min(1).optional(),
    occurredAt: z.string().min(1).optional(),
    terminalUserId: z.string().optional(),
    terminalUserEmail: z.string().email().optional(),
  })
  .superRefine((event, ctx) => {
    if (event.source === 'stripe' && !event.cloudOrderId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['cloudOrderId'],
        message: 'cloudOrderId is required for stripe deliveries',
      })
    }
    if (event.source === 'redeem_code' && !event.cloudRedemptionId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['cloudRedemptionId'],
        message: 'cloudRedemptionId is required for redeem_code deliveries',
      })
    }
  })

export type QuotaStoreSettingsInput = z.infer<typeof quotaStoreSettingsSchema>
export type QuotaStoreCurrency = z.infer<typeof quotaStoreCurrencySchema>
export type QuotaStorePackagePrice = z.infer<typeof quotaStorePackagePriceSchema>
export type QuotaStorePackageInput = z.input<typeof quotaStorePackageInputSchema>
export type QuotaStorePackagePatchInput = z.input<typeof quotaStorePackagePatchSchema>
export type CheckoutInput = z.infer<typeof checkoutInputSchema>
export type RedemptionInput = z.infer<typeof redemptionInputSchema>
export type StorageCodeStatus = z.infer<typeof storageCodeStatusSchema>
export type GenerateStorageCodesInput = z.input<typeof generateStorageCodesInputSchema>
export type RevokeStorageCodeInput = z.infer<typeof revokeStorageCodeSchema>
export type CloudDeliveryEvent = z.infer<typeof cloudDeliveryEventSchema>
