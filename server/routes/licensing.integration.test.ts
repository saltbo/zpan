import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as schema from '../db/schema.js'
import { createTestApp } from '../test/setup.js'

describe('GET /api/licensing/status', () => {
  it('returns { bound: false } when no binding row exists', async () => {
    const { app } = await createTestApp()

    const res = await app.request('/api/licensing/status')

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ bound: false })
  })

  it('returns bound state with plan and features when binding row exists with cert', async () => {
    const { app, db } = await createTestApp()

    const entitlement = {
      account_id: 'acc-1',
      instance_id: 'inst-1',
      plan: 'pro',
      features: ['white_label', 'teams_unlimited'],
      issued_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    }

    await db.insert(schema.licenseBinding).values({
      id: 1,
      instanceId: 'inst-1',
      cloudAccountId: 'acc-1',
      cloudAccountEmail: 'user@example.com',
      refreshToken: 'secret-refresh-token',
      cachedCert: JSON.stringify(entitlement),
      cachedExpiresAt: Math.floor(Date.now() / 1000) + 86400,
      lastRefreshAt: Math.floor(Date.now() / 1000),
      lastRefreshError: null,
      boundAt: Math.floor(Date.now() / 1000),
    })

    const res = await app.request('/api/licensing/status')

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.bound).toBe(true)
    expect(body.account_email).toBe('user@example.com')
    expect(body.plan).toBe('pro')
    expect(body.features).toEqual(['white_label', 'teams_unlimited'])
    // refresh_token must never appear in the response
    expect(body.refresh_token).toBeUndefined()
    expect(body.refreshToken).toBeUndefined()
  })

  it('returns bound:true with no plan/features when cachedCert is null', async () => {
    const { app, db } = await createTestApp()

    await db.insert(schema.licenseBinding).values({
      id: 1,
      instanceId: 'inst-1',
      cloudAccountId: null,
      cloudAccountEmail: null,
      refreshToken: 'secret',
      cachedCert: null,
      cachedExpiresAt: null,
      lastRefreshAt: null,
      lastRefreshError: null,
      boundAt: null,
    })

    const res = await app.request('/api/licensing/status')

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.bound).toBe(true)
    expect(body.plan).toBeUndefined()
    expect(body.features).toBeUndefined()
  })

  it('is accessible without authentication', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/licensing/status')
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

describe('POST /api/licensing/refresh-cron', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns 401 when REFRESH_CRON_SECRET env is not set', async () => {
    const { app } = await createTestApp()

    const res = await app.request('/api/licensing/refresh-cron?secret=anything', { method: 'POST' })

    expect(res.status).toBe(401)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.error).toBe('Unauthorized')
  })

  it('returns 401 when secret param does not match REFRESH_CRON_SECRET', async () => {
    const { app } = await createTestApp({ REFRESH_CRON_SECRET: 'correct-secret' })

    const res = await app.request('/api/licensing/refresh-cron?secret=wrong-secret', { method: 'POST' })

    expect(res.status).toBe(401)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.error).toBe('Unauthorized')
  })

  it('returns 401 when secret query param is missing', async () => {
    const { app } = await createTestApp({ REFRESH_CRON_SECRET: 'correct-secret' })

    const res = await app.request('/api/licensing/refresh-cron', { method: 'POST' })

    expect(res.status).toBe(401)
  })

  it('returns 200 with { ok: true } when secret is correct and no binding exists', async () => {
    const { app } = await createTestApp({ REFRESH_CRON_SECRET: 'correct-secret' })

    const res = await app.request('/api/licensing/refresh-cron?secret=correct-secret', { method: 'POST' })

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.ok).toBe(true)
  })

  it('returns 200 with { ok: true } and calls refresh when binding exists with old lastRefreshAt', async () => {
    const { app, db } = await createTestApp({ REFRESH_CRON_SECRET: 'cron-secret' })

    const nowSec = Math.floor(Date.now() / 1000)
    // 10 minutes ago — outside the 5-minute dedup window
    const oldRefresh = nowSec - 600

    await db.insert(schema.licenseBinding).values({
      id: 1,
      instanceId: 'inst-1',
      refreshToken: 'old-token',
      cachedCert: null,
      cachedExpiresAt: null,
      lastRefreshAt: oldRefresh,
      lastRefreshError: null,
      boundAt: null,
    })

    vi.mocked(fetch).mockResolvedValueOnce(
      makeCloudResponse({
        refresh_token: 'new-token',
        certificate: 'v4.public.fake-cert-for-test',
      }),
    )

    const res = await app.request('/api/licensing/refresh-cron?secret=cron-secret', { method: 'POST' })

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.ok).toBe(true)
  })

  it('returns 200 with { ok: true } even when performRefresh throws (error is swallowed)', async () => {
    const { app, db } = await createTestApp({ REFRESH_CRON_SECRET: 'cron-secret' })

    const nowSec = Math.floor(Date.now() / 1000)
    const oldRefresh = nowSec - 600

    await db.insert(schema.licenseBinding).values({
      id: 1,
      instanceId: 'inst-1',
      refreshToken: 'old-token',
      cachedCert: null,
      cachedExpiresAt: null,
      lastRefreshAt: oldRefresh,
      lastRefreshError: null,
      boundAt: null,
    })

    // Simulate a network failure from the cloud endpoint
    vi.mocked(fetch).mockRejectedValueOnce(new Error('network failure'))

    const res = await app.request('/api/licensing/refresh-cron?secret=cron-secret', { method: 'POST' })

    // runLicensingRefresh catches all errors and logs them — never rethrows
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.ok).toBe(true)
  })

  it('is accessible without authentication (public route)', async () => {
    const { app } = await createTestApp({ REFRESH_CRON_SECRET: 'my-secret' })

    const res = await app.request('/api/licensing/refresh-cron?secret=my-secret', { method: 'POST' })

    // Should not return 401 due to missing auth session
    expect(res.status).toBe(200)
  })
})
