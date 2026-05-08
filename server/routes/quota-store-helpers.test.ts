import { describe, expect, it } from 'vitest'
import type { Database } from '../platform/interface'
import {
  cloudGiftCardsResponseSchema,
  cloudOrdersResponseSchema,
  cloudPackageResponseSchema,
  createOrderPayload,
  createPaymentPayload,
  giftCardsPath,
  ordersPath,
  type RouteContext,
} from './quota-store-helpers'

function createRouteContext(): RouteContext {
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ email: 'owner@example.com' }],
        }),
      }),
    }),
  } as unknown as Database

  return {
    get: (key: 'platform') => {
      if (key !== 'platform') throw new Error('unexpected_context_key')
      return {
        db,
        getEnv: (name: string) => (name === 'ZPAN_PUBLIC_ORIGIN' ? 'https://disk.example.com/app' : undefined),
      }
    },
    req: {
      url: 'http://internal.local/api/store/checkouts',
      header: () => undefined,
    },
  } as unknown as RouteContext
}

describe('quota store helper paths', () => {
  it('builds gift card and order Cloud paths', () => {
    expect(giftCardsPath()('store-1')).toBe('/api/stores/store-1/gift-cards')
    expect(giftCardsPath('active')('store-1')).toBe('/api/stores/store-1/gift-cards?status=active')
    expect(ordersPath()('store-1')).toBe('/api/stores/store-1/orders')
    expect(ordersPath({ limit: 100 })('store-1')).toBe('/api/stores/store-1/orders?limit=100')
    expect(ordersPath({ limit: 100, offset: 100 })('store-1')).toBe('/api/stores/store-1/orders?limit=100&offset=100')
    expect(ordersPath({ limit: 100, endUserId: 'user-1' })('store-1')).toBe(
      '/api/stores/store-1/orders?limit=100&endUserId=user-1',
    )
  })

  it('builds Cloud commerce order and payment payloads', async () => {
    await expect(createOrderPayload(createRouteContext(), 'pkg-1', 'org-1', 'user-1', 'usd')).resolves.toEqual({
      items: [{ productId: 'pkg-1' }],
      currency: 'usd',
      target: {
        orgId: 'org-1',
        endUserId: 'user-1',
        endUserLabel: 'owner@example.com',
      },
      walletCreditAmount: 'max',
    })
    expect(createPaymentPayload(createRouteContext())).toEqual({
      provider: 'stripe',
      successUrl: 'https://disk.example.com/storage',
      cancelUrl: 'https://disk.example.com/storage',
    })
  })

  it('normalizes Cloud commerce order responses', () => {
    expect(
      cloudOrdersResponseSchema.parse([
        {
          id: 'order-1',
          target: { orgId: 'org-1', endUserId: 'user-1', endUserLabel: 'owner@example.com' },
          paymentStatus: 'paid',
          fulfillmentStatus: 'fulfilled',
          subtotalAmount: 999,
          discountAmount: 100,
          totalAmount: 899,
          currency: 'usd',
          items: [
            {
              name: 'Storage Bundle',
              description: null,
              fulfillmentPayload: { storageBytes: 1024, trafficBytes: 2048 },
            },
          ],
          payments: [{ provider: 'stripe', providerSessionId: 'cs_1', providerPaymentIntentId: 'pi_1' }],
          createdAt: '2026-05-07T00:00:00.000Z',
          paidAt: '2026-05-07T00:01:00.000Z',
          fulfilledAt: '2026-05-07T00:02:00.000Z',
        },
      ]),
    ).toEqual({
      items: [
        {
          id: 'order-1',
          orgId: 'org-1',
          packageName: 'Storage Bundle',
          packageDescription: null,
          storageBytes: 1024,
          trafficBytes: 2048,
          subtotalAmount: 999,
          giftCardAmount: 100,
          stripeAmount: 899,
          paidAmount: 999,
          currency: 'usd',
          giftCardId: null,
          stripeSessionId: 'cs_1',
          stripePaymentIntentId: 'pi_1',
          paymentStatus: 'paid',
          fulfillmentStatus: 'delivered',
          terminalUserId: 'user-1',
          terminalUserEmail: 'owner@example.com',
          createdAt: '2026-05-07T00:00:00.000Z',
          paidAt: '2026-05-07T00:01:00.000Z',
          fulfilledAt: '2026-05-07T00:02:00.000Z',
        },
      ],
      total: 1,
    })
  })

  it('normalizes Cloud snake case gift card responses', () => {
    expect(
      cloudGiftCardsResponseSchema.parse([
        {
          id: 'gift-1',
          code: null,
          initial_amount: 5000,
          remaining_amount: 2500,
          currency: 'usd',
          status: 'active',
          expires_at: null,
          created_at: '2026-05-07T00:00:00.000Z',
          updated_at: '2026-05-07T00:01:00.000Z',
          disabled_at: null,
        },
      ]),
    ).toEqual({
      items: [
        {
          id: 'gift-1',
          code: '',
          initialAmount: 5000,
          remainingAmount: 2500,
          currency: 'usd',
          status: 'active',
          expiresAt: null,
          createdAt: '2026-05-07T00:00:00.000Z',
          updatedAt: '2026-05-07T00:01:00.000Z',
          disabledAt: null,
        },
      ],
      total: 1,
    })
  })

  it('normalizes paged Cloud gift card responses', () => {
    expect(
      cloudGiftCardsResponseSchema.parse({
        items: [
          {
            id: 'gift-1',
            code: 'ZS-PAGED-1',
            initialAmount: 5000,
            remainingAmount: 2500,
            currency: 'usd',
            status: 'active',
            expiresAt: null,
            createdAt: '2026-05-07T00:00:00.000Z',
            updatedAt: '2026-05-07T00:01:00.000Z',
            disabledAt: null,
          },
        ],
        total: 7,
      }),
    ).toEqual({
      items: [
        {
          id: 'gift-1',
          code: 'ZS-PAGED-1',
          initialAmount: 5000,
          remainingAmount: 2500,
          currency: 'usd',
          status: 'active',
          expiresAt: null,
          createdAt: '2026-05-07T00:00:00.000Z',
          updatedAt: '2026-05-07T00:01:00.000Z',
          disabledAt: null,
        },
      ],
      total: 7,
    })
  })

  it('normalizes legacy storage package payload shapes', () => {
    expect(
      cloudPackageResponseSchema.parse({
        id: 'legacy-storage',
        name: 'Legacy Storage',
        description: null,
        resourceType: 'storage',
        resourceBytes: 2048,
        prices: [{ currency: 'usd', unit_amount: '1200' }],
        sort_order: '4',
        created_at: '2026-05-07T00:00:00.000Z',
        updated_at: '2026-05-07T00:01:00.000Z',
      }),
    ).toEqual({
      id: 'legacy-storage',
      name: 'Legacy Storage',
      description: '',
      storageBytes: 2048,
      trafficBytes: 0,
      prices: [{ currency: 'usd', amount: 1200 }],
      active: true,
      sortOrder: 4,
      createdAt: '2026-05-07T00:00:00.000Z',
      updatedAt: '2026-05-07T00:01:00.000Z',
    })
    expect(
      cloudPackageResponseSchema.parse({
        id: 'legacy-traffic',
        name: 'Legacy Traffic',
        resource_type: 'traffic',
        resource_bytes: '4096',
        type: 'zpan_quota',
        prices: [{ currency: 'cny', amount: 1800 }],
        sortOrder: 5,
        active: false,
        createdAt: '2026-05-07T00:00:00.000Z',
        updatedAt: '2026-05-07T00:01:00.000Z',
      }),
    ).toEqual({
      id: 'legacy-traffic',
      name: 'Legacy Traffic',
      description: '',
      storageBytes: 0,
      trafficBytes: 4096,
      prices: [{ currency: 'cny', amount: 1800 }],
      active: false,
      sortOrder: 5,
      createdAt: '2026-05-07T00:00:00.000Z',
      updatedAt: '2026-05-07T00:01:00.000Z',
    })
  })
})
