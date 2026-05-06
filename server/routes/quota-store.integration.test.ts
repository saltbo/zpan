import { sql } from 'drizzle-orm'
import { generateKeys, sign } from 'paseto-ts/v4'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ZPAN_CLOUD_URL_DEFAULT } from '../../shared/constants'
import { PUBLIC_KEYS } from '../licensing/public-keys.js'
import { getQuotaStoreSettings } from '../services/quota-store.js'
import { adminHeaders, authedHeaders, createTestApp, seedProLicense } from '../test/setup.js'

const REFRESH_TOKEN = 'test-refresh-token'
const { secretKey: EVENT_SECRET, publicKey: EVENT_PUBLIC } = generateKeys('public')

beforeEach(() => {
  if (!PUBLIC_KEYS.includes(EVENT_PUBLIC)) PUBLIC_KEYS.unshift(EVENT_PUBLIC)
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { packages?: Array<{ id: string }> }
      return {
        ok: true,
        status: 200,
        json: async () =>
          body.packages
            ? { packages: body.packages.map((pkg) => ({ id: `cloud-${pkg.id}`, externalPackageId: pkg.id })) }
            : { orderId: 'order-cloud-1', url: 'https://cloud.example/checkout', ok: true },
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
      bytes: 1024,
    })

    const res = await postWebhook(app, payload)

    expect(res.status).toBe(402)
  })

  it('validates positive package bytes and amount', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)

    const res = await app.request('/api/admin/quota-store/packages', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Bad', description: '', bytes: 0, amount: 0, currency: 'usd' }),
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
      status: 'store_disabled',
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

  it('creates, lists, and syncs quota store packages', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)

    const created = await app.request('/api/admin/quota-store/packages', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Small', description: 'starter', bytes: 4096, amount: 500, currency: 'usd' }),
    })
    const listed = await app.request('/api/admin/quota-store/packages', { headers })

    expect(created.status).toBe(201)
    await expect(created.json()).resolves.toMatchObject({ syncStatus: 'synced' })
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [URL, RequestInit]
    const syncBody = String(init.body)
    const syncTimestamp = (init.headers as Record<string, string>)['x-zpan-store-timestamp']
    expect(syncTimestamp).toBeUndefined()
    expect(String(url)).toBe(`${ZPAN_CLOUD_URL_DEFAULT}/api/store/packages/sync`)
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${REFRESH_TOKEN}`)
    expect(JSON.parse(syncBody)).toMatchObject({
      boundLicenseId: 'test-binding',
      packages: [{ name: 'Small', description: 'starter', bytes: 4096, amount: 500, currency: 'usd', active: true }],
    })
    expect(JSON.parse(syncBody)).not.toHaveProperty('callbackUrl')
    expect(listed.status).toBe(200)
    await expect(listed.json()).resolves.toMatchObject({ total: 1 })
  })

  it('does not send callback URLs during package sync', async () => {
    const { app, db } = await createTestApp({ ZPAN_PUBLIC_ORIGIN: 'https://zpan.example/custom-path' })
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)

    const created = await app.request('/api/admin/quota-store/packages', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Configured', description: '', bytes: 4096, amount: 500, currency: 'usd' }),
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
      successUrl: 'http://localhost/store',
      cancelUrl: 'http://localhost/store',
    })
  })

  it('does not use forwarded origins during package sync', async () => {
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
      body: JSON.stringify({ name: 'Bad Proto', description: '', bytes: 4096, amount: 500, currency: 'usd' }),
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
      successUrl: 'http://localhost/store',
      cancelUrl: 'http://localhost/store',
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
      successUrl: 'https://files.example.com/store',
      cancelUrl: 'https://files.example.com/store',
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
      successUrl: 'https://auth.example.com/store',
      cancelUrl: 'https://auth.example.com/store',
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
      successUrl: 'http://localhost/store',
      cancelUrl: 'http://localhost/store',
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
      successUrl: 'http://localhost/store',
      cancelUrl: 'http://localhost/store',
    })
  })

  it('surfaces package create sync failures without clearing the local package', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 502, json: async () => ({}) } as Response)

    const res = await app.request('/api/admin/quota-store/packages', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Small', description: '', bytes: 4096, amount: 500, currency: 'usd' }),
    })

    expect(res.status).toBe(202)
    await expect(res.json()).resolves.toMatchObject({ syncStatus: 'failed', syncError: 'cloud_request_failed_502' })
  })

  it('rejects malformed successful package sync responses', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) } as Response)

    const res = await app.request('/api/admin/quota-store/packages', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Small', description: '', bytes: 4096, amount: 500, currency: 'usd' }),
    })

    expect(res.status).toBe(202)
    await expect(res.json()).resolves.toMatchObject({ syncStatus: 'failed', syncError: 'invalid_cloud_response' })
  })

  it('rejects currencies Cloud does not accept', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)

    const res = await app.request('/api/admin/quota-store/packages', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Euro', description: '', bytes: 4096, amount: 500, currency: 'eur' }),
    })

    expect(res.status).toBe(400)
  })

  it('rejects non-json successful package sync responses', async () => {
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
      body: JSON.stringify({ name: 'Small', description: '', bytes: 4096, amount: 500, currency: 'usd' }),
    })

    expect(res.status).toBe(202)
    await expect(res.json()).resolves.toMatchObject({ syncStatus: 'failed', syncError: 'invalid_cloud_response' })
  })

  it('syncs package deletion to Cloud before deleting locally', async () => {
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
    expect(String(url)).toBe(`${ZPAN_CLOUD_URL_DEFAULT}/api/store/packages/sync`)
    expect(JSON.parse(init.body as string)).toMatchObject({
      boundLicenseId: 'test-binding',
      packages: [],
    })
    expect(JSON.parse(init.body as string)).not.toHaveProperty('callbackUrl')
  })

  it('ignores stale Cloud catalog rows when marking packages synced', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)
    vi.mocked(fetch).mockImplementationOnce(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { packages: Array<{ id: string }> }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          packages: [
            { id: 'cloud-pkg-1', externalPackageId: body.packages[0].id },
            { id: 'cloud-deleted', externalPackageId: 'deleted-package' },
          ],
        }),
      } as Response
    })

    const res = await app.request('/api/admin/quota-store/packages', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Small', description: '', bytes: 4096, amount: 500, currency: 'usd' }),
    })

    expect(res.status).toBe(201)
    await expect(res.json()).resolves.toMatchObject({ syncStatus: 'synced' })
  })

  it('preserves existing Cloud package id when update sync fails', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)
    const packageId = await seedPackage(db)
    await db.run(sql`UPDATE quota_store_packages SET cloud_package_id = 'cloud-existing' WHERE id = ${packageId}`)
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: async () => ({ error: 'cloud_down' }),
    } as Response)

    const res = await app.request(`/api/admin/quota-store/packages/${packageId}`, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Small', description: '', bytes: 4096, amount: 500, currency: 'usd' }),
    })

    expect(res.status).toBe(200)
    const rows = await db.all<{ cloudPackageId: string | null }>(
      sql`SELECT cloud_package_id AS cloudPackageId FROM quota_store_packages WHERE id = ${packageId}`,
    )
    expect(rows[0].cloudPackageId).toBe('cloud-existing')
  })

  it('keeps the local package when Cloud deletion sync fails', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)
    const packageId = await seedPackage(db)
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({ error: 'cloud_unavailable' }),
    } as Response)

    const res = await app.request(`/api/admin/quota-store/packages/${packageId}`, {
      method: 'DELETE',
      headers,
    })

    expect(res.status).toBe(502)
    await expect(res.json()).resolves.toEqual({ error: 'cloud_unavailable' })
    const rows = await db.all<{ count: number }>(
      sql`SELECT COUNT(*) AS count FROM quota_store_packages WHERE id = ${packageId}`,
    )
    expect(rows[0].count).toBe(1)
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
    await seedGrant(db, orgId)

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

    expect(packages.status).toBe(200)
    await expect(packages.json()).resolves.toMatchObject({ total: 1 })
    expect(targets.status).toBe(200)
    await expect(targets.json()).resolves.toMatchObject({ total: 1, items: [{ orgId, type: 'personal' }] })
    expect(checkout.status).toBe(200)
    await expect(checkout.json()).resolves.toEqual({ checkoutUrl: 'https://cloud.example/checkout' })
    expect(redemption.status).toBe(200)
    await expect(redemption.json()).resolves.toMatchObject({ ok: true })
    const [checkoutUrl, checkoutInit] = vi.mocked(fetch).mock.calls[0] as [URL, RequestInit]
    const [redemptionUrl, redemptionInit] = vi.mocked(fetch).mock.calls[1] as [URL, RequestInit]
    const checkoutBody = JSON.parse(String(checkoutInit.body))
    const redemptionBody = JSON.parse(String(redemptionInit.body))
    expect(String(checkoutUrl)).toBe(`${ZPAN_CLOUD_URL_DEFAULT}/api/store/checkout`)
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
      externalPackageId: packageId,
      targetOrgId: orgId,
      terminalUserId: expect.any(String),
      terminalUserLabel: 'buyer@example.com',
      amount: 500,
      currency: 'usd',
      bytes: 4096,
      successUrl: 'http://localhost/store',
      cancelUrl: 'http://localhost/store',
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
    await expect(grants.json()).resolves.toMatchObject({ total: 1, items: [{ orgId, bytes: 512 }] })
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
    await seedPackage(db)
    const payload = JSON.stringify({
      eventId: 'evt-cloud-pr-15-token',
      cloudOrderId: 'order-cloud-pr-15-token',
      targetOrgId: orgId,
      packageId: 'cloud-pkg-1',
      source: 'stripe',
      bytes: 4096,
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
    await seedPackage(db)
    const payload = JSON.stringify({
      eventId: 'evt-cloud-pr-16-token',
      cloudOrderId: 'order-cloud-pr-16-token',
      targetOrgId: orgId,
      packageId: 'cloud-pkg-1',
      source: 'stripe',
      bytes: 4096,
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

  it('valid Cloud delivery creates one grant and increases effective quota once', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)
    const orgId = await getFirstOrgId(db)
    const packageId = await seedPackage(db)

    const payload = JSON.stringify({
      eventId: 'evt-1',
      cloudOrderId: 'order-1',
      targetOrgId: orgId,
      packageId: 'cloud-pkg-1',
      source: 'stripe',
      bytes: 4096,
    })

    const first = await postWebhook(app, payload)
    await db.run(sql`UPDATE quota_store_packages SET bytes = 8192 WHERE id = ${packageId}`)
    const duplicate = await postWebhook(app, payload)

    expect(first.status).toBe(200)
    await expect(first.json()).resolves.toMatchObject({ success: true, duplicate: false })
    expect(duplicate.status).toBe(200)
    await expect(duplicate.json()).resolves.toMatchObject({ success: true, duplicate: true, grantId: null })
    const grants = await db.all<{ count: number }>(
      sql`SELECT COUNT(*) AS count FROM quota_grants WHERE org_id = ${orgId}`,
    )
    expect(grants[0].count).toBe(1)
    const events = await db.all<{ status: string; error: string | null; processedAt: number | null }>(
      sql`SELECT status, error, processed_at AS processedAt FROM quota_delivery_events WHERE event_id = 'evt-1'`,
    )
    expect(events).toEqual([{ status: 'processed', error: null, processedAt: expect.any(Number) }])

    const quotaRes = await app.request('/api/quotas/me', { headers })
    const quota = (await quotaRes.json()) as { baseQuota: number; grantedQuota: number; quota: number }
    expect(quota.grantedQuota).toBe(4096)
    expect(quota.quota).toBe(quota.baseQuota + 4096)
  })

  it('marks a new delivery event duplicate when the grant already exists', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)
    const orgId = await getFirstOrgId(db)

    const first = await postWebhook(
      app,
      JSON.stringify({
        eventId: 'evt-code-1',
        cloudRedemptionId: 'redemption-code-1',
        targetOrgId: orgId,
        source: 'redeem_code',
        code: 'CODE-1',
        bytes: 4096,
      }),
    )
    const duplicate = await postWebhook(
      app,
      JSON.stringify({
        eventId: 'evt-code-2',
        cloudRedemptionId: 'redemption-code-2',
        targetOrgId: orgId,
        source: 'redeem_code',
        code: 'CODE-1',
        bytes: 4096,
      }),
    )

    expect(first.status).toBe(200)
    expect(duplicate.status).toBe(200)
    await expect(duplicate.json()).resolves.toMatchObject({ success: true, duplicate: true, grantId: null })
    const events = await db.all<{ eventId: string; status: string; error: string | null }>(
      sql`SELECT event_id AS eventId, status, error FROM quota_delivery_events ORDER BY event_id`,
    )
    expect(events).toEqual([
      { eventId: 'evt-code-1', status: 'processed', error: null },
      { eventId: 'evt-code-2', status: 'duplicate', error: null },
    ])
  })

  it('marks delivery events failed when package validation fails', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)
    const orgId = await getFirstOrgId(db)
    const packageId = await seedPackage(db)
    const payload = JSON.stringify({
      eventId: 'evt-invalid-package',
      cloudOrderId: 'order-invalid-package',
      targetOrgId: orgId,
      packageId: 'cloud-pkg-1',
      source: 'stripe',
      bytes: 8192,
    })

    const res = await postWebhook(app, payload)

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'invalid_package_delivery' })
    const events = await db.all<{ status: string; error: string | null; processedAt: number | null }>(
      sql`
        SELECT status, error, processed_at AS processedAt
        FROM quota_delivery_events
        WHERE event_id = 'evt-invalid-package'
      `,
    )
    expect(events).toEqual([{ status: 'failed', error: 'invalid_package_delivery', processedAt: expect.any(Number) }])

    await db.run(sql`UPDATE quota_store_packages SET bytes = 8192 WHERE id = ${packageId}`)
    const retry = await postWebhook(app, payload)
    expect(retry.status).toBe(200)
    await expect(retry.json()).resolves.toMatchObject({ success: true, duplicate: false })
  })

  it('rejects ambiguous delivery package identifiers', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)
    const orgId = await getFirstOrgId(db)
    const now = Date.now()
    await db.run(sql`
      INSERT INTO quota_store_packages
        (id, name, description, bytes, amount, currency, active, sort_order, cloud_package_id, sync_status, created_at, updated_at)
      VALUES
        ('pkg-cloud-a', 'Cloud package A', '', 4096, 500, 'usd', 1, 1, 'cloud-pkg-ambiguous', 'synced', ${now}, ${now}),
        ('pkg-cloud-b', 'Cloud package B', '', 4096, 500, 'usd', 1, 2, 'cloud-pkg-ambiguous', 'synced', ${now}, ${now})
    `)

    const res = await postWebhook(
      app,
      JSON.stringify({
        eventId: 'evt-ambiguous-package',
        cloudOrderId: 'order-ambiguous-package',
        targetOrgId: orgId,
        packageId: 'cloud-pkg-ambiguous',
        source: 'stripe',
        bytes: 4096,
      }),
    )

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'invalid_package_delivery' })
  })

  it('uses exact local package identifiers before Cloud package identifiers', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)
    const orgId = await getFirstOrgId(db)
    const now = Date.now()
    await db.run(sql`
      INSERT INTO quota_store_packages
        (id, name, description, bytes, amount, currency, active, sort_order, cloud_package_id, sync_status, created_at, updated_at)
      VALUES
        ('pkg-colliding-id', 'Local package', '', 4096, 500, 'usd', 1, 1, 'cloud-local', 'synced', ${now}, ${now}),
        ('pkg-cloud-owner', 'Cloud package', '', 4096, 500, 'usd', 1, 2, 'pkg-colliding-id', 'synced', ${now}, ${now})
    `)

    const res = await postWebhook(
      app,
      JSON.stringify({
        eventId: 'evt-package-id-collision',
        cloudOrderId: 'order-package-id-collision',
        targetOrgId: orgId,
        packageId: 'pkg-colliding-id',
        source: 'stripe',
        bytes: 4096,
      }),
    )

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ success: true, duplicate: false })
    const grants = await db.all<{ count: number }>(
      sql`SELECT COUNT(*) AS count FROM quota_grants WHERE package_snapshot LIKE '%pkg-colliding-id%'`,
    )
    expect(grants[0].count).toBe(1)
  })

  it('marks delivery events failed when grant insertion fails', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)
    const orgId = await getFirstOrgId(db)
    const packageId = await seedPackage(db)
    await db.run(sql`
      CREATE TRIGGER quota_grants_abort_test
      BEFORE INSERT ON quota_grants
      BEGIN
        SELECT RAISE(ABORT, 'grant_insert_failed');
      END
    `)

    const res = await postWebhook(
      app,
      JSON.stringify({
        eventId: 'evt-grant-insert-failed',
        cloudOrderId: 'order-grant-insert-failed',
        targetOrgId: orgId,
        packageId,
        source: 'stripe',
        bytes: 4096,
      }),
    )

    expect(res.status).toBe(400)
    const events = await db.all<{ status: string; error: string | null }>(
      sql`
        SELECT status, error
        FROM quota_delivery_events
        WHERE event_id = 'evt-grant-insert-failed'
      `,
    )
    expect(events).toEqual([{ status: 'failed', error: expect.stringContaining('grant_insert_failed') }])
  })

  it('rejects deliveries when ledger insertion fails', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)
    const orgId = await getFirstOrgId(db)
    const packageId = await seedPackage(db)
    await db.run(sql`
      CREATE TRIGGER quota_delivery_events_abort_test
      BEFORE INSERT ON quota_delivery_events
      BEGIN
        SELECT RAISE(ABORT, 'ledger_insert_failed');
      END
    `)

    const res = await postWebhook(
      app,
      JSON.stringify({
        eventId: 'evt-ledger-insert-failed',
        cloudOrderId: 'order-ledger-insert-failed',
        targetOrgId: orgId,
        packageId,
        source: 'stripe',
        bytes: 4096,
      }),
    )

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: expect.stringContaining('ledger_insert_failed') })
  })

  it('rejects failed delivery retries when the payload hash changes', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)
    const orgId = await getFirstOrgId(db)
    const packageId = await seedPackage(db)
    const payload = JSON.stringify({
      eventId: 'evt-hash-conflict',
      cloudOrderId: 'order-hash-conflict',
      targetOrgId: orgId,
      packageId,
      source: 'stripe',
      bytes: 8192,
    })

    const failed = await postWebhook(app, payload)
    const retry = await postWebhook(
      app,
      JSON.stringify({
        eventId: 'evt-hash-conflict',
        cloudOrderId: 'order-hash-conflict',
        targetOrgId: orgId,
        packageId,
        source: 'stripe',
        bytes: 4096,
      }),
    )

    expect(failed.status).toBe(400)
    expect(retry.status).toBe(400)
    await expect(retry.json()).resolves.toEqual({ error: 'delivery_payload_conflict' })
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
      packageId: await seedPackage(db),
      source: 'stripe',
      bytes: 4096,
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

  it('rejects purchase deliveries without a package id', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    await seedSettings(app, headers)
    const payload = JSON.stringify({
      eventId: 'evt-no-package',
      cloudOrderId: 'order-no-package',
      targetOrgId: await getFirstOrgId(db),
      source: 'stripe',
      bytes: 4096,
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
      source: 'redeem_code',
      bytes: 4096,
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

async function seedPackage(db: Awaited<ReturnType<typeof createTestApp>>['db']): Promise<string> {
  const id = 'pkg-1'
  const now = Date.now()
  await db.run(sql`
    INSERT INTO quota_store_packages
      (id, name, description, bytes, amount, currency, active, sort_order, cloud_package_id, sync_status, created_at, updated_at)
    VALUES (${id}, 'Small', '', 4096, 500, 'usd', 1, 0, 'cloud-pkg-1', 'synced', ${now}, ${now})
  `)
  return id
}

async function seedSettingsRow(db: Awaited<ReturnType<typeof createTestApp>>['db']) {
  const now = Date.now()
  await db.run(sql`
    INSERT INTO quota_store_settings
      (id, enabled, created_at, updated_at)
    VALUES ('default', 1, ${now}, ${now})
  `)
}

async function seedGrant(db: Awaited<ReturnType<typeof createTestApp>>['db'], orgId: string) {
  await db.run(sql`
    INSERT INTO quota_grants
      (id, org_id, source, external_event_id, cloud_order_id, bytes, active, created_at)
    VALUES ('grant-user-list', ${orgId}, 'stripe', 'evt-user-list', 'order-user-list', 512, 1, ${Date.now()})
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
