// @vitest-environment node
/**
 * E2E Integration Test: zpan ↔ zpan-cloud licensing flow.
 *
 * This test exercises the REAL staging cloud API
 * to verify the full licensing lifecycle:
 *   1. Pairing creation → cloud returns device code
 *   2. Pairing poll → pending status
 *   3. Entitlement refresh → 401 for invalid tokens (CloudUnboundError)
 *   4. Feature gate: community (unbound) → Pro features disabled
 *   5. Feature gate: Pro binding with valid PASETO → Pro features enabled
 *   6. Feature gate: expired cert → Pro features disabled
 *   7. Unbind → binding row deleted, features revoked
 *
 * Pairing approval requires a logged-in cloud user session, so we test up to
 * the poll-pending stage against the live API, then use locally-signed PASETO
 * certs to test the full feature-gate chain end-to-end.
 *
 * Run with: pnpm exec vitest run server/usecases/e2e-cloud-integration.test.ts
 */

import { generateKeys, sign } from 'paseto-ts/v4'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SignupMode } from '../../shared/constants'
import { createPairing, pollPairing, refreshEntitlement } from '../adapters/gateways/licensing-cloud'
import { createInstanceRepo } from '../adapters/repos/instance'
import { createLicenseBindingRepo } from '../adapters/repos/license-binding'
import { PUBLIC_KEYS } from '../domain/license-keys'
import { hasFeature } from '../domain/licensing'
import { adminHeaders, createTestApp, seedProLicense } from '../test/setup'
import { loadBindingState } from './licensing'
import { CloudUnboundError, type PairingResponse } from './ports'

const CLOUD_BASE_URL = process.env.ZPAN_CLOUD_URL ?? 'https://zpan-cloud-staging.saltbo.workers.dev'
const CLOUD_BASE_ORIGIN = new URL(CLOUD_BASE_URL).origin
const { secretKey: E2E_SECRET, publicKey: E2E_PUBLIC } = generateKeys('public')

function nowSec(): number {
  return Math.floor(Date.now() / 1000)
}

function signLicenseAssertion(overrides: Record<string, unknown> = {}): string {
  const now = nowSec()
  return sign(E2E_SECRET, {
    type: 'zpan.license',
    issuer: 'https://cloud.zpan.space',
    subject: 'e2e-binding',
    accountId: 'user-123',
    instanceId: 'test-instance',
    edition: 'pro',
    authorizedHosts: [],
    licenseValidUntil: now + 365 * 24 * 60 * 60,
    issuedAt: now,
    notBefore: now,
    expiresAt: now + 86400,
    ...overrides,
  })
}

async function approvePairingInCloud(pairing: PairingResponse): Promise<void> {
  const email = process.env.E2E_CLOUD_PRO_EMAIL
  const password = process.env.E2E_CLOUD_PRO_PASSWORD
  if (!email || !password) throw new Error('E2E_CLOUD_PRO_EMAIL and E2E_CLOUD_PRO_PASSWORD are required')

  const cloudOrigin = new URL(pairing.pairingUrl).origin
  const signIn = await fetch(`${cloudOrigin}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: cloudOrigin },
    body: JSON.stringify({ email, password }),
  })
  if (!signIn.ok) {
    const text = await signIn.text().catch(() => '')
    throw new Error(`Cloud test account sign-in failed: ${signIn.status} ${text}`)
  }

  const cookies = (signIn.headers as Headers & { getSetCookie(): string[] }).getSetCookie()
  const cloudHeaders = { 'Content-Type': 'application/json', Origin: cloudOrigin, Cookie: cookies.join('; ') }
  const licenses = await fetch(`${cloudOrigin}/api/licenses`, { headers: cloudHeaders })
  if (!licenses.ok) {
    const text = await licenses.text().catch(() => '')
    throw new Error(`Cloud license list failed: ${licenses.status} ${text}`)
  }

  const licenseBody = (await licenses.json()) as { data?: Array<{ id: string }> } | Array<{ id: string }>
  const activeLicenses = Array.isArray(licenseBody) ? licenseBody : (licenseBody.data ?? [])
  for (const license of activeLicenses) {
    const deleted = await fetch(`${cloudOrigin}/api/licenses/${encodeURIComponent(license.id)}`, {
      method: 'DELETE',
      headers: cloudHeaders,
    })
    if (!deleted.ok) {
      const text = await deleted.text().catch(() => '')
      throw new Error(`Cloud license cleanup failed: ${deleted.status} ${text}`)
    }
  }

  const approve = await fetch(`${cloudOrigin}/api/pairings/${encodeURIComponent(pairing.code)}`, {
    method: 'PATCH',
    headers: cloudHeaders,
    body: JSON.stringify({ action: 'approve' }),
  })
  if (!approve.ok) {
    const text = await approve.text().catch(() => '')
    throw new Error(`Cloud pairing approval failed: ${approve.status} ${text}`)
  }
}

// ─── Phase 1: Live Cloud API contract verification ───────────────────────────

describe('E2E: zpan-cloud API contract', () => {
  it('POST /api/pairings creates a pairing with correct shape', async () => {
    const result = await createPairing(CLOUD_BASE_URL, {
      id: `e2e-${Date.now()}`,
      name: 'E2E Test Instance',
      url: 'https://e2e-test.local',
      version: '0.0.1',
    })

    expect(result).toMatchObject({
      code: expect.stringMatching(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/),
      pairingUrl: expect.stringContaining('/pair?code='),
      expiresAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    })
    expect(new URL(result.pairingUrl).origin).toBe(CLOUD_BASE_ORIGIN)
  })

  it('GET /api/pairings/:code returns pending for a fresh code', async () => {
    const pairing = await createPairing(CLOUD_BASE_URL, {
      id: `e2e-poll-${Date.now()}`,
      name: 'E2E Poll Test',
      url: 'https://e2e-poll.local',
      version: '0.0.1',
    })

    const result = await pollPairing(CLOUD_BASE_URL, pairing.code)

    expect(result.status).toBe('pending')
    expect(result.refreshToken).toBeUndefined()
    expect(result.certificate).toBeUndefined()
  })

  it('POST /api/entitlements rejects invalid Bearer token with 401', async () => {
    await expect(refreshEntitlement(CLOUD_BASE_URL, 'totally-invalid-token')).rejects.toThrow(CloudUnboundError)
  })

  it('GET /health returns ok', async () => {
    const res = await fetch(`${CLOUD_BASE_URL}/health`)
    expect(res.ok).toBe(true)
    const body = (await res.json()) as { ok: boolean }
    expect(body.ok).toBe(true)
  })
})

// ─── Phase 2: zpan feature gates — Community (no binding) ───────────────────

describe('E2E: Feature gates — Community (unbound)', () => {
  it('loadBindingState returns { bound: false } when no license', async () => {
    const { db } = await createTestApp()
    const state = await loadBindingState({ licenseBinding: createLicenseBindingRepo(db) })

    expect(state.bound).toBe(false)
    expect(state.active).toBeUndefined()
    expect(state.edition).toBeUndefined()
    expect(state.license_valid_until).toBeUndefined()
    expect(state.certificate_expires_at).toBeUndefined()
  })

  it('hasFeature returns false for all Pro features when unbound', async () => {
    const { db } = await createTestApp()
    const state = await loadBindingState({ licenseBinding: createLicenseBindingRepo(db) })

    expect(hasFeature('open_registration', state)).toBe(false)
    expect(hasFeature('white_label', state)).toBe(false)
    expect(hasFeature('teams_unlimited', state)).toBe(false)
    expect(hasFeature('storages_unlimited', state)).toBe(false)
  })

  it('PUT /api/site/options returns 402 when enabling open signup without Pro', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)

    const res = await app.request('/api/site/options/auth_signup_mode', {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: SignupMode.OPEN }),
    })

    expect(res.status).toBe(402)
    const body = (await res.json()) as { error: string; feature: string }
    expect(body.error).toBe('feature_not_available')
    expect(body.feature).toBe('open_registration')
  })
})

// ─── Phase 3: zpan feature gates — Pro (active binding) ─────────────────────

describe('E2E: Feature gates — Pro (active binding)', () => {
  it('loadBindingState returns active Pro metadata when bound', async () => {
    const { db } = await createTestApp()
    await seedProLicense(db)

    const state = await loadBindingState({ licenseBinding: createLicenseBindingRepo(db) })

    expect(state.bound).toBe(true)
    expect(state.active).toBe(true)
    expect(state.edition).toBe('pro')
    expect(state.license_valid_until).toEqual(expect.any(Number))
    expect(state.certificate_expires_at).toEqual(expect.any(Number))
  })

  it('hasFeature returns true for all Pro features when bound', async () => {
    const { db } = await createTestApp()
    await seedProLicense(db)

    const state = await loadBindingState({ licenseBinding: createLicenseBindingRepo(db) })

    expect(hasFeature('open_registration', state)).toBe(true)
    expect(hasFeature('white_label', state)).toBe(true)
    expect(hasFeature('teams_unlimited', state)).toBe(true)
    expect(hasFeature('storages_unlimited', state)).toBe(true)
  })

  it('PUT /api/site/options allows open signup with Pro license', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)

    const res = await app.request('/api/site/options/auth_signup_mode', {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: SignupMode.OPEN }),
    })

    expect(res.status).toBeLessThan(300) // 200 or 201
  })

  it('hasFeature enables every local Pro gate for an active binding', async () => {
    const { db } = await createTestApp()
    await seedProLicense(db)

    const state = await loadBindingState({ licenseBinding: createLicenseBindingRepo(db) })

    expect(hasFeature('white_label', state)).toBe(true)
    expect(hasFeature('open_registration', state)).toBe(true)
    expect(hasFeature('teams_unlimited', state)).toBe(true)
  })
})

// ─── Phase 4: Expired cert → features revoked ───────────────────────────────

describe('E2E: Feature gates — expired certificate', () => {
  it('hasFeature returns false when cert is expired', async () => {
    const { db } = await createTestApp()

    PUBLIC_KEYS.unshift(E2E_PUBLIC)
    const expiresAt = nowSec() - 1
    await createLicenseBindingRepo(db).createLicenseBinding({
      cloudBindingId: 'expired-binding',
      cloudStoreId: 'store-expired',
      instanceId: 'test-instance',
      cloudAccountId: 'user-123',
      refreshToken: 'test-token',
      cachedCert: signLicenseAssertion({ expiresAt, licenseValidUntil: expiresAt }),
      cachedExpiresAt: expiresAt,
      lastRefreshAt: nowSec(),
    })

    const state = await loadBindingState({ licenseBinding: createLicenseBindingRepo(db) })

    expect(state.bound).toBe(true)
    expect(state.active).toBe(false)
    expect(state.edition).toBeUndefined()
    expect(hasFeature('open_registration', state)).toBe(false)
    expect(hasFeature('white_label', state)).toBe(false)

    PUBLIC_KEYS.splice(PUBLIC_KEYS.indexOf(E2E_PUBLIC), 1)
  })
})

// ─── Phase 5: Unbind → features revoked ──────────────────────────────────────

describe('E2E: Unbind flow', () => {
  it('DELETE /api/site/licensing/binding unbinds a staging-approved binding and revokes features', async () => {
    const { app, db } = await createTestApp({ ZPAN_CLOUD_URL: CLOUD_BASE_URL })
    const headers = await adminHeaders(app)

    const pairRes = await app.request('/api/site/licensing/pairings', { method: 'POST', headers })
    expect(pairRes.status).toBe(200)
    const pairing = (await pairRes.json()) as PairingResponse
    await approvePairingInCloud(pairing)

    const pollRes = await app.request(`/api/site/licensing/pairings/${pairing.code}`, { headers })
    expect(pollRes.status).toBe(200)
    const pollBody = (await pollRes.json()) as { status: string; edition?: string }
    expect(pollBody.status).toBe('approved')
    expect(pollBody.edition).toBe('pro')

    let state = await loadBindingState(
      { licenseBinding: createLicenseBindingRepo(db) },
      { cloudBaseUrl: CLOUD_BASE_URL, currentHost: 'localhost' },
    )
    expect(state.bound).toBe(true)
    expect(hasFeature('open_registration', state)).toBe(true)

    const res = await app.request('/api/site/licensing/binding', {
      method: 'DELETE',
      headers,
    })
    expect(res.status).toBe(200)

    // Verify features are revoked after unbind
    state = await loadBindingState(
      { licenseBinding: createLicenseBindingRepo(db) },
      { cloudBaseUrl: CLOUD_BASE_URL, currentHost: 'localhost' },
    )
    expect(state.bound).toBe(false)
    expect(hasFeature('open_registration', state)).toBe(false)
  })
})

// ─── Phase 6: Pairing → Poll → Approval → Feature activation (mocked cloud) ─

describe('E2E: Full pairing-to-activation flow (mocked cloud approval)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    PUBLIC_KEYS.unshift(E2E_PUBLIC)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    const idx = PUBLIC_KEYS.indexOf(E2E_PUBLIC)
    if (idx >= 0) PUBLIC_KEYS.splice(idx, 1)
  })

  it('complete flow: pair → poll pending → poll approved → features active → refresh → unbind', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)

    // Step 1: Initiate pairing (mock cloud response)
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: 'E2E-TST',
          pairingUrl: 'https://cloud.zpan.space/pair?code=E2E-TST',
          expiresAt: new Date(Date.now() + 900_000).toISOString(),
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    const pairRes = await app.request('/api/site/licensing/pairings', {
      method: 'POST',
      headers,
    })
    expect(pairRes.status).toBe(200)
    const pairBody = (await pairRes.json()) as { code: string }
    expect(pairBody.code).toBe('E2E-TST')

    // Step 2: Poll — pending
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ status: 'pending' }), {
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const pendingRes = await app.request('/api/site/licensing/pairings/E2E-TST', { headers })
    expect(pendingRes.status).toBe(200)
    expect(((await pendingRes.json()) as { status: string }).status).toBe('pending')

    const instanceId = await createInstanceRepo(db).getOrCreateInstanceId()
    const cert = signLicenseAssertion({
      subject: 'e2e-binding',
      instanceId,
      authorizedHosts: ['localhost'],
    })

    // Step 3: Poll — approved (signed certificate from pairing)
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: 'approved',
          refreshToken: 'rt-e2e-secret',
          certificate: cert,
          binding: {
            id: 'e2e-binding',
            storeId: 'store-e2e',
            instanceId,
            authorizedHosts: ['localhost'],
          },
          account: { id: 'user-123', email: 'user@example.com' },
        }),
        { headers: { 'Content-Type': 'application/json' } },
      ),
    )

    const approvedRes = await app.request('/api/site/licensing/pairings/E2E-TST', { headers })
    expect(approvedRes.status).toBe(200)
    const approvedBody = (await approvedRes.json()) as {
      status: string
      edition?: string
    }
    expect(approvedBody.status).toBe('approved')
    expect(approvedBody.edition).toBe('pro')

    // Step 4: Verify binding stored in DB
    const state2 = await createLicenseBindingRepo(db).loadLicenseState()
    expect(state2.refreshToken).toBe('rt-e2e-secret')
    expect(state2.cachedCert).toBeTruthy()

    // Step 5: Verify features are now active
    const state = await loadBindingState({ licenseBinding: createLicenseBindingRepo(db) })
    expect(state.bound).toBe(true)
    expect(state.active).toBe(true)
    expect(state.edition).toBe('pro')
    expect(hasFeature('open_registration', state)).toBe(true)
    expect(hasFeature('white_label', state)).toBe(true)
    expect(hasFeature('teams_unlimited', state)).toBe(true)
    expect(hasFeature('storages_unlimited', state)).toBe(true)

    // Step 6: Open registration is now allowed
    const openRegRes = await app.request('/api/site/options/auth_signup_mode', {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: SignupMode.OPEN }),
    })
    expect(openRegRes.status).toBeLessThan(300) // 200 or 201

    // Step 7: Unbind — features revoked
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 204 }))

    const unbindRes = await app.request('/api/site/licensing/binding', {
      method: 'DELETE',
      headers,
    })
    expect(unbindRes.status).toBe(200)

    const stateAfter = await loadBindingState({ licenseBinding: createLicenseBindingRepo(db) })
    expect(stateAfter.bound).toBe(false)
    expect(hasFeature('open_registration', stateAfter)).toBe(false)

    // Step 8: Open registration blocked again
    const blockedRes = await app.request('/api/site/options/auth_signup_mode', {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: SignupMode.OPEN }),
    })
    expect(blockedRes.status).toBe(402)
  })
})

// ─── Phase 7: PASETO verification with real public key ───────────────────────

describe('E2E: PASETO cert verification chain', () => {
  it('verifyCertificate rejects certs signed with unknown key', async () => {
    const { db } = await createTestApp()

    // A fake PASETO token that looks structurally valid but signed with wrong key
    const fakePaseto =
      'v4.public.eyJhY2NvdW50X2lkIjoiYTEiLCJpbnN0YW5jZV9pZCI6InRlc3QtaW5zdGFuY2UiLCJwbGFuIjoicHJvIiwiZmVhdHVyZXMiOlsid2hpdGVfbGFiZWwiXSwiZXhwaXJlc19hdCI6IjIwOTktMDEtMDFUMDA6MDA6MDBaIiwiaXNzdWVkX2F0IjoiMjAyNi0wMS0wMVQwMDowMDowMFoifQ.fakesignaturebytes'

    await createLicenseBindingRepo(db).createLicenseBinding({
      cloudBindingId: 'fake-binding',
      cloudStoreId: 'store-fake',
      instanceId: 'test-instance',
      cloudAccountId: 'test-account',
      refreshToken: 'test-token',
      cachedCert: fakePaseto,
      cachedExpiresAt: nowSec() + 3600,
      lastRefreshAt: nowSec(),
    })

    const state = await loadBindingState({ licenseBinding: createLicenseBindingRepo(db) })

    // Should be bound but inactive (PASETO verification fails)
    expect(state.bound).toBe(true)
    expect(state.active).toBe(false)
    expect(state.edition).toBeUndefined()
    expect(hasFeature('white_label', state)).toBe(false)
  })

  it('PUBLIC_KEYS contains the production cloud key', () => {
    expect(PUBLIC_KEYS.length).toBeGreaterThanOrEqual(1)
    expect(PUBLIC_KEYS[0]).toMatch(/^k4\.public\./)
  })
})
