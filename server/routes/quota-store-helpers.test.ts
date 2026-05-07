import { describe, expect, it } from 'vitest'
import type { Database } from '../platform/interface'
import { createCheckoutPayload, giftCardsPath, ordersPath, type RouteContext } from './quota-store-helpers'

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
})
