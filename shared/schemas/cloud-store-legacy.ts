import { z } from 'zod'

export const legacyCloudProductDeliverableSchema = z.object({
  type: z.enum(['zpan.plan', 'zpan.credits', 'zpan.extra']),
  storageBytes: z.number().int().min(0).default(0),
  trafficBytes: z.number().int().min(0).default(0),
  includedCredits: z.number().int().min(0).default(0),
  validityDays: z.number().int().positive().optional(),
  trafficOveragePriceCents: z.number().int().min(0).optional(),
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
    customerId: z.string().optional(),
    customerEmail: z.string().email().optional(),
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
    'commerce.order_item.fulfilled',
    'commerce.subscription.renewed',
    'commerce.subscription.updated',
    'commerce.subscription.canceled',
    'commerce.subscription.expired',
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
    paymentProvider: z.enum(['stripe', 'gift_card', 'credits']).nullable(),
    stripePriceId: z.string().nullable().optional(),
    stripePriceLookupKey: z.string().nullable().optional(),
    stripePriceRecurring: z.unknown().optional(),
    stripePriceMetadata: z.record(z.string(), z.string()).optional(),
    stripeSubscriptionId: z.string().nullable().optional(),
    stripeInvoiceId: z.string().nullable().optional(),
    billingPeriodStart: z.string().nullable().optional(),
    billingPeriodEnd: z.string().nullable().optional(),
  }),
  occurredAt: z.string().min(1),
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
  storeDeliveryEventSchema.transform((event) => ({
    eventId: event.eventId,
    eventType: 'order.quota_changed' as const,
    cloudOrderId: sourceId(event),
    targetOrgId: targetOrgId(event.target),
    direction:
      event.eventType === 'commerce.subscription.canceled' || event.eventType === 'commerce.subscription.expired'
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
    customerId: typeof event.target?.customerId === 'string' ? event.target.customerId : undefined,
    customerEmail: typeof event.target?.customerLabel === 'string' ? event.target.customerLabel : undefined,
  })),
])

export type CloudOrderQuotaChange = z.infer<typeof cloudOrderQuotaChangeSchema>
