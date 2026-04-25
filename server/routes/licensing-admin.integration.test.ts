import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as schema from '../db/schema.js'
import { adminHeaders, authedHeaders, createTestApp } from '../test/setup.js'

function makeCloudResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

describe('Licensing Admin API — auth guards', () => {
  it('POST /api/licensing/pair returns 401 without auth', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/licensing/pair', { method: 'POST' })
    expect(res.status).toBe(401)
  })

  it('GET /api/licensing/pair/:code/poll returns 401 without auth', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/licensing/pair/ABC-123/poll')
    expect(res.status).toBe(401)
  })

  it('POST /api/licensing/refresh returns 401 without auth', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/licensing/refresh', { method: 'POST' })
    expect(res.status).toBe(401)
  })

  it('DELETE /api/licensing/binding returns 401 without auth', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/licensing/binding', { method: 'DELETE' })
    expect(res.status).toBe(401)
  })

  it('POST /api/licensing/pair returns 403 for non-admin', async () => {
    const { app } = await createTestApp()
    await authedHeaders(app, 'admin@example.com')
    await authedHeaders(app, 'regular@example.com')
    const signInRes = await app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'regular@example.com', password: 'password123456' }),
    })
    const headers = { Cookie: signInRes.headers.getSetCookie().join('; ') }
    const res = await app.request('/api/licensing/pair', { method: 'POST', headers })
    expect(res.status).toBe(403)
  })
})

describe('POST /api/licensing/pair', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('calls cloud and returns pairing info', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)

    const cloudPayload = {
      code: 'ABC-123',
      pairing_url: 'https://cloud.zpan.space/pair',
      expires_at: '2026-01-01T00:00:00Z',
    }
    vi.mocked(fetch).mockResolvedValueOnce(makeCloudResponse(cloudPayload))

    const res = await app.request('/api/licensing/pair', {
      method: 'POST',
      headers,
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.code).toBe('ABC-123')
    expect(body.pairing_url).toBe('https://cloud.zpan.space/pair')
  })
})

describe('GET /api/licensing/pair/:code/poll', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns pending status when cloud returns pending', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)

    vi.mocked(fetch).mockResolvedValueOnce(makeCloudResponse({ status: 'pending' }))

    const res = await app.request('/api/licensing/pair/ABC-123/poll', { headers })

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.status).toBe('pending')
  })

  it('stores binding on approved and returns approved status', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)

    vi.mocked(fetch).mockResolvedValueOnce(
      makeCloudResponse({
        status: 'approved',
        refresh_token: 'rt-secret',
        entitlement: {
          plan: 'pro',
          features: ['white_label'],
          expires_at: '2026-12-31T00:00:00Z',
          account_id: 'a1',
          instance_id: 'i1',
          issued_at: '2026-01-01T00:00:00Z',
        },
      }),
    )

    const res = await app.request('/api/licensing/pair/CODE-1/poll', { headers })

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.status).toBe('approved')

    // Check that binding was persisted
    const rows = await db.select().from(schema.licenseBinding).limit(1)
    expect(rows.length).toBe(1)
    expect(rows[0].refreshToken).toBe('rt-secret')
  })
})

describe('POST /api/licensing/refresh', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns success when binding exists and cloud responds OK', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)

    await db.insert(schema.licenseBinding).values({
      id: 1,
      instanceId: 'inst-1',
      refreshToken: 'old-token',
      cachedCert: null,
      cachedExpiresAt: null,
      lastRefreshAt: null,
      lastRefreshError: null,
      boundAt: null,
    })

    vi.mocked(fetch).mockResolvedValueOnce(
      makeCloudResponse({ refresh_token: 'new-token', certificate: 'v4.public.fake-token-for-test' }),
    )

    const res = await app.request('/api/licensing/refresh', { method: 'POST', headers })

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.success).toBe(true)
  })

  it('returns success:true with null last_refresh_at when no binding exists', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)

    // No binding exists — performRefresh is a no-op
    const res = await app.request('/api/licensing/refresh', { method: 'POST', headers })

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.success).toBe(true)
    expect(body.last_refresh_at).toBeNull()
  })
})

describe('DELETE /api/licensing/binding', () => {
  it('deletes binding row and returns deleted: true', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)

    await db.insert(schema.licenseBinding).values({
      id: 1,
      instanceId: 'inst-1',
      refreshToken: 'some-token',
      cachedCert: null,
      cachedExpiresAt: null,
      lastRefreshAt: null,
      lastRefreshError: null,
      boundAt: null,
    })

    const res = await app.request('/api/licensing/binding', { method: 'DELETE', headers })

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.deleted).toBe(true)

    // Confirm row is gone
    const rows = await db.select().from(schema.licenseBinding).limit(1)
    expect(rows.length).toBe(0)
  })

  it('returns deleted: true even when no binding exists', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)

    const res = await app.request('/api/licensing/binding', { method: 'DELETE', headers })

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.deleted).toBe(true)
  })
})
