import { z } from 'zod'

export const cloudStoreSettingsSchema = z.object({
  enabled: z.boolean(),
})

export const cloudStoreCurrencySchema = z.string().min(1)
export const cloudProductPriceSchema = z.object({
  currency: cloudStoreCurrencySchema,
  amount: z.number().int().positive(),
})

export const cloudProductInputSchema = z
  .object({
    type: z.literal('zpan_quota'),
    name: z.string().min(1).max(120),
    description: z.string().max(1000).default(''),
    metadata: z.object({
      storageBytes: z.number().int().min(0).default(0),
      trafficBytes: z.number().int().min(0).default(0),
    }),
    prices: z.array(cloudProductPriceSchema).min(1),
    active: z.boolean().default(true),
    sortOrder: z.number().int().default(0),
  })
  .superRefine((data, ctx) => {
    if (data.metadata.storageBytes === 0 && data.metadata.trafficBytes === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['metadata', 'storageBytes'],
        message: 'At least one of storageBytes or trafficBytes must be greater than 0',
      })
    }
  })

export const cloudProductPatchSchema = z
  .object({
    type: z.literal('zpan_quota'),
    name: z.string().min(1).max(120),
    description: z.string().max(1000),
    metadata: z.object({
      storageBytes: z.number().int().min(0),
      trafficBytes: z.number().int().min(0),
    }),
    prices: z.array(cloudProductPriceSchema).min(1),
    active: z.boolean(),
    sortOrder: z.number().int(),
  })
  .partial()

export const checkoutInputSchema = z.object({
  packageId: z.string().min(1),
  currency: cloudStoreCurrencySchema.optional(),
})

export const giftCardStatusSchema = z.enum(['created', 'active', 'disabled', 'exhausted', 'expired', 'revoked'])

export const createGiftCardInputSchema = z.object({
  amount: z.number().int().positive(),
  currency: cloudStoreCurrencySchema,
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
    occurredAt: z.string().datetime().optional(),
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

export type CloudStoreSettingsInput = z.infer<typeof cloudStoreSettingsSchema>
export type CloudStoreCurrency = z.infer<typeof cloudStoreCurrencySchema>
export type CloudProductPrice = z.infer<typeof cloudProductPriceSchema>
export type CloudProductInput = z.infer<typeof cloudProductInputSchema>
export type CloudProductPatchInput = z.input<typeof cloudProductPatchSchema>
export type CheckoutInput = z.infer<typeof checkoutInputSchema>
export type GiftCardStatus = z.infer<typeof giftCardStatusSchema>
export type CreateGiftCardInput = z.input<typeof createGiftCardInputSchema>
export type DisableGiftCardInput = z.infer<typeof disableGiftCardSchema>
export type CloudOrderQuotaChange = z.infer<typeof cloudOrderQuotaChangeSchema>

export const cloudWalletBalanceSchema = z.object({
  id: z.string().min(1),
  storeId: z.string().min(1),
  endUserId: z.string().nullable(),
  currency: z.string().min(1),
  availableAmount: z.number().int().min(0),
  pendingAmount: z.number().int().min(0),
  stripeCustomerId: z.string().nullable(),
  updatedAt: z.string().min(1),
})

export const cloudWalletResponseSchema = z.object({
  balances: z.array(cloudWalletBalanceSchema),
})

export type CloudWalletResponse = z.infer<typeof cloudWalletResponseSchema>

export const cloudWalletTransactionSchema = z.object({
  id: z.string().min(1),
  storeId: z.string().min(1),
  endUserId: z.string().nullable(),
  currency: z.string().min(1),
  amount: z.number().int().min(0),
  direction: z.enum(['credit', 'debit']),
  status: z.enum(['posted', 'pending', 'released', 'refunded']),
  sourceType: z.enum(['gift_card_redemption', 'order_payment', 'stripe_invoice', 'adjustment', 'refund']),
  sourceId: z.string().nullable(),
  orderId: z.string().nullable(),
  paymentId: z.string().nullable(),
  stripeCustomerBalanceTransactionId: z.string().nullable(),
  createdAt: z.string().min(1),
})

export const cloudWalletTransactionsResponseSchema = z.object({
  items: z.array(cloudWalletTransactionSchema),
  total: z.number().int().min(0),
  limit: z.number().int().min(0),
  offset: z.number().int().min(0),
})

export type CloudWalletTransaction = z.infer<typeof cloudWalletTransactionSchema>
export type CloudWalletTransactionsResponse = z.infer<typeof cloudWalletTransactionsResponseSchema>

export const redeemGiftCardInputSchema = z.object({
  code: z.string().min(1),
})

export type RedeemGiftCardInput = z.infer<typeof redeemGiftCardInputSchema>

export const redeemGiftCardResponseSchema = z.object({
  redeemedAmount: z.number().int().min(0),
  currency: z.string().nullable(),
  entries: z.array(
    z.object({
      id: z.string().min(1),
      storeId: z.string().min(1),
      endUserId: z.string().nullable(),
      currency: z.string().min(1),
      amount: z.number().int().min(0),
      direction: z.enum(['credit', 'debit']),
      status: z.string().min(1),
      sourceType: z.string().min(1),
      sourceId: z.string().min(1),
      orderId: z.string().nullable().optional(),
      paymentId: z.string().nullable().optional(),
      stripeCustomerBalanceTransactionId: z.string().nullable().optional(),
      createdAt: z.string().min(1),
    }),
  ),
  failures: z.array(
    z.object({
      code: z.string().min(1),
      error: z.string().min(1),
    }),
  ),
})

export type RedeemGiftCardResponse = z.infer<typeof redeemGiftCardResponseSchema>
