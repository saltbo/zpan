import { z } from 'zod'

export const quotaStoreSettingsSchema = z.object({
  enabled: z.boolean(),
})

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
  giftCardCode: z.string().min(1).optional(),
})

export const giftCardStatusSchema = z.enum(['active', 'disabled', 'exhausted', 'expired'])

export const createGiftCardInputSchema = z.object({
  amount: z.number().int().positive(),
  currency: quotaStoreCurrencySchema,
  expiresAt: z.string().datetime().optional(),
  count: z.number().int().min(1).max(100),
})

export const disableGiftCardSchema = z.object({
  disabled: z.literal(true),
})

export const cloudOrderQuotaChangeSchema = z
  .object({
    eventId: z.string().min(1),
    eventType: z.literal('order.quota_changed'),
    cloudOrderId: z.string().min(1),
    targetOrgId: z.string().min(1),
    direction: z.enum(['increase', 'decrease']),
    storageBytes: z.number().int().min(0).default(0),
    trafficBytes: z.number().int().min(0).default(0),
    source: z.string().min(1).optional(),
    packageId: z.string().min(1).optional(),
    occurredAt: z.string().min(1).optional(),
    terminalUserId: z.string().optional(),
    terminalUserEmail: z.string().email().optional(),
  })
  .strict()
  .superRefine((event, ctx) => {
    if (event.storageBytes === 0 && event.trafficBytes === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['storageBytes'],
        message: 'At least one of storageBytes or trafficBytes must be greater than 0',
      })
    }
  })

export type QuotaStoreSettingsInput = z.infer<typeof quotaStoreSettingsSchema>
export type QuotaStoreCurrency = z.infer<typeof quotaStoreCurrencySchema>
export type QuotaStorePackagePrice = z.infer<typeof quotaStorePackagePriceSchema>
export type QuotaStorePackageInput = z.input<typeof quotaStorePackageInputSchema>
export type QuotaStorePackagePatchInput = z.input<typeof quotaStorePackagePatchSchema>
export type CheckoutInput = z.infer<typeof checkoutInputSchema>
export type GiftCardStatus = z.infer<typeof giftCardStatusSchema>
export type CreateGiftCardInput = z.input<typeof createGiftCardInputSchema>
export type DisableGiftCardInput = z.infer<typeof disableGiftCardSchema>
export type CloudOrderQuotaChange = z.infer<typeof cloudOrderQuotaChangeSchema>
