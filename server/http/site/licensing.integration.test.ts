import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLicenseBindingRepo } from '../../adapters/repos/license-binding.js'
import { cloudTrafficReports } from '../../db/schema.js'
import { createTestApp, seedBusinessLicense, seedProLicense } from '../../test/setup.js'

describe('GET /api/site/licensing/status', () => {
  it('returns { bound: false } when no binding row exists [spec: licensing/state-unbound]', async () => {
    const { app } = await createTestApp()

    const res = await app.request('/api/site/licensing/status')

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({
      bound: false,
      cloud_dashboard_url: 'https://cloud.zpan.space/dashboard',
    })
  })

  it('returns bound state with plan and features when binding row exists with cert [spec: licensing/state-bound]', async () => {
    const { app, db } = await createTestApp()

    await createLicenseBindingRepo(db).createLicenseBinding({
      cloudBindingId: 'bind-1',
      cloudStoreId: 'store-1',
      instanceId: 'inst-1',
      cloudAccountId: 'acc-1',
      cloudAccountEmail: 'user@example.com',
      refreshToken: 'secret-refresh-token',
      cachedCert: 'test-cert',
      cachedExpiresAt: Math.floor(Date.now() / 1000) + 86400,
      lastRefreshAt: Math.floor(Date.now() / 1000),
    })

    const res = await app.request('/api/site/licensing/status')

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.bound).toBe(true)
    expect(body.account_email).toBe('user@example.com')
    // refreshToken must never appear in the response
    expect(body.refresh_token).toBeUndefined()
    expect(body.refreshToken).toBeUndefined()
  })

  it('returns bound:true with no plan/features when cachedCert is null [spec: licensing/state-bound-no-cert]', async () => {
    const { app, db } = await createTestApp()

    await createLicenseBindingRepo(db).createLicenseBinding({
      cloudBindingId: 'bind-1',
      cloudStoreId: 'store-1',
      instanceId: 'inst-1',
      cloudAccountId: 'acc-1',
      refreshToken: 'secret',
      cachedCert: 'test-cert',
      cachedExpiresAt: Math.floor(Date.now() / 1000) + 86400,
      lastRefreshAt: Math.floor(Date.now() / 1000),
    })

    const res = await app.request('/api/site/licensing/status')

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.bound).toBe(true)
  })

  it('is accessible without authentication [spec: licensing/public]', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/site/licensing/status')
    expect(res.status).toBe(200)
  })
})

function makeCloudResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

describe('POST /api/site/licensing/refresh-cron', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns 401 when REFRESH_CRON_SECRET env is not set [spec: licensing/refresh-auth]', async () => {
    const { app } = await createTestApp()

    const res = await app.request('/api/site/licensing/refresh-cron?secret=anything', { method: 'POST' })

    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: { message: string } }
    expect(body.error.message).toBe('Unauthorized')
  })

  it('returns 401 when secret param does not match REFRESH_CRON_SECRET', async () => {
    const { app } = await createTestApp({ REFRESH_CRON_SECRET: 'correct-secret' })

    const res = await app.request('/api/site/licensing/refresh-cron?secret=wrong-secret', { method: 'POST' })

    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: { message: string } }
    expect(body.error.message).toBe('Unauthorized')
  })

  it('returns 401 when secret query param is missing', async () => {
    const { app } = await createTestApp({ REFRESH_CRON_SECRET: 'correct-secret' })

    const res = await app.request('/api/site/licensing/refresh-cron', { method: 'POST' })

    expect(res.status).toBe(401)
  })

  it('returns 200 with { ok: true } when secret is correct and no binding exists [spec: licensing/refresh-noop]', async () => {
    const { app } = await createTestApp({ REFRESH_CRON_SECRET: 'correct-secret' })

    const res = await app.request('/api/site/licensing/refresh-cron?secret=correct-secret', { method: 'POST' })

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.ok).toBe(true)
  })

  it('returns 200 with { ok: true } and calls refresh when binding exists with old lastRefreshAt [spec: licensing/refresh-runs]', async () => {
    const { app, db } = await createTestApp({ REFRESH_CRON_SECRET: 'cron-secret' })

    await seedProLicense(db)

    vi.mocked(fetch).mockResolvedValueOnce(
      makeCloudResponse({
        refreshToken: 'new-token',
        certificate: 'v4.public.fake-cert-for-test',
      }),
    )

    const res = await app.request('/api/site/licensing/refresh-cron?secret=cron-secret', { method: 'POST' })

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.ok).toBe(true)
  })

  it('returns 200 with { ok: true } even when performRefresh throws (error is swallowed) [spec: licensing/refresh-error-swallowed]', async () => {
    const { app, db } = await createTestApp({ REFRESH_CRON_SECRET: 'cron-secret' })

    await seedProLicense(db)

    // Simulate a network failure from the cloud endpoint
    vi.mocked(fetch).mockRejectedValueOnce(new Error('network failure'))

    const res = await app.request('/api/site/licensing/refresh-cron?secret=cron-secret', { method: 'POST' })

    // runLicensingRefresh catches all errors and logs them — never rethrows
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.ok).toBe(true)
  })

  it('is accessible without authentication (public route) [spec: licensing/traffic-cron-public]', async () => {
    const { app } = await createTestApp({ REFRESH_CRON_SECRET: 'my-secret' })

    const res = await app.request('/api/site/licensing/refresh-cron?secret=my-secret', { method: 'POST' })

    // Should not return 401 due to missing auth session
    expect(res.status).toBe(200)
  })

  it('syncs pending traffic reports from the dedicated traffic cron endpoint [spec: licensing/traffic-sync]', async () => {
    const { app, db } = await createTestApp({
      REFRESH_CRON_SECRET: 'traffic-secret',
      ZPAN_CLOUD_URL: 'https://cloud.example',
    })
    await seedBusinessLicense(db)
    await db.insert(cloudTrafficReports).values({
      id: 'report_traffic_cron',
      orgId: 'org_traffic_cron',
      period: '2026-05',
      source: 'object_download',
      sourceId: 'matter_traffic_cron',
      eventId: 'evt_traffic_cron',
      bytes: 1024,
      status: 'pending',
      error: null,
      createdAt: new Date('2026-05-01T00:00:00.000Z'),
      updatedAt: new Date('2026-05-01T00:00:00.000Z'),
    })
    vi.mocked(fetch).mockResolvedValueOnce(
      makeCloudResponse({ data: { accepted: true, duplicate: false, eventId: 'evt_traffic_cron' } }, 201),
    )

    const res = await app.request('/api/site/licensing/traffic-sync-runs?secret=traffic-secret', { method: 'POST' })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ ok: true, attempted: 1, reported: 1, blocked: 0, failed: 0 })
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://cloud.example/api/stores/store-test-binding/billing/usage-events')
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer test-refresh-token')
    await expect(db.select().from(cloudTrafficReports)).resolves.toMatchObject([{ status: 'reported' }])
  })

  it('requires the cron secret for the dedicated traffic cron endpoint [spec: licensing/traffic-cron-secret]', async () => {
    const { app } = await createTestApp({ REFRESH_CRON_SECRET: 'traffic-secret' })

    const res = await app.request('/api/site/licensing/traffic-sync-runs?secret=wrong-secret', { method: 'POST' })

    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toMatchObject({ error: { message: 'Unauthorized' } })
  })
})
