import { sql } from 'drizzle-orm'
import { generateKeys, sign } from 'paseto-ts/v4'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ZPAN_CLOUD_URL_DEFAULT } from '../../../shared/constants'
import { PUBLIC_KEYS } from '../../domain/license-keys.js'
import { adminHeaders, authedHeaders, createTestApp, seedBusinessLicense } from '../../test/setup.js'
import { cloudGiftCardsResponseSchema, cloudPackageResponseSchema } from './helpers.js'

const REFRESH_TOKEN = 'test-refresh-token'
const INSTANCE_STORE_PATH = '/api/stores/store-test-binding'
const { secretKey: EVENT_SECRET, publicKey: EVENT_PUBLIC } = generateKeys('public')

const cloudGiftCardResponseFixture = {
  id: 'gift-card-1',
  storeId: 'store-test-binding',
  campaignId: null,
  code: null,
  codeLast4: '0001',
  credits: 1000,
  status: 'active',
  expiresAt: null,
  createdAt: '2026-05-06T00:00:00.000Z',
  updatedAt: '2026-05-06T00:00:00.000Z',
  disabledAt: null,
  revokedAt: null,
  createdByAdmin: 'admin',
}

function cloudGiftCard(overrides: Record<string, unknown> = {}) {
  return { ...cloudGiftCardResponseFixture, ...overrides }
}

function cloudProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cloud-pkg-1',
    storeId: 'store-test-binding',
    type: 'store_item',
    name: 'Small',
    description: 'starter',
    metadata: { deliverable: { type: 'zpan.plan', storageBytes: 4096, includedCredits: 100 } },
    prices: [{ id: 'price-usd', currency: 'usd', amount: 500, recurring: { interval: 'month', intervalCount: 1 } }],
    active: true,
    sortOrder: 1,
    createdAt: '2026-05-06T00:00:00.000Z',
    updatedAt: '2026-05-06T00:00:00.000Z',
    ...overrides,
  }
}

function cloudOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cloud-order-1',
    storeId: 'store-test-binding',
    buyerAccountId: 'buyer-1',
    target: { orgId: 'org-placeholder' },
    status: 'paid',
    paymentStatus: 'paid',
    fulfillmentStatus: 'fulfilled',
    subtotalAmount: 500,
    discountAmount: 0,
    totalAmount: 500,
    currency: 'usd',
    items: [
      {
        id: 'order-item-1',
        orderId: 'cloud-order-1',
        productId: 'cloud-pkg-1',
        productType: 'store_item',
        name: 'Small',
        description: 'starter',
        quantity: 1,
        unitAmount: 500,
        totalAmount: 500,
        fulfillmentPayload: { deliverable: { type: 'zpan.plan', storageBytes: 512, trafficBytes: 0 } },
      },
    ],
    payments: [
      {
        id: 'payment-1',
        orderId: 'cloud-order-1',
        provider: 'stripe',
        amount: 500,
        currency: 'usd',
        status: 'paid',
        providerSessionId: 'cs_test_1',
        providerPaymentIntentId: 'pi_test_1',
        createdAt: '2026-05-06T00:00:00.000Z',
        paidAt: '2026-05-06T00:00:00.000Z',
      },
    ],
    createdAt: '2026-05-06T00:00:00.000Z',
    paidAt: '2026-05-06T00:00:00.000Z',
    fulfilledAt: '2026-05-06T00:00:00.000Z',
    canceledAt: null,
    ...overrides,
  }
}

function paymentPayload() {
  const call = vi.mocked(fetch).mock.calls.find(([url]) => String(url).includes('/payments')) as
    | [URL, RequestInit]
    | undefined
  if (!call) throw new Error('payment_request_missing')
  return JSON.parse(String(call[1].body)) as Record<string, unknown>
}

function orderPayload() {
  const call = vi
    .mocked(fetch)
    .mock.calls.find(([url, init]) => init?.method === 'POST' && String(url).endsWith('/orders')) as
    | [URL, RequestInit]
    | undefined
  if (!call) throw new Error('order_request_missing')
  return JSON.parse(String(call[1].body)) as Record<string, unknown>
}

function requestHeader(init: RequestInit, name: string) {
  return new Headers(init.headers).get(name)
}

beforeEach(() => {
  if (!PUBLIC_KEYS.includes(EVENT_PUBLIC)) PUBLIC_KEYS.unshift(EVENT_PUBLIC)
  let lastTargetOrgId = 'org-placeholder'
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, init) => {
      if (String(url).includes('/api/stores/') && String(url).includes('/credit-accounts/')) {
        if (init?.method === 'GET') {
          if (String(url).includes('/ledger-entries')) {
            return {
              ok: true,
              status: 200,
              json: async () => ({
                items: [
                  {
                    id: 'ledger-1',
                    creditAccountId: 'credit-account-1',
                    creditBucketId: 'credit-bucket-1',
                    storeId: 'store-test-binding',
                    customerId: 'org-placeholder',
                    amount: 500,
                    direction: 'credit',
                    status: 'posted',
                    sourceType: 'gift_card_redemption',
                    sourceId: 'gift-1',
                    orderId: null,
                    paymentId: null,
                    createdAt: '2026-05-06T00:00:00.000Z',
                  },
                ],
                total: 1,
                limit: 50,
                offset: 0,
              }),
            } as Response
          }
          return {
            ok: true,
            status: 200,
            json: async () => ({
              balance: 1250,
            }),
          } as Response
        }
        return {
          ok: true,
          status: 201,
          json: async () => ({
            redeemedCredits: 1000,
            entries: [],
            failures: [],
          }),
        } as Response
      }
      if (String(url).includes('/api/stores/') && String(url).includes('/gift-cards')) {
        if (init?.method === 'DELETE') {
          return { ok: true, status: 204, json: async () => ({}) } as Response
        }
        if (init?.method === 'PATCH') {
          return { ok: true, status: 204, json: async () => null } as Response
        }
        if (init?.method === 'GET') {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              items: [cloudGiftCard({ code: 'ZS-LIST-1', codeLast4: 'ST-1', credits: 1024 })],
              total: 1,
              limit: 50,
              offset: 0,
              data: {
                items: [cloudGiftCard({ code: 'ZS-LIST-1', codeLast4: 'ST-1', credits: 1024 })],
                total: 1,
                limit: 50,
                offset: 0,
              },
            }),
          } as Response
        }
        const body = JSON.parse(String(init?.body ?? '{}')) as { credits?: number; count?: number }
        return {
          ok: true,
          status: 201,
          json: async () => ({
            data: Array.from({ length: body.count ?? 1 }, (_, index) =>
              cloudGiftCard({
                code: `ZS-GEN-${index + 1}`,
                codeLast4: `GEN${index + 1}`,
                credits: body.credits ?? 1024,
                status: 'active',
              }),
            ),
          }),
        } as Response
      }
      if (String(url).includes('/api/stores/') && String(url).includes('/products')) {
        if (init?.method === 'GET') {
          const parsedUrl = new URL(String(url))
          const id = parsedUrl.pathname.split('/').at(-1)
          if (id?.startsWith('cloud-pkg-')) {
            return {
              ok: true,
              status: 200,
              json: async () => cloudProduct({ id }),
            } as Response
          }
          const status = parsedUrl.searchParams.get('status')
          const items = [
            cloudProduct(),
            cloudProduct({
              id: 'cloud-pkg-inactive',
              name: 'Retired',
              description: 'hidden from users',
              metadata: { deliverable: { type: 'zpan.plan', storageBytes: 8192, includedCredits: 0 } },
              prices: [{ currency: 'usd', amount: 900, recurring: { interval: 'month', intervalCount: 1 } }],
              active: false,
              sortOrder: 2,
            }),
          ].filter((product) => (status === 'active' ? product.active : status === 'inactive' ? !product.active : true))
          return {
            ok: true,
            status: 200,
            json: async () => ({
              items,
              total: items.length,
              limit: 100,
              offset: 0,
            }),
          } as Response
        }
        if (init?.method === 'DELETE') {
          return { ok: true, status: 204, json: async () => ({}) } as Response
        }
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
        return {
          ok: true,
          status: 200,
          json: async () =>
            cloudProduct({
              id: new URL(String(url)).pathname.split('/').at(-1)?.startsWith('cloud-pkg-')
                ? new URL(String(url)).pathname.split('/').at(-1)
                : 'cloud-pkg-1',
              ...body,
              metadata: body.metadata ?? {
                deliverable: { type: 'zpan.plan', storageBytes: 4096, includedCredits: 100 },
              },
            }),
        } as Response
      }
      if (
        String(url).includes('/api/stores/') &&
        String(url).includes('/orders/') &&
        String(url).includes('/payments')
      ) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            status: 'pending',
            paymentId: 'payment-cloud-1',
            orderId: 'order-cloud-1',
            url: 'https://cloud.example/checkout',
          }),
        } as Response
      }
      if (String(url).includes('/api/stores/') && String(url).includes('/orders')) {
        const parsedUrl = new URL(String(url))
        const orderId = parsedUrl.pathname.split('/').at(-1)
        if (init?.method === 'PATCH') {
          return {
            ok: true,
            status: 200,
            json: async () =>
              cloudOrder({
                id: orderId,
                status: 'canceled',
                paymentStatus: 'canceled',
                fulfillmentStatus: 'canceled',
              }),
          } as Response
        }
        if (init?.method === 'POST') {
          const body = JSON.parse(String(init.body)) as { target?: { orgId?: string } }
          lastTargetOrgId = body.target?.orgId ?? lastTargetOrgId
          return {
            ok: true,
            status: 201,
            json: async () => cloudOrder({ id: 'order-cloud-1', target: body.target ?? null }),
          } as Response
        }
        if (orderId?.startsWith('order-')) {
          const targetOrgId = orderId === 'order-other-org' ? 'org-other' : lastTargetOrgId
          return {
            ok: true,
            status: 200,
            json: async () =>
              cloudOrder({
                id: orderId,
                target: { orgId: targetOrgId, customerId: targetOrgId },
              }),
          } as Response
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [cloudOrder({ target: { orgId: lastTargetOrgId } })],
            total: 1,
            limit: 100,
            offset: 0,
          }),
        } as Response
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: 'pending',
          paymentId: 'payment-cloud-1',
          orderId: 'order-cloud-1',
          url: 'https://cloud.example/checkout',
        }),
      } as Response
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  const eventKeyIndex = PUBLIC_KEYS.indexOf(EVENT_PUBLIC)
  if (eventKeyIndex >= 0) PUBLIC_KEYS.splice(eventKeyIndex, 1)
})

describe('Quota Store API', () => {
  it('parses Cloud package and gift-card response shapes', () => {
    expect(
      cloudPackageResponseSchema.parse({
        id: 'pkg-sdk',
        storeId: 'store-test-binding',
        type: 'store_item',
        name: 'SDK Package',
        description: null,
        metadata: { deliverable: { type: 'zpan.plan', storageBytes: 4096, includedCredits: 100 } },
        prices: [{ currency: 'usd', amount: 999, recurring: { interval: 'month', intervalCount: 1 } }],
        active: true,
        sortOrder: 2,
        createdAt: '2026-05-06T00:00:00.000Z',
        updatedAt: '2026-05-06T00:00:00.000Z',
      }),
    ).toEqual({
      id: 'pkg-sdk',
      storeId: 'store-test-binding',
      type: 'store_item',
      name: 'SDK Package',
      description: null,
      metadata: { deliverable: { type: 'zpan.plan', storageBytes: 4096, includedCredits: 100 } },
      prices: [{ currency: 'usd', amount: 999, recurring: { interval: 'month', intervalCount: 1 } }],
      active: true,
      sortOrder: 2,
      createdAt: '2026-05-06T00:00:00.000Z',
      updatedAt: '2026-05-06T00:00:00.000Z',
    })

    expect(
      cloudGiftCardsResponseSchema.parse({
        items: [
          cloudGiftCard({
            code: 'ZS11-ACTV-0000-0001',
            codeLast4: '0001',
            credits: 2048,
          }),
        ],
        total: 1,
        limit: 50,
        offset: 0,
      }),
    ).toEqual({
      items: [
        {
          id: 'gift-card-1',
          storeId: 'store-test-binding',
          campaignId: null,
          code: 'ZS11-ACTV-0000-0001',
          codeLast4: '0001',
          credits: 2048,
          status: 'active',
          expiresAt: null,
          createdAt: '2026-05-06T00:00:00.000Z',
          updatedAt: '2026-05-06T00:00:00.000Z',
          disabledAt: null,
          revokedAt: null,
          createdByAdmin: 'admin',
        },
      ],
      total: 1,
      limit: 50,
      offset: 0,
    })
  })

  it('returns 402 for Cloud quota-change webhook when Pro quota_store is absent [spec: quota-store/feature-gated]', async () => {
    const { app } = await createTestApp()
    const payload = JSON.stringify({
      eventId: 'evt-no-pro',
      eventType: 'order.quota_changed',
      cloudOrderId: 'order-no-pro',
      targetOrgId: 'org-no-pro',
      source: 'stripe',
      direction: 'increase',
      storageBytes: 1024,
      trafficBytes: 0,
    })

    const res = await postWebhook(app, payload)

    expect(res.status).toBe(402)
  })

  it('ignores spoofed forwarded origin for Cloud checkout return URLs [spec: quota-store/checkout-origin-antispoof]', async () => {
    const { app, db } = await createTestApp()
    await seedBusinessLicense(db)
    const headers = await authedHeaders(app, 'buyer@example.com')
    const packageId = await seedPackage(db)

    const checkout = await app.request('/api/store/checkouts', {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'attacker.example',
      },
      body: JSON.stringify({ packageId }),
    })

    expect(checkout.status).toBe(200)
    expect(orderPayload()).toMatchObject({
      deliveryCallbackUrl: 'http://localhost/api/store/webhook',
    })
    expect(paymentPayload()).toMatchObject({
      successUrl: 'http://localhost/storage',
      cancelUrl: 'http://localhost/storage',
    })
  })

  it('ignores non-https forwarded schemes for Cloud checkout return URLs', async () => {
    const { app, db } = await createTestApp()
    await seedBusinessLicense(db)
    const headers = await authedHeaders(app, 'buyer@example.com')
    const packageId = await seedPackage(db)

    const checkout = await app.request('/api/store/checkouts', {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
        'x-forwarded-proto': 'http',
        'x-forwarded-host': 'localhost',
      },
      body: JSON.stringify({ packageId }),
    })

    expect(checkout.status).toBe(200)
    expect(orderPayload()).toMatchObject({
      deliveryCallbackUrl: 'http://localhost/api/store/webhook',
    })
    expect(paymentPayload()).toMatchObject({
      successUrl: 'http://localhost/storage',
      cancelUrl: 'http://localhost/storage',
    })
  })

  it('uses the detected site origin for checkout return URLs [spec: quota-store/checkout-return-origin]', async () => {
    const { app, db } = await createTestApp()
    await seedBusinessLicense(db)
    const headers = await authedHeaders(app, 'buyer@example.com')
    const packageId = await seedPackage(db)

    const checkout = await app.request('http://files.example.com/api/store/checkouts', {
      method: 'POST',
      headers: { ...headers, Host: 'localhost', 'Content-Type': 'application/json' },
      body: JSON.stringify({ packageId }),
    })

    expect(checkout.status).toBe(200)
    expect(orderPayload()).toMatchObject({
      deliveryCallbackUrl: 'http://localhost/api/store/webhook',
    })
    expect(paymentPayload()).toMatchObject({
      successUrl: 'http://localhost/storage',
      cancelUrl: 'http://localhost/storage',
    })
  })

  it('does not use auth URL as checkout return URL configuration', async () => {
    const { app, db } = await createTestApp({ BETTER_AUTH_URL: 'https://auth.example.com/path' })
    await seedBusinessLicense(db)
    const headers = await authedHeaders(app, 'buyer@example.com')
    const packageId = await seedPackage(db)

    const checkout = await app.request('/api/store/checkouts', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ packageId }),
    })

    expect(checkout.status).toBe(200)
    expect(orderPayload()).toMatchObject({
      deliveryCallbackUrl: 'http://localhost/api/store/webhook',
    })
    expect(paymentPayload()).toMatchObject({
      successUrl: 'http://localhost/storage',
      cancelUrl: 'http://localhost/storage',
    })
  })

  it('uses configured site public origin for checkout URLs', async () => {
    const { app, db } = await createTestApp()
    await db.run(sql`
      INSERT INTO system_options (key, value, public)
      VALUES ('site_public_origin', 'https://files.example.com/path', 0)
    `)
    await seedBusinessLicense(db)
    const headers = await authedHeaders(app, 'buyer@example.com')
    const packageId = await seedPackage(db)

    const checkout = await app.request('/api/store/checkouts', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ packageId }),
    })

    expect(checkout.status).toBe(200)
    expect(orderPayload()).toMatchObject({
      deliveryCallbackUrl: 'https://files.example.com/api/store/webhook',
    })
    expect(paymentPayload()).toMatchObject({
      successUrl: 'https://files.example.com/storage',
      cancelUrl: 'https://files.example.com/storage',
    })
  })

  it('falls back to request origin when site public origin is not configured', async () => {
    const { app, db } = await createTestApp()
    await seedBusinessLicense(db)
    const headers = await authedHeaders(app, 'buyer@example.com')
    const packageId = await seedPackage(db)

    const checkout = await app.request('/api/store/checkouts', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ packageId }),
    })

    expect(checkout.status).toBe(200)
    expect(orderPayload()).toMatchObject({
      deliveryCallbackUrl: 'http://localhost/api/store/webhook',
    })
    expect(paymentPayload()).toMatchObject({
      successUrl: 'http://localhost/storage',
      cancelUrl: 'http://localhost/storage',
    })
  })

  it('rejects checkout target orgs the user cannot access [spec: quota-store/checkout-access]', async () => {
    const { app, db } = await createTestApp()
    await seedBusinessLicense(db)
    const headers = await authedHeaders(app, 'buyer@example.com')
    const packageId = await seedPackage(db)

    const res = await app.request('/api/store/checkouts', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ packageId }),
    })

    expect(res.status).toBe(200)
  })

  it('rejects team checkout from non-owner members [spec: quota-store/team-checkout-owner-only]', async () => {
    const { app, db } = await createTestApp()
    await seedBusinessLicense(db)
    const { headers } = await memberInTeamOrg(app, db, 'editor')
    const packageId = await seedPackage(db)

    const res = await app.request('/api/store/checkouts', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ packageId }),
    })

    expect(res.status).toBe(403)
  })

  it('allows team checkout for the team owner and targets the team org [spec: quota-store/team-checkout]', async () => {
    const { app, db } = await createTestApp()
    await seedBusinessLicense(db)
    const { headers, teamOrgId } = await memberInTeamOrg(app, db, 'owner')
    const packageId = await seedPackage(db)

    const res = await app.request('/api/store/checkouts', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ packageId }),
    })

    expect(res.status).toBe(200)
    const target = orderPayload().target as { orgId: string; customerId: string; customerLabel: string }
    expect(target.orgId).toBe(teamOrgId)
    expect(target.customerId).toBe(teamOrgId)
    expect(target.customerLabel).toBe('Test Team')
  })

  it('rejects team billing and credit endpoints for non-owner members', async () => {
    const { app, db } = await createTestApp()
    await seedBusinessLicense(db)
    const { headers } = await memberInTeamOrg(app, db, 'viewer')

    const portal = await app.request('/api/store/billing-portal-sessions', { method: 'POST', headers })
    expect(portal.status).toBe(403)

    const credits = await app.request('/api/store/credits', { headers })
    expect(credits.status).toBe(403)

    const ledger = await app.request('/api/store/credits/ledger-entries', { headers })
    expect(ledger.status).toBe(403)

    const redemption = await app.request('/api/store/credits/redemptions', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'ZS-TEST-1' }),
    })
    expect(redemption.status).toBe(403)

    const orders = await app.request('/api/store/orders', { headers })
    expect(orders.status).toBe(403)
  })

  it('allows team billing portal for the team owner', async () => {
    const { app, db } = await createTestApp()
    await seedBusinessLicense(db)
    const { headers, teamOrgId } = await memberInTeamOrg(app, db, 'owner')
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ url: 'https://billing.stripe.test/team', stripeSubscriptionId: 'sub_team' }),
    } as Response)

    const res = await app.request('/api/store/billing-portal-sessions', { method: 'POST', headers })
    expect(res.status).toBe(200)
    const call = vi.mocked(fetch).mock.calls.find(([url]) => String(url).includes('portal-sessions')) as
      | [URL, RequestInit]
      | undefined
    expect(call).toBeDefined()
    expect(JSON.parse(String(call![1].body))).toMatchObject({ customerId: teamOrgId })
  })

  it('omits credit discount fields when checking out recurring packages', async () => {
    const { app, db } = await createTestApp()
    await seedBusinessLicense(db)
    const headers = await authedHeaders(app, 'buyer@example.com')
    const packageId = await seedPackage(db)
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () =>
        cloudProduct({
          id: packageId,
          prices: [
            {
              id: 'price-monthly',
              currency: 'usd',
              amount: 500,
              recurring: { interval: 'month', intervalCount: 1 },
            },
          ],
        }),
    } as Response)

    const checkout = await app.request('/api/store/checkouts', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ packageId }),
    })

    expect(checkout.status).toBe(200)
  })

  it('rejects recurring checkout when the workspace already has an active plan [spec: quota-store/no-double-plan]', async () => {
    const { app, db } = await createTestApp()
    await seedBusinessLicense(db)
    const headers = await authedHeaders(app, 'buyer@example.com')
    const orgId = await getFirstOrgId(db)
    const packageId = await seedPackage(db)
    const now = Date.now()
    await db.run(sql`
      UPDATE org_quota_entitlements
      SET status = 'revoked', updated_at = ${now}
      WHERE org_id = ${orgId}
        AND resource_type = 'storage'
        AND entitlement_type = 'plan'
        AND status = 'active'
    `)
    await db.run(sql`
      INSERT INTO org_quota_entitlements
        (id, org_id, resource_type, entitlement_type, source, source_id, bytes, starts_at, expires_at, status, metadata, created_at, updated_at)
      VALUES
        ('ent-active-plan', ${orgId}, 'storage', 'plan', 'cloud_order', ${`stripe_subscription:sub_active:${orgId}`}, 4096, ${now}, NULL, 'active', '{"packageName":"Active Plan"}', ${now}, ${now})
    `)
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () =>
        cloudProduct({
          id: packageId,
          prices: [
            {
              id: 'price-monthly',
              currency: 'usd',
              amount: 500,
              recurring: { interval: 'month', intervalCount: 1 },
            },
          ],
        }),
    } as Response)

    const checkout = await app.request('/api/store/checkouts', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ packageId }),
    })

    expect(checkout.status).toBe(409)
    await expect(checkout.json()).resolves.toMatchObject({
      error: { message: 'Workspace plan already exists', details: [{ reason: 'WORKSPACE_PLAN_EXISTS' }] },
    })
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1)
  })

  it('creates fixed-duration package checkouts without credit discount fields [spec: quota-store/fixed-checkout]', async () => {
    const { app, db } = await createTestApp()
    await seedBusinessLicense(db)
    const headers = await authedHeaders(app, 'buyer@example.com')
    const packageId = await seedPackage(db)

    const checkout = await app.request('/api/store/checkouts', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ packageId }),
    })

    expect(checkout.status).toBe(200)
  })

  it('creates a subscription portal for the active workspace plan [spec: quota-store/subscription-portal]', async () => {
    const { app, db } = await createTestApp()
    await seedBusinessLicense(db)
    const headers = await authedHeaders(app, 'buyer@example.com')
    const orgId = await getFirstOrgId(db)
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ url: 'https://billing.stripe.test/1', stripeSubscriptionId: 'sub_1' }),
    } as Response)

    const portal = await app.request('/api/store/billing-portal-sessions', {
      method: 'POST',
      headers,
    })

    expect(portal.status).toBe(200)
    await expect(portal.json()).resolves.toEqual({
      url: 'https://billing.stripe.test/1',
      stripeSubscriptionId: 'sub_1',
    })
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [URL, RequestInit]
    expect(String(url)).toBe(`${ZPAN_CLOUD_URL_DEFAULT}${INSTANCE_STORE_PATH}/billing/portal-sessions`)
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ customerId: orgId, returnUrl: 'http://localhost/storage' })
  })

  it('lists purchasable packages, targets, checkout, and orders [spec: quota-store/list-packages]', async () => {
    const { app, db } = await createTestApp()
    await seedBusinessLicense(db)
    const headers = await authedHeaders(app, 'buyer@example.com')
    const orgId = await getFirstOrgId(db)
    const packageId = await seedPackage(db)

    const packages = await app.request('/api/store/packages', { headers })
    const targets = await app.request('/api/store/targets', { headers })
    const checkout = await app.request('/api/store/checkouts', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ packageId }),
    })
    const orders = await app.request('/api/store/orders', { headers })

    expect(packages.status).toBe(200)
    await expect(packages.json()).resolves.toMatchObject({
      total: 1,
      items: [{ id: 'cloud-pkg-1', active: true }],
    })
    expect(targets.status).toBe(200)
    await expect(targets.json()).resolves.toMatchObject({ total: 1, items: [{ orgId, type: 'personal' }] })
    expect(checkout.status).toBe(200)
    await expect(checkout.json()).resolves.toEqual({
      status: 'pending',
      paymentId: 'payment-cloud-1',
      orderId: 'order-cloud-1',
      url: 'https://cloud.example/checkout',
    })
    const calls = vi.mocked(fetch).mock.calls as Array<[URL, RequestInit]>
    const [orderUrl, orderInit] = calls.find(
      ([url, init]) => init.method === 'POST' && String(url).endsWith('/orders'),
    )!
    const orderBody = JSON.parse(String(orderInit.body))
    expect(String(orderUrl)).toBe(`${ZPAN_CLOUD_URL_DEFAULT}${INSTANCE_STORE_PATH}/orders`)
    expect(requestHeader(orderInit, 'Authorization')).toBe(`Bearer ${REFRESH_TOKEN}`)
    expect(orderBody).toMatchObject({
      items: [{ productId: packageId }],
      currency: 'usd',
      target: {
        orgId,
        customerId: orgId,
        customerLabel: 'buyer@example.com',
      },
    })
    const [paymentUrl, paymentInit] = calls.find(([url]) => String(url).includes('/payments'))!
    const paymentBody = JSON.parse(String(paymentInit.body))
    expect(String(paymentUrl)).toBe(`${ZPAN_CLOUD_URL_DEFAULT}${INSTANCE_STORE_PATH}/orders/order-cloud-1/payments`)
    expect(paymentBody).toMatchObject({
      successUrl: 'http://localhost/storage',
      cancelUrl: 'http://localhost/storage',
    })
    expect(orders.status).toBe(200)
    await expect(orders.json()).resolves.toMatchObject({
      total: 1,
      items: [
        {
          id: 'cloud-order-1',
          target: { orgId },
          items: [{ fulfillmentPayload: { deliverable: { type: 'zpan.plan', storageBytes: 512 } } }],
        },
      ],
    })
    const [ordersUrl] = calls
      .filter(([url]) => {
        const parsed = new URL(String(url))
        return parsed.pathname.endsWith('/orders') && parsed.searchParams.get('limit') === '100'
      })
      .at(-1)!
    const parsedOrdersUrl = new URL(String(ordersUrl))
    expect(parsedOrdersUrl.pathname).toBe('/api/stores/store-test-binding/orders')
    expect(parsedOrdersUrl.searchParams.get('limit')).toBe('100')
    expect(parsedOrdersUrl.searchParams.get('customerId')).toBe(orgId)
  })

  it('rejects checkout currency fields before proxying to Cloud [spec: quota-store/checkout-currency-guard]', async () => {
    const { app, db } = await createTestApp()
    await seedBusinessLicense(db)
    const headers = await authedHeaders(app, 'buyer@example.com')
    const packageId = await seedPackage(db)

    const cnyCheckout = await app.request('/api/store/checkouts', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ packageId, currency: 'cny' }),
    })
    const usdCheckout = await app.request('/api/store/checkouts', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ packageId, currency: 'usd' }),
    })

    expect(cnyCheckout.status).toBe(400)
    expect(usdCheckout.status).toBe(400)
    const calls = vi.mocked(fetch).mock.calls as Array<[URL, RequestInit]>
    expect(calls.some(([url, init]) => init.method === 'POST' && String(url).endsWith('/orders'))).toBe(false)
  })

  it('rejects malformed Cloud checkout products with non-USD prices', async () => {
    const { app, db } = await createTestApp()
    await seedBusinessLicense(db)
    const headers = await authedHeaders(app, 'buyer@example.com')
    const packageId = await seedPackage(db)
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () =>
        cloudProduct({
          id: packageId,
          prices: [
            { id: 'price-usd', currency: 'usd', amount: 500 },
            { id: 'price-cny', currency: 'cny', amount: 3600 },
          ],
        }),
    } as Response)

    const checkout = await app.request('/api/store/checkouts', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ packageId, priceId: 'price-cny' }),
    })

    expect(checkout.status).toBe(502)
    await expect(checkout.json()).resolves.toMatchObject({ error: { code: 502, message: 'invalid_cloud_response' } })
    const calls = vi.mocked(fetch).mock.calls as Array<[URL, RequestInit]>
    expect(calls.some(([url, init]) => init.method === 'POST' && String(url).endsWith('/orders'))).toBe(false)
  })

  it('proxies credit balance and gift card redemption through credit endpoints [spec: quota-store/credit-balance]', async () => {
    const { app, db } = await createTestApp()
    await seedBusinessLicense(db)
    const headers = await authedHeaders(app, 'buyer@example.com')
    const orgId = await getFirstOrgId(db)

    const credits = await app.request('/api/store/credits', { headers })
    const redeem = await app.request('/api/store/credits/redemptions', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'ZS-1234-5678' }),
    })

    expect(credits.status).toBe(200)
    await expect(credits.json()).resolves.toEqual({ balance: 1250 })
    expect(redeem.status).toBe(200)
    await expect(redeem.json()).resolves.toEqual({
      redeemedCredits: 1000,
      entries: [],
      failures: [],
    })

    const calls = vi.mocked(fetch).mock.calls as Array<[URL, RequestInit]>
    const [creditsUrl, creditsInit] = calls.find(([url]) => String(url).includes(`/credit-accounts/${orgId}/balance`))!
    const [redeemUrl, redeemInit] = calls.find(([url]) =>
      String(url).includes(`/credit-accounts/${orgId}/redemptions`),
    )!
    expect(String(creditsUrl)).toBe(`${ZPAN_CLOUD_URL_DEFAULT}${INSTANCE_STORE_PATH}/credit-accounts/${orgId}/balance`)
    expect(creditsInit.method).toBe('GET')
    expect(String(redeemUrl)).toBe(
      `${ZPAN_CLOUD_URL_DEFAULT}${INSTANCE_STORE_PATH}/credit-accounts/${orgId}/redemptions`,
    )
    expect(redeemInit.method).toBe('POST')
    expect(JSON.parse(String(redeemInit.body))).toEqual({ codes: ['ZS-1234-5678'] })
  })

  it('proxies credit ledger entries through credit endpoints [spec: quota-store/credit-ledger]', async () => {
    const { app, db } = await createTestApp()
    await seedBusinessLicense(db)
    const headers = await authedHeaders(app, 'buyer@example.com')
    const orgId = await getFirstOrgId(db)

    const ledger = await app.request('/api/store/credits/ledger-entries', { headers })

    expect(ledger.status).toBe(200)
    await expect(ledger.json()).resolves.toEqual({
      items: [
        {
          id: 'ledger-1',
          creditAccountId: 'credit-account-1',
          creditBucketId: 'credit-bucket-1',
          storeId: 'store-test-binding',
          customerId: 'org-placeholder',
          amount: 500,
          direction: 'credit',
          status: 'posted',
          sourceType: 'gift_card_redemption',
          sourceId: 'gift-1',
          orderId: null,
          paymentId: null,
          createdAt: '2026-05-06T00:00:00.000Z',
        },
      ],
      total: 1,
      limit: 50,
      offset: 0,
    })

    const calls = vi.mocked(fetch).mock.calls as Array<[URL, RequestInit]>
    const [ledgerUrl, ledgerInit] = calls.find(([url]) =>
      String(url).includes(`/credit-accounts/${orgId}/ledger-entries`),
    )!
    expect(String(ledgerUrl)).toBe(
      `${ZPAN_CLOUD_URL_DEFAULT}${INSTANCE_STORE_PATH}/credit-accounts/${orgId}/ledger-entries`,
    )
    expect(ledgerInit.method).toBe('GET')
  })

  it('continues payment and cancels orders through Cloud [spec: quota-store/order-continue-cancel]', async () => {
    const { app, db } = await createTestApp()
    await seedBusinessLicense(db)
    const headers = await authedHeaders(app, 'buyer@example.com')
    const orgId = await getFirstOrgId(db)
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => cloudOrder({ id: 'order-cloud-1', target: { orgId, customerId: orgId } }),
    } as Response)

    const payment = await app.request('/api/store/orders/order-cloud-1/payments', {
      method: 'POST',
      headers,
    })
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => cloudOrder({ id: 'order-cloud-1', target: { orgId, customerId: orgId } }),
    } as Response)
    const canceled = await app.request('/api/store/orders/order-cloud-1/status', {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'canceled' }),
    })

    expect(payment.status).toBe(200)
    await expect(payment.json()).resolves.toEqual({
      status: 'pending',
      paymentId: 'payment-cloud-1',
      orderId: 'order-cloud-1',
      url: 'https://cloud.example/checkout',
    })
    expect(canceled.status).toBe(200)
    await expect(canceled.json()).resolves.toMatchObject({
      id: 'order-cloud-1',
      status: 'canceled',
      paymentStatus: 'canceled',
      fulfillmentStatus: 'canceled',
    })

    const calls = vi.mocked(fetch).mock.calls as Array<[URL, RequestInit]>
    const [paymentUrl, paymentInit] = calls.find(([url]) => String(url).includes('/orders/order-cloud-1/payments'))!
    const [cancelUrl, cancelInit] = calls.find(
      ([url, init]) => String(url).includes('/orders/order-cloud-1') && init.method === 'PATCH',
    )!
    expect(String(paymentUrl)).toBe(`${ZPAN_CLOUD_URL_DEFAULT}${INSTANCE_STORE_PATH}/orders/order-cloud-1/payments`)
    expect(paymentInit.method).toBe('POST')
    expect(JSON.parse(String(paymentInit.body))).toEqual({
      successUrl: 'http://localhost/storage',
      cancelUrl: 'http://localhost/storage',
    })
    expect(String(cancelUrl)).toBe(`${ZPAN_CLOUD_URL_DEFAULT}${INSTANCE_STORE_PATH}/orders/order-cloud-1`)
    expect(cancelInit.method).toBe('PATCH')
    expect(JSON.parse(String(cancelInit.body))).toEqual({ status: 'canceled' })
  })

  it('rejects payment continuation and cancellation for another org order [spec: quota-store/order-org-scope]', async () => {
    const { app, db } = await createTestApp()
    await seedBusinessLicense(db)
    const headers = await authedHeaders(app, 'buyer@example.com')

    const payment = await app.request('/api/store/orders/order-other-org/payments', {
      method: 'POST',
      headers,
    })
    const canceled = await app.request('/api/store/orders/order-other-org/status', {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'canceled' }),
    })

    expect(payment.status).toBe(403)
    await expect(payment.json()).resolves.toMatchObject({ error: { message: 'Forbidden' } })
    expect(canceled.status).toBe(403)
    await expect(canceled.json()).resolves.toMatchObject({ error: { message: 'Forbidden' } })
    const calls = vi.mocked(fetch).mock.calls as Array<[URL, RequestInit]>
    expect(calls.some(([url]) => String(url).includes('/orders/order-other-org/payments'))).toBe(false)
    expect(
      calls.some(([url, init]) => String(url).includes('/orders/order-other-org') && init.method === 'PATCH'),
    ).toBe(false)
  })

  it('hides self-service store endpoints until Cloud is bound [spec: quota-store/requires-binding]', async () => {
    const { app, db } = await createTestApp()
    await seedBusinessLicense(db)
    const headers = await authedHeaders(app, 'buyer@example.com')
    await db.run(sql`UPDATE license_bindings SET refresh_token = NULL`)

    const packageId = await seedPackage(db)
    const packages = await app.request('/api/store/packages', { headers })
    const targets = await app.request('/api/store/targets', { headers })
    const checkout = await app.request('/api/store/checkouts', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ packageId }),
    })
    const orders = await app.request('/api/store/orders', { headers })

    const expectFeatureGate = async (res: Response) => {
      const body = (await res.json()) as { error: { details: { reason: string; metadata?: { feature?: string } }[] } }
      expect(body.error.details[0]?.reason).toBe('FEATURE_NOT_AVAILABLE')
      expect(body.error.details[0]?.metadata?.feature).toBe('quota_store')
    }
    expect(packages.status).toBe(402)
    await expectFeatureGate(packages)
    expect(targets.status).toBe(402)
    await expectFeatureGate(targets)
    expect(checkout.status).toBe(402)
    await expectFeatureGate(checkout)
    expect(orders.status).toBe(402)
    await expectFeatureGate(orders)
  })

  it('rejects malformed successful checkout responses', async () => {
    const { app, db } = await createTestApp()
    await seedBusinessLicense(db)
    const headers = await authedHeaders(app, 'buyer@example.com')
    const packageId = await seedPackage(db)
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) } as Response)

    const res = await app.request('/api/store/checkouts', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ packageId }),
    })

    expect(res.status).toBe(502)
    await expect(res.json()).resolves.toMatchObject({ error: { code: 502, message: 'invalid_cloud_response' } })
  })

  it('surfaces Cloud checkout error responses [spec: quota-store/checkout-error-surfacing]', async () => {
    const { app, db } = await createTestApp()
    await seedBusinessLicense(db)
    const headers = await authedHeaders(app, 'buyer@example.com')
    const packageId = await seedPackage(db)
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({ error: 'cloud_down' }),
    } as Response)

    const res = await app.request('/api/store/checkouts', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ packageId }),
    })

    expect(res.status).toBe(502)
    await expect(res.json()).resolves.toMatchObject({ error: { code: 502, message: 'cloud_down' } })
  })

  it('uses status errors when Cloud checkout error bodies have no string error', async () => {
    const { app, db } = await createTestApp()
    await seedBusinessLicense(db)
    const headers = await authedHeaders(app, 'buyer@example.com')
    const packageId = await seedPackage(db)
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 504,
      json: async () => ({ error: 504 }),
    } as Response)

    const res = await app.request('/api/store/checkouts', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ packageId }),
    })

    expect(res.status).toBe(502)
    await expect(res.json()).resolves.toMatchObject({ error: { code: 502, message: 'cloud_request_failed_504' } })
  })

  it('accepts current Cloud quota-change webhook tokens with audience equal to instance id', async () => {
    const { app, db } = await createTestApp()
    await seedBusinessLicense(db)
    const orgId = await getFirstOrgId(db)
    const payload = JSON.stringify({
      eventId: 'evt-cloud-pr-15-token',
      cloudOrderId: 'order-cloud-pr-15-token',
      targetOrgId: orgId,
      eventType: 'order.quota_changed',
      direction: 'increase',
      storageBytes: 4096,
      trafficBytes: 0,
      source: 'stripe',
      packageName: 'Storage Pack',
      expiresAt: '2099-06-01T00:00:00.000Z',
    })

    const res = await postWebhook(app, payload)

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ success: true, duplicate: false })
  })

  it("accepts Cloud PR #16 quota-change webhook tokens with audience='license_1' and boundLicenseId='binding_1'", async () => {
    const { app, db } = await createTestApp()
    await seedCloudPr16License(db)
    const orgId = await getFirstOrgId(db)
    const payload = JSON.stringify({
      eventId: 'evt-cloud-pr-16-token',
      cloudOrderId: 'order-cloud-pr-16-token',
      targetOrgId: orgId,
      eventType: 'order.quota_changed',
      direction: 'increase',
      storageBytes: 4096,
      trafficBytes: 0,
      source: 'stripe',
      packageName: 'Storage Pack',
      expiresAt: '2099-06-01T00:00:00.000Z',
    })

    const res = await app.request('/api/store/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(await signedWebhookHeaders(payload, { audience: 'license_1', boundLicenseId: 'binding_1' })),
      },
      body: payload,
    })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ success: true, duplicate: false })
  })

  it('valid Cloud quota-change webhook records active entitlement once and records audit [spec: quota-store/webhook-records-entitlement]', async () => {
    const { app, db } = await createTestApp()
    await seedBusinessLicense(db)
    const headers = await adminHeaders(app)
    const orgId = await getFirstOrgId(db)
    const payload = JSON.stringify({
      eventId: 'evt-1',
      cloudOrderId: 'order-1',
      targetOrgId: orgId,
      eventType: 'order.quota_changed',
      direction: 'increase',
      storageBytes: 4096,
      trafficBytes: 0,
      source: 'stripe',
      packageName: 'Storage Pack',
      expiresAt: '2099-06-01T00:00:00.000Z',
    })

    const first = await postWebhook(app, payload)
    const duplicate = await postWebhook(app, payload)

    expect(first.status).toBe(200)
    await expect(first.json()).resolves.toMatchObject({ success: true, duplicate: false })
    expect(duplicate.status).toBe(200)
    await expect(duplicate.json()).resolves.toMatchObject({ success: true, duplicate: true, eventId: 'evt-1' })
    const events = await db.all<{ status: string; error: string | null; processedAt: number | null }>(
      sql`SELECT status, error, processed_at AS processedAt FROM webhook_events WHERE event_id = 'evt-1'`,
    )
    expect(events).toEqual([{ status: 'processed', error: null, processedAt: expect.any(Number) }])

    const quotaRes = await app.request('/api/quotas/me', { headers })
    const quota = (await quotaRes.json()) as { baseQuota: number; entitlementQuota: number; quota: number }
    expect(quota.baseQuota).toBe(10485760)
    expect(quota.entitlementQuota).toBe(4096)
    expect(quota.quota).toBe(10485760 + 4096)
    const entitlement = await db.all<{ bytes: number; status: string; sourceId: string; expiresAt: number }>(sql`
      SELECT bytes, status, source_id AS sourceId, expires_at AS expiresAt
      FROM org_quota_entitlements
      WHERE org_id = ${orgId} AND resource_type = 'storage' AND source_id = 'order-1'
    `)
    expect(entitlement).toEqual([
      { bytes: 4096, status: 'active', sourceId: 'order-1', expiresAt: Date.parse('2099-06-01T00:00:00.000Z') },
    ])
    const audit = await db.all<{ action: string; metadata: string }>(
      sql`SELECT action, metadata FROM activity_events WHERE org_id = ${orgId} ORDER BY created_at DESC LIMIT 1`,
    )
    expect(audit[0].action).toBe('quota_order_increase')
    expect(JSON.parse(audit[0].metadata)).toMatchObject({
      eventId: 'evt-1',
      storageBytes: 4096,
      trafficBytes: 0,
      packageName: 'Storage Pack',
    })
  })

  it('delivers initial subscription storage and traffic entitlements under a stable source id [spec: quota-store/webhook-subscription-delivery]', async () => {
    const { app, db } = await createTestApp()
    await seedBusinessLicense(db)
    const headers = await adminHeaders(app)
    const orgId = await getFirstOrgId(db)
    await db.run(sql`UPDATE org_quotas SET quota = 8192, traffic_quota = 1024 WHERE org_id = ${orgId}`)
    const subscriptionSourceId = `stripe_subscription:sub_metered_123:${orgId}`
    const payload = JSON.stringify({
      eventId: 'evt-subscription-initial-entitlement',
      cloudOrderId: subscriptionSourceId,
      targetOrgId: orgId,
      eventType: 'order.quota_changed',
      direction: 'increase',
      storageBytes: 4096,
      trafficBytes: 2048,
      trafficOveragePriceCents: 25,
      source: 'stripe_subscription',
      packageId: 'pkg-monthly-storage-traffic',
      packageName: 'Team Plan',
      occurredAt: '2026-05-01T00:00:00.000Z',
      expiresAt: '2099-06-01T00:00:00.000Z',
      customerId: 'buyer-1',
      customerEmail: 'buyer@example.com',
    })

    const first = await postWebhook(app, payload)
    const duplicate = await postWebhook(app, payload)

    expect(first.status).toBe(200)
    await expect(first.json()).resolves.toMatchObject({ success: true, duplicate: false })
    expect(duplicate.status).toBe(200)
    await expect(duplicate.json()).resolves.toMatchObject({
      success: true,
      duplicate: true,
      eventId: 'evt-subscription-initial-entitlement',
    })

    const entitlements = await db.all<{
      resourceType: string
      bytes: number
      startsAt: number
      expiresAt: number
      metadata: string
    }>(sql`
      SELECT resource_type AS resourceType, bytes, starts_at AS startsAt, expires_at AS expiresAt, metadata
      FROM org_quota_entitlements
      WHERE source_id = ${subscriptionSourceId}
      ORDER BY resource_type
    `)
    expect(entitlements).toHaveLength(2)
    expect(entitlements.map((row) => ({ resourceType: row.resourceType, bytes: row.bytes }))).toEqual([
      { resourceType: 'storage', bytes: 4096 },
      { resourceType: 'traffic', bytes: 2048 },
    ])
    expect(new Date(entitlements[0].startsAt).toISOString()).toBe('2026-05-01T00:00:00.000Z')
    expect(new Date(entitlements[0].expiresAt).toISOString()).toBe('2099-06-01T00:00:00.000Z')
    expect(JSON.parse(entitlements[0].metadata)).toMatchObject({
      eventId: 'evt-subscription-initial-entitlement',
      source: 'stripe_subscription',
      packageId: 'pkg-monthly-storage-traffic',
      packageName: 'Team Plan',
      trafficOveragePriceCents: 25,
      expiresAt: '2099-06-01T00:00:00.000Z',
      customerId: 'buyer-1',
      customerEmail: 'buyer@example.com',
    })

    const quotaRes = await app.request('/api/quotas/me', { headers })
    const quota = (await quotaRes.json()) as {
      baseQuota: number
      entitlementQuota: number
      quota: number
      baseTrafficQuota: number
      entitlementTrafficQuota: number
      trafficQuota: number
      currentPlan: { trafficOveragePriceCents: number | null }
    }
    expect(quota).toMatchObject({
      baseQuota: 4096,
      entitlementQuota: 0,
      quota: 4096,
      baseTrafficQuota: 2048,
      entitlementTrafficQuota: 0,
      trafficQuota: 2048,
      storagePlanName: 'Team Plan',
      storageExtraNames: [],
      trafficPlanName: 'Team Plan',
      trafficExtraNames: [],
      currentPlan: { trafficOveragePriceCents: 25 },
    })

    const freeBaselines = await db.all<{ resourceType: string; status: string }>(sql`
      SELECT resource_type AS resourceType, status
      FROM org_quota_entitlements
      WHERE org_id = ${orgId} AND source = 'free_plan'
      ORDER BY resource_type
    `)
    expect(freeBaselines).toEqual([
      { resourceType: 'storage', status: 'active' },
      { resourceType: 'traffic', status: 'active' },
    ])

    const revoked = await postWebhook(
      app,
      JSON.stringify({
        eventId: 'evt-subscription-revoked',
        cloudOrderId: subscriptionSourceId,
        targetOrgId: orgId,
        eventType: 'order.quota_changed',
        direction: 'decrease',
        storageBytes: 4096,
        trafficBytes: 2048,
        source: 'stripe_subscription',
      }),
    )
    expect(revoked.status).toBe(200)
    const fallbackRes = await app.request('/api/quotas/me', { headers })
    const fallback = (await fallbackRes.json()) as { baseQuota: number; quota: number; storagePlanName: string }
    expect(fallback).toMatchObject({ baseQuota: 10 * 1024 * 1024, quota: 10 * 1024 * 1024, storagePlanName: 'Free' })
  })

  it('renews subscription entitlements by replacing plan bytes and extending expiry [spec: quota-store/webhook-renewal]', async () => {
    const { app, db } = await createTestApp()
    await seedBusinessLicense(db)
    const headers = await adminHeaders(app)
    const orgId = await getFirstOrgId(db)
    const subscriptionSourceId = `stripe_subscription:sub_renewal:${orgId}`

    const first = await postWebhook(
      app,
      JSON.stringify({
        eventId: 'evt-subscription-period-1',
        cloudOrderId: subscriptionSourceId,
        targetOrgId: orgId,
        eventType: 'order.quota_changed',
        direction: 'increase',
        storageBytes: 4096,
        trafficBytes: 2048,
        source: 'stripe_subscription',
        packageName: 'Team Plan',
        occurredAt: '2026-05-01T00:00:00.000Z',
        expiresAt: '2099-06-01T00:00:00.000Z',
      }),
    )
    const renewal = await postWebhook(
      app,
      JSON.stringify({
        eventId: 'evt-subscription-period-2',
        cloudOrderId: subscriptionSourceId,
        targetOrgId: orgId,
        eventType: 'order.quota_changed',
        direction: 'increase',
        storageBytes: 8192,
        trafficBytes: 4096,
        source: 'stripe_subscription',
        packageName: 'Team Plan Plus',
        occurredAt: '2026-06-01T00:00:00.000Z',
        expiresAt: '2099-07-01T00:00:00.000Z',
      }),
    )

    expect(first.status).toBe(200)
    expect(renewal.status).toBe(200)
    const entitlements = await db.all<{ resourceType: string; bytes: number; expiresAt: number }>(sql`
      SELECT resource_type AS resourceType, bytes, expires_at AS expiresAt
      FROM org_quota_entitlements
      WHERE source_id = ${subscriptionSourceId}
      ORDER BY resource_type
    `)
    expect(entitlements).toEqual([
      { resourceType: 'storage', bytes: 8192, expiresAt: Date.parse('2099-07-01T00:00:00.000Z') },
      { resourceType: 'traffic', bytes: 4096, expiresAt: Date.parse('2099-07-01T00:00:00.000Z') },
    ])

    const quotaRes = await app.request('/api/quotas/me', { headers })
    const quota = (await quotaRes.json()) as {
      baseQuota: number
      entitlementQuota: number
      quota: number
      baseTrafficQuota: number
      entitlementTrafficQuota: number
      trafficQuota: number
    }
    expect(quota).toMatchObject({
      baseQuota: 8192,
      entitlementQuota: 0,
      quota: 8192,
      baseTrafficQuota: 4096,
      entitlementTrafficQuota: 0,
      trafficQuota: 4096,
      storagePlanName: 'Team Plan Plus',
      storageExtraNames: [],
      trafficPlanName: 'Team Plan Plus',
      trafficExtraNames: [],
    })
  })

  it('accumulates repeated Cloud increases for the same order and resource [spec: quota-store/webhook-accumulate]', async () => {
    const { app, db } = await createTestApp()
    await seedBusinessLicense(db)
    const headers = await adminHeaders(app)
    const orgId = await getFirstOrgId(db)

    const first = await postWebhook(
      app,
      JSON.stringify({
        eventId: 'evt-repeat-increase-1',
        cloudOrderId: 'order-repeat-increase',
        targetOrgId: orgId,
        eventType: 'order.quota_changed',
        direction: 'increase',
        storageBytes: 4096,
        trafficBytes: 0,
        source: 'stripe',
      }),
    )
    const second = await postWebhook(
      app,
      JSON.stringify({
        eventId: 'evt-repeat-increase-2',
        cloudOrderId: 'order-repeat-increase',
        targetOrgId: orgId,
        eventType: 'order.quota_changed',
        direction: 'increase',
        storageBytes: 2048,
        trafficBytes: 0,
        source: 'stripe',
      }),
    )

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    const entitlements = await db.all<{ bytes: number; status: string }>(
      sql`SELECT bytes, status FROM org_quota_entitlements WHERE source_id = 'order-repeat-increase' AND resource_type = 'storage'`,
    )
    expect(entitlements).toEqual([{ bytes: 6144, status: 'active' }])

    const quotaRes = await app.request('/api/quotas/me', { headers })
    const quota = (await quotaRes.json()) as { entitlementQuota: number }
    expect(quota.entitlementQuota).toBe(6144)
  })

  it('decreases accumulated Cloud order entitlement bytes without revoking the remainder [spec: quota-store/webhook-decrease]', async () => {
    const { app, db } = await createTestApp()
    await seedBusinessLicense(db)
    const headers = await adminHeaders(app)
    const orgId = await getFirstOrgId(db)

    await postWebhook(
      app,
      JSON.stringify({
        eventId: 'evt-partial-decrease-inc-1',
        cloudOrderId: 'order-partial-decrease',
        targetOrgId: orgId,
        eventType: 'order.quota_changed',
        direction: 'increase',
        storageBytes: 4096,
        trafficBytes: 0,
        source: 'stripe',
      }),
    )
    await postWebhook(
      app,
      JSON.stringify({
        eventId: 'evt-partial-decrease-inc-2',
        cloudOrderId: 'order-partial-decrease',
        targetOrgId: orgId,
        eventType: 'order.quota_changed',
        direction: 'increase',
        storageBytes: 2048,
        trafficBytes: 0,
        source: 'stripe',
      }),
    )
    const decrease = await postWebhook(
      app,
      JSON.stringify({
        eventId: 'evt-partial-decrease-dec',
        cloudOrderId: 'order-partial-decrease',
        targetOrgId: orgId,
        eventType: 'order.quota_changed',
        direction: 'decrease',
        storageBytes: 2048,
        trafficBytes: 0,
        source: 'stripe',
      }),
    )

    expect(decrease.status).toBe(200)
    const entitlements = await db.all<{ bytes: number; status: string }>(
      sql`SELECT bytes, status FROM org_quota_entitlements WHERE source_id = 'order-partial-decrease' AND resource_type = 'storage'`,
    )
    expect(entitlements).toEqual([{ bytes: 4096, status: 'active' }])

    const quotaRes = await app.request('/api/quotas/me', { headers })
    const quota = (await quotaRes.json()) as { entitlementQuota: number }
    expect(quota.entitlementQuota).toBe(4096)
  })

  it('restarts entitlement bytes when a new increase follows full revocation', async () => {
    const { app, db } = await createTestApp()
    await seedBusinessLicense(db)
    const headers = await adminHeaders(app)
    const orgId = await getFirstOrgId(db)

    await postWebhook(
      app,
      JSON.stringify({
        eventId: 'evt-reactivate-inc-1',
        cloudOrderId: 'order-reactivate',
        targetOrgId: orgId,
        eventType: 'order.quota_changed',
        direction: 'increase',
        storageBytes: 4096,
        trafficBytes: 0,
        source: 'stripe',
      }),
    )
    await postWebhook(
      app,
      JSON.stringify({
        eventId: 'evt-reactivate-dec',
        cloudOrderId: 'order-reactivate',
        targetOrgId: orgId,
        eventType: 'order.quota_changed',
        direction: 'decrease',
        storageBytes: 4096,
        trafficBytes: 0,
        source: 'stripe',
      }),
    )
    const increase = await postWebhook(
      app,
      JSON.stringify({
        eventId: 'evt-reactivate-inc-2',
        cloudOrderId: 'order-reactivate',
        targetOrgId: orgId,
        eventType: 'order.quota_changed',
        direction: 'increase',
        storageBytes: 2048,
        trafficBytes: 0,
        source: 'stripe',
      }),
    )

    expect(increase.status).toBe(200)
    const entitlements = await db.all<{ bytes: number; status: string }>(
      sql`SELECT bytes, status FROM org_quota_entitlements WHERE source_id = 'order-reactivate' AND resource_type = 'storage'`,
    )
    expect(entitlements).toEqual([{ bytes: 2048, status: 'active' }])

    const quotaRes = await app.request('/api/quotas/me', { headers })
    const quota = (await quotaRes.json()) as { entitlementQuota: number }
    expect(quota.entitlementQuota).toBe(2048)
  })

  it('rejects legacy order delivery event types', async () => {
    const { app, db } = await createTestApp()
    await seedBusinessLicense(db)
    const payload = JSON.stringify({
      eventId: 'evt-legacy-event-type',
      eventType: 'order.delivered',
      cloudOrderId: 'order-legacy-event-type',
      targetOrgId: await getFirstOrgId(db),
      direction: 'increase',
      storageBytes: 4096,
      trafficBytes: 0,
    })

    const res = await postWebhook(app, payload)

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      error: { message: 'Invalid payload', details: [{ reason: 'INVALID_PAYLOAD' }] },
    })
  })

  it('storage decreases revoke matching Cloud order entitlements without changing base quota', async () => {
    const { app, db } = await createTestApp()
    await seedBusinessLicense(db)
    const orgId = await getFirstOrgId(db)
    await db.run(sql`UPDATE org_quotas SET quota = 2048 WHERE org_id = ${orgId}`)
    const now = Date.now()
    await db.run(sql`
      INSERT INTO org_quota_entitlements
        (id, org_id, resource_type, source, source_id, bytes, starts_at, expires_at, status, metadata, created_at, updated_at)
      VALUES
        ('ent-storage-decrease', ${orgId}, 'storage', 'cloud_order', 'order-storage-decrease', 4096, ${now}, NULL, 'active', NULL, ${now}, ${now})
    `)

    const res = await postWebhook(
      app,
      JSON.stringify({
        eventId: 'evt-storage-decrease',
        cloudOrderId: 'order-storage-decrease',
        targetOrgId: orgId,
        eventType: 'order.quota_changed',
        direction: 'decrease',
        storageBytes: 4096,
        trafficBytes: 0,
      }),
    )

    expect(res.status).toBe(200)
    const rows = await db.all<{ quota: number }>(sql`SELECT quota FROM org_quotas WHERE org_id = ${orgId}`)
    expect(rows[0].quota).toBe(2048)
    const entitlements = await db.all<{ status: string }>(
      sql`SELECT status FROM org_quota_entitlements WHERE source_id = 'order-storage-decrease'`,
    )
    expect(entitlements).toEqual([{ status: 'revoked' }])
  })

  it('records traffic increases and revokes them on matching decreases', async () => {
    const { app, db } = await createTestApp()
    await seedBusinessLicense(db)
    const headers = await adminHeaders(app)
    const orgId = await getFirstOrgId(db)

    await postWebhook(
      app,
      JSON.stringify({
        eventId: 'evt-traffic-increase',
        cloudOrderId: 'order-traffic-increase',
        targetOrgId: orgId,
        eventType: 'order.quota_changed',
        direction: 'increase',
        storageBytes: 0,
        trafficBytes: 4096,
      }),
    )
    await postWebhook(
      app,
      JSON.stringify({
        eventId: 'evt-traffic-decrease',
        cloudOrderId: 'order-traffic-increase',
        targetOrgId: orgId,
        eventType: 'order.quota_changed',
        direction: 'decrease',
        storageBytes: 0,
        trafficBytes: 1024,
      }),
    )

    const rows = await db.all<{ trafficQuota: number; status: string }>(
      sql`SELECT bytes AS trafficQuota, status FROM org_quota_entitlements WHERE source_id = 'order-traffic-increase'`,
    )
    expect(rows[0]).toEqual({ trafficQuota: 3072, status: 'active' })

    const quotaRes = await app.request('/api/quotas/me', { headers })
    const quota = (await quotaRes.json()) as { entitlementTrafficQuota: number; trafficQuota: number }
    expect(quota.entitlementTrafficQuota).toBe(3072)
    expect(quota.trafficQuota).toBe(3072)
  })

  it('processes same-order increase then decrease as two independent events', async () => {
    const { app, db } = await createTestApp()
    await seedBusinessLicense(db)
    const orgId = await getFirstOrgId(db)
    await db.run(sql`UPDATE org_quotas SET quota = 8192 WHERE org_id = ${orgId}`)

    const increase = await postWebhook(
      app,
      JSON.stringify({
        eventId: 'evt-order-increase',
        cloudOrderId: 'order-reversal-test',
        targetOrgId: orgId,
        eventType: 'order.quota_changed',
        direction: 'increase',
        storageBytes: 4096,
        trafficBytes: 0,
        source: 'stripe',
      }),
    )
    const decrease = await postWebhook(
      app,
      JSON.stringify({
        eventId: 'evt-order-decrease',
        cloudOrderId: 'order-reversal-test',
        targetOrgId: orgId,
        eventType: 'order.quota_changed',
        direction: 'decrease',
        storageBytes: 4096,
        trafficBytes: 0,
        source: 'stripe',
      }),
    )

    expect(increase.status).toBe(200)
    await expect(increase.json()).resolves.toMatchObject({ success: true, duplicate: false })
    expect(decrease.status).toBe(200)
    await expect(decrease.json()).resolves.toMatchObject({ success: true, duplicate: false })

    const rows = await db.all<{ quota: number }>(sql`SELECT quota FROM org_quotas WHERE org_id = ${orgId}`)
    expect(rows[0].quota).toBe(8192)
    const entitlements = await db.all<{ status: string }>(
      sql`SELECT status FROM org_quota_entitlements WHERE source_id = 'order-reversal-test'`,
    )
    expect(entitlements).toEqual([{ status: 'revoked' }])

    const deliveries = await db.all<{ eventId: string; status: string }>(
      sql`SELECT event_id AS eventId, status FROM webhook_events WHERE event_id IN ('evt-order-increase', 'evt-order-decrease') ORDER BY created_at`,
    )
    expect(deliveries).toEqual([
      { eventId: 'evt-order-increase', status: 'processed' },
      { eventId: 'evt-order-decrease', status: 'processed' },
    ])

    const auditRows = await db.all<{ action: string }>(
      sql`SELECT action FROM activity_events WHERE org_id = ${orgId} ORDER BY created_at DESC LIMIT 2`,
    )
    expect(auditRows.map((r) => r.action)).toContain('quota_order_decrease')
    expect(auditRows.map((r) => r.action)).toContain('quota_order_increase')
  })

  it('does not fall back to base quota when a second decrease sees an already revoked entitlement', async () => {
    const { app, db } = await createTestApp()
    await seedBusinessLicense(db)
    const orgId = await getFirstOrgId(db)
    await db.run(sql`UPDATE org_quotas SET quota = 8192 WHERE org_id = ${orgId}`)

    await postWebhook(
      app,
      JSON.stringify({
        eventId: 'evt-double-decrease-increase',
        cloudOrderId: 'order-double-decrease',
        targetOrgId: orgId,
        eventType: 'order.quota_changed',
        direction: 'increase',
        storageBytes: 4096,
        trafficBytes: 0,
        source: 'stripe',
      }),
    )
    const firstDecrease = await postWebhook(
      app,
      JSON.stringify({
        eventId: 'evt-double-decrease-first',
        cloudOrderId: 'order-double-decrease',
        targetOrgId: orgId,
        eventType: 'order.quota_changed',
        direction: 'decrease',
        storageBytes: 4096,
        trafficBytes: 0,
        source: 'stripe',
      }),
    )
    const secondDecrease = await postWebhook(
      app,
      JSON.stringify({
        eventId: 'evt-double-decrease-second',
        cloudOrderId: 'order-double-decrease',
        targetOrgId: orgId,
        eventType: 'order.quota_changed',
        direction: 'decrease',
        storageBytes: 4096,
        trafficBytes: 0,
        source: 'stripe',
      }),
    )

    expect(firstDecrease.status).toBe(200)
    expect(secondDecrease.status).toBe(200)
    const rows = await db.all<{ quota: number }>(sql`SELECT quota FROM org_quotas WHERE org_id = ${orgId}`)
    expect(rows[0].quota).toBe(8192)
  })

  it('replaying the same decrease event is idempotent and does not double-deduct [spec: quota-store/webhook-idempotent]', async () => {
    const { app, db } = await createTestApp()
    await seedBusinessLicense(db)
    const orgId = await getFirstOrgId(db)
    await db.run(sql`UPDATE org_quotas SET quota = 8192 WHERE org_id = ${orgId}`)

    const payload = JSON.stringify({
      eventId: 'evt-decrease-idempotent',
      cloudOrderId: 'order-decrease-dup',
      targetOrgId: orgId,
      eventType: 'order.quota_changed',
      direction: 'decrease',
      storageBytes: 2048,
      trafficBytes: 0,
      source: 'stripe',
    })

    const first = await postWebhook(app, payload)
    const second = await postWebhook(app, payload)

    expect(first.status).toBe(200)
    await expect(first.json()).resolves.toMatchObject({ success: true, duplicate: false })
    expect(second.status).toBe(200)
    await expect(second.json()).resolves.toMatchObject({
      success: true,
      duplicate: true,
      eventId: 'evt-decrease-idempotent',
    })

    const rows = await db.all<{ quota: number }>(sql`SELECT quota FROM org_quotas WHERE org_id = ${orgId}`)
    expect(rows[0].quota).toBe(6144)
  })

  it('reverses pre-migration Cloud order quota stored in base quota', async () => {
    const { app, db } = await createTestApp()
    await seedBusinessLicense(db)
    const orgId = await getFirstOrgId(db)
    await db.run(sql`UPDATE org_quotas SET quota = 8192, traffic_quota = 4096 WHERE org_id = ${orgId}`)

    const decrease = await postWebhook(
      app,
      JSON.stringify({
        eventId: 'evt-legacy-base-decrease',
        cloudOrderId: 'order-legacy-base',
        targetOrgId: orgId,
        eventType: 'order.quota_changed',
        direction: 'decrease',
        storageBytes: 2048,
        trafficBytes: 1024,
        source: 'stripe',
      }),
    )

    expect(decrease.status).toBe(200)
    await expect(decrease.json()).resolves.toMatchObject({ success: true, duplicate: false })
    const rows = await db.all<{ quota: number; trafficQuota: number }>(
      sql`SELECT quota, traffic_quota AS trafficQuota FROM org_quotas WHERE org_id = ${orgId}`,
    )
    expect(rows[0]).toEqual({ quota: 6144, trafficQuota: 3072 })
  })

  it('records decrease audit event with correct action and metadata', async () => {
    const { app, db } = await createTestApp()
    await seedBusinessLicense(db)
    const orgId = await getFirstOrgId(db)
    await db.run(sql`UPDATE org_quotas SET quota = 8192 WHERE org_id = ${orgId}`)

    await postWebhook(
      app,
      JSON.stringify({
        eventId: 'evt-audit-decrease',
        cloudOrderId: 'order-audit-dec',
        targetOrgId: orgId,
        eventType: 'order.quota_changed',
        direction: 'decrease',
        storageBytes: 1024,
        trafficBytes: 0,
        source: 'stripe',
      }),
    )

    const audit = await db.all<{ action: string; metadata: string }>(
      sql`SELECT action, metadata FROM activity_events WHERE org_id = ${orgId} ORDER BY created_at DESC LIMIT 1`,
    )
    expect(audit[0].action).toBe('quota_order_decrease')
    expect(JSON.parse(audit[0].metadata)).toMatchObject({
      eventId: 'evt-audit-decrease',
      eventType: 'order.quota_changed',
      direction: 'decrease',
      storageBytes: 1024,
      trafficBytes: 0,
    })
  })

  it('traffic decrease from same cloudOrderId processes independently', async () => {
    const { app, db } = await createTestApp()
    await seedBusinessLicense(db)
    const orgId = await getFirstOrgId(db)

    await postWebhook(
      app,
      JSON.stringify({
        eventId: 'evt-traffic-order-inc',
        cloudOrderId: 'order-traffic-reversal',
        targetOrgId: orgId,
        eventType: 'order.quota_changed',
        direction: 'increase',
        storageBytes: 0,
        trafficBytes: 8192,
        source: 'stripe',
      }),
    )
    const decrease = await postWebhook(
      app,
      JSON.stringify({
        eventId: 'evt-traffic-order-dec',
        cloudOrderId: 'order-traffic-reversal',
        targetOrgId: orgId,
        eventType: 'order.quota_changed',
        direction: 'decrease',
        storageBytes: 0,
        trafficBytes: 8192,
        source: 'stripe',
      }),
    )

    expect(decrease.status).toBe(200)
    await expect(decrease.json()).resolves.toMatchObject({ success: true, duplicate: false })

    const rows = await db.all<{ status: string }>(
      sql`SELECT status FROM org_quota_entitlements WHERE source_id = 'order-traffic-reversal'`,
    )
    expect(rows[0].status).toBe('revoked')
  })

  it('rejects failed delivery retries when the payload hash changes', async () => {
    const { app, db } = await createTestApp()
    await seedBusinessLicense(db)
    const orgId = await getFirstOrgId(db)
    const payload = JSON.stringify({
      eventId: 'evt-hash-conflict',
      cloudOrderId: 'order-hash-conflict',
      targetOrgId: orgId,
      eventType: 'order.quota_changed',
      direction: 'increase',
      storageBytes: 4096,
      trafficBytes: 0,
      source: 'stripe',
    })

    const first = await postWebhook(app, payload)
    const retry = await postWebhook(
      app,
      JSON.stringify({
        eventId: 'evt-hash-conflict',
        cloudOrderId: 'order-hash-conflict',
        targetOrgId: orgId,
        eventType: 'order.quota_changed',
        direction: 'increase',
        storageBytes: 8192,
        trafficBytes: 0,
        source: 'stripe',
      }),
    )

    expect(first.status).toBe(200)
    expect(retry.status).toBe(400)
    await expect(retry.json()).resolves.toMatchObject({ error: { code: 400, message: 'webhook_payload_conflict' } })
  })

  it('allows failed delivery retries when the payload is unchanged', async () => {
    const { app, db } = await createTestApp()
    await seedBusinessLicense(db)
    const orgId = await getFirstOrgId(db)
    await db.run(sql`DELETE FROM org_quotas WHERE org_id = ${orgId}`)
    const payload = JSON.stringify({
      eventId: 'evt-failed-same-payload',
      cloudOrderId: 'order-failed-same-payload',
      targetOrgId: orgId,
      eventType: 'order.quota_changed',
      direction: 'increase',
      storageBytes: 4096,
      trafficBytes: 0,
      source: 'stripe',
    })

    const failed = await postWebhook(app, payload)
    await db.run(sql`
      INSERT INTO org_quotas (id, org_id, quota, used, traffic_quota, traffic_used, traffic_period)
      VALUES ('quota-retry-target', ${orgId}, 0, 0, 0, 0, '1970-01')
    `)
    const retry = await postWebhook(app, payload)

    expect(failed.status).toBe(400)
    await expect(failed.json()).resolves.toMatchObject({ error: { code: 400, message: 'target_quota_missing' } })
    expect(retry.status).toBe(200)
    await expect(retry.json()).resolves.toMatchObject({ success: true, duplicate: false })
    const deliveries = await db.all<{ status: string; error: string | null }>(
      sql`SELECT status, error FROM webhook_events WHERE event_id = 'evt-failed-same-payload'`,
    )
    expect(deliveries).toEqual([{ status: 'processed', error: null }])
  })

  it('rejects missing Cloud quota-change webhook auth [spec: quota-store/webhook-auth-required]', async () => {
    const { app, db } = await createTestApp()
    await seedBusinessLicense(db)

    const res = await app.request('/api/store/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ eventId: 'evt-bad' }),
    })

    expect(res.status).toBe(401)
  })

  it('rejects malformed Cloud quota-change webhook event tokens', async () => {
    const { app, db } = await createTestApp()
    await seedBusinessLicense(db)
    const payload = JSON.stringify({ eventId: 'evt-bad-token' })

    const res = await app.request('/api/store/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-commerce-event-token': 'bad-token',
      },
      body: payload,
    })

    expect(res.status).toBe(401)
  })

  it('rejects Cloud quota-change webhook event tokens with the wrong purpose', async () => {
    const { app, db } = await createTestApp()
    await seedBusinessLicense(db)
    const payload = JSON.stringify({ eventId: 'evt-wrong-purpose' })

    const res = await app.request('/api/store/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(await signedWebhookHeaders(payload, { purpose: 'quota_store.other' })),
      },
      body: payload,
    })

    expect(res.status).toBe(401)
  })

  it('rejects expired Cloud quota-change webhook event tokens [spec: quota-store/webhook-token-expiry]', async () => {
    const { app, db } = await createTestApp()
    await seedBusinessLicense(db)
    const payload = JSON.stringify({ eventId: 'evt-expired-token' })
    const now = Math.floor(Date.now() / 1000)

    const res = await app.request('/api/store/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(await signedWebhookHeaders(payload, { issuedAt: now - 120, expiresAt: now - 60 })),
      },
      body: payload,
    })

    expect(res.status).toBe(401)
  })

  it('rejects Cloud quota-change webhook event tokens without issuedAt', async () => {
    const { app, db } = await createTestApp()
    await seedBusinessLicense(db)
    const payload = JSON.stringify({ eventId: 'evt-missing-issued-at' })

    const res = await app.request('/api/store/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(await signedWebhookHeaders(payload, { issuedAt: undefined })),
      },
      body: payload,
    })

    expect(res.status).toBe(401)
  })

  it('rejects Cloud quota-change webhook event tokens with future issuedAt and no notBefore', async () => {
    const { app, db } = await createTestApp()
    await seedBusinessLicense(db)
    const payload = JSON.stringify({ eventId: 'evt-future-issued-at' })
    const issuedAt = Math.floor(Date.now() / 1000) + 60

    const res = await app.request('/api/store/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(await signedWebhookHeaders(payload, { issuedAt, notBefore: undefined, expiresAt: issuedAt + 60 })),
      },
      body: payload,
    })

    expect(res.status).toBe(401)
  })

  it('rejects Cloud quota-change webhook event tokens with an overlong TTL', async () => {
    const { app, db } = await createTestApp()
    await seedBusinessLicense(db)
    const payload = JSON.stringify({ eventId: 'evt-overlong-token' })
    const issuedAt = Math.floor(Date.now() / 1000)

    const res = await app.request('/api/store/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(await signedWebhookHeaders(payload, { issuedAt, expiresAt: issuedAt + 301 })),
      },
      body: payload,
    })

    expect(res.status).toBe(401)
  })

  it('rejects Cloud quota-change webhook event tokens with the wrong payload hash', async () => {
    const { app, db } = await createTestApp()
    await seedBusinessLicense(db)
    const payload = JSON.stringify({ eventId: 'evt-wrong-hash' })

    const res = await app.request('/api/store/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(await signedWebhookHeaders(payload, { payloadHash: '0'.repeat(64) })),
      },
      body: payload,
    })

    expect(res.status).toBe(401)
  })

  it('rejects Cloud quota-change webhook event tokens with a mismatched event id', async () => {
    const { app, db } = await createTestApp()
    await seedBusinessLicense(db)
    const payload = JSON.stringify({
      eventId: 'evt-body-id',
      cloudOrderId: 'order-event-id',
      targetOrgId: await getFirstOrgId(db),
      eventType: 'order.quota_changed',
      direction: 'increase',
      storageBytes: 4096,
      trafficBytes: 0,
      source: 'stripe',
    })

    const res = await app.request('/api/store/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(await signedWebhookHeaders(payload, { eventId: 'evt-token-id' })),
      },
      body: payload,
    })

    expect(res.status).toBe(401)
  })

  it('rejects Cloud quota-change webhook event tokens with the wrong audience [spec: quota-store/webhook-token-audience]', async () => {
    const { app, db } = await createTestApp()
    await seedBusinessLicense(db)
    const payload = JSON.stringify({ eventId: 'evt-wrong-audience' })

    const res = await app.request('/api/store/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(await signedWebhookHeaders(payload, { audience: 'wrong-audience' })),
      },
      body: payload,
    })

    expect(res.status).toBe(401)
  })

  it('rejects signed malformed Cloud payloads', async () => {
    const { app, db } = await createTestApp()
    await seedBusinessLicense(db)
    const payload = '{bad-json'

    const res = await postWebhook(app, payload)

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      error: { message: 'Invalid payload', details: [{ reason: 'INVALID_PAYLOAD' }] },
    })
  })

  it('rejects deliveries without resource details', async () => {
    const { app, db } = await createTestApp()
    await seedBusinessLicense(db)
    const payload = JSON.stringify({
      eventId: 'evt-no-package',
      cloudOrderId: 'order-no-package',
      targetOrgId: await getFirstOrgId(db),
      source: 'stripe',
    })

    const res = await postWebhook(app, payload)

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      error: { message: 'Invalid payload', details: [{ reason: 'INVALID_PAYLOAD' }] },
    })
  })

  it('rejects credit-only commerce fulfillment events on the quota webhook [spec: quota-store/webhook-rejects-commerce]', async () => {
    const { app, db } = await createTestApp()
    await seedBusinessLicense(db)
    const payload = JSON.stringify({
      eventId: 'evt-credit-only',
      eventType: 'commerce.order_item.fulfilled',
      orderId: 'order-credit-only',
      orderItemId: 'item-credit-only',
      productId: 'product-credit-only',
      productName: 'Credits',
      quantity: 1,
      deliverable: {
        type: 'zpan.credits',
        includedCredits: 200,
      },
      target: {
        orgId: await getFirstOrgId(db),
        customerId: 'customer-credit-only',
        customerLabel: 'customer@example.com',
      },
      context: {
        storeId: 'store_1',
        paymentProvider: 'stripe',
      },
      occurredAt: '2026-06-01T00:00:00.000Z',
    })

    const res = await postWebhook(app, payload)

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      error: { message: 'Invalid payload', details: [{ reason: 'INVALID_PAYLOAD' }] },
    })
  })
})

// Nulls the bound store id while keeping the refresh token + cached cert, so the
// quota_store feature gate still passes (license stays bound/active) but
// getCloudStoreBinding throws quota_store_binding_missing — the state the
// storefront proxies surface as 403.
async function breakStoreBinding(db: Awaited<ReturnType<typeof createTestApp>>['db']) {
  await db.run(sql`UPDATE license_bindings SET cloud_store_id = NULL`)
}

describe('Quota Store API — storefront proxy error branches', () => {
  it('proxies credit products through the store products endpoint', async () => {
    const { app, db } = await createTestApp()
    await seedBusinessLicense(db)
    const headers = await authedHeaders(app, 'credit-products@example.com')
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        items: [
          cloudProduct({
            id: 'cloud-credit-1',
            name: 'Credit Pack',
            metadata: { deliverable: { type: 'zpan.credits', credits: 1000 } },
          }),
        ],
        total: 1,
        limit: 100,
        offset: 0,
      }),
    } as Response)

    const res = await app.request('/api/store/credits/products', { headers })
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      total: 1,
      items: [{ id: 'cloud-credit-1' }],
    })
  })

  it('returns a discount quote from Cloud', async () => {
    const { app, db } = await createTestApp()
    await seedBusinessLicense(db)
    const headers = await authedHeaders(app, 'discount@example.com')
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ code: 'SAVE10', currency: 'usd', subtotal: 1000, discount: 100, total: 900 }),
    } as Response)

    const res = await app.request('/api/store/discount-quotes', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'SAVE10', priceId: 'price-usd' }),
    })
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      code: 'SAVE10',
      currency: 'usd',
      subtotal: 1000,
      discount: 100,
      total: 900,
    })
  })

  it('returns 403 (binding_missing) for storefront reads when the store is not bound', async () => {
    const { app, db } = await createTestApp()
    await seedBusinessLicense(db)
    const headers = await authedHeaders(app, 'unbound-reads@example.com')
    await breakStoreBinding(db)

    const packages = await app.request('/api/store/packages', { headers })
    const creditProducts = await app.request('/api/store/credits/products', { headers })
    const targets = await app.request('/api/store/targets', { headers })
    const discount = await app.request('/api/store/discount-quotes', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'SAVE10', priceId: 'price-usd' }),
    })

    for (const res of [packages, creditProducts, targets, discount]) {
      expect(res.status).toBe(403)
      const body = (await res.json()) as { error: { message: string; status: string } }
      expect(body.error.message).toBe('quota_store_binding_missing')
      expect(body.error.status).toBe('PERMISSION_DENIED')
    }
  })

  it('returns 403 (binding_missing) for owner-scoped store endpoints when the store is not bound', async () => {
    const { app, db } = await createTestApp()
    await seedBusinessLicense(db)
    const headers = await authedHeaders(app, 'unbound-owner@example.com')
    await breakStoreBinding(db)

    const credits = await app.request('/api/store/credits', { headers })
    const ledger = await app.request('/api/store/credits/ledger-entries', { headers })
    const billing = await app.request('/api/store/billing-portal-sessions', { method: 'POST', headers })
    const checkout = await app.request('/api/store/checkouts', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ packageId: 'cloud-pkg-1' }),
    })
    const redeem = await app.request('/api/store/credits/redemptions', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'ZS-TEST-1' }),
    })

    for (const res of [credits, ledger, billing, checkout, redeem]) {
      expect(res.status).toBe(403)
      const body = (await res.json()) as { error: { message: string } }
      expect(body.error.message).toBe('quota_store_binding_missing')
    }
  })

  it('returns 502 when Cloud fails while fetching an order for payment/cancel', async () => {
    const { app, db } = await createTestApp()
    await seedBusinessLicense(db)
    const headers = await authedHeaders(app, 'order-cloud-error@example.com')

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: 'cloud_boom' }),
    } as Response)
    const payment = await app.request('/api/store/orders/order-err/payments', { method: 'POST', headers })
    expect(payment.status).toBe(502)
    await expect(payment.json()).resolves.toMatchObject({ error: { code: 502, message: 'cloud_boom' } })

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: 'cloud_boom' }),
    } as Response)
    const cancel = await app.request('/api/store/orders/order-err/status', {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'canceled' }),
    })
    expect(cancel.status).toBe(502)
    await expect(cancel.json()).resolves.toMatchObject({ error: { code: 502, message: 'cloud_boom' } })
  })

  it('returns 403 (store not ready) for order endpoints when the store is not bound', async () => {
    const { app, db } = await createTestApp()
    await seedBusinessLicense(db)
    const headers = await authedHeaders(app, 'unbound-orders@example.com')
    await breakStoreBinding(db)

    const orders = await app.request('/api/store/orders', { headers })
    const payment = await app.request('/api/store/orders/order-1/payments', { method: 'POST', headers })
    const cancel = await app.request('/api/store/orders/order-1/status', {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'canceled' }),
    })

    for (const res of [orders, payment, cancel]) {
      expect(res.status).toBe(403)
      const body = (await res.json()) as { error: { message: string } }
      expect(body.error.message).toBe('quota_store_binding_missing')
    }
  })
})

// Sign up a fresh user, create a team org, add the user as a member with the
// given role, and switch their session's active organization to the team.
async function memberInTeamOrg(
  app: Awaited<ReturnType<typeof createTestApp>>['app'],
  db: Awaited<ReturnType<typeof createTestApp>>['db'],
  role: 'owner' | 'editor' | 'viewer',
): Promise<{ headers: Record<string, string>; teamOrgId: string; userId: string }> {
  const email = `${role}-${Math.random().toString(36).slice(2)}@example.com`
  const headers = await authedHeaders(app, email)
  const users = await db.all<{ id: string }>(sql`SELECT id FROM user WHERE email = ${email}`)
  const userId = users[0]!.id

  const teamOrgId = `team-org-${Math.random().toString(36).slice(2)}`
  await db.run(sql`
    INSERT INTO organization (id, name, slug, metadata)
    VALUES (${teamOrgId}, 'Test Team', ${teamOrgId}, '{"type":"team"}')
  `)
  await db.run(sql`
    INSERT INTO org_quotas (id, org_id, quota, used, traffic_quota, traffic_used, traffic_period)
    VALUES (${`quota-${teamOrgId}`}, ${teamOrgId}, 10485760, 0, 0, 0, '1970-01')
  `)
  await db.run(sql`
    INSERT INTO member (id, organization_id, user_id, role)
    VALUES (${`member-${teamOrgId}`}, ${teamOrgId}, ${userId}, ${role})
  `)

  const setActive = await app.request('/api/auth/organization/set-active', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizationId: teamOrgId }),
  })
  expect(setActive.status).toBe(200)
  const updatedCookies = setActive.headers.getSetCookie()
  if (updatedCookies.length > 0) {
    headers.Cookie = mergeCookies(headers.Cookie, updatedCookies)
  }
  return { headers, teamOrgId, userId }
}

function mergeCookies(existing: string, setCookies: string[]): string {
  const jar = new Map<string, string>()
  for (const pair of existing.split('; ')) {
    const idx = pair.indexOf('=')
    if (idx >= 0) jar.set(pair.slice(0, idx), pair.slice(idx + 1))
  }
  for (const cookie of setCookies) {
    const [pair] = cookie.split(';')
    const idx = pair.indexOf('=')
    if (idx >= 0) jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim())
  }
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
}

async function getFirstOrgId(db: Awaited<ReturnType<typeof createTestApp>>['db']): Promise<string> {
  const rows = await db.all<{ id: string }>(sql`SELECT id FROM organization LIMIT 1`)
  if (rows[0]) return rows[0].id
  await db.run(sql`
    INSERT INTO organization (id, name, slug, metadata)
    VALUES ('org-test', 'Test Organization', 'test-organization', '{"type":"personal"}')
  `)
  await db.run(sql`
    INSERT INTO org_quotas (id, org_id, quota, used, traffic_quota, traffic_used, traffic_period)
    VALUES ('quota-test', 'org-test', 10485760, 0, 0, 0, '1970-01')
  `)
  return 'org-test'
}

async function seedPackage(_db: Awaited<ReturnType<typeof createTestApp>>['db']): Promise<string> {
  return 'cloud-pkg-1'
}

async function postWebhook(app: Awaited<ReturnType<typeof createTestApp>>['app'], payload: string) {
  return app.request('/api/store/webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(await signedWebhookHeaders(payload)),
    },
    body: payload,
  })
}

async function signedWebhookHeaders(payload: string, overrides: Record<string, unknown> = {}) {
  const body = parseJson(payload)
  const issuedAt = Math.floor(Date.now() / 1000)
  const token = sign(EVENT_SECRET, {
    type: 'commerce.fulfillment.token',
    purpose: 'store.delivery',
    issuer: ZPAN_CLOUD_URL_DEFAULT,
    audience: 'test-instance',
    boundLicenseId: 'test-binding',
    eventId: body.eventId ?? 'evt-malformed',
    payloadHash: await sha256Hex(payload),
    issuedAt,
    notBefore: issuedAt,
    expiresAt: issuedAt + 60,
    ...overrides,
  })

  return {
    'x-commerce-event-token': token,
  }
}

async function seedCloudPr16License(db: Awaited<ReturnType<typeof createTestApp>>['db']) {
  const { createLicenseBindingRepo } = await import('../../adapters/repos/license-binding.js')
  const issuedAt = Math.floor(Date.now() / 1000)
  const expiresAt = issuedAt + 3600
  const cachedCert = sign(EVENT_SECRET, {
    type: 'zpan.license',
    issuer: ZPAN_CLOUD_URL_DEFAULT,
    subject: 'binding_1',
    accountId: 'test-account',
    instanceId: 'license_1',
    storeId: 'store-binding-1',
    edition: 'business',
    features: [
      'white_label',
      'open_registration',
      'teams_unlimited',
      'storages_unlimited',
      'site_announcements',
      'audit_log',
      'quota_store',
    ],
    licenseId: 'business-license-unit',
    authorizedHosts: ['localhost'],
    licenseValidUntil: issuedAt + 365 * 24 * 60 * 60,
    issuedAt,
    notBefore: issuedAt,
    expiresAt,
  })

  await createLicenseBindingRepo(db).createLicenseBinding({
    cloudBindingId: 'binding_1',
    cloudStoreId: 'store-binding-1',
    instanceId: 'license_1',
    cloudAccountId: 'test-account',
    refreshToken: REFRESH_TOKEN,
    cachedCert,
    cachedExpiresAt: expiresAt,
    lastRefreshAt: issuedAt,
  })
}

function parseJson(payload: string): { eventId?: string } {
  try {
    return JSON.parse(payload) as { eventId?: string }
  } catch {
    return {}
  }
}

async function sha256Hex(payload: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', encodeBytes(payload).buffer as ArrayBuffer))
}

function encodeBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
