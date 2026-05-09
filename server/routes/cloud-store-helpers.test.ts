import { describe, expect, it } from 'vitest'
import {
  cloudGiftCardsResponseSchema,
  cloudOrdersResponseSchema,
  cloudPackageResponseSchema,
  giftCardsPath,
  ordersPath,
  packagesPath,
  redemptionPath,
  walletPath,
} from './cloud-store-helpers'

describe('quota store helper paths', () => {
  it('builds gift card and order Cloud paths', () => {
    expect(giftCardsPath()('store-1')).toBe('/api/stores/store-1/gift-cards')
    expect(giftCardsPath('active')('store-1')).toBe('/api/stores/store-1/gift-cards?status=active')
    expect(packagesPath()('store-1')).toBe('/api/stores/store-1/products?type=store_item&limit=100')
    expect(packagesPath({ status: 'active' })('store-1')).toBe(
      '/api/stores/store-1/products?type=store_item&limit=100&status=active',
    )
    expect(ordersPath()('store-1')).toBe('/api/stores/store-1/orders')
    expect(ordersPath({ limit: 100 })('store-1')).toBe('/api/stores/store-1/orders?limit=100')
    expect(ordersPath({ limit: 100, offset: 100 })('store-1')).toBe('/api/stores/store-1/orders?limit=100&offset=100')
    expect(ordersPath({ limit: 100, endUserId: 'user-1' })('store-1')).toBe(
      '/api/stores/store-1/orders?limit=100&endUserId=user-1',
    )
    expect(walletPath('org-1')('store-1')).toBe('/api/stores/store-1/wallets/org-1/balance')
    expect(redemptionPath('org-1')('store-1')).toBe('/api/stores/store-1/wallets/org-1/redemptions')
  })

  it('parses Cloud commerce order responses', () => {
    expect(
      cloudOrdersResponseSchema.parse({
        items: [
          {
            id: 'order-1',
            storeId: 'store-1',
            buyerAccountId: 'buyer-1',
            target: { orgId: 'org-1', endUserId: 'user-1', endUserLabel: 'owner@example.com' },
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
                productType: 'zpan_quota',
                name: 'Storage Bundle',
                description: null,
                quantity: 1,
                unitAmount: 999,
                totalAmount: 999,
                fulfillmentPayload: { storageBytes: 1024, trafficBytes: 2048 },
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
      }),
    ).toEqual({
      items: [
        {
          id: 'order-1',
          storeId: 'store-1',
          buyerAccountId: 'buyer-1',
          target: { orgId: 'org-1', endUserId: 'user-1', endUserLabel: 'owner@example.com' },
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
              productType: 'zpan_quota',
              name: 'Storage Bundle',
              description: null,
              quantity: 1,
              unitAmount: 999,
              totalAmount: 999,
              fulfillmentPayload: { storageBytes: 1024, trafficBytes: 2048 },
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
    })
  })

  it('parses paged Cloud gift card responses', () => {
    expect(
      cloudGiftCardsResponseSchema.parse({
        items: [
          {
            id: 'gift-1',
            boundLicenseId: null,
            code: 'ZS-PAGED-1',
            amount: 2500,
            currency: 'usd',
            status: 'active',
            expiresAt: null,
            firstRedeemedAt: '2026-05-07T00:00:30.000Z',
            lastRedeemedAt: '2026-05-07T00:01:00.000Z',
            redemptionCount: 1,
            createdAt: '2026-05-07T00:00:00.000Z',
            updatedAt: '2026-05-07T00:01:00.000Z',
            disabledAt: null,
            revokedAt: null,
            createdByAdmin: 'admin',
          },
        ],
        total: 7,
      }),
    ).toEqual({
      items: [
        {
          id: 'gift-1',
          boundLicenseId: null,
          code: 'ZS-PAGED-1',
          amount: 2500,
          currency: 'usd',
          status: 'active',
          expiresAt: null,
          firstRedeemedAt: '2026-05-07T00:00:30.000Z',
          lastRedeemedAt: '2026-05-07T00:01:00.000Z',
          redemptionCount: 1,
          createdAt: '2026-05-07T00:00:00.000Z',
          updatedAt: '2026-05-07T00:01:00.000Z',
          disabledAt: null,
          revokedAt: null,
          createdByAdmin: 'admin',
        },
      ],
      total: 7,
    })
  })

  it('parses Cloud package responses', () => {
    expect(
      cloudPackageResponseSchema.parse({
        id: 'pkg-1',
        type: 'zpan_quota',
        name: 'Storage Package',
        description: null,
        metadata: { storageBytes: 2048, trafficBytes: 4096 },
        prices: [{ currency: 'usd', amount: 1200 }],
        active: true,
        sortOrder: 4,
        createdAt: '2026-05-07T00:00:00.000Z',
        updatedAt: '2026-05-07T00:01:00.000Z',
      }),
    ).toEqual({
      id: 'pkg-1',
      type: 'zpan_quota',
      name: 'Storage Package',
      description: null,
      metadata: { storageBytes: 2048, trafficBytes: 4096 },
      prices: [{ currency: 'usd', amount: 1200 }],
      active: true,
      sortOrder: 4,
      createdAt: '2026-05-07T00:00:00.000Z',
      updatedAt: '2026-05-07T00:01:00.000Z',
    })
    expect(
      cloudPackageResponseSchema.parse({
        id: 'pkg-2',
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
        ],
        active: true,
        sortOrder: 5,
        createdAt: '2026-05-07T00:00:00.000Z',
        updatedAt: '2026-05-07T00:01:00.000Z',
      }),
    ).toMatchObject({
      id: 'pkg-2',
      type: 'zpan_quota',
      metadata: { storageBytes: 8192, trafficBytes: 4096, validityDays: 30, trafficOveragePriceCents: 2 },
      prices: [{ currency: 'usd', amount: 1900, recurring: { interval: 'month', intervalCount: 1 } }],
    })
  })
})
