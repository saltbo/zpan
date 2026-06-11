import { z } from 'zod'
import {
  commerceOrderItemSchema,
  commerceOrderSchema,
  createProductSchema,
  orderListResponseSchema,
  productPriceSchema,
  updateProductSchema,
} from 'zpan-cloud-sdk'
import { type CloudOrderQuotaChange, legacyCloudProductDeliverableSchema } from './cloud-store-legacy'

export { cloudOrderQuotaChangeSchema } from './cloud-store-legacy'

export const cloudStoreCurrencySchema = z.literal('usd')
export const cloudProductPriceSchema = productPriceSchema.extend({
  currency: cloudStoreCurrencySchema,
  amount: z.number().int().positive(),
})
export const cloudProductDeliverableSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('zpan.plan'),
      storageBytes: z.number().int().min(0).default(0),
      includedCredits: z.number().int().min(0).default(0),
    })
    .strict(),
  z
    .object({
      type: z.literal('zpan.credits'),
      includedCredits: z.number().int().positive(),
    })
    .strict(),
])

export const cloudOrderFulfillmentPayloadSchema = z.object({
  deliverable: z.union([legacyCloudProductDeliverableSchema, cloudProductDeliverableSchema]),
})
export const cloudOrderItemSchema = commerceOrderItemSchema.extend({
  fulfillmentPayload: cloudOrderFulfillmentPayloadSchema,
})
export const cloudOrderSchema = commerceOrderSchema.extend({
  items: z.array(cloudOrderItemSchema),
})
export const cloudOrdersResponseSchema = orderListResponseSchema.extend({
  items: z.array(cloudOrderSchema),
})

function validateUniformPriceBilling(
  prices: CloudProductPrice[],
  ctx: z.RefinementCtx,
  path: Array<string | number> = ['prices'],
) {
  const recurringCount = prices.filter((price) => price.recurring).length
  if (recurringCount > 0 && recurringCount !== prices.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path,
      message: 'All prices for a Cloud product must use the same billing mode',
    })
  }
}

function validateSubscriptionPrices(
  prices: CloudProductPrice[],
  ctx: z.RefinementCtx,
  path: Array<string | number> = ['prices'],
) {
  const recurringPrices = prices.filter((price) => price.recurring)
  if (recurringPrices.length === 0) return

  for (const [index, price] of prices.entries()) {
    if (price.recurring) {
      const isMonthly = price.recurring.interval === 'month' && price.recurring.intervalCount === 1
      const isAnnual = price.recurring.interval === 'year' && price.recurring.intervalCount === 1
      if (!isMonthly && !isAnnual) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [...path, index, 'recurring'],
          message: 'Subscription prices must bill monthly or yearly',
        })
      }
    }
    if (price.recurring?.usageType === 'metered') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...path, index],
        message: 'Subscription prices must not use metered billing',
      })
    }
    if (price.metadata?.usageResource === 'traffic_egress') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...path, index],
        message: 'Traffic overage prices are no longer supported',
      })
    }
  }

  const currencies = new Set(recurringPrices.map((price) => price.currency))
  for (const currency of currencies) {
    const fixedPrices = recurringPrices.filter(
      (price) => price.currency === currency && price.recurring?.usageType !== 'metered',
    )
    const monthlyCount = fixedPrices.filter((price) => price.recurring?.interval === 'month').length
    const yearlyCount = fixedPrices.filter((price) => price.recurring?.interval === 'year').length
    if (fixedPrices.length < 1 || monthlyCount > 1 || yearlyCount > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path,
        message: `Subscription prices for ${currency} must have at least one monthly or yearly price, and at most one of each`,
      })
    }
  }
}

function validateDeliverableBillingMode(
  deliverable: CloudProductDeliverable,
  prices: CloudProductPrice[],
  ctx: z.RefinementCtx,
) {
  const recurring = prices.some((price) => price.recurring)
  if (recurring && deliverable.type === 'zpan.plan') return
  if (!recurring && deliverable.type === 'zpan.credits') return
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: ['metadata', 'deliverable', 'type'],
    message: recurring
      ? 'Recurring prices must use zpan.plan deliverables'
      : 'One-time prices must use zpan.credits deliverables',
  })
}

export const cloudProductInputSchema = createProductSchema
  .safeExtend({
    name: createProductSchema.shape.name.min(1).max(120),
    description: z.string().max(1000).default(''),
    metadata: z.object({ deliverable: cloudProductDeliverableSchema }),
    prices: z.array(cloudProductPriceSchema).min(1),
  })
  .superRefine((data, ctx) => {
    validateUniformPriceBilling(data.prices, ctx)
    validateSubscriptionPrices(data.prices, ctx)
    const deliverable = data.metadata.deliverable
    validateDeliverableBillingMode(deliverable, data.prices, ctx)
    if (deliverable.type === 'zpan.plan' && deliverable.storageBytes === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['metadata', 'deliverable', 'storageBytes'],
        message: 'Plan storageBytes must be greater than 0',
      })
    }
  })

export const cloudProductPatchSchema = updateProductSchema
  .safeExtend({
    name: updateProductSchema.shape.name.unwrap().min(1).max(120).optional(),
    description: z.string().max(1000).optional(),
    metadata: z.object({ deliverable: cloudProductDeliverableSchema }).optional(),
    prices: z.array(cloudProductPriceSchema).min(1).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.prices) {
      validateUniformPriceBilling(data.prices, ctx)
      validateSubscriptionPrices(data.prices, ctx)
    }
    if (data.metadata) {
      const deliverable = data.metadata.deliverable
      if (data.prices) validateDeliverableBillingMode(deliverable, data.prices, ctx)
      if (deliverable.type === 'zpan.credits' || deliverable.storageBytes > 0) return
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['metadata', 'deliverable', 'storageBytes'],
        message: 'Plan storageBytes must be greater than 0',
      })
    }
  })

export const checkoutInputSchema = z
  .object({
    packageId: z.string().min(1),
    priceId: z.string().min(1).optional(),
    promotionCode: z.string().trim().min(1).optional(),
  })
  .strict()

export const discountQuoteInputSchema = z
  .object({
    code: z.string().trim().min(1).max(64),
    priceId: z.string().trim().min(1),
    quantity: z.number().int().positive().optional(),
  })
  .strict()

export const discountQuoteSchema = z.object({
  code: z.string(),
  currency: z.string(),
  subtotal: z.number().int(),
  discount: z.number().int(),
  total: z.number().int(),
})

export const giftCardStatusSchema = z.enum(['active', 'redeemed', 'disabled', 'expired', 'revoked'])

export const createGiftCardInputSchema = z.object({
  credits: z.number().int().positive(),
  expiresAt: z.string().datetime().optional(),
  campaignId: z.string().min(1).optional(),
  count: z.number().int().min(1).max(100),
})

export const disableGiftCardSchema = z.object({
  disabled: z.literal(true),
})

export type CloudStoreCurrency = z.infer<typeof cloudStoreCurrencySchema>
export type CloudProductPrice = z.infer<typeof cloudProductPriceSchema>
export type CloudProductDeliverable = z.infer<typeof cloudProductDeliverableSchema>
export type CloudProductInput = z.infer<typeof cloudProductInputSchema>
export type CloudProductPatchInput = z.input<typeof cloudProductPatchSchema>
export type CloudOrderFulfillmentPayload = z.infer<typeof cloudOrderFulfillmentPayloadSchema>
export type CloudOrderItem = z.infer<typeof cloudOrderItemSchema>
export type CloudOrder = z.infer<typeof cloudOrderSchema>
export type CheckoutInput = z.infer<typeof checkoutInputSchema>
export type DiscountQuoteInput = z.infer<typeof discountQuoteInputSchema>
export type DiscountQuote = z.infer<typeof discountQuoteSchema>
export type GiftCardStatus = z.infer<typeof giftCardStatusSchema>
export type CreateGiftCardInput = z.input<typeof createGiftCardInputSchema>
export type DisableGiftCardInput = z.infer<typeof disableGiftCardSchema>
export type { CloudOrderQuotaChange }

export const cloudCreditBalanceResponseSchema = z.object({
  balance: z.number().int(),
})

export const cloudCreditBucketSchema = z.object({
  id: z.string().min(1),
  creditAccountId: z.string().min(1),
  storeId: z.string().min(1),
  customerId: z.string().nullable(),
  sourceType: z.enum(['subscription_grant', 'top_up', 'gift_card_redemption', 'admin_grant']),
  sourceId: z.string().min(1),
  originalCredits: z.number().int(),
  remainingCredits: z.number().int(),
  expiresAt: z.string().nullable(),
  updatedAt: z.string().min(1),
})

export const cloudCreditLedgerEntrySchema = z.object({
  id: z.string().min(1),
  creditAccountId: z.string().nullable(),
  creditBucketId: z.string().nullable(),
  storeId: z.string().min(1),
  customerId: z.string().nullable(),
  amount: z.number().int(),
  direction: z.enum(['credit', 'debit']),
  status: z.enum(['posted', 'reversed']),
  sourceType: z.enum([
    'subscription_grant',
    'top_up',
    'gift_card_redemption',
    'admin_grant',
    'usage_charge',
    'adjustment',
  ]),
  sourceId: z.string().min(1),
  orderId: z.string().nullable(),
  paymentId: z.string().nullable(),
  createdAt: z.string().min(1),
})

export const cloudCreditBucketsResponseSchema = z.object({
  items: z.array(cloudCreditBucketSchema),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
})

export const cloudCreditLedgerResponseSchema = z.object({
  items: z.array(cloudCreditLedgerEntrySchema),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
})

export type CloudCreditBalanceResponse = z.infer<typeof cloudCreditBalanceResponseSchema>
export type CloudCreditBucket = z.infer<typeof cloudCreditBucketSchema>
export type CloudCreditBucketsResponse = z.infer<typeof cloudCreditBucketsResponseSchema>
export type CloudCreditLedgerEntry = z.infer<typeof cloudCreditLedgerEntrySchema>
export type CloudCreditLedgerResponse = z.infer<typeof cloudCreditLedgerResponseSchema>

export const redeemGiftCardInputSchema = z.object({
  code: z.string().min(1),
})

export type RedeemGiftCardInput = z.infer<typeof redeemGiftCardInputSchema>

export const redeemGiftCardResponseSchema = z.object({
  redeemedCredits: z.number().int().min(0),
  entries: z.array(cloudCreditLedgerEntrySchema),
  failures: z.array(
    z.object({
      code: z.string().min(1),
      error: z.string().min(1),
    }),
  ),
})

export type RedeemGiftCardResponse = z.infer<typeof redeemGiftCardResponseSchema>
