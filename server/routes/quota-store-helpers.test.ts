import { describe, expect, it } from 'vitest'
import type { Database } from '../platform/interface'
import {
  cloudGiftCardsResponseSchema,
  cloudOrdersResponseSchema,
  createCheckoutPayload,
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
      url: 'http://internal.local/api/quota-store/checkouts',
      header: () => undefined,
    },
  } as unknown as RouteContext
}

describe('quota store helper paths', () => {
  it('builds gift card and order Cloud paths', () => {
    expect(giftCardsPath()).toBe('/api/store/gift-cards')
    expect(giftCardsPath('active')).toBe('/api/store/gift-cards?status=active')
    expect(ordersPath()).toBe('/api/store/orders')
    expect(ordersPath(['org-1', 'org 2'])).toBe('/api/store/orders?targetOrgIds=org-1%2Corg%202')
  })

  it('includes gift card code in checkout payloads', async () => {
    await expect(
      createCheckoutPayload(createRouteContext(), 'binding-1', 'pkg-1', 'org-1', 'user-1', 'usd', 'GC-123'),
    ).resolves.toEqual({
      boundLicenseId: 'binding-1',
      packageId: 'pkg-1',
      targetOrgId: 'org-1',
      terminalUserId: 'user-1',
      terminalUserLabel: 'owner@example.com',
      currency: 'usd',
      giftCardCode: 'GC-123',
      successUrl: 'https://disk.example.com/storage',
      cancelUrl: 'https://disk.example.com/storage',
    })
  })

  it('normalizes Cloud snake case order responses', () => {
    expect(
      cloudOrdersResponseSchema.parse([
        {
          id: 'order-1',
          target_org_id: 'org-1',
          package_name: 'Storage Bundle',
          package_description: null,
          storage_bytes: 1024,
          traffic_bytes: 2048,
          subtotal_amount: 999,
          gift_card_amount: 100,
          stripe_amount: 899,
          paid_amount: 999,
          currency: 'usd',
          gift_card_id: 'gift-1',
          stripe_session_id: 'cs_1',
          stripe_payment_intent_id: 'pi_1',
          payment_status: 'paid',
          fulfillment_status: 'delivered',
          terminal_user_id: 'user-1',
          terminal_user_email: 'owner@example.com',
          created_at: '2026-05-07T00:00:00.000Z',
          paid_at: '2026-05-07T00:01:00.000Z',
          fulfilled_at: '2026-05-07T00:02:00.000Z',
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
          giftCardId: 'gift-1',
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
    ).toEqual([
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
    ])
  })
})
