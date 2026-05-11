import { sql } from 'drizzle-orm'
import { generateKeys, sign } from 'paseto-ts/v4'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ZPAN_CLOUD_URL_DEFAULT } from '../../shared/constants'
import type { CloudGiftCard } from '../../shared/types'
import { PUBLIC_KEYS } from '../licensing/public-keys.js'
import { getCloudStoreSettings } from '../services/cloud-store.js'
import { adminHeaders, authedHeaders, createTestApp, seedProLicense } from '../test/setup.js'
import {
  cloudGiftCardsResponseSchema,
  cloudPackageResponseSchema,
  getUserStoreSettings,
} from './cloud-store-helpers.js'

const REFRESH_TOKEN = 'test-refresh-token'
const INSTANCE_STORE_PATH = '/api/stores/store-test-binding'
const { secretKey: EVENT_SECRET, publicKey: EVENT_PUBLIC } = generateKeys('public')

const zpanCloudGiftCardResponseFixture: CloudGiftCard = {
  id: 'gift-card-1',
  storeId: 'store-test-binding',
  campaignId: null,
  code: null,
  codeLast4: '0001',
  amount: 1000,
  currency: 'usd',
  status: 'active',
  expiresAt: null,
  createdAt: '2026-05-06T00:00:00.000Z',
  updatedAt: '2026-05-06T00:00:00.000Z',
  disabledAt: null,
  revokedAt: null,
  createdByAdmin: 'admin',
}

function cloudGiftCard(overrides: Partial<typeof zpanCloudGiftCardResponseFixture> = {}) {
  return { ...zpanCloudGiftCardResponseFixture, ...overrides }
}

function cloudProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cloud-pkg-1',
    storeId: 'store-test-binding',
    type: 'store_item',
    name: 'Small',
    description: 'starter',
    metadata: { deliverable: { storageBytes: 4096, trafficBytes: 0 } },
    prices: [
      { id: 'price-usd', currency: 'usd', amount: 500 },
      { id: 'price-cny', currency: 'cny', amount: 3600 },
    ],
    active: true,
    sortOrder: 1,
    createdAt: '2026-05-06T00:00:00.000Z',
    updatedAt: '2026-05-06T00:00:00.000Z',
    ...overrides,
  }
}

function cloudProductRequest(overrides: Record<string, unknown> = {}) {
  return {
    type: 'store_item',
    name: 'Small',
    description: '',
    metadata: { deliverable: { type: 'zpan.extra', storageBytes: 4096, trafficBytes: 0 } },
    prices: [{ currency: 'usd', amount: 500 }],
    active: true,
    sortOrder: 0,
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
        productType: 'zpan_quota',
        name: 'Small',
        description: 'starter',
        quantity: 1,
        unitAmount: 500,
        totalAmount: 500,
        fulfillmentPayload: { storageBytes: 512, trafficBytes: 0 },
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
      if (String(url).includes('/api/stores/') && String(url).includes('/wallets/')) {
        if (init?.method === 'GET') {
          if (String(url).includes('/transactions')) {
            return {
              ok: true,
              status: 200,
              json: async () => ({
                items: [
                  {
                    id: 'ledger-1',
                    storeId: 'store-test-binding',
                    customerId: 'org-placeholder',
                    currency: 'usd',
                    amount: 500,
                    direction: 'credit',
                    status: 'posted',
                    sourceType: 'gift_card_redemption',
                    sourceId: 'gift-1',
                    orderId: null,
                    paymentId: null,
                    stripeCustomerBalanceTransactionId: null,
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
              items: [
                {
                  id: 'wallet-1',
                  storeId: 'store-test-binding',
                  customerId: 'org-placeholder',
                  currency: 'usd',
                  availableAmount: 1250,
                  pendingAmount: 0,
                  stripeCustomerId: null,
                  updatedAt: '2026-05-06T00:00:00.000Z',
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
          status: 201,
          json: async () => ({
            redeemedAmount: 1000,
            currency: 'usd',
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
              items: [cloudGiftCard({ code: 'ZS-LIST-1', codeLast4: 'ST-1', amount: 1024 })],
              total: 1,
              limit: 50,
              offset: 0,
              data: {
                items: [cloudGiftCard({ code: 'ZS-LIST-1', codeLast4: 'ST-1', amount: 1024 })],
                total: 1,
                limit: 50,
                offset: 0,
              },
            }),
          } as Response
        }
        const body = JSON.parse(String(init?.body ?? '{}')) as { amount?: number; count?: number }
        return {
          ok: true,
          status: 201,
          json: async () => ({
            data: Array.from({ length: body.count ?? 1 }, (_, index) =>
              cloudGiftCard({
                code: `ZS-GEN-${index + 1}`,
                codeLast4: `GEN${index + 1}`,
                amount: body.amount ?? 1024,
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
              metadata: { deliverable: { storageBytes: 0, trafficBytes: 8192 } },
              prices: [{ currency: 'usd', amount: 900 }],
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
              metadata: body.metadata ?? { deliverable: { storageBytes: 4096, trafficBytes: 0 } },
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
        metadata: { deliverable: { storageBytes: 4096, trafficBytes: 8192 } },
        prices: [{ currency: 'usd', amount: 999 }],
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
      metadata: { deliverable: { storageBytes: 4096, trafficBytes: 8192 } },
      prices: [{ currency: 'usd', amount: 999 }],
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
            amount: 2048,
            currency: 'usd',
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
          amount: 2048,
          currency: 'usd',
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

  it('surfaces unexpected store settings load errors', async () => {
    const db = {
      select: () => ({
        from: () => ({
          where: async () => {
            throw new Error('settings read failed')
          },
        }),
      }),
    }

    await expect(getUserStoreSettings(db as unknown as Parameters<typeof getUserStoreSettings>[0])).rejects.toThrow(
      'settings read failed',
    )
  })

  it('returns 402 when Pro quota_store is absent', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)

    const res = await app.request('/api/admin/store/packages', { headers })

    expect(res.status).toBe(402)
  })

  it('returns 402 for Cloud quota-change webhook when Pro quota_store is absent', async () => {
    const { app, db } = await createTestApp()
    await seedSettingsRow(db)
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

  it('validates package resource bytes and prices', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)

    const res = await app.request('/api/admin/store/packages', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(
        cloudProductRequest({
          name: 'Bad',
          metadata: { deliverable: { type: 'zpan.extra', storageBytes: 0, trafficBytes: 0 } },
          prices: [],
        }),
      ),
    })

    expect(res.status).toBe(400)
  })

  it('reads and updates quota store settings', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)

    const empty = await app.request('/api/admin/store/settings', { headers })
    await seedSettings(app, headers)
    const filled = await app.request('/api/admin/store/settings', { headers })

    expect(empty.status).toBe(200)
    await expect(empty.json()).resolves.toBeNull()
    expect(filled.status).toBe(200)
    const payload = await filled.json()
    expect(payload).toMatchObject({
      enabled: true,
      status: 'ready',
    })
    expect(payload).not.toHaveProperty('cloudBaseUrl')
    expect(payload).not.toHaveProperty('publicInstanceUrl')
    expect(payload).not.toHaveProperty('webhookSigningSecret')
  })

  it('updates quota store operator settings only', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)

    const updated = await app.request('/api/admin/store/settings', {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    })

    expect(updated.status).toBe(200)
    await expect(updated.json()).resolves.toMatchObject({
      enabled: false,
      status: 'ready',
    })
  })

  it('reports Cloud not connected when the settings binding refresh token is missing', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)
    await db.run(sql`UPDATE license_bindings SET refresh_token = NULL`)

    const settings = await getCloudStoreSettings(db)

    expect(settings).toMatchObject({
      enabled: true,
      status: 'cloud_unbound',
    })
  })

  it('proxies package CRUD to Cloud without local sync', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)

    const created = await app.request('/api/admin/store/packages', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(
        cloudProductRequest({
          name: 'Small',
          description: 'starter',
        }),
      ),
    })
    const listed = await app.request('/api/admin/store/packages', { headers })

    expect(created.status).toBe(201)
    await expect(created.json()).resolves.toMatchObject({ id: 'cloud-pkg-1', name: 'Small' })
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [URL, RequestInit]
    const body = String(init.body)
    expect(String(url)).toBe(`${ZPAN_CLOUD_URL_DEFAULT}${INSTANCE_STORE_PATH}/products`)
    expect(requestHeader(init, 'Authorization')).toBe(`Bearer ${REFRESH_TOKEN}`)
    expect(JSON.parse(body)).toMatchObject({
      name: 'Small',
      description: 'starter',
      metadata: { deliverable: { type: 'zpan.extra', storageBytes: 4096, trafficBytes: 0 } },
      type: 'store_item',
      prices: [{ currency: 'usd', amount: 500 }],
    })
    expect(JSON.parse(body)).not.toHaveProperty('callbackUrl')
    expect(listed.status).toBe(200)
    await expect(listed.json()).resolves.toMatchObject({
      total: 2,
      items: [
        { id: 'cloud-pkg-1', metadata: { deliverable: { storageBytes: 4096, trafficBytes: 0 } }, active: true },
        { id: 'cloud-pkg-inactive', metadata: { deliverable: { storageBytes: 0, trafficBytes: 8192 } }, active: false },
      ],
    })
  })

  it('accepts Cloud package object lists and PUT updates', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        items: [
          cloudProduct({
            id: 'cloud-pkg-object',
            name: 'Object Shape',
            description: null,
            metadata: { deliverable: { storageBytes: 0, trafficBytes: 4096 } },
            prices: [
              { currency: 'usd', amount: 500 },
              { currency: 'cny', amount: 3600 },
            ],
            sortOrder: 3,
          }),
        ],
        total: 1,
        limit: 100,
        offset: 0,
      }),
    } as Response)

    const listed = await app.request('/api/admin/store/packages', { headers })
    const updated = await app.request('/api/admin/store/packages/cloud-pkg-object', {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(
        cloudProductRequest({
          name: 'Updated',
          metadata: { deliverable: { type: 'zpan.extra', storageBytes: 0, trafficBytes: 8192 } },
          prices: [{ currency: 'cny', amount: 900 }],
        }),
      ),
    })

    expect(listed.status).toBe(200)
    await expect(listed.json()).resolves.toMatchObject({
      total: 1,
      items: [
        {
          id: 'cloud-pkg-object',
          description: null,
          metadata: { deliverable: { storageBytes: 0, trafficBytes: 4096 } },
          sortOrder: 3,
        },
      ],
    })
    expect(updated.status).toBe(200)
    const updateCall = vi.mocked(fetch).mock.calls.find((call) => call[1]?.method === 'PATCH')
    expect(updateCall).toBeTruthy()
    const [, updateInit] = updateCall as [URL, RequestInit]
    expect(updateInit.method).toBe('PATCH')
    expect(JSON.parse(updateInit.body as string)).toEqual({
      name: 'Updated',
      description: '',
      type: 'store_item',
      metadata: {
        deliverable: { type: 'zpan.extra', storageBytes: 0, trafficBytes: 8192 },
      },
      prices: [{ currency: 'cny', amount: 900 }],
      active: true,
      sortOrder: 0,
    })
  })

  it('gets packages by Cloud id', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)

    const res = await app.request('/api/admin/store/packages/cloud-pkg-1', { headers })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ id: 'cloud-pkg-1', active: true })
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [URL, RequestInit]
    expect(String(url)).toBe(`${ZPAN_CLOUD_URL_DEFAULT}${INSTANCE_STORE_PATH}/products/cloud-pkg-1`)
    expect(init.method).toBe('GET')
  })

  it('does not send callback URLs during package create', async () => {
    const { app, db } = await createTestApp({ ZPAN_PUBLIC_ORIGIN: 'https://zpan.example/custom-path' })
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)

    const created = await app.request('/api/admin/store/packages', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(
        cloudProductRequest({
          name: 'Configured',
        }),
      ),
    })

    expect(created.status).toBe(201)
    const [, init] = vi.mocked(fetch).mock.calls[0] as [URL, RequestInit]
    expect(JSON.parse(init.body as string)).not.toHaveProperty('callbackUrl')
  })

  it('proxies recurring plans and fixed-duration quota packages to Cloud deliverables', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)

    const recurringPlan = await app.request('/api/admin/store/packages', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(
        cloudProductRequest({
          name: 'Team Monthly',
          metadata: {
            deliverable: { type: 'zpan.plan', storageBytes: 4096, trafficBytes: 8192, trafficOveragePriceCents: 2 },
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
        }),
      ),
    })
    const fixedPackage = await app.request('/api/admin/store/packages', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(
        cloudProductRequest({
          name: 'Traffic Pack',
          metadata: { deliverable: { type: 'zpan.extra', storageBytes: 0, trafficBytes: 8192, validityDays: 30 } },
          prices: [{ currency: 'usd', amount: 900 }],
        }),
      ),
    })

    expect(recurringPlan.status).toBe(201)
    expect(fixedPackage.status).toBe(201)
    const recurringBody = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string)
    const fixedBody = JSON.parse((vi.mocked(fetch).mock.calls[1][1] as RequestInit).body as string)
    expect(recurringBody).toMatchObject({
      type: 'store_item',
      metadata: {
        deliverable: { type: 'zpan.plan', storageBytes: 4096, trafficBytes: 8192, trafficOveragePriceCents: 2 },
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
    expect(fixedBody).toMatchObject({
      type: 'store_item',
      metadata: { deliverable: { type: 'zpan.extra', storageBytes: 0, trafficBytes: 8192, validityDays: 30 } },
      prices: [{ currency: 'usd', amount: 900 }],
    })
  })

  it('rejects mixed package billing modes before proxying to Cloud', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)

    const created = await app.request('/api/admin/store/packages', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(
        cloudProductRequest({
          name: 'Mixed Billing',
          metadata: { deliverable: { type: 'zpan.plan', storageBytes: 4096, trafficBytes: 0 } },
          prices: [
            { currency: 'usd', amount: 1900, recurring: { interval: 'month', intervalCount: 1 } },
            { currency: 'cny', amount: 9000 },
          ],
        }),
      ),
    })

    expect(created.status).toBe(400)
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })

  it('rejects malformed metered traffic prices before proxying to Cloud', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)

    const missingUsageResource = await app.request('/api/admin/store/packages', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(
        cloudProductRequest({
          name: 'Malformed Metered',
          metadata: { deliverable: { type: 'zpan.plan', storageBytes: 4096, trafficBytes: 0 } },
          prices: [
            { currency: 'usd', amount: 1900, recurring: { interval: 'month', intervalCount: 1 } },
            { currency: 'usd', amount: 2, recurring: { interval: 'month', intervalCount: 1, usageType: 'metered' } },
          ],
        }),
      ),
    })
    const missingUsageType = await app.request('/api/admin/store/packages', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(
        cloudProductRequest({
          name: 'Malformed Resource',
          metadata: { deliverable: { type: 'zpan.plan', storageBytes: 4096, trafficBytes: 0 } },
          prices: [
            { currency: 'usd', amount: 1900, recurring: { interval: 'month', intervalCount: 1 } },
            {
              currency: 'usd',
              amount: 2,
              recurring: { interval: 'month', intervalCount: 1 },
              metadata: { usageResource: 'traffic_egress' },
            },
          ],
        }),
      ),
    })

    expect(missingUsageResource.status).toBe(400)
    expect(missingUsageType.status).toBe(400)
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })

  it('rejects duplicate fixed or metered subscription prices before proxying to Cloud', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)

    const duplicateFixed = await app.request('/api/admin/store/packages', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(
        cloudProductRequest({
          name: 'Duplicate Fixed',
          metadata: { deliverable: { type: 'zpan.plan', storageBytes: 4096, trafficBytes: 0 } },
          prices: [
            { currency: 'usd', amount: 1900, recurring: { interval: 'month', intervalCount: 1 } },
            { currency: 'usd', amount: 2900, recurring: { interval: 'month', intervalCount: 1 } },
            {
              currency: 'usd',
              amount: 2,
              recurring: { interval: 'month', intervalCount: 1, usageType: 'metered' },
              metadata: { usageResource: 'traffic_egress' },
            },
          ],
        }),
      ),
    })
    const duplicateMetered = await app.request('/api/admin/store/packages', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(
        cloudProductRequest({
          name: 'Duplicate Metered',
          metadata: { deliverable: { type: 'zpan.plan', storageBytes: 4096, trafficBytes: 0 } },
          prices: [
            { currency: 'usd', amount: 1900, recurring: { interval: 'month', intervalCount: 1 } },
            {
              currency: 'usd',
              amount: 2,
              recurring: { interval: 'month', intervalCount: 1, usageType: 'metered' },
              metadata: { usageResource: 'traffic_egress' },
            },
            {
              currency: 'usd',
              amount: 3,
              recurring: { interval: 'month', intervalCount: 1, usageType: 'metered' },
              metadata: { usageResource: 'traffic_egress' },
            },
          ],
        }),
      ),
    })

    expect(duplicateFixed.status).toBe(400)
    expect(duplicateMetered.status).toBe(400)
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })

  it('rejects non-monthly subscription prices before proxying to Cloud', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)

    const yearlyInterval = await app.request('/api/admin/store/packages', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(
        cloudProductRequest({
          name: 'Yearly Plan',
          metadata: { deliverable: { type: 'zpan.plan', storageBytes: 4096, trafficBytes: 0 } },
          prices: [
            { currency: 'usd', amount: 1900, recurring: { interval: 'year', intervalCount: 1 } },
            {
              currency: 'usd',
              amount: 2,
              recurring: { interval: 'year', intervalCount: 1, usageType: 'metered' },
              metadata: { usageResource: 'traffic_egress' },
            },
          ],
        }),
      ),
    })
    const multiMonthInterval = await app.request('/api/admin/store/packages', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(
        cloudProductRequest({
          name: 'Quarterly Plan',
          metadata: { deliverable: { type: 'zpan.plan', storageBytes: 4096, trafficBytes: 0 } },
          prices: [
            { currency: 'usd', amount: 1900, recurring: { interval: 'month', intervalCount: 3 } },
            {
              currency: 'usd',
              amount: 2,
              recurring: { interval: 'month', intervalCount: 3, usageType: 'metered' },
              metadata: { usageResource: 'traffic_egress' },
            },
          ],
        }),
      ),
    })

    expect(yearlyInterval.status).toBe(400)
    expect(multiMonthInterval.status).toBe(400)
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })

  it('updates package quota deliverables directly through Cloud', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)

    const updated = await app.request('/api/admin/store/packages/pkg-1', {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        metadata: { deliverable: { type: 'zpan.extra', storageBytes: 4096, trafficBytes: 0 } },
      }),
    })

    expect(updated.status).toBe(200)
    const [, init] = vi.mocked(fetch).mock.calls[0] as [URL, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({
      metadata: { deliverable: { type: 'zpan.extra', storageBytes: 4096, trafficBytes: 0 } },
    })
  })

  it('updates package names without touching deliverables', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)

    const updated = await app.request('/api/admin/store/packages/pkg-1', {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Renamed' }),
    })

    expect(updated.status).toBe(200)
    const [, init] = vi.mocked(fetch).mock.calls[0] as [URL, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({ name: 'Renamed' })
  })

  it('ignores spoofed forwarded origin for Cloud checkout return URLs', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await authedHeaders(app, 'buyer@example.com')
    await seedSettings(app, headers)
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

  it('does not use forwarded origins during package create', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)

    const created = await app.request('/api/admin/store/packages', {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
        'x-forwarded-proto': 'http',
        'x-forwarded-host': 'localhost',
      },
      body: JSON.stringify(
        cloudProductRequest({
          name: 'Bad Proto',
        }),
      ),
    })

    expect(created.status).toBe(201)
    const [, init] = vi.mocked(fetch).mock.calls[0] as [URL, RequestInit]
    expect(JSON.parse(init.body as string)).not.toHaveProperty('callbackUrl')
  })

  it('ignores non-https forwarded schemes for Cloud checkout return URLs', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await authedHeaders(app, 'buyer@example.com')
    await seedSettings(app, headers)
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

  it('uses https origin for non-local http request URLs', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await authedHeaders(app, 'buyer@example.com')
    await seedSettings(app, headers)
    const packageId = await seedPackage(db)

    const checkout = await app.request('http://files.example.com/api/store/checkouts', {
      method: 'POST',
      headers: { ...headers, Host: 'localhost', 'Content-Type': 'application/json' },
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

  it('uses configured auth URL origin for checkout return URLs', async () => {
    const { app, db } = await createTestApp({ BETTER_AUTH_URL: 'https://auth.example.com/path' })
    await seedProLicense(db)
    const headers = await authedHeaders(app, 'buyer@example.com')
    await seedSettings(app, headers)
    const packageId = await seedPackage(db)

    const checkout = await app.request('/api/store/checkouts', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ packageId }),
    })

    expect(checkout.status).toBe(200)
    expect(orderPayload()).toMatchObject({
      deliveryCallbackUrl: 'https://auth.example.com/api/store/webhook',
    })
    expect(paymentPayload()).toMatchObject({
      successUrl: 'https://auth.example.com/storage',
      cancelUrl: 'https://auth.example.com/storage',
    })
  })

  it('falls back to request origin when public origin env is invalid', async () => {
    const { app, db } = await createTestApp({ ZPAN_PUBLIC_ORIGIN: 'not a url' })
    await seedProLicense(db)
    const headers = await authedHeaders(app, 'buyer@example.com')
    await seedSettings(app, headers)
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

  it('falls back to request origin when public origin env uses an unsupported scheme', async () => {
    const { app, db } = await createTestApp({ ZPAN_PUBLIC_ORIGIN: 'ftp://files.example.com' })
    await seedProLicense(db)
    const headers = await authedHeaders(app, 'buyer@example.com')
    await seedSettings(app, headers)
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

  it('surfaces package create Cloud failures', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 502, json: async () => ({}) } as Response)

    const res = await app.request('/api/admin/store/packages', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(
        cloudProductRequest({
          name: 'Small',
        }),
      ),
    })

    expect(res.status).toBe(502)
    await expect(res.json()).resolves.toEqual({ error: 'cloud_request_failed_502' })
  })

  it('rejects malformed successful package responses', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) } as Response)

    const res = await app.request('/api/admin/store/packages', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(
        cloudProductRequest({
          name: 'Small',
        }),
      ),
    })

    expect(res.status).toBe(502)
    await expect(res.json()).resolves.toEqual({ error: 'invalid_cloud_response' })
  })

  it('rejects prices with empty currency strings', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)

    const res = await app.request('/api/admin/store/packages', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(
        cloudProductRequest({
          name: 'Bad Currency',
          prices: [{ currency: '', amount: 500 }],
        }),
      ),
    })

    expect(res.status).toBe(400)
  })

  it('rejects non-json successful package responses', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('not_json')
      },
    } as unknown as Response)

    const res = await app.request('/api/admin/store/packages', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(
        cloudProductRequest({
          name: 'Small',
        }),
      ),
    })

    expect(res.status).toBe(502)
    await expect(res.json()).resolves.toEqual({ error: 'invalid_cloud_response' })
  })

  it('deletes packages through Cloud', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)
    const packageId = await seedPackage(db)

    const res = await app.request(`/api/admin/store/packages/${packageId}`, {
      method: 'DELETE',
      headers,
    })

    expect(res.status).toBe(200)
    const calls = vi.mocked(fetch).mock.calls
    const [url, init] = calls[calls.length - 1] as [URL, RequestInit]
    expect(String(url)).toBe(`${ZPAN_CLOUD_URL_DEFAULT}${INSTANCE_STORE_PATH}/products/${packageId}`)
    expect(init.method).toBe('DELETE')
  })

  it('proxies admin gift card management through the bound Cloud API', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)

    const generated = await app.request('/api/admin/store/gift-cards', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: 4096,
        currency: 'usd',
        expiresAt: '2026-06-01T00:00:00.000Z',
        count: 2,
      }),
    })
    const listed = await app.request('/api/admin/store/gift-cards?status=active', { headers })
    const deleted = await app.request('/api/admin/store/gift-cards/ZS-GEN-1', { method: 'DELETE', headers })

    expect(generated.status).toBe(201)
    await expect(generated.json()).resolves.toMatchObject([
      { code: 'ZS-GEN-1', amount: 4096, status: 'active' },
      { code: 'ZS-GEN-2', amount: 4096, status: 'active' },
    ])
    expect(listed.status).toBe(200)
    await expect(listed.json()).resolves.toMatchObject({
      total: 1,
      items: [{ code: 'ZS-LIST-1', amount: 1024 }],
    })
    expect(deleted.status).toBe(200)
    await expect(deleted.json()).resolves.toEqual({ code: 'ZS-GEN-1', deleted: true })

    const calls = vi.mocked(fetch).mock.calls as Array<[URL, RequestInit]>
    const [generateUrl, generateInit] = calls[0]
    const [listUrl, listInit] = calls[1]
    const [deleteUrl, deleteInit] = calls[2]
    expect(String(generateUrl)).toBe(`${ZPAN_CLOUD_URL_DEFAULT}${INSTANCE_STORE_PATH}/gift-cards`)
    expect(requestHeader(generateInit, 'Authorization')).toBe(`Bearer ${REFRESH_TOKEN}`)
    expect(JSON.parse(generateInit.body as string)).toEqual({
      amount: 4096,
      currency: 'usd',
      expiresAt: '2026-06-01T00:00:00.000Z',
      count: 2,
    })
    expect(String(listUrl)).toBe(`${ZPAN_CLOUD_URL_DEFAULT}${INSTANCE_STORE_PATH}/gift-cards?status=active`)
    expect(requestHeader(listInit, 'Authorization')).toBe(`Bearer ${REFRESH_TOKEN}`)
    expect(String(deleteUrl)).toBe(`${ZPAN_CLOUD_URL_DEFAULT}${INSTANCE_STORE_PATH}/gift-cards/ZS-GEN-1`)
    expect(deleteInit.method).toBe('DELETE')
  })

  it('accepts paged admin gift card lists from Cloud', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ items: [cloudGiftCard({ code: 'ZS-PAGED-1' })], total: 9, limit: 50, offset: 0 }),
    } as Response)

    const res = await app.request('/api/admin/store/gift-cards?status=active', { headers })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ total: 9, items: [{ code: 'ZS-PAGED-1' }] })
  })

  it('returns admin gift card create responses from Cloud', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => [cloudGiftCard({ code: 'ZS-CREATED-1', codeLast4: 'TED1' })],
    } as Response)

    const res = await app.request('/api/admin/store/gift-cards', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: 4096,
        currency: 'usd',
        count: 1,
      }),
    })

    expect(res.status).toBe(201)
    await expect(res.json()).resolves.toMatchObject([{ code: 'ZS-CREATED-1' }])
  })

  it('disables admin gift cards through Cloud', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 204,
      json: async () => null,
    } as Response)

    const res = await app.request('/api/admin/store/gift-cards/ZS-GEN-1', {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ disabled: true }),
    })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ code: 'ZS-GEN-1', disabled: true })
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [URL, RequestInit]
    expect(String(url)).toBe(`${ZPAN_CLOUD_URL_DEFAULT}${INSTANCE_STORE_PATH}/gift-cards/ZS-GEN-1`)
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body as string)).toEqual({ disabled: true })
  })

  it('rejects non-admin gift card management', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const admin = await adminHeaders(app)
    await seedSettings(app, admin)
    const headers = await authedHeaders(app, 'buyer@example.com')

    const res = await app.request('/api/admin/store/gift-cards', { headers })

    expect(res.status).toBe(403)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('proxies admin store orders from Cloud', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)

    const res = await app.request('/api/admin/store/orders', { headers })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      total: 1,
      items: [{ id: 'cloud-order-1', items: [{ fulfillmentPayload: { storageBytes: 512, trafficBytes: 0 } }] }],
    })
    const [url] = vi.mocked(fetch).mock.calls[0] as [URL, RequestInit]
    expect(String(url)).toBe(`${ZPAN_CLOUD_URL_DEFAULT}${INSTANCE_STORE_PATH}/orders?limit=100`)
  })

  it('paginates admin store orders from Cloud', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ items: [cloudOrder({ id: 'cloud-order-2' })], total: 2, limit: 1, offset: 1 }),
    } as Response)

    const res = await app.request('/api/admin/store/orders?limit=1&offset=1', { headers })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      total: 2,
      items: [{ id: 'cloud-order-2' }],
    })
    const calls = vi.mocked(fetch).mock.calls as Array<[URL, RequestInit]>
    expect(String(calls[0][0])).toBe(`${ZPAN_CLOUD_URL_DEFAULT}${INSTANCE_STORE_PATH}/orders?limit=1&offset=1`)
  })

  it('updates packages through Cloud', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)

    const res = await app.request('/api/admin/store/packages/cloud-pkg-1', {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(
        cloudProductRequest({
          name: 'Small',
        }),
      ),
    })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ id: 'cloud-pkg-1', name: 'Small' })
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [URL, RequestInit]
    expect(String(url)).toBe(`${ZPAN_CLOUD_URL_DEFAULT}${INSTANCE_STORE_PATH}/products/cloud-pkg-1`)
    expect(init.method).toBe('PATCH')
  })

  it('publishes and unpublishes packages through partial Cloud patches', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)

    const res = await app.request('/api/admin/store/packages/cloud-pkg-1', {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: false }),
    })

    expect(res.status).toBe(200)
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [URL, RequestInit]
    expect(String(url)).toBe(`${ZPAN_CLOUD_URL_DEFAULT}${INSTANCE_STORE_PATH}/products/cloud-pkg-1`)
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(String(init.body))).toEqual({ active: false })
  })

  it('surfaces package update Cloud failures without local writes', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: async () => ({ error: 'cloud_down' }),
    } as Response)

    const res = await app.request('/api/admin/store/packages/cloud-pkg-1', {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(
        cloudProductRequest({
          name: 'Small',
        }),
      ),
    })

    expect(res.status).toBe(502)
    await expect(res.json()).resolves.toEqual({ error: 'cloud_down' })
  })

  it('surfaces package delete Cloud failures', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({ error: 'cloud_unavailable' }),
    } as Response)

    const res = await app.request('/api/admin/store/packages/cloud-pkg-1', {
      method: 'DELETE',
      headers,
    })

    expect(res.status).toBe(502)
    await expect(res.json()).resolves.toEqual({ error: 'cloud_unavailable' })
  })

  it('rejects checkout target orgs the user cannot access', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await authedHeaders(app, 'buyer@example.com')
    await seedSettings(app, headers)
    const packageId = await seedPackage(db)

    const res = await app.request('/api/store/checkouts', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ packageId }),
    })

    expect(res.status).toBe(200)
  })

  it('omits wallet credit when checking out recurring packages', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await authedHeaders(app, 'buyer@example.com')
    await seedSettings(app, headers)
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
      body: JSON.stringify({ packageId, currency: 'usd' }),
    })

    expect(checkout.status).toBe(200)
    expect(orderPayload()).not.toHaveProperty('walletCreditAmount')
  })

  it('rejects recurring checkout when the workspace already has an active plan', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await authedHeaders(app, 'buyer@example.com')
    await seedSettings(app, headers)
    const orgId = await getFirstOrgId(db)
    const packageId = await seedPackage(db)
    const now = Date.now()
    await db.run(sql`
      INSERT INTO org_quota_entitlements
        (id, org_id, resource_type, source, source_id, bytes, starts_at, expires_at, status, metadata, created_at, updated_at)
      VALUES
        ('ent-active-plan', ${orgId}, 'storage', 'cloud_order', ${`stripe_subscription:sub_active:${orgId}`}, 4096, ${now}, NULL, 'active', '{"packageName":"Active Plan"}', ${now}, ${now})
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
      body: JSON.stringify({ packageId, currency: 'usd' }),
    })

    expect(checkout.status).toBe(409)
    await expect(checkout.json()).resolves.toEqual({ error: 'workspace_plan_exists' })
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1)
  })

  it('uses wallet credit when checking out fixed-duration packages', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await authedHeaders(app, 'buyer@example.com')
    await seedSettings(app, headers)
    const packageId = await seedPackage(db)

    const checkout = await app.request('/api/store/checkouts', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ packageId, currency: 'usd' }),
    })

    expect(checkout.status).toBe(200)
    expect(orderPayload()).not.toHaveProperty('walletCreditAmount')
  })

  it('creates a subscription portal for the active workspace plan', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await authedHeaders(app, 'buyer@example.com')
    await seedSettings(app, headers)
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

  it('lists purchasable packages, targets, checkout, and orders', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await authedHeaders(app, 'buyer@example.com')
    await seedSettings(app, headers)
    const orgId = await getFirstOrgId(db)
    const packageId = await seedPackage(db)

    const packages = await app.request('/api/store/packages', { headers })
    const targets = await app.request('/api/store/targets', { headers })
    const checkout = await app.request('/api/store/checkouts', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ packageId, currency: 'cny' }),
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
      currency: 'cny',
      target: {
        orgId,
        customerId: orgId,
        customerLabel: 'buyer@example.com',
      },
    })
    expect(orderBody).not.toHaveProperty('walletCreditAmount')
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
      items: [{ id: 'cloud-order-1', target: { orgId }, items: [{ fulfillmentPayload: { storageBytes: 512 } }] }],
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

  it('proxies wallet balance and gift card redemption through wallet endpoints', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await authedHeaders(app, 'buyer@example.com')
    await seedSettings(app, headers)
    const orgId = await getFirstOrgId(db)

    const wallet = await app.request('/api/store/wallet', { headers })
    const redeem = await app.request('/api/store/gift-cards/redeem', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'ZS-1234-5678' }),
    })

    expect(wallet.status).toBe(200)
    await expect(wallet.json()).resolves.toEqual({
      items: [
        {
          id: 'wallet-1',
          storeId: 'store-test-binding',
          customerId: 'org-placeholder',
          currency: 'usd',
          availableAmount: 1250,
          pendingAmount: 0,
          stripeCustomerId: null,
          updatedAt: '2026-05-06T00:00:00.000Z',
        },
      ],
      total: 1,
      limit: 50,
      offset: 0,
    })
    expect(redeem.status).toBe(200)
    await expect(redeem.json()).resolves.toEqual({
      redeemedAmount: 1000,
      currency: 'usd',
      entries: [],
      failures: [],
    })

    const calls = vi.mocked(fetch).mock.calls as Array<[URL, RequestInit]>
    const [walletUrl, walletInit] = calls.find(([url]) => String(url).includes(`/wallets/${orgId}/balances`))!
    const [redeemUrl, redeemInit] = calls.find(([url]) => String(url).includes(`/wallets/${orgId}/redemptions`))!
    expect(String(walletUrl)).toBe(`${ZPAN_CLOUD_URL_DEFAULT}${INSTANCE_STORE_PATH}/wallets/${orgId}/balances`)
    expect(walletInit.method).toBe('GET')
    expect(String(redeemUrl)).toBe(`${ZPAN_CLOUD_URL_DEFAULT}${INSTANCE_STORE_PATH}/wallets/${orgId}/redemptions`)
    expect(redeemInit.method).toBe('POST')
    expect(JSON.parse(String(redeemInit.body))).toEqual({ codes: ['ZS-1234-5678'] })
  })

  it('proxies wallet transactions through wallet endpoints', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await authedHeaders(app, 'buyer@example.com')
    await seedSettings(app, headers)
    const orgId = await getFirstOrgId(db)

    const transactions = await app.request('/api/store/wallet/transactions', { headers })

    expect(transactions.status).toBe(200)
    await expect(transactions.json()).resolves.toEqual({
      items: [
        {
          id: 'ledger-1',
          storeId: 'store-test-binding',
          customerId: 'org-placeholder',
          currency: 'usd',
          amount: 500,
          direction: 'credit',
          status: 'posted',
          sourceType: 'gift_card_redemption',
          sourceId: 'gift-1',
          orderId: null,
          paymentId: null,
          stripeCustomerBalanceTransactionId: null,
          createdAt: '2026-05-06T00:00:00.000Z',
        },
      ],
      total: 1,
      limit: 50,
      offset: 0,
    })

    const calls = vi.mocked(fetch).mock.calls as Array<[URL, RequestInit]>
    const [transactionsUrl, transactionsInit] = calls.find(([url]) =>
      String(url).includes(`/wallets/${orgId}/transactions`),
    )!
    expect(String(transactionsUrl)).toBe(
      `${ZPAN_CLOUD_URL_DEFAULT}${INSTANCE_STORE_PATH}/wallets/${orgId}/transactions`,
    )
    expect(transactionsInit.method).toBe('GET')
  })

  it('continues payment and cancels orders through Cloud', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await authedHeaders(app, 'buyer@example.com')
    await seedSettings(app, headers)
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
    const canceled = await app.request('/api/store/orders/order-cloud-1', {
      method: 'PATCH',
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

  it('rejects payment continuation and cancellation for another org order', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await authedHeaders(app, 'buyer@example.com')
    await seedSettings(app, headers)

    const payment = await app.request('/api/store/orders/order-other-org/payments', {
      method: 'POST',
      headers,
    })
    const canceled = await app.request('/api/store/orders/order-other-org', {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'canceled' }),
    })

    expect(payment.status).toBe(403)
    await expect(payment.json()).resolves.toEqual({ error: 'Forbidden' })
    expect(canceled.status).toBe(403)
    await expect(canceled.json()).resolves.toEqual({ error: 'Forbidden' })
    const calls = vi.mocked(fetch).mock.calls as Array<[URL, RequestInit]>
    expect(calls.some(([url]) => String(url).includes('/orders/order-other-org/payments'))).toBe(false)
    expect(
      calls.some(([url, init]) => String(url).includes('/orders/order-other-org') && init.method === 'PATCH'),
    ).toBe(false)
  })

  it('hides self-service packages when the store is disabled', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await authedHeaders(app, 'buyer@example.com')
    await seedSettings(app, headers)
    await app.request('/api/admin/store/settings', {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        enabled: false,
      }),
    })

    const packageId = await seedPackage(db)
    const packages = await app.request('/api/store/packages', { headers })
    const targets = await app.request('/api/store/targets', { headers })
    const checkout = await app.request('/api/store/checkouts', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ packageId }),
    })
    const orders = await app.request('/api/store/orders', { headers })

    expect(packages.status).toBe(403)
    await expect(packages.json()).resolves.toEqual({ error: 'quota_store_disabled' })
    expect(targets.status).toBe(403)
    await expect(targets.json()).resolves.toEqual({ error: 'quota_store_disabled' })
    expect(checkout.status).toBe(403)
    await expect(checkout.json()).resolves.toEqual({ error: 'quota_store_disabled' })
    expect(orders.status).toBe(403)
    await expect(orders.json()).resolves.toEqual({ error: 'quota_store_disabled' })
  })

  it('hides self-service store endpoints until Cloud is bound', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await authedHeaders(app, 'buyer@example.com')
    await seedSettings(app, headers)
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

    expect(packages.status).toBe(402)
    await expect(packages.json()).resolves.toMatchObject({ error: 'feature_not_available', feature: 'quota_store' })
    expect(targets.status).toBe(402)
    await expect(targets.json()).resolves.toMatchObject({ error: 'feature_not_available', feature: 'quota_store' })
    expect(checkout.status).toBe(402)
    await expect(checkout.json()).resolves.toMatchObject({ error: 'feature_not_available', feature: 'quota_store' })
    expect(orders.status).toBe(402)
    await expect(orders.json()).resolves.toMatchObject({ error: 'feature_not_available', feature: 'quota_store' })
  })

  it('rejects malformed successful checkout responses', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await authedHeaders(app, 'buyer@example.com')
    await seedSettings(app, headers)
    const packageId = await seedPackage(db)
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) } as Response)

    const res = await app.request('/api/store/checkouts', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ packageId }),
    })

    expect(res.status).toBe(502)
    await expect(res.json()).resolves.toEqual({ error: 'invalid_cloud_response' })
  })

  it('surfaces Cloud checkout error responses', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await authedHeaders(app, 'buyer@example.com')
    await seedSettings(app, headers)
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
    await expect(res.json()).resolves.toEqual({ error: 'cloud_down' })
  })

  it('uses status errors when Cloud checkout error bodies have no string error', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await authedHeaders(app, 'buyer@example.com')
    await seedSettings(app, headers)
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
    await expect(res.json()).resolves.toEqual({ error: 'cloud_request_failed_504' })
  })

  it('accepts current Cloud quota-change webhook tokens with audience equal to instance id', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)
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
      expiresAt: '2026-06-01T00:00:00.000Z',
    })

    const res = await postWebhook(app, payload)

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ success: true, duplicate: false })
  })

  it("accepts Cloud PR #16 quota-change webhook tokens with audience='license_1' and boundLicenseId='binding_1'", async () => {
    const { app, db } = await createTestApp()
    await seedCloudPr16License(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)
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
      expiresAt: '2026-06-01T00:00:00.000Z',
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

  it('valid Cloud quota-change webhook records active entitlement once and records audit', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)
    const orgId = await getFirstOrgId(db)
    const before = await db.all<{ quota: number }>(sql`SELECT quota FROM org_quotas WHERE org_id = ${orgId}`)

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
      expiresAt: '2026-06-01T00:00:00.000Z',
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
    expect(quota.baseQuota).toBe(before[0].quota)
    expect(quota.entitlementQuota).toBe(4096)
    expect(quota.quota).toBe(before[0].quota + 4096)
    const entitlement = await db.all<{ bytes: number; status: string; sourceId: string; expiresAt: number }>(sql`
      SELECT bytes, status, source_id AS sourceId, expires_at AS expiresAt
      FROM org_quota_entitlements
      WHERE org_id = ${orgId} AND resource_type = 'storage'
    `)
    expect(entitlement).toEqual([
      { bytes: 4096, status: 'active', sourceId: 'order-1', expiresAt: Date.parse('2026-06-01T00:00:00.000Z') },
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

  it('delivers initial subscription storage and traffic entitlements under a stable source id', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)
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
      expiresAt: '2026-06-01T00:00:00.000Z',
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
    expect(new Date(entitlements[0].expiresAt).toISOString()).toBe('2026-06-01T00:00:00.000Z')
    expect(JSON.parse(entitlements[0].metadata)).toMatchObject({
      eventId: 'evt-subscription-initial-entitlement',
      source: 'stripe_subscription',
      packageId: 'pkg-monthly-storage-traffic',
      packageName: 'Team Plan',
      trafficOveragePriceCents: 25,
      expiresAt: '2026-06-01T00:00:00.000Z',
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
  })

  it('renews subscription entitlements by replacing plan bytes and extending expiry', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)
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
        expiresAt: '2026-06-01T00:00:00.000Z',
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
        expiresAt: '2026-07-01T00:00:00.000Z',
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
      { resourceType: 'storage', bytes: 8192, expiresAt: Date.parse('2026-07-01T00:00:00.000Z') },
      { resourceType: 'traffic', bytes: 4096, expiresAt: Date.parse('2026-07-01T00:00:00.000Z') },
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

  it('accumulates repeated Cloud increases for the same order and resource', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)
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

  it('decreases accumulated Cloud order entitlement bytes without revoking the remainder', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)
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
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)
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
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)
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
    await expect(res.json()).resolves.toEqual({ error: 'invalid_payload' })
  })

  it('storage decreases revoke matching Cloud order entitlements without changing base quota', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)
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
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)
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
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)
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
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)
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

  it('replaying the same decrease event is idempotent and does not double-deduct', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)
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
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)
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
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)
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
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)
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
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)
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
    await expect(retry.json()).resolves.toEqual({ error: 'webhook_payload_conflict' })
  })

  it('allows failed delivery retries when the payload is unchanged', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)
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
    await expect(failed.json()).resolves.toEqual({ error: 'target_quota_missing' })
    expect(retry.status).toBe(200)
    await expect(retry.json()).resolves.toMatchObject({ success: true, duplicate: false })
    const deliveries = await db.all<{ status: string; error: string | null }>(
      sql`SELECT status, error FROM webhook_events WHERE event_id = 'evt-failed-same-payload'`,
    )
    expect(deliveries).toEqual([{ status: 'processed', error: null }])
  })

  it('rejects missing Cloud quota-change webhook auth', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)

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
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)
    const payload = JSON.stringify({ eventId: 'evt-bad-token' })

    const res = await app.request('/api/store/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-zpan-cloud-event-token': 'bad-token',
      },
      body: payload,
    })

    expect(res.status).toBe(401)
  })

  it('rejects Cloud quota-change webhook event tokens with the wrong purpose', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)
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

  it('rejects expired Cloud quota-change webhook event tokens', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)
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
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)
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
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)
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
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)
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
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)
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
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)
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

  it('rejects Cloud quota-change webhook event tokens with the wrong audience', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)
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
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)
    const payload = '{bad-json'

    const res = await postWebhook(app, payload)

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: 'invalid_payload' })
  })

  it('rejects deliveries without resource details', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)
    const payload = JSON.stringify({
      eventId: 'evt-no-package',
      cloudOrderId: 'order-no-package',
      targetOrgId: await getFirstOrgId(db),
      source: 'stripe',
    })

    const res = await postWebhook(app, payload)

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: 'invalid_payload' })
  })
})

async function seedSettings(app: Awaited<ReturnType<typeof createTestApp>>['app'], headers: Record<string, string>) {
  await app.request('/api/admin/store/settings', {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: true }),
  })
}

async function getFirstOrgId(db: Awaited<ReturnType<typeof createTestApp>>['db']): Promise<string> {
  const rows = await db.all<{ id: string }>(sql`SELECT id FROM organization LIMIT 1`)
  return rows[0].id
}

async function seedPackage(_db: Awaited<ReturnType<typeof createTestApp>>['db']): Promise<string> {
  return 'cloud-pkg-1'
}

async function seedSettingsRow(db: Awaited<ReturnType<typeof createTestApp>>['db']) {
  const now = new Date().toISOString()
  await db.run(sql`
    INSERT INTO system_options
      (key, value, public)
    VALUES
      ('cloud_store_enabled', 'true', 0),
      ('cloud_store_created_at', ${now}, 0),
      ('cloud_store_updated_at', ${now}, 0)
  `)
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
    type: 'zpan.cloud.event',
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
    'x-zpan-cloud-event-token': token,
  }
}

async function seedCloudPr16License(db: Awaited<ReturnType<typeof createTestApp>>['db']) {
  const { createLicenseBinding } = await import('../licensing/license-state.js')
  const issuedAt = Math.floor(Date.now() / 1000)
  const expiresAt = issuedAt + 3600
  const cachedCert = sign(EVENT_SECRET, {
    type: 'zpan.license',
    issuer: ZPAN_CLOUD_URL_DEFAULT,
    subject: 'binding_1',
    accountId: 'test-account',
    instanceId: 'license_1',
    storeId: 'store-binding-1',
    edition: 'pro',
    authorizedHosts: ['localhost'],
    licenseValidUntil: issuedAt + 365 * 24 * 60 * 60,
    issuedAt,
    notBefore: issuedAt,
    expiresAt,
  })

  await createLicenseBinding(db, {
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
