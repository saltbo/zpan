import { describe, expect, it } from 'vitest'
import {
  cloudGiftCardCreateResponseSchema,
  cloudGiftCardsResponseSchema,
  cloudOrdersResponseSchema,
  cloudPackageResponseSchema,
} from './cloud-store-helpers'

describe('quota store helper schemas', () => {
  it('parses Cloud commerce order responses', () => {
    expect(
      cloudOrdersResponseSchema.parse({
        items: [
          {
            id: 'order-1',
            storeId: 'store-1',
            buyerAccountId: 'buyer-1',
            target: { orgId: 'org-1', customerId: 'user-1', customerLabel: 'owner@example.com' },
            status: 'paid',
            paymentStatus: 'paid',
            fulfillmentStatus: 'fulfilled',
            subtotalAmount: 999,
            discountAmount: 100,
            totalAmount: 899,
            currency: 'usd',
            items: [
              {
                id: 'item-1',
                orderId: 'order-1',
                productId: 'pkg-1',
                productType: 'store_item',
                name: 'Storage Bundle',
                description: null,
                quantity: 1,
                unitAmount: 999,
                totalAmount: 999,
                fulfillmentPayload: { deliverable: { type: 'zpan.plan', storageBytes: 1024, trafficBytes: 2048 } },
              },
            ],
            payments: [
              {
                id: 'payment-1',
                orderId: 'order-1',
                provider: 'stripe',
                amount: 899,
                currency: 'usd',
                status: 'paid',
                providerSessionId: 'cs_1',
                providerPaymentIntentId: 'pi_1',
                createdAt: '2026-05-07T00:00:30.000Z',
                paidAt: '2026-05-07T00:01:00.000Z',
              },
            ],
            createdAt: '2026-05-07T00:00:00.000Z',
            paidAt: '2026-05-07T00:01:00.000Z',
            fulfilledAt: '2026-05-07T00:02:00.000Z',
            canceledAt: null,
          },
        ],
        total: 1,
        limit: 100,
        offset: 0,
      }),
    ).toEqual({
      items: [
        {
          id: 'order-1',
          storeId: 'store-1',
          buyerAccountId: 'buyer-1',
          target: { orgId: 'org-1', customerId: 'user-1', customerLabel: 'owner@example.com' },
          status: 'paid',
          paymentStatus: 'paid',
          fulfillmentStatus: 'fulfilled',
          subtotalAmount: 999,
          discountAmount: 100,
          totalAmount: 899,
          currency: 'usd',
          items: [
            {
              id: 'item-1',
              orderId: 'order-1',
              productId: 'pkg-1',
              productType: 'store_item',
              name: 'Storage Bundle',
              description: null,
              quantity: 1,
              unitAmount: 999,
              totalAmount: 999,
              fulfillmentPayload: { deliverable: { type: 'zpan.plan', storageBytes: 1024, trafficBytes: 2048 } },
            },
          ],
          payments: [
            {
              id: 'payment-1',
              orderId: 'order-1',
              provider: 'stripe',
              amount: 899,
              currency: 'usd',
              status: 'paid',
              providerSessionId: 'cs_1',
              providerPaymentIntentId: 'pi_1',
              createdAt: '2026-05-07T00:00:30.000Z',
              paidAt: '2026-05-07T00:01:00.000Z',
            },
          ],
          createdAt: '2026-05-07T00:00:00.000Z',
          paidAt: '2026-05-07T00:01:00.000Z',
          fulfilledAt: '2026-05-07T00:02:00.000Z',
          canceledAt: null,
        },
      ],
      total: 1,
      limit: 100,
      offset: 0,
    })
  })

  it('parses paged Cloud gift card responses', () => {
    expect(
      cloudGiftCardsResponseSchema.parse({
        items: [
          {
            id: 'gift-1',
            storeId: 'store-1',
            campaignId: null,
            code: null,
            codeLast4: 'GED1',
            amount: 2500,
            currency: 'usd',
            status: 'active',
            expiresAt: null,
            createdAt: '2026-05-07T00:00:00.000Z',
            updatedAt: '2026-05-07T00:01:00.000Z',
            disabledAt: null,
            revokedAt: null,
            createdByAdmin: 'admin',
          },
        ],
        total: 7,
        limit: 50,
        offset: 0,
      }),
    ).toEqual({
      items: [
        {
          id: 'gift-1',
          storeId: 'store-1',
          campaignId: null,
          code: null,
          codeLast4: 'GED1',
          amount: 2500,
          currency: 'usd',
          status: 'active',
          expiresAt: null,
          createdAt: '2026-05-07T00:00:00.000Z',
          updatedAt: '2026-05-07T00:01:00.000Z',
          disabledAt: null,
          revokedAt: null,
          createdByAdmin: 'admin',
        },
      ],
      total: 7,
      limit: 50,
      offset: 0,
    })
  })

  it('normalizes Cloud gift card create responses to generated cards', () => {
    const card = {
      id: 'gift-created',
      storeId: 'store-1',
      campaignId: null,
      code: 'ZS-CREATED-1',
      codeLast4: 'TED1',
      amount: 500,
      currency: 'usd',
      status: 'active',
      expiresAt: null,
      createdAt: '2026-05-07T00:00:00.000Z',
      updatedAt: '2026-05-07T00:00:00.000Z',
      disabledAt: null,
      revokedAt: null,
      createdByAdmin: 'admin',
    }

    expect(cloudGiftCardCreateResponseSchema.parse([card])).toEqual([card])
    expect(cloudGiftCardCreateResponseSchema.parse({ items: [card], total: 1, limit: 50, offset: 0 })).toEqual([card])
  })

  it('parses Cloud package responses', () => {
    expect(
      cloudPackageResponseSchema.parse({
        id: 'pkg-1',
        storeId: 'store-1',
        type: 'store_item',
        name: 'Storage Package',
        description: null,
        metadata: { deliverable: { type: 'zpan.extra', storageBytes: 2048, trafficBytes: 4096 } },
        prices: [{ currency: 'usd', amount: 1200 }],
        active: true,
        sortOrder: 4,
        createdAt: '2026-05-07T00:00:00.000Z',
        updatedAt: '2026-05-07T00:01:00.000Z',
      }),
    ).toEqual({
      id: 'pkg-1',
      storeId: 'store-1',
      type: 'store_item',
      name: 'Storage Package',
      description: null,
      metadata: { deliverable: { type: 'zpan.extra', storageBytes: 2048, trafficBytes: 4096 } },
      prices: [{ currency: 'usd', amount: 1200 }],
      active: true,
      sortOrder: 4,
      createdAt: '2026-05-07T00:00:00.000Z',
      updatedAt: '2026-05-07T00:01:00.000Z',
    })
    expect(
      cloudPackageResponseSchema.parse({
        id: 'pkg-2',
        storeId: 'store-1',
        type: 'store_item',
        name: 'Monthly Plan',
        description: null,
        metadata: {
          deliverable: {
            type: 'zpan.plan',
            storageBytes: 8192,
            trafficBytes: 4096,
            validityDays: 30,
            trafficOveragePriceCents: 2,
          },
        },
        prices: [
          {
            currency: 'usd',
            amount: 1900,
            recurring: { interval: 'month', intervalCount: 1 },
          },
          {
            currency: 'usd',
            amount: 2,
            recurring: { interval: 'month', intervalCount: 1, usageType: 'metered' },
            metadata: { usageResource: 'traffic_egress' },
          },
        ],
        active: true,
        sortOrder: 5,
        createdAt: '2026-05-07T00:00:00.000Z',
        updatedAt: '2026-05-07T00:01:00.000Z',
      }),
    ).toMatchObject({
      id: 'pkg-2',
      type: 'store_item',
      metadata: {
        deliverable: { storageBytes: 8192, trafficBytes: 4096, validityDays: 30, trafficOveragePriceCents: 2 },
      },
      prices: [
        { currency: 'usd', amount: 1900, recurring: { interval: 'month', intervalCount: 1 } },
        {
          currency: 'usd',
          amount: 2,
          recurring: { interval: 'month', intervalCount: 1, usageType: 'metered' },
          metadata: { usageResource: 'traffic_egress' },
        },
      ],
    })
  })
})
