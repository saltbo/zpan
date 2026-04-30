import { generateKeys, sign } from 'paseto-ts/v4'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getOrCreateInstanceId } from '../licensing/instance-id.js'
import { createLicenseBinding, loadLicenseState } from '../licensing/license-state.js'
import { PUBLIC_KEYS } from '../licensing/public-keys.js'
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

const { secretKey: TEST_SECRET, publicKey: TEST_PUBLIC } = generateKeys('public')
const originalKeys: string[] = []

function nowSec(): number {
  return Math.floor(Date.now() / 1000)
}

function signCert(instanceId: string): string {
  const now = nowSec()
  return sign(TEST_SECRET, {
    type: 'zpan.license',
    issuer: 'https://cloud.zpan.space',
    subject: 'bind-1',
    accountId: 'acct-1',
    instanceId,
    edition: 'pro',
    authorizedHosts: ['localhost'],
    licenseValidUntil: now + 365 * 24 * 60 * 60,
    issuedAt: now,
    notBefore: now,
    expiresAt: now + 3600,
  })
}

async function seedBinding(db: Awaited<ReturnType<typeof createTestApp>>['db'], instanceId = 'inst-1') {
  const now = nowSec()
  const cert = signCert(instanceId)
  await createLicenseBinding(db, {
    cloudBindingId: 'bind-1',
    instanceId,
    cloudAccountId: 'acct-1',
    refreshToken: 'old-token',
    cachedCert: cert,
    cachedExpiresAt: now + 3600,
    lastRefreshAt: now,
  })
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
    originalKeys.push(...PUBLIC_KEYS)
    PUBLIC_KEYS.length = 0
    PUBLIC_KEYS.push(TEST_PUBLIC)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    PUBLIC_KEYS.length = 0
    for (const key of originalKeys.splice(0)) PUBLIC_KEYS.push(key)
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

    const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(init.body)).instance_host).toBe('http://localhost')
  })
})

describe('GET /api/licensing/pair/:code/poll', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    originalKeys.push(...PUBLIC_KEYS)
    PUBLIC_KEYS.length = 0
    PUBLIC_KEYS.push(TEST_PUBLIC)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    PUBLIC_KEYS.length = 0
    for (const key of originalKeys.splice(0)) PUBLIC_KEYS.push(key)
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
    const instanceId = await getOrCreateInstanceId(db)

    vi.mocked(fetch).mockResolvedValueOnce(
      makeCloudResponse({
        status: 'approved',
        refresh_token: 'rt-secret',
        certificate: signCert(instanceId),
        binding: { id: 'bind-1', instance_id: instanceId, authorized_hosts: ['localhost'] },
        account: { id: 'acct-1', email: 'acct@example.com' },
      }),
    )

    const res = await app.request('/api/licensing/pair/CODE-1/poll', { headers })

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.status).toBe('approved')

    // Check that binding was persisted
    const state = await loadLicenseState(db)
    expect(state.refreshToken).toBe('rt-secret')
  })

  it('rejects approved responses with an invalid certificate', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)

    vi.mocked(fetch).mockResolvedValueOnce(
      makeCloudResponse({
        status: 'approved',
        refresh_token: 'rt-secret',
        certificate: signCert('wrong-instance'),
      }),
    )

    const res = await app.request('/api/licensing/pair/CODE-1/poll', { headers })

    expect(res.status).toBe(502)
    const state = await loadLicenseState(db)
    expect(state.refreshToken).toBeNull()
  })

  it('rejects approved responses when certificate is missing', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)

    vi.mocked(fetch).mockResolvedValueOnce(
      makeCloudResponse({
        status: 'approved',
        refresh_token: 'rt-secret',
      }),
    )

    const res = await app.request('/api/licensing/pair/CODE-1/poll', { headers })

    expect(res.status).toBe(502)
    const state = await loadLicenseState(db)
    expect(state.refreshToken).toBeNull()
  })
})

describe('POST /api/licensing/refresh', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    originalKeys.push(...PUBLIC_KEYS)
    PUBLIC_KEYS.length = 0
    PUBLIC_KEYS.push(TEST_PUBLIC)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    PUBLIC_KEYS.length = 0
    for (const key of originalKeys.splice(0)) PUBLIC_KEYS.push(key)
  })

  it('returns success when binding exists and cloud responds OK', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)

    await seedBinding(db)

    vi.mocked(fetch).mockResolvedValueOnce(
      makeCloudResponse({
        refresh_token: 'new-token',
        certificate: signCert('inst-1'),
        binding: { id: 'bind-1', instance_id: 'inst-1', authorized_hosts: ['localhost'] },
        account: { id: 'acct-1', email: 'acct@example.com' },
      }),
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

    await seedBinding(db)

    const res = await app.request('/api/licensing/binding', { method: 'DELETE', headers })

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.deleted).toBe(true)

    // Confirm binding is gone
    const state = await loadLicenseState(db)
    expect(state.refreshToken).toBeNull()
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
