import { sql } from 'drizzle-orm'
import { generateKeys, sign } from 'paseto-ts/v4'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ZPAN_CLOUD_URL_DEFAULT } from '../../shared/constants'
import { PUBLIC_KEYS } from '../licensing/public-keys.js'
import { getQuotaStoreSettings } from '../services/quota-store.js'
import { adminHeaders, authedHeaders, createTestApp, seedProLicense } from '../test/setup.js'
import {
  cloudPackageResponseSchema,
  cloudStorageCodesResponseSchema,
  getUserStoreSettings,
} from './quota-store-helpers.js'

const REFRESH_TOKEN = 'test-refresh-token'
const { secretKey: EVENT_SECRET, publicKey: EVENT_PUBLIC } = generateKeys('public')

const zpanCloudStorageCodeResponseFixture = {
  code: 'ZS11-ACTV-0000-0001',
  resourceType: 'storage',
  bytes: 1024,
  maxUses: 1,
  usesCount: 0,
  expiresAt: null,
  createdAt: '2026-05-06T00:00:00.000Z',
  revokedAt: null,
  createdByAdmin: 'admin',
  createdByBoundLicense: 'binding_1',
}

function cloudStorageCode(overrides: Partial<typeof zpanCloudStorageCodeResponseFixture> = {}) {
  return { ...zpanCloudStorageCodeResponseFixture, ...overrides }
}

beforeEach(() => {
  if (!PUBLIC_KEYS.includes(EVENT_PUBLIC)) PUBLIC_KEYS.unshift(EVENT_PUBLIC)
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, init) => {
      if (String(url).includes('/api/store/storage-codes')) {
        if (init?.method === 'DELETE') {
          return { ok: true, status: 204, json: async () => ({}) } as Response
        }
        if (init?.method === 'GET') {
          return {
            ok: true,
            status: 200,
            json: async () => [cloudStorageCode({ code: 'ZS-LIST-1', bytes: 2048, maxUses: 2, usesCount: 1 })],
          } as Response
        }
        const body = JSON.parse(String(init?.body ?? '{}')) as {
          resourceType?: string
          bytes?: number
          max_uses?: number
          count?: number
        }
        return {
          ok: true,
          status: 200,
          json: async () =>
            Array.from({ length: body.count ?? 1 }, (_, index) =>
              cloudStorageCode({
                code: `ZS-GEN-${index + 1}`,
                resourceType: body.resourceType ?? 'storage',
                bytes: body.bytes ?? 1024,
                maxUses: body.max_uses ?? 1,
              }),
            ),
        } as Response
      }
      if (String(url).includes('/api/store/packages')) {
        if (init?.method === 'GET') {
          const id = String(url).split('/').at(-1)
          if (id?.startsWith('cloud-pkg-')) {
            return {
              ok: true,
              status: 200,
              json: async () => ({
                id,
                name: 'Small',
                description: 'starter',
                resourceType: 'storage',
                resourceBytes: 4096,
                prices: [
                  { currency: 'usd', amount: 500 },
                  { currency: 'cny', amount: 3600 },
                ],
                active: true,
                sortOrder: 1,
                createdAt: '2026-05-06T00:00:00.000Z',
                updatedAt: '2026-05-06T00:00:00.000Z',
              }),
            } as Response
          }
          return {
            ok: true,
            status: 200,
            json: async () => [
              {
                id: 'cloud-pkg-1',
                name: 'Small',
                description: 'starter',
                resourceType: 'storage',
                resourceBytes: 4096,
                prices: [
                  { currency: 'usd', amount: 500 },
                  { currency: 'cny', amount: 3600 },
                ],
                active: true,
                sortOrder: 1,
                createdAt: '2026-05-06T00:00:00.000Z',
                updatedAt: '2026-05-06T00:00:00.000Z',
              },
              {
                id: 'cloud-pkg-inactive',
                name: 'Retired',
                description: 'hidden from users',
                resourceType: 'traffic',
                resourceBytes: 8192,
                prices: [{ currency: 'usd', amount: 900 }],
                active: false,
                sortOrder: 2,
                createdAt: '2026-05-06T00:00:00.000Z',
                updatedAt: '2026-05-06T00:00:00.000Z',
              },
            ],
          } as Response
        }
        if (init?.method === 'DELETE') {
          return { ok: true, status: 204, json: async () => ({}) } as Response
        }
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: String(url).split('/').at(-1)?.startsWith('pkg-') ? String(url).split('/').at(-1) : 'cloud-pkg-1',
            name: 'Small',
            description: 'starter',
            resourceType: 'storage',
            resourceBytes: 4096,
            prices: [{ currency: 'usd', amount: 500 }],
            active: true,
            sortOrder: 1,
            createdAt: '2026-05-06T00:00:00.000Z',
            updatedAt: '2026-05-06T00:00:00.000Z',
            ...body,
          }),
        } as Response
      }
      if (String(url).includes('/api/store/grants')) {
        const requestedOrgId = new URL(String(url)).searchParams.get('targetOrgIds')?.split(',')[0] ?? 'org-placeholder'
        return {
          ok: true,
          status: 200,
          json: async () => [
            {
              id: 'cloud-grant-1',
              org_id: requestedOrgId,
              source: 'stripe',
              external_event_id: 'evt-cloud-grant',
              cloud_order_id: 'order-cloud-grant',
              cloud_redemption_id: null,
              code: null,
              bytes: 512,
              package_snapshot: null,
              granted_by: null,
              terminal_user_id: null,
              terminal_user_email: null,
              active: true,
              created_at: '2026-05-06T00:00:00.000Z',
            },
          ],
        } as Response
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ orderId: 'order-cloud-1', url: 'https://cloud.example/checkout', ok: true }),
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
  it('parses Cloud package and storage-code response shapes', () => {
    expect(
      cloudPackageResponseSchema.parse({
        id: 'pkg-snake',
        name: 'Snake Package',
        description: null,
        resource_type: 'traffic',
        resource_bytes: 2048,
        prices: [{ currency: 'cny', unit_amount: 3600 }],
        active: true,
        sort_order: 4,
        created_at: '2026-05-06T00:00:00.000Z',
        updated_at: '2026-05-06T00:00:00.000Z',
      }),
    ).toEqual({
      id: 'pkg-snake',
      name: 'Snake Package',
      description: '',
      resourceType: 'traffic',
      resourceBytes: 2048,
      prices: [{ currency: 'cny', amount: 3600 }],
      active: true,
      sortOrder: 4,
      createdAt: '2026-05-06T00:00:00.000Z',
      updatedAt: '2026-05-06T00:00:00.000Z',
    })

    expect(
      cloudStorageCodesResponseSchema.parse([
        cloudStorageCode({
          code: 'ZS11-ACTV-0000-0001',
          resourceType: 'storage',
          bytes: 4096,
          maxUses: 2,
          usesCount: 1,
        }),
      ]),
    ).toEqual([
      {
        code: 'ZS11-ACTV-0000-0001',
        resourceType: 'storage',
        resourceBytes: 4096,
        maxUses: 2,
        usesCount: 1,
        expiresAt: null,
        createdAt: '2026-05-06T00:00:00.000Z',
        revokedAt: null,
      },
    ])
  })

  it('surfaces unexpected store settings load errors', async () => {
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => {
              throw new Error('settings read failed')
            },
          }),
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

    const res = await app.request('/api/admin/quota-store/packages', { headers })

    expect(res.status).toBe(402)
  })

  it('returns 402 for Cloud delivery when Pro quota_store is absent', async () => {
    const { app, db } = await createTestApp()
    await seedSettingsRow(db)
    const payload = JSON.stringify({
      eventId: 'evt-no-pro',
      cloudOrderId: 'order-no-pro',
      targetOrgId: 'org-no-pro',
      source: 'stripe',
      resourceType: 'storage',
      operation: 'increase',
      resourceBytes: 1024,
    })

    const res = await postWebhook(app, payload)

    expect(res.status).toBe(402)
  })

  it('validates package resource bytes and prices', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)

    const res = await app.request('/api/admin/quota-store/packages', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Bad', description: '', resourceType: 'storage', resourceBytes: 0, prices: [] }),
    })

    expect(res.status).toBe(400)
  })

  it('reads and updates quota store settings', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)

    const empty = await app.request('/api/admin/quota-store/settings', { headers })
    await seedSettings(app, headers)
    const filled = await app.request('/api/admin/quota-store/settings', { headers })

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

    const updated = await app.request('/api/admin/quota-store/settings', {
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

    const settings = await getQuotaStoreSettings(db)

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

    const created = await app.request('/api/admin/quota-store/packages', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Small',
        description: 'starter',
        resourceType: 'storage',
        resourceBytes: 4096,
        prices: [{ currency: 'usd', amount: 500 }],
      }),
    })
    const listed = await app.request('/api/admin/quota-store/packages', { headers })

    expect(created.status).toBe(201)
    await expect(created.json()).resolves.toMatchObject({ id: 'cloud-pkg-1', name: 'Small' })
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [URL, RequestInit]
    const body = String(init.body)
    expect(String(url)).toBe(`${ZPAN_CLOUD_URL_DEFAULT}/api/store/packages`)
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${REFRESH_TOKEN}`)
    expect(JSON.parse(body)).toMatchObject({
      name: 'Small',
      description: 'starter',
      resourceType: 'storage',
      resourceBytes: 4096,
      prices: [{ currency: 'usd', amount: 500 }],
    })
    expect(JSON.parse(body)).not.toHaveProperty('callbackUrl')
    expect(listed.status).toBe(200)
    await expect(listed.json()).resolves.toMatchObject({
      total: 2,
      items: [
        { id: 'cloud-pkg-1', active: true },
        { id: 'cloud-pkg-inactive', active: false },
      ],
    })
  })

  it('accepts Cloud package object lists and compatibility PUT updates', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        items: [
          {
            id: 'cloud-pkg-object',
            name: 'Object Shape',
            description: null,
            resourceType: 'traffic',
            resourceBytes: 4096,
            prices: [
              { currency: 'usd', amount: 500 },
              { currency: 'cny', amount: 3600 },
            ],
            active: true,
            sortOrder: 3,
            createdAt: '2026-05-06T00:00:00.000Z',
            updatedAt: '2026-05-06T00:00:00.000Z',
          },
        ],
      }),
    } as Response)

    const listed = await app.request('/api/admin/quota-store/packages', { headers })
    const updated = await app.request('/api/admin/quota-store/packages/cloud-pkg-object', {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Updated',
        description: '',
        resourceType: 'traffic',
        resourceBytes: 8192,
        prices: [{ currency: 'cny', amount: 900 }],
      }),
    })

    expect(listed.status).toBe(200)
    await expect(listed.json()).resolves.toMatchObject({
      total: 1,
      items: [{ id: 'cloud-pkg-object', description: '', resourceType: 'traffic', sortOrder: 3 }],
    })
    expect(updated.status).toBe(200)
    const [, updateInit] = vi.mocked(fetch).mock.calls[1] as [URL, RequestInit]
    expect(updateInit.method).toBe('PATCH')
    expect(JSON.parse(updateInit.body as string)).toEqual({
      name: 'Updated',
      description: '',
      resourceType: 'traffic',
      resourceBytes: 8192,
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

    const res = await app.request('/api/admin/quota-store/packages/cloud-pkg-1', { headers })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ id: 'cloud-pkg-1', active: true })
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [URL, RequestInit]
    expect(String(url)).toBe(`${ZPAN_CLOUD_URL_DEFAULT}/api/store/packages/cloud-pkg-1`)
    expect(init.method).toBe('GET')
  })

  it('does not send callback URLs during package create', async () => {
    const { app, db } = await createTestApp({ ZPAN_PUBLIC_ORIGIN: 'https://zpan.example/custom-path' })
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)

    const created = await app.request('/api/admin/quota-store/packages', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Configured',
        description: '',
        resourceType: 'storage',
        resourceBytes: 4096,
        prices: [{ currency: 'usd', amount: 500 }],
      }),
    })

    expect(created.status).toBe(201)
    const [, init] = vi.mocked(fetch).mock.calls[0] as [URL, RequestInit]
    expect(JSON.parse(init.body as string)).not.toHaveProperty('callbackUrl')
  })

  it('ignores spoofed forwarded origin for Cloud checkout return URLs', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await authedHeaders(app, 'buyer@example.com')
    await seedSettings(app, headers)
    const orgId = await getFirstOrgId(db)
    const packageId = await seedPackage(db)

    const checkout = await app.request('/api/quota-store/checkout', {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'attacker.example',
      },
      body: JSON.stringify({ packageId, targetOrgId: orgId }),
    })

    expect(checkout.status).toBe(200)
    const [, init] = vi.mocked(fetch).mock.calls[0] as [URL, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body).toMatchObject({
      successUrl: 'http://localhost/storage',
      cancelUrl: 'http://localhost/storage',
    })
  })

  it('does not use forwarded origins during package create', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)

    const created = await app.request('/api/admin/quota-store/packages', {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
        'x-forwarded-proto': 'http',
        'x-forwarded-host': 'localhost',
      },
      body: JSON.stringify({
        name: 'Bad Proto',
        description: '',
        resourceType: 'storage',
        resourceBytes: 4096,
        prices: [{ currency: 'usd', amount: 500 }],
      }),
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
    const orgId = await getFirstOrgId(db)
    const packageId = await seedPackage(db)

    const checkout = await app.request('/api/quota-store/checkout', {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
        'x-forwarded-proto': 'http',
        'x-forwarded-host': 'localhost',
      },
      body: JSON.stringify({ packageId, targetOrgId: orgId }),
    })

    expect(checkout.status).toBe(200)
    const [, checkoutInit] = vi.mocked(fetch).mock.calls[0] as [URL, RequestInit]
    const checkoutBody = JSON.parse(String(checkoutInit.body))
    expect(checkoutBody).toMatchObject({
      successUrl: 'http://localhost/storage',
      cancelUrl: 'http://localhost/storage',
    })
  })

  it('uses https origin for non-local http request URLs', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await authedHeaders(app, 'buyer@example.com')
    await seedSettings(app, headers)
    const orgId = await getFirstOrgId(db)
    const packageId = await seedPackage(db)

    const checkout = await app.request('http://files.example.com/api/quota-store/checkout', {
      method: 'POST',
      headers: { ...headers, Host: 'localhost', 'Content-Type': 'application/json' },
      body: JSON.stringify({ packageId, targetOrgId: orgId }),
    })

    expect(checkout.status).toBe(200)
    const [, checkoutInit] = vi.mocked(fetch).mock.calls[0] as [URL, RequestInit]
    const checkoutBody = JSON.parse(String(checkoutInit.body))
    expect(checkoutBody).toMatchObject({
      successUrl: 'https://files.example.com/storage',
      cancelUrl: 'https://files.example.com/storage',
    })
  })

  it('uses configured auth URL origin for checkout return URLs', async () => {
    const { app, db } = await createTestApp({ BETTER_AUTH_URL: 'https://auth.example.com/path' })
    await seedProLicense(db)
    const headers = await authedHeaders(app, 'buyer@example.com')
    await seedSettings(app, headers)
    const orgId = await getFirstOrgId(db)
    const packageId = await seedPackage(db)

    const checkout = await app.request('/api/quota-store/checkout', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ packageId, targetOrgId: orgId }),
    })

    expect(checkout.status).toBe(200)
    const [, checkoutInit] = vi.mocked(fetch).mock.calls[0] as [URL, RequestInit]
    const checkoutBody = JSON.parse(String(checkoutInit.body))
    expect(checkoutBody).toMatchObject({
      successUrl: 'https://auth.example.com/storage',
      cancelUrl: 'https://auth.example.com/storage',
    })
  })

  it('falls back to request origin when public origin env is invalid', async () => {
    const { app, db } = await createTestApp({ ZPAN_PUBLIC_ORIGIN: 'not a url' })
    await seedProLicense(db)
    const headers = await authedHeaders(app, 'buyer@example.com')
    await seedSettings(app, headers)
    const orgId = await getFirstOrgId(db)
    const packageId = await seedPackage(db)

    const checkout = await app.request('/api/quota-store/checkout', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ packageId, targetOrgId: orgId }),
    })

    expect(checkout.status).toBe(200)
    const [, checkoutInit] = vi.mocked(fetch).mock.calls[0] as [URL, RequestInit]
    const checkoutBody = JSON.parse(String(checkoutInit.body))
    expect(checkoutBody).toMatchObject({
      successUrl: 'http://localhost/storage',
      cancelUrl: 'http://localhost/storage',
    })
  })

  it('falls back to request origin when public origin env uses an unsupported scheme', async () => {
    const { app, db } = await createTestApp({ ZPAN_PUBLIC_ORIGIN: 'ftp://files.example.com' })
    await seedProLicense(db)
    const headers = await authedHeaders(app, 'buyer@example.com')
    await seedSettings(app, headers)
    const orgId = await getFirstOrgId(db)
    const packageId = await seedPackage(db)

    const checkout = await app.request('/api/quota-store/checkout', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ packageId, targetOrgId: orgId }),
    })

    expect(checkout.status).toBe(200)
    const [, checkoutInit] = vi.mocked(fetch).mock.calls[0] as [URL, RequestInit]
    const checkoutBody = JSON.parse(String(checkoutInit.body))
    expect(checkoutBody).toMatchObject({
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

    const res = await app.request('/api/admin/quota-store/packages', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Small',
        description: '',
        resourceType: 'storage',
        resourceBytes: 4096,
        prices: [{ currency: 'usd', amount: 500 }],
      }),
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

    const res = await app.request('/api/admin/quota-store/packages', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Small',
        description: '',
        resourceType: 'storage',
        resourceBytes: 4096,
        prices: [{ currency: 'usd', amount: 500 }],
      }),
    })

    expect(res.status).toBe(502)
    await expect(res.json()).resolves.toEqual({ error: 'invalid_cloud_response' })
  })

  it('rejects price currencies Cloud does not accept', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)

    const res = await app.request('/api/admin/quota-store/packages', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Euro',
        description: '',
        resourceType: 'storage',
        resourceBytes: 4096,
        prices: [{ currency: 'eur', amount: 500 }],
      }),
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

    const res = await app.request('/api/admin/quota-store/packages', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Small',
        description: '',
        resourceType: 'storage',
        resourceBytes: 4096,
        prices: [{ currency: 'usd', amount: 500 }],
      }),
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

    const res = await app.request(`/api/admin/quota-store/packages/${packageId}`, {
      method: 'DELETE',
      headers,
    })

    expect(res.status).toBe(200)
    const calls = vi.mocked(fetch).mock.calls
    const [url, init] = calls[calls.length - 1] as [URL, RequestInit]
    expect(String(url)).toBe(`${ZPAN_CLOUD_URL_DEFAULT}/api/store/packages/${packageId}`)
    expect(init.method).toBe('DELETE')
  })

  it('proxies admin storage code management through the bound Cloud API', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)

    const generated = await app.request('/api/admin/quota-store/storage-codes', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        resourceType: 'traffic',
        resourceBytes: 4096,
        maxUses: 3,
        expiresAt: '2026-06-01T00:00:00.000Z',
        count: 2,
      }),
    })
    const listed = await app.request('/api/admin/quota-store/storage-codes?status=active', { headers })
    const revoked = await app.request('/api/admin/quota-store/storage-codes/ZS-GEN-1', { method: 'DELETE', headers })

    expect(generated.status).toBe(201)
    await expect(generated.json()).resolves.toMatchObject({
      total: 2,
      items: [
        { code: 'ZS-GEN-1', resourceType: 'traffic', resourceBytes: 4096 },
        { code: 'ZS-GEN-2', resourceType: 'traffic', resourceBytes: 4096 },
      ],
    })
    expect(listed.status).toBe(200)
    await expect(listed.json()).resolves.toMatchObject({
      total: 1,
      items: [{ code: 'ZS-LIST-1', resourceType: 'storage', resourceBytes: 2048, maxUses: 2 }],
    })
    expect(revoked.status).toBe(200)
    await expect(revoked.json()).resolves.toEqual({ code: 'ZS-GEN-1', deleted: true })

    const calls = vi.mocked(fetch).mock.calls as Array<[URL, RequestInit]>
    const [generateUrl, generateInit] = calls[0]
    const [listUrl, listInit] = calls[1]
    const [revokeUrl, revokeInit] = calls[2]
    expect(String(generateUrl)).toBe(`${ZPAN_CLOUD_URL_DEFAULT}/api/store/storage-codes`)
    expect(generateInit.headers).toMatchObject({ Authorization: `Bearer ${REFRESH_TOKEN}` })
    expect(JSON.parse(generateInit.body as string)).toEqual({
      resourceType: 'traffic',
      bytes: 4096,
      max_uses: 3,
      expires_at: '2026-06-01T00:00:00.000Z',
      count: 2,
    })
    expect(String(listUrl)).toBe(`${ZPAN_CLOUD_URL_DEFAULT}/api/store/storage-codes?status=active`)
    expect(listInit.headers).toMatchObject({ Authorization: `Bearer ${REFRESH_TOKEN}` })
    expect(String(revokeUrl)).toBe(`${ZPAN_CLOUD_URL_DEFAULT}/api/store/storage-codes/ZS-GEN-1`)
    expect(revokeInit.method).toBe('DELETE')
  })

  it('patches admin storage code state through Cloud', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({}),
    } as Response)

    const res = await app.request('/api/admin/quota-store/storage-codes/ZS-GEN-1', {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ revoked: true }),
    })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ code: 'ZS-GEN-1', revoked: true })
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [URL, RequestInit]
    expect(String(url)).toBe(`${ZPAN_CLOUD_URL_DEFAULT}/api/store/storage-codes/ZS-GEN-1`)
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body as string)).toEqual({ revoked: true })
  })

  it('rejects non-admin storage code management', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const admin = await adminHeaders(app)
    await seedSettings(app, admin)
    const headers = await authedHeaders(app, 'buyer@example.com')

    const res = await app.request('/api/admin/quota-store/storage-codes', { headers })

    expect(res.status).toBe(403)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('proxies admin delivery records from Cloud grants', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)

    const res = await app.request('/api/admin/quota-store/delivery-records', { headers })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ total: 1, items: [{ id: 'cloud-grant-1', bytes: 512 }] })
    const [url] = vi.mocked(fetch).mock.calls[0] as [URL, RequestInit]
    expect(String(url)).toBe(`${ZPAN_CLOUD_URL_DEFAULT}/api/store/grants`)
  })

  it('updates packages through Cloud', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)

    const res = await app.request('/api/admin/quota-store/packages/cloud-pkg-1', {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Small',
        description: '',
        resourceType: 'storage',
        resourceBytes: 4096,
        prices: [{ currency: 'usd', amount: 500 }],
      }),
    })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ id: 'cloud-pkg-1', name: 'Small' })
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [URL, RequestInit]
    expect(String(url)).toBe(`${ZPAN_CLOUD_URL_DEFAULT}/api/store/packages/cloud-pkg-1`)
    expect(init.method).toBe('PATCH')
  })

  it('publishes and unpublishes packages through partial Cloud patches', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)

    const res = await app.request('/api/admin/quota-store/packages/cloud-pkg-1', {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: false }),
    })

    expect(res.status).toBe(200)
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [URL, RequestInit]
    expect(String(url)).toBe(`${ZPAN_CLOUD_URL_DEFAULT}/api/store/packages/cloud-pkg-1`)
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

    const res = await app.request('/api/admin/quota-store/packages/cloud-pkg-1', {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Small',
        description: '',
        resourceType: 'storage',
        resourceBytes: 4096,
        prices: [{ currency: 'usd', amount: 500 }],
      }),
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

    const res = await app.request('/api/admin/quota-store/packages/cloud-pkg-1', {
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

    const res = await app.request('/api/quota-store/checkout', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ packageId: 'pkg-1', targetOrgId: 'other-org' }),
    })

    expect(res.status).toBe(403)
  })

  it('rejects checkouts target orgs the user cannot access', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await authedHeaders(app, 'buyer@example.com')
    await seedSettings(app, headers)

    const res = await app.request('/api/quota-store/checkouts', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ packageId: 'cloud-pkg-1', targetOrgId: 'other-org' }),
    })

    expect(res.status).toBe(403)
  })

  it('rejects redemption target orgs the user cannot access', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await authedHeaders(app, 'buyer@example.com')
    await seedSettings(app, headers)

    const res = await app.request('/api/quota-store/redemptions', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'CODE-NOPE', targetOrgId: 'other-org' }),
    })

    expect(res.status).toBe(403)
  })

  it('lists purchasable packages, targets, checkout, redemptions, and grants', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await authedHeaders(app, 'buyer@example.com')
    await seedSettings(app, headers)
    const orgId = await getFirstOrgId(db)
    const packageId = await seedPackage(db)

    const packages = await app.request('/api/quota-store/packages', { headers })
    const targets = await app.request('/api/quota-store/targets', { headers })
    const checkout = await app.request('/api/quota-store/checkouts', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ packageId, targetOrgId: orgId, currency: 'cny' }),
    })
    const redemption = await app.request('/api/quota-store/redemptions', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'CODE-OK', targetOrgId: orgId }),
    })
    const grants = await app.request('/api/quota-store/grants', { headers })

    expect(packages.status).toBe(200)
    await expect(packages.json()).resolves.toMatchObject({
      total: 1,
      items: [{ id: 'cloud-pkg-1', active: true }],
    })
    expect(targets.status).toBe(200)
    await expect(targets.json()).resolves.toMatchObject({ total: 1, items: [{ orgId, type: 'personal' }] })
    expect(checkout.status).toBe(200)
    await expect(checkout.json()).resolves.toEqual({ checkoutUrl: 'https://cloud.example/checkout' })
    expect(redemption.status).toBe(200)
    await expect(redemption.json()).resolves.toMatchObject({ ok: true })
    const calls = vi.mocked(fetch).mock.calls as Array<[URL, RequestInit]>
    const [checkoutUrl, checkoutInit] = calls.find(([url]) => String(url).includes('/api/store/checkouts'))!
    const [redemptionUrl, redemptionInit] = calls.find(([url]) => String(url).includes('/api/store/redemptions'))!
    const checkoutBody = JSON.parse(String(checkoutInit.body))
    const redemptionBody = JSON.parse(String(redemptionInit.body))
    expect(String(checkoutUrl)).toBe(`${ZPAN_CLOUD_URL_DEFAULT}/api/store/checkouts`)
    expect(String(redemptionUrl)).toBe(`${ZPAN_CLOUD_URL_DEFAULT}/api/store/redemptions`)
    expect(checkoutInit.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${REFRESH_TOKEN}`,
    })
    expect(redemptionInit.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${REFRESH_TOKEN}`,
    })
    expect(checkoutBody).toMatchObject({
      boundLicenseId: 'test-binding',
      packageId,
      targetOrgId: orgId,
      currency: 'cny',
      terminalUserId: expect.any(String),
      terminalUserLabel: 'buyer@example.com',
      successUrl: 'http://localhost/storage',
      cancelUrl: 'http://localhost/storage',
    })
    expect(checkoutBody).not.toHaveProperty('session')
    expect(redemptionBody).toMatchObject({
      boundLicenseId: 'test-binding',
      code: 'CODE-OK',
      targetOrgId: orgId,
      terminalUserId: expect.any(String),
      terminalUserLabel: 'buyer@example.com',
    })
    expect(redemptionBody).not.toHaveProperty('session')
    expect(grants.status).toBe(200)
    await expect(grants.json()).resolves.toMatchObject({
      total: 1,
      items: [{ id: 'cloud-grant-1', orgId, bytes: 512 }],
    })
    const [grantsUrl] = calls.find(([url]) => String(url).includes('/api/store/grants'))!
    expect(String(grantsUrl)).toContain(`targetOrgIds=${encodeURIComponent(orgId)}`)
  })

  it('hides self-service packages when the store is disabled', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await authedHeaders(app, 'buyer@example.com')
    await seedSettings(app, headers)
    await app.request('/api/admin/quota-store/settings', {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        enabled: false,
      }),
    })

    const orgId = await getFirstOrgId(db)
    const packageId = await seedPackage(db)
    const packages = await app.request('/api/quota-store/packages', { headers })
    const targets = await app.request('/api/quota-store/targets', { headers })
    const checkout = await app.request('/api/quota-store/checkout', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ packageId, targetOrgId: orgId }),
    })
    const redemption = await app.request('/api/quota-store/redemptions', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'CODE-OK', targetOrgId: orgId }),
    })
    const grants = await app.request('/api/quota-store/grants', { headers })

    expect(packages.status).toBe(403)
    await expect(packages.json()).resolves.toEqual({ error: 'quota_store_disabled' })
    expect(targets.status).toBe(403)
    await expect(targets.json()).resolves.toEqual({ error: 'quota_store_disabled' })
    expect(checkout.status).toBe(403)
    await expect(checkout.json()).resolves.toEqual({ error: 'quota_store_disabled' })
    expect(redemption.status).toBe(403)
    await expect(redemption.json()).resolves.toEqual({ error: 'quota_store_disabled' })
    expect(grants.status).toBe(403)
    await expect(grants.json()).resolves.toEqual({ error: 'quota_store_disabled' })
  })

  it('hides self-service store endpoints until Cloud is bound', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await authedHeaders(app, 'buyer@example.com')
    await seedSettings(app, headers)
    await db.run(sql`UPDATE license_bindings SET refresh_token = NULL`)

    const orgId = await getFirstOrgId(db)
    const packageId = await seedPackage(db)
    const packages = await app.request('/api/quota-store/packages', { headers })
    const targets = await app.request('/api/quota-store/targets', { headers })
    const checkout = await app.request('/api/quota-store/checkout', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ packageId, targetOrgId: orgId }),
    })
    const redemption = await app.request('/api/quota-store/redemptions', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'CODE-OK', targetOrgId: orgId }),
    })
    const grants = await app.request('/api/quota-store/grants', { headers })

    expect(packages.status).toBe(402)
    await expect(packages.json()).resolves.toMatchObject({ error: 'feature_not_available', feature: 'quota_store' })
    expect(targets.status).toBe(402)
    await expect(targets.json()).resolves.toMatchObject({ error: 'feature_not_available', feature: 'quota_store' })
    expect(checkout.status).toBe(402)
    await expect(checkout.json()).resolves.toMatchObject({ error: 'feature_not_available', feature: 'quota_store' })
    expect(redemption.status).toBe(402)
    await expect(redemption.json()).resolves.toMatchObject({ error: 'feature_not_available', feature: 'quota_store' })
    expect(grants.status).toBe(402)
    await expect(grants.json()).resolves.toMatchObject({ error: 'feature_not_available', feature: 'quota_store' })
  })

  it('rejects malformed successful checkout responses', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await authedHeaders(app, 'buyer@example.com')
    await seedSettings(app, headers)
    const orgId = await getFirstOrgId(db)
    const packageId = await seedPackage(db)
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) } as Response)

    const res = await app.request('/api/quota-store/checkout', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ packageId, targetOrgId: orgId }),
    })

    expect(res.status).toBe(502)
    await expect(res.json()).resolves.toEqual({ error: 'invalid_cloud_response' })
  })

  it('surfaces Cloud checkout error responses', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await authedHeaders(app, 'buyer@example.com')
    await seedSettings(app, headers)
    const orgId = await getFirstOrgId(db)
    const packageId = await seedPackage(db)
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({ error: 'cloud_down' }),
    } as Response)

    const res = await app.request('/api/quota-store/checkout', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ packageId, targetOrgId: orgId }),
    })

    expect(res.status).toBe(502)
    await expect(res.json()).resolves.toEqual({ error: 'cloud_down' })
  })

  it('uses status errors when Cloud checkout error bodies have no string error', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await authedHeaders(app, 'buyer@example.com')
    await seedSettings(app, headers)
    const orgId = await getFirstOrgId(db)
    const packageId = await seedPackage(db)
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 504,
      json: async () => ({ error: 504 }),
    } as Response)

    const res = await app.request('/api/quota-store/checkout', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ packageId, targetOrgId: orgId }),
    })

    expect(res.status).toBe(502)
    await expect(res.json()).resolves.toEqual({ error: 'cloud_request_failed_504' })
  })

  it('accepts current Cloud delivery tokens with audience equal to instance id', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)
    const orgId = await getFirstOrgId(db)
    const payload = JSON.stringify({
      eventId: 'evt-cloud-pr-15-token',
      cloudOrderId: 'order-cloud-pr-15-token',
      targetOrgId: orgId,
      resourceType: 'storage',
      operation: 'increase',
      resourceBytes: 4096,
      source: 'stripe',
    })

    const res = await postWebhook(app, payload)

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ success: true, duplicate: false })
  })

  it("accepts Cloud PR #16 delivery tokens with audience='license_1' and boundLicenseId='binding_1'", async () => {
    const { app, db } = await createTestApp()
    await seedCloudPr16License(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)
    const orgId = await getFirstOrgId(db)
    const payload = JSON.stringify({
      eventId: 'evt-cloud-pr-16-token',
      cloudOrderId: 'order-cloud-pr-16-token',
      targetOrgId: orgId,
      resourceType: 'storage',
      operation: 'increase',
      resourceBytes: 4096,
      source: 'stripe',
    })

    const res = await app.request('/api/quota-store/webhooks/cloud', {
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

  it('valid Cloud delivery updates org quota once and records audit', async () => {
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
      resourceType: 'storage',
      operation: 'increase',
      resourceBytes: 4096,
      source: 'stripe',
    })

    const first = await postWebhook(app, payload)
    const duplicate = await postWebhook(app, payload)

    expect(first.status).toBe(200)
    await expect(first.json()).resolves.toMatchObject({ success: true, duplicate: false })
    expect(duplicate.status).toBe(200)
    await expect(duplicate.json()).resolves.toMatchObject({ success: true, duplicate: true, eventId: 'evt-1' })
    const events = await db.all<{ status: string; error: string | null; processedAt: number | null }>(
      sql`SELECT status, error, processed_at AS processedAt FROM quota_delivery_events WHERE event_id = 'evt-1'`,
    )
    expect(events).toEqual([{ status: 'processed', error: null, processedAt: expect.any(Number) }])

    const quotaRes = await app.request('/api/quotas/me', { headers })
    const quota = (await quotaRes.json()) as { baseQuota: number; grantedQuota: number; quota: number }
    expect(quota.grantedQuota).toBe(0)
    expect(quota.quota).toBe(before[0].quota + 4096)
    const audit = await db.all<{ action: string; metadata: string }>(
      sql`SELECT action, metadata FROM activity_events WHERE org_id = ${orgId} ORDER BY created_at DESC LIMIT 1`,
    )
    expect(audit[0].action).toBe('quota_storage_increase')
    expect(JSON.parse(audit[0].metadata)).toMatchObject({ eventId: 'evt-1', resourceBytes: 4096 })
  })

  it('applies storage decreases without going below zero', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)
    const orgId = await getFirstOrgId(db)
    await db.run(sql`UPDATE org_quotas SET quota = 2048 WHERE org_id = ${orgId}`)

    const res = await postWebhook(
      app,
      JSON.stringify({
        eventId: 'evt-storage-decrease',
        targetOrgId: orgId,
        resourceType: 'storage',
        operation: 'decrease',
        resourceBytes: 4096,
      }),
    )

    expect(res.status).toBe(200)
    const rows = await db.all<{ quota: number }>(sql`SELECT quota FROM org_quotas WHERE org_id = ${orgId}`)
    expect(rows[0].quota).toBe(0)
  })

  it('applies traffic increases and decreases', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)
    const orgId = await getFirstOrgId(db)

    await postWebhook(
      app,
      JSON.stringify({
        eventId: 'evt-traffic-increase',
        targetOrgId: orgId,
        resourceType: 'traffic',
        operation: 'increase',
        resourceBytes: 4096,
      }),
    )
    await postWebhook(
      app,
      JSON.stringify({
        eventId: 'evt-traffic-decrease',
        targetOrgId: orgId,
        resourceType: 'traffic',
        operation: 'decrease',
        resourceBytes: 1024,
      }),
    )

    const rows = await db.all<{ trafficQuota: number }>(
      sql`SELECT traffic_quota AS trafficQuota FROM org_quotas WHERE org_id = ${orgId}`,
    )
    expect(rows[0].trafficQuota).toBe(3072)
  })

  it('does not apply the same redemption code twice', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)
    const orgId = await getFirstOrgId(db)
    const before = await db.all<{ quota: number }>(sql`SELECT quota FROM org_quotas WHERE org_id = ${orgId}`)

    const first = await postWebhook(
      app,
      JSON.stringify({
        eventId: 'evt-code-first',
        cloudRedemptionId: 'redemption-first',
        targetOrgId: orgId,
        resourceType: 'storage',
        operation: 'increase',
        resourceBytes: 4096,
        source: 'redeem_code',
        code: 'ZS-SAME-CODE',
      }),
    )
    const duplicate = await postWebhook(
      app,
      JSON.stringify({
        eventId: 'evt-code-second',
        cloudRedemptionId: 'redemption-second',
        targetOrgId: orgId,
        resourceType: 'storage',
        operation: 'increase',
        resourceBytes: 4096,
        source: 'redeem_code',
        code: 'ZS-SAME-CODE',
      }),
    )

    expect(first.status).toBe(200)
    expect(duplicate.status).toBe(200)
    await expect(duplicate.json()).resolves.toMatchObject({ success: true, duplicate: true })
    const rows = await db.all<{ quota: number }>(sql`SELECT quota FROM org_quotas WHERE org_id = ${orgId}`)
    expect(rows[0].quota).toBe(before[0].quota + 4096)
    const deliveries = await db.all<{ status: string }>(
      sql`SELECT status FROM quota_delivery_events WHERE code = 'ZS-SAME-CODE'`,
    )
    expect(deliveries).toEqual([{ status: 'processed' }])
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
        resourceType: 'storage',
        operation: 'increase',
        resourceBytes: 4096,
        source: 'stripe',
      }),
    )
    const decrease = await postWebhook(
      app,
      JSON.stringify({
        eventId: 'evt-order-decrease',
        cloudOrderId: 'order-reversal-test',
        targetOrgId: orgId,
        resourceType: 'storage',
        operation: 'decrease',
        resourceBytes: 4096,
        source: 'stripe',
      }),
    )

    expect(increase.status).toBe(200)
    await expect(increase.json()).resolves.toMatchObject({ success: true, duplicate: false })
    expect(decrease.status).toBe(200)
    await expect(decrease.json()).resolves.toMatchObject({ success: true, duplicate: false })

    const rows = await db.all<{ quota: number }>(sql`SELECT quota FROM org_quotas WHERE org_id = ${orgId}`)
    expect(rows[0].quota).toBe(8192)

    const deliveries = await db.all<{ eventId: string; status: string }>(
      sql`SELECT event_id AS eventId, status FROM quota_delivery_events WHERE cloud_order_id = 'order-reversal-test' ORDER BY created_at`,
    )
    expect(deliveries).toEqual([
      { eventId: 'evt-order-increase', status: 'processed' },
      { eventId: 'evt-order-decrease', status: 'processed' },
    ])

    const auditRows = await db.all<{ action: string }>(
      sql`SELECT action FROM activity_events WHERE org_id = ${orgId} ORDER BY created_at DESC LIMIT 2`,
    )
    expect(auditRows.map((r) => r.action)).toContain('quota_storage_decrease')
    expect(auditRows.map((r) => r.action)).toContain('quota_storage_increase')
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
      resourceType: 'storage',
      operation: 'decrease',
      resourceBytes: 2048,
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
        resourceType: 'storage',
        operation: 'decrease',
        resourceBytes: 1024,
        source: 'stripe',
      }),
    )

    const audit = await db.all<{ action: string; metadata: string }>(
      sql`SELECT action, metadata FROM activity_events WHERE org_id = ${orgId} ORDER BY created_at DESC LIMIT 1`,
    )
    expect(audit[0].action).toBe('quota_storage_decrease')
    expect(JSON.parse(audit[0].metadata)).toMatchObject({
      eventId: 'evt-audit-decrease',
      resourceType: 'storage',
      operation: 'decrease',
      resourceBytes: 1024,
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
        resourceType: 'traffic',
        operation: 'increase',
        resourceBytes: 8192,
        source: 'stripe',
      }),
    )
    const decrease = await postWebhook(
      app,
      JSON.stringify({
        eventId: 'evt-traffic-order-dec',
        cloudOrderId: 'order-traffic-reversal',
        targetOrgId: orgId,
        resourceType: 'traffic',
        operation: 'decrease',
        resourceBytes: 8192,
        source: 'stripe',
      }),
    )

    expect(decrease.status).toBe(200)
    await expect(decrease.json()).resolves.toMatchObject({ success: true, duplicate: false })

    const rows = await db.all<{ trafficQuota: number }>(
      sql`SELECT traffic_quota AS trafficQuota FROM org_quotas WHERE org_id = ${orgId}`,
    )
    expect(rows[0].trafficQuota).toBe(0)
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
      resourceType: 'storage',
      operation: 'increase',
      resourceBytes: 4096,
      source: 'stripe',
    })

    const first = await postWebhook(app, payload)
    const retry = await postWebhook(
      app,
      JSON.stringify({
        eventId: 'evt-hash-conflict',
        cloudOrderId: 'order-hash-conflict',
        targetOrgId: orgId,
        resourceType: 'storage',
        operation: 'increase',
        resourceBytes: 8192,
        source: 'stripe',
      }),
    )

    expect(first.status).toBe(200)
    expect(retry.status).toBe(400)
    await expect(retry.json()).resolves.toEqual({ error: 'delivery_payload_conflict' })
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
      resourceType: 'storage',
      operation: 'increase',
      resourceBytes: 4096,
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
      sql`SELECT status, error FROM quota_delivery_events WHERE event_id = 'evt-failed-same-payload'`,
    )
    expect(deliveries).toEqual([{ status: 'processed', error: null }])
  })

  it('rejects missing Cloud delivery auth', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)

    const res = await app.request('/api/quota-store/webhooks/cloud', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ eventId: 'evt-bad' }),
    })

    expect(res.status).toBe(401)
  })

  it('rejects malformed Cloud delivery event tokens', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)
    const payload = JSON.stringify({ eventId: 'evt-bad-token' })

    const res = await app.request('/api/quota-store/webhooks/cloud', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-zpan-cloud-event-token': 'bad-token',
      },
      body: payload,
    })

    expect(res.status).toBe(401)
  })

  it('rejects Cloud delivery event tokens with the wrong purpose', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)
    const payload = JSON.stringify({ eventId: 'evt-wrong-purpose' })

    const res = await app.request('/api/quota-store/webhooks/cloud', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(await signedWebhookHeaders(payload, { purpose: 'quota_store.other' })),
      },
      body: payload,
    })

    expect(res.status).toBe(401)
  })

  it('rejects expired Cloud delivery event tokens', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)
    const payload = JSON.stringify({ eventId: 'evt-expired-token' })
    const now = Math.floor(Date.now() / 1000)

    const res = await app.request('/api/quota-store/webhooks/cloud', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(await signedWebhookHeaders(payload, { issuedAt: now - 120, expiresAt: now - 60 })),
      },
      body: payload,
    })

    expect(res.status).toBe(401)
  })

  it('rejects Cloud delivery event tokens without issuedAt', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)
    const payload = JSON.stringify({ eventId: 'evt-missing-issued-at' })

    const res = await app.request('/api/quota-store/webhooks/cloud', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(await signedWebhookHeaders(payload, { issuedAt: undefined })),
      },
      body: payload,
    })

    expect(res.status).toBe(401)
  })

  it('rejects Cloud delivery event tokens with future issuedAt and no notBefore', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)
    const payload = JSON.stringify({ eventId: 'evt-future-issued-at' })
    const issuedAt = Math.floor(Date.now() / 1000) + 60

    const res = await app.request('/api/quota-store/webhooks/cloud', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(await signedWebhookHeaders(payload, { issuedAt, notBefore: undefined, expiresAt: issuedAt + 60 })),
      },
      body: payload,
    })

    expect(res.status).toBe(401)
  })

  it('rejects Cloud delivery event tokens with an overlong TTL', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)
    const payload = JSON.stringify({ eventId: 'evt-overlong-token' })
    const issuedAt = Math.floor(Date.now() / 1000)

    const res = await app.request('/api/quota-store/webhooks/cloud', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(await signedWebhookHeaders(payload, { issuedAt, expiresAt: issuedAt + 301 })),
      },
      body: payload,
    })

    expect(res.status).toBe(401)
  })

  it('rejects Cloud delivery event tokens with the wrong payload hash', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)
    const payload = JSON.stringify({ eventId: 'evt-wrong-hash' })

    const res = await app.request('/api/quota-store/webhooks/cloud', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(await signedWebhookHeaders(payload, { payloadHash: '0'.repeat(64) })),
      },
      body: payload,
    })

    expect(res.status).toBe(401)
  })

  it('rejects Cloud delivery event tokens with a mismatched event id', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)
    const payload = JSON.stringify({
      eventId: 'evt-body-id',
      cloudOrderId: 'order-event-id',
      targetOrgId: await getFirstOrgId(db),
      resourceType: 'storage',
      operation: 'increase',
      resourceBytes: 4096,
      source: 'stripe',
    })

    const res = await app.request('/api/quota-store/webhooks/cloud', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(await signedWebhookHeaders(payload, { eventId: 'evt-token-id' })),
      },
      body: payload,
    })

    expect(res.status).toBe(401)
  })

  it('rejects Cloud delivery event tokens with the wrong audience', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)
    const payload = JSON.stringify({ eventId: 'evt-wrong-audience' })

    const res = await app.request('/api/quota-store/webhooks/cloud', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(await signedWebhookHeaders(payload, { audience: 'test-binding' })),
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

  it('rejects redemption deliveries without a Cloud redemption id', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)
    const payload = JSON.stringify({
      eventId: 'evt-no-code',
      targetOrgId: await getFirstOrgId(db),
      resourceType: 'storage',
      operation: 'increase',
      resourceBytes: 4096,
      source: 'redeem_code',
    })

    const res = await postWebhook(app, payload)

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: 'invalid_payload' })
  })
})

async function seedSettings(app: Awaited<ReturnType<typeof createTestApp>>['app'], headers: Record<string, string>) {
  await app.request('/api/admin/quota-store/settings', {
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
  const now = Date.now()
  await db.run(sql`
    INSERT INTO quota_store_settings
      (id, enabled, created_at, updated_at)
    VALUES ('default', 1, ${now}, ${now})
  `)
}

async function postWebhook(app: Awaited<ReturnType<typeof createTestApp>>['app'], payload: string) {
  return app.request('/api/quota-store/webhooks/cloud', {
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
    purpose: 'quota_store.delivery',
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
    edition: 'pro',
    authorizedHosts: ['localhost'],
    licenseValidUntil: issuedAt + 365 * 24 * 60 * 60,
    issuedAt,
    notBefore: issuedAt,
    expiresAt,
  })

  await createLicenseBinding(db, {
    cloudBindingId: 'binding_1',
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
