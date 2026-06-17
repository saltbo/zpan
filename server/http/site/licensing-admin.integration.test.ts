import { generateKeys, sign } from 'paseto-ts/v4'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createInstanceRepo } from '../../adapters/repos/instance.js'
import { createLicenseBindingRepo } from '../../adapters/repos/license-binding.js'
import { PUBLIC_KEYS } from '../../domain/license-keys.js'
import { adminHeaders, authedHeaders, createTestApp } from '../../test/setup.js'

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

function signCert(instanceId: string, secret: string = TEST_SECRET): string {
  const now = nowSec()
  return sign(secret, {
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
  await createLicenseBindingRepo(db).createLicenseBinding({
    cloudBindingId: 'bind-1',
    instanceId,
    cloudAccountId: 'acct-1',
    cloudStoreId: 'store-1',
    refreshToken: 'old-token',
    cachedCert: cert,
    cachedExpiresAt: now + 3600,
    lastRefreshAt: now,
  })
}

describe('Licensing Admin API — auth guards', () => {
  it('POST /api/site/licensing/pairings returns 401 without auth [spec: licensing-admin/auth-required]', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/site/licensing/pairings', { method: 'POST' })
    expect(res.status).toBe(401)
  })

  it('GET /api/site/licensing/pairings/:code returns 401 without auth', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/site/licensing/pairings/ABC-123')
    expect(res.status).toBe(401)
  })

  it('POST /api/site/licensing/refresh-runs returns 401 without auth', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/site/licensing/refresh-runs', { method: 'POST' })
    expect(res.status).toBe(401)
  })

  it('DELETE /api/site/licensing/binding returns 401 without auth', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/site/licensing/binding', { method: 'DELETE' })
    expect(res.status).toBe(401)
  })

  it('POST /api/site/licensing/pairings returns 403 for non-admin [spec: licensing-admin/admin-only]', async () => {
    const { app } = await createTestApp()
    await authedHeaders(app, 'admin@example.com')
    await authedHeaders(app, 'regular@example.com')
    const signInRes = await app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'regular@example.com', password: 'password123456' }),
    })
    const headers = { Cookie: signInRes.headers.getSetCookie().join('; ') }
    const res = await app.request('/api/site/licensing/pairings', { method: 'POST', headers })
    expect(res.status).toBe(403)
  })
})

describe('POST /api/site/licensing/pairings', () => {
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

  it('calls cloud and returns pairing info [spec: licensing-admin/pair-initiate]', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)

    const cloudPayload = {
      code: 'ABC-123',
      pairingUrl: 'https://cloud.zpan.space/pair',
      expiresAt: '2026-01-01T00:00:00Z',
    }
    vi.mocked(fetch).mockResolvedValueOnce(makeCloudResponse(cloudPayload))

    const res = await app.request('/api/site/licensing/pairings', {
      method: 'POST',
      headers,
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.code).toBe('ABC-123')
    expect(body.pairingUrl).toBe('https://cloud.zpan.space/pair')

    const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(init.body)).instance.url).toBe('http://localhost')
  })
})

describe('GET /api/site/licensing/pairings/:code', () => {
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

  it('returns pending status when cloud returns pending [spec: licensing-admin/poll-pending]', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)

    vi.mocked(fetch).mockResolvedValueOnce(makeCloudResponse({ status: 'pending' }))

    const res = await app.request('/api/site/licensing/pairings/ABC-123', { headers })

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.status).toBe('pending')
  })

  it('stores binding on approved and returns approved status [spec: licensing-admin/poll-approved]', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    const instanceId = await createInstanceRepo(db).getOrCreateInstanceId()

    vi.mocked(fetch).mockResolvedValueOnce(
      makeCloudResponse({
        status: 'approved',
        refreshToken: 'rt-secret',
        certificate: signCert(instanceId),
        binding: { id: 'bind-1', storeId: 'store-1', instanceId, authorizedHosts: ['localhost'] },
        account: { id: 'acct-1', email: 'acct@example.com' },
      }),
    )

    const res = await app.request('/api/site/licensing/pairings/CODE-1', { headers })

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.status).toBe('approved')
    expect(body.cloud_store_id).toBe('store-1')

    // Check that binding was persisted
    const state = await createLicenseBindingRepo(db).loadLicenseState()
    expect(state.refreshToken).toBe('rt-secret')
    expect(state.cloudStoreId).toBe('store-1')
  })

  it('stores the pairing certificate when approved [spec: licensing-admin/store-cert]', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    const instanceId = await createInstanceRepo(db).getOrCreateInstanceId()
    const certificate = signCert(instanceId)

    vi.mocked(fetch)
      .mockResolvedValueOnce(
        makeCloudResponse({
          status: 'approved',
          refreshToken: 'pair-rt',
          certificate,
          binding: { id: 'bind-1', storeId: 'store-1', instanceId, authorizedHosts: ['localhost'] },
          account: { id: 'acct-1', email: 'acct@example.com' },
        }),
      )
      // The confirm callback to the cloud after the cert is verified + stored.
      .mockResolvedValueOnce(makeCloudResponse(null, 204))

    const res = await app.request('/api/site/licensing/pairings/CODE-1', { headers })

    expect(res.status).toBe(200)
    const state = await createLicenseBindingRepo(db).loadLicenseState()
    expect(state.refreshToken).toBe('pair-rt')
    expect(state.cachedCert).toBe(certificate)
    // Poll + confirm (PATCH /licenses/:id { status: 'confirmed' }).
    expect(vi.mocked(fetch).mock.calls).toHaveLength(2)
    const [confirmUrl, confirmInit] = vi.mocked(fetch).mock.calls.at(-1) as [string, RequestInit]
    expect(String(confirmUrl)).toContain('/licenses/bind-1')
    expect(confirmInit.method).toBe('PATCH')
    expect(JSON.parse(confirmInit.body as string)).toEqual({ status: 'confirmed' })
  })

  it('rejects approved responses with an invalid certificate [spec: licensing-admin/reject-invalid-cert]', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)

    vi.mocked(fetch).mockResolvedValueOnce(
      makeCloudResponse({
        status: 'approved',
        refreshToken: 'rt-secret',
        certificate: signCert('wrong-instance'),
      }),
    )

    const res = await app.request('/api/site/licensing/pairings/CODE-1', { headers })

    expect(res.status).toBe(502)
    const state = await createLicenseBindingRepo(db).loadLicenseState()
    expect(state.refreshToken).toBeNull()
  })

  it('rejects approved responses when certificate is missing [spec: licensing-admin/reject-missing-cert]', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)

    vi.mocked(fetch).mockResolvedValueOnce(
      makeCloudResponse({
        status: 'approved',
        refreshToken: 'rt-secret',
      }),
    )

    const res = await app.request('/api/site/licensing/pairings/CODE-1', { headers })

    expect(res.status).toBe(502)
    const state = await createLicenseBindingRepo(db).loadLicenseState()
    expect(state.refreshToken).toBeNull()
  })

  it('rejects approved responses when binding metadata is missing', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    const instanceId = await createInstanceRepo(db).getOrCreateInstanceId()

    vi.mocked(fetch).mockResolvedValueOnce(
      makeCloudResponse({
        status: 'approved',
        refreshToken: 'rt-secret',
        certificate: signCert(instanceId),
      }),
    )

    const res = await app.request('/api/site/licensing/pairings/CODE-1', { headers })

    expect(res.status).toBe(502)
    await expect(res.json()).resolves.toMatchObject({
      error: {
        message: 'Invalid certificate',
        details: [{ reason: 'INVALID_CERTIFICATE', metadata: { certificateReason: 'incomplete_response' } }],
      },
    })
    const state = await createLicenseBindingRepo(db).loadLicenseState()
    expect(state.status).toBe('disconnected')
    expect(state.refreshToken).toBeNull()
    expect(state.cachedCert).toBeNull()
  })

  it('reports an untrusted signing key and rolls back the orphaned cloud binding [spec: licensing-admin/untrusted-key-rollback]', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    const instanceId = await createInstanceRepo(db).getOrCreateInstanceId()

    // Sign with a key ZPan does not trust — simulates a rotated/mismatched cloud
    // signing key (the real-world "lost private key" scenario).
    const { secretKey: untrustedSecret } = generateKeys('public')

    vi.mocked(fetch)
      .mockResolvedValueOnce(
        makeCloudResponse({
          status: 'approved',
          refreshToken: 'rt-secret',
          certificate: signCert(instanceId, untrustedSecret),
          binding: { id: 'cb-1', instanceId, storeId: 'store-1', authorizedHosts: [] },
          account: { id: 'acct-1', email: 'owner@example.com' },
        }),
      )
      // The rollback unbind call to the cloud.
      .mockResolvedValueOnce(makeCloudResponse({ ok: true }))

    const res = await app.request('/api/site/licensing/pairings/CODE-1', { headers })

    expect(res.status).toBe(502)
    await expect(res.json()).resolves.toMatchObject({
      error: {
        message: 'Invalid certificate',
        details: [{ reason: 'INVALID_CERTIFICATE', metadata: { certificateReason: 'signature' } }],
      },
    })
    // ZPan stored nothing; the cloud binding was released.
    const state = await createLicenseBindingRepo(db).loadLicenseState()
    expect(state.refreshToken).toBeNull()
    const unbindCall = vi.mocked(fetch).mock.calls.at(-1)
    expect(String(unbindCall?.[0])).toContain('cb-1')
  })
})

describe('POST /api/site/licensing/refresh-runs', () => {
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

  it('returns success when binding exists and cloud responds OK [spec: licensing-admin/refresh]', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)

    await seedBinding(db)

    vi.mocked(fetch).mockResolvedValueOnce(
      makeCloudResponse({
        refreshToken: 'new-token',
        certificate: signCert('inst-1'),
        binding: { id: 'bind-1', storeId: 'store-1', instanceId: 'inst-1', authorizedHosts: ['localhost'] },
        account: { id: 'acct-1', email: 'acct@example.com' },
      }),
    )

    const res = await app.request('/api/site/licensing/refresh-runs', { method: 'POST', headers })

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.success).toBe(true)
  })

  it('returns success:true with null last_refresh_at when no binding exists [spec: licensing-admin/refresh-unbound]', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)

    // No binding exists — performRefresh is a no-op
    const res = await app.request('/api/site/licensing/refresh-runs', { method: 'POST', headers })

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.success).toBe(true)
    expect(body.last_refresh_at).toBeNull()
  })
})

describe('DELETE /api/site/licensing/binding', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('unbinds from Cloud, deletes binding row, and returns deleted: true [spec: licensing-admin/unbind]', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)

    await seedBinding(db)
    vi.mocked(fetch).mockResolvedValueOnce(makeCloudResponse(null, 204))

    const res = await app.request('/api/site/licensing/binding', { method: 'DELETE', headers })

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.deleted).toBe(true)
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://cloud.zpan.space/api/licenses/bind-1')
    expect(init.method).toBe('DELETE')
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer old-token')

    // Confirm binding is gone
    const state = await createLicenseBindingRepo(db).loadLicenseState()
    expect(state.refreshToken).toBeNull()
  })

  it('clears the local binding when Cloud unbind fails [spec: licensing-admin/unbind-cloud-fail]', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)

    await seedBinding(db)
    vi.mocked(fetch).mockResolvedValueOnce(makeCloudResponse({ error: 'unbound' }, 401))

    const res = await app.request('/api/site/licensing/binding', { method: 'DELETE', headers })

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.deleted).toBe(true)
    expect(body.cloud_unbind_error).toContain('Cloud unbind failed')

    const state = await createLicenseBindingRepo(db).loadLicenseState()
    expect(state.refreshToken).toBeNull()
  })

  it('returns deleted: true even when no binding exists [spec: licensing-admin/unbind-idempotent]', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)

    const res = await app.request('/api/site/licensing/binding', { method: 'DELETE', headers })

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.deleted).toBe(true)
    expect(fetch).not.toHaveBeenCalled()
  })
})
