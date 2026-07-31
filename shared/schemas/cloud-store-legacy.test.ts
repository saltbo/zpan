import { describe, expect, it } from 'vitest'
import { cloudOrderQuotaChangeSchema } from './cloud-store-legacy'

function deliveryEvent(context: Record<string, unknown>) {
  return {
    eventId: 'event-1',
    eventType: 'commerce.order_item.fulfilled',
    orderId: 'order-1',
    orderItemId: 'item-1',
    productId: 'product-1',
    productName: 'Storage',
    quantity: 1,
    deliverable: { storageBytes: 1024 },
    target: { orgId: 'org-1' },
    context: {
      storeId: 'store-1',
      paymentProvider: 'x402',
      ...context,
    },
    occurredAt: '2026-07-31T00:00:00.000Z',
  }
}

describe('cloudOrderQuotaChangeSchema', () => {
  it('accepts ISO billing periods', () => {
    expect(
      cloudOrderQuotaChangeSchema.safeParse(
        deliveryEvent({
          billingPeriodStart: '2026-07-31T00:00:00.000Z',
          billingPeriodEnd: '2026-08-31T00:00:00.000Z',
        }),
      ).success,
    ).toBe(true)
  })

  it('rejects malformed billing periods', () => {
    expect(
      cloudOrderQuotaChangeSchema.safeParse(
        deliveryEvent({
          billingPeriodStart: 'not-a-date',
          billingPeriodEnd: '2026-08-31T00:00:00.000Z',
        }),
      ).success,
    ).toBe(false)
  })

  it('rejects incomplete billing periods', () => {
    expect(
      cloudOrderQuotaChangeSchema.safeParse(
        deliveryEvent({
          billingPeriodStart: '2026-07-31T00:00:00.000Z',
        }),
      ).success,
    ).toBe(false)
  })
})
