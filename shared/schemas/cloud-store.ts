import { z } from 'zod'

export const cloudStoreSettingsSchema = z.object({
  enabled: z.boolean(),
})

export const cloudStoreCurrencySchema = z.string().min(1)
export const cloudProductPriceSchema = z.object({
  currency: cloudStoreCurrencySchema,
  amount: z.number().int().positive(),
  recurring: z
    .object({
      interval: z.enum(['day', 'week', 'month', 'year']),
      intervalCount: z.number().int().positive(),
      usageType: z.enum(['licensed', 'metered']).optional(),
    })
    .nullable()
    .optional(),
  metadata: z.record(z.string(), z.string()).optional(),
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

function isMeteredTrafficPrice(price: CloudProductPrice) {
  return price.recurring?.usageType === 'metered' && price.metadata?.usageResource === 'traffic_egress'
}

function validateSubscriptionMeteredPairs(
  prices: CloudProductPrice[],
  ctx: z.RefinementCtx,
  path: Array<string | number> = ['prices'],
) {
  const recurringPrices = prices.filter((price) => price.recurring)
  if (recurringPrices.length === 0) return

  for (const [index, price] of prices.entries()) {
    if (price.recurring && (price.recurring.interval !== 'month' || price.recurring.intervalCount !== 1)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...path, index, 'recurring'],
        message: 'Subscription prices must bill monthly',
      })
    }
    const usageType = price.recurring?.usageType
    const usageResource = price.metadata?.usageResource
    if (usageType === 'metered' && usageResource !== 'traffic_egress') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...path, index],
        message: 'Metered traffic prices must set usageResource to traffic_egress',
      })
    }
    if (usageResource === 'traffic_egress' && usageType !== 'metered') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...path, index],
        message: 'Traffic overage prices must use metered billing',
      })
    }
  }

  const currencies = new Set(recurringPrices.map((price) => price.currency))
  for (const currency of currencies) {
    const monthlyCount = recurringPrices.filter(
      (price) => price.currency === currency && !isMeteredTrafficPrice(price),
    ).length
    if (monthlyCount !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path,
        message: `Subscription prices for ${currency} must have exactly one monthly price`,
      })
    }
    const meteredCount = recurringPrices.filter(
      (price) => price.currency === currency && isMeteredTrafficPrice(price),
    ).length
    if (meteredCount === 1) continue
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path,
      message: `Subscription prices for ${currency} must have exactly one metered traffic price`,
    })
  }
}

export const cloudProductInputSchema = z
  .object({
    type: z.literal('zpan_quota'),
    name: z.string().min(1).max(120),
    description: z.string().max(1000).default(''),
    metadata: z.object({
      storageBytes: z.number().int().min(0).default(0),
      trafficBytes: z.number().int().min(0).default(0),
      validityDays: z.number().int().positive().optional(),
      trafficOveragePriceCents: z.number().int().min(0).optional(),
    }),
    prices: z.array(cloudProductPriceSchema).min(1),
    active: z.boolean().default(true),
    sortOrder: z.number().int().default(0),
  })
  .superRefine((data, ctx) => {
    validateUniformPriceBilling(data.prices, ctx)
    validateSubscriptionMeteredPairs(data.prices, ctx)
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
      validityDays: z.number().int().positive().optional(),
      trafficOveragePriceCents: z.number().int().min(0).optional(),
    }),
    prices: z.array(cloudProductPriceSchema).min(1),
    active: z.boolean(),
    sortOrder: z.number().int(),
  })
  .partial()
  .superRefine((data, ctx) => {
    if (data.prices) {
      validateUniformPriceBilling(data.prices, ctx)
      validateSubscriptionMeteredPairs(data.prices, ctx)
    }
    const touchesDeliverable = data.name !== undefined || data.metadata !== undefined || data.prices !== undefined
    if (touchesDeliverable && (!data.name || !data.metadata || !data.prices)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['metadata'],
        message: 'Package name, metadata, and prices are required when updating package quota or billing',
      })
    }
  })

export const checkoutInputSchema = z.object({
  packageId: z.string().min(1),
  currency: cloudStoreCurrencySchema.optional(),
  priceId: z.string().min(1).optional(),
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

const legacyCloudOrderQuotaChangeSchema = z
  .object({
    eventId: z.string().min(1),
    eventType: z.literal('order.quota_changed'),
    cloudOrderId: z.string().min(1),
    targetOrgId: z.string().min(1),
    direction: z.enum(['increase', 'decrease']),
    storageBytes: z.number().int().min(0).default(0),
    trafficBytes: z.number().int().min(0).default(0),
    trafficOveragePriceCents: z.number().int().min(0).optional(),
    source: z.string().min(1).optional(),
    packageId: z.string().min(1).optional(),
    packageName: z.string().min(1).optional(),
    occurredAt: z.string().min(1).optional(),
    expiresAt: z.string().datetime().optional(),
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

const storeDeliveryEventSchema = z.object({
  eventId: z.string().min(1),
  eventType: z.enum([
    'store.order_item.fulfilled',
    'store.subscription.renewed',
    'store.subscription.updated',
    'store.subscription.canceled',
    'store.subscription.expired',
  ]),
  orderId: z.string().min(1),
  orderItemId: z.string().min(1),
  productId: z.string().min(1),
  productName: z.string().min(1),
  quantity: z.number().int().positive(),
  deliverable: z.record(z.string(), z.unknown()),
  target: z.record(z.string(), z.unknown()).nullable(),
  context: z.object({
    storeId: z.string().min(1),
    paymentProvider: z.enum(['stripe', 'gift_card', 'wallet']).nullable(),
    stripePriceId: z.string().nullable().optional(),
    stripePriceLookupKey: z.string().nullable().optional(),
    stripePriceRecurring: z.unknown().optional(),
    stripePriceMetadata: z.record(z.string(), z.string()).optional(),
    stripeSubscriptionId: z.string().nullable().optional(),
    stripeInvoiceId: z.string().nullable().optional(),
    billingPeriodStart: z.string().nullable().optional(),
    billingPeriodEnd: z.string().nullable().optional(),
  }),
  occurredAt: z.string().datetime(),
})

function numberDeliverableValue(deliverable: Record<string, unknown>, key: string) {
  const value = deliverable[key]
  return typeof value === 'number' ? value : 0
}

function optionalNumberDeliverableValue(deliverable: Record<string, unknown>, key: string) {
  const value = deliverable[key]
  return typeof value === 'number' ? value : undefined
}

function stringDeliverableValue(deliverable: Record<string, unknown>, key: string) {
  const value = deliverable[key]
  return typeof value === 'string' ? value : undefined
}

function targetOrgId(target: Record<string, unknown> | null) {
  return typeof target?.orgId === 'string' ? target.orgId : ''
}

function sourceId(event: z.infer<typeof storeDeliveryEventSchema>) {
  const orgId = targetOrgId(event.target)
  if (event.context.stripeSubscriptionId) return `stripe_subscription:${event.context.stripeSubscriptionId}:${orgId}`
  return event.orderId
}

function expiresAt(event: z.infer<typeof storeDeliveryEventSchema>) {
  if (event.context.billingPeriodEnd) return event.context.billingPeriodEnd
  const validityDays = numberDeliverableValue(event.deliverable, 'validityDays')
  if (validityDays <= 0) return undefined
  return new Date(new Date(event.occurredAt).getTime() + validityDays * 86_400_000).toISOString()
}

export const cloudOrderQuotaChangeSchema = z.union([
  legacyCloudOrderQuotaChangeSchema,
  storeDeliveryEventSchema
    .transform((event) => ({
      eventId: event.eventId,
      eventType: 'order.quota_changed' as const,
      cloudOrderId: sourceId(event),
      targetOrgId: targetOrgId(event.target),
      direction:
        event.eventType === 'store.subscription.canceled' || event.eventType === 'store.subscription.expired'
          ? ('decrease' as const)
          : ('increase' as const),
      storageBytes: numberDeliverableValue(event.deliverable, 'storageBytes'),
      trafficBytes: numberDeliverableValue(event.deliverable, 'trafficBytes'),
      trafficOveragePriceCents: optionalNumberDeliverableValue(event.deliverable, 'trafficOveragePriceCents'),
      source: event.context.stripeSubscriptionId ? 'stripe_subscription' : 'stripe',
      packageId: event.productId,
      packageName: stringDeliverableValue(event.deliverable, 'packageName') ?? event.productName,
      occurredAt: event.occurredAt,
      expiresAt: expiresAt(event),
      terminalUserId: typeof event.target?.endUserId === 'string' ? event.target.endUserId : undefined,
      terminalUserEmail: typeof event.target?.endUserLabel === 'string' ? event.target.endUserLabel : undefined,
    }))
    .pipe(legacyCloudOrderQuotaChangeSchema),
])

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
