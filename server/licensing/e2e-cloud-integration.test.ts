// @vitest-environment node
/**
 * E2E Integration Test: zpan ↔ zpan-cloud licensing flow.
 *
 * This test exercises the REAL cloud API at cloud.zpan.space (or workers.dev)
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
 * Run with: npx vitest run server/licensing/e2e-cloud-integration.test.ts
 */

import { generateKeys, sign } from 'paseto-ts/v4'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SignupMode } from '../../shared/constants'
import { CloudUnboundError, createPairing, pollPairing, refreshEntitlement } from '../services/licensing-cloud'
import { adminHeaders, createTestApp, seedProLicense } from '../test/setup'
import { hasFeature, loadBindingState } from './has-feature'
import { getOrCreateInstanceId } from './instance-id'
import { createLicenseBinding, loadLicenseState } from './license-state'
import { PUBLIC_KEYS } from './public-keys'

const CLOUD_BASE_URL = process.env.ZPAN_CLOUD_URL ?? 'https://zpan-cloud.saltbo.workers.dev'
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

// ─── Phase 1: Live Cloud API contract verification ───────────────────────────

describe('E2E: zpan-cloud API contract', () => {
  it('POST /api/pairings creates a pairing with correct shape', async () => {
    const result = await createPairing(
      CLOUD_BASE_URL,
      `e2e-${Date.now()}`,
      'E2E Test Instance',
      'https://e2e-test.local',
    )

    expect(result).toMatchObject({
      code: expect.stringMatching(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/),
      pairing_url: expect.stringContaining('/pair?code='),
      expires_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    })
  })

  it('GET /api/pairings/:code returns pending for a fresh code', async () => {
    const pairing = await createPairing(
      CLOUD_BASE_URL,
      `e2e-poll-${Date.now()}`,
      'E2E Poll Test',
      'https://e2e-poll.local',
    )

    const result = await pollPairing(CLOUD_BASE_URL, pairing.code)

    expect(result.status).toBe('pending')
    expect(result.refresh_token).toBeUndefined()
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
    const state = await loadBindingState(db)

    expect(state.bound).toBe(false)
    expect(state.active).toBeUndefined()
    expect(state.edition).toBeUndefined()
    expect(state.license_valid_until).toBeUndefined()
    expect(state.certificate_expires_at).toBeUndefined()
  })

  it('hasFeature returns false for all Pro features when unbound', async () => {
    const { db } = await createTestApp()
    const state = await loadBindingState(db)

    expect(hasFeature('open_registration', state)).toBe(false)
    expect(hasFeature('white_label', state)).toBe(false)
    expect(hasFeature('teams_unlimited', state)).toBe(false)
    expect(hasFeature('storages_unlimited', state)).toBe(false)
  })

  it('PUT /api/system/options returns 402 when enabling open signup without Pro', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)

    const res = await app.request('/api/system/options/auth_signup_mode', {
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

    const state = await loadBindingState(db)

    expect(state.bound).toBe(true)
    expect(state.active).toBe(true)
    expect(state.edition).toBe('pro')
    expect(state.license_valid_until).toEqual(expect.any(Number))
    expect(state.certificate_expires_at).toEqual(expect.any(Number))
  })

  it('hasFeature returns true for all Pro features when bound', async () => {
    const { db } = await createTestApp()
    await seedProLicense(db)

    const state = await loadBindingState(db)

    expect(hasFeature('open_registration', state)).toBe(true)
    expect(hasFeature('white_label', state)).toBe(true)
    expect(hasFeature('teams_unlimited', state)).toBe(true)
    expect(hasFeature('storages_unlimited', state)).toBe(true)
  })

  it('PUT /api/system/options allows open signup with Pro license', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)

    const res = await app.request('/api/system/options/auth_signup_mode', {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: SignupMode.OPEN }),
    })

    expect(res.status).toBeLessThan(300) // 200 or 201
  })

  it('hasFeature enables every local Pro gate for an active binding', async () => {
    const { db } = await createTestApp()
    await seedProLicense(db)

    const state = await loadBindingState(db)

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
    await createLicenseBinding(db, {
      cloudBindingId: 'expired-binding',
      instanceId: 'test-instance',
      cloudAccountId: 'user-123',
      refreshToken: 'test-token',
      cachedCert: signLicenseAssertion({ expiresAt, licenseValidUntil: expiresAt }),
      cachedExpiresAt: expiresAt,
      lastRefreshAt: nowSec(),
    })

    const state = await loadBindingState(db)

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
  it('DELETE /api/licensing/binding removes binding and revokes features', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)

    // Verify features are active before unbind
    let state = await loadBindingState(db)
    expect(state.bound).toBe(true)
    expect(hasFeature('open_registration', state)).toBe(true)

    // Unbind
    const res = await app.request('/api/licensing/binding', {
      method: 'DELETE',
      headers,
    })
    expect(res.status).toBe(200)

    // Verify features are revoked after unbind
    state = await loadBindingState(db)
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
          pairing_url: 'https://cloud.zpan.space/pair?code=E2E-TST',
          expires_at: new Date(Date.now() + 900_000).toISOString(),
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    const pairRes = await app.request('/api/licensing/pair', {
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

    const pendingRes = await app.request('/api/licensing/pair/E2E-TST/poll', { headers })
    expect(pendingRes.status).toBe(200)
    expect(((await pendingRes.json()) as { status: string }).status).toBe('pending')

    const instanceId = await getOrCreateInstanceId(db)
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
          refresh_token: 'rt-e2e-secret',
          certificate: cert,
          binding: { id: 'e2e-binding', instance_id: instanceId, authorized_hosts: ['localhost'] },
          account: { id: 'user-123', email: 'user@example.com' },
        }),
        { headers: { 'Content-Type': 'application/json' } },
      ),
    )

    const approvedRes = await app.request('/api/licensing/pair/E2E-TST/poll', { headers })
    expect(approvedRes.status).toBe(200)
    const approvedBody = (await approvedRes.json()) as {
      status: string
      edition?: string
    }
    expect(approvedBody.status).toBe('approved')
    expect(approvedBody.edition).toBe('pro')

    // Step 4: Verify binding stored in DB
    const state2 = await loadLicenseState(db)
    expect(state2.refreshToken).toBe('rt-e2e-secret')
    expect(state2.cachedCert).toBeTruthy()

    // Step 5: Verify features are now active
    const state = await loadBindingState(db)
    expect(state.bound).toBe(true)
    expect(state.active).toBe(true)
    expect(state.edition).toBe('pro')
    expect(hasFeature('open_registration', state)).toBe(true)
    expect(hasFeature('white_label', state)).toBe(true)
    expect(hasFeature('teams_unlimited', state)).toBe(true)
    expect(hasFeature('storages_unlimited', state)).toBe(true)

    // Step 6: Open registration is now allowed
    const openRegRes = await app.request('/api/system/options/auth_signup_mode', {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: SignupMode.OPEN }),
    })
    expect(openRegRes.status).toBeLessThan(300) // 200 or 201

    // Step 7: Unbind — features revoked
    const unbindRes = await app.request('/api/licensing/binding', {
      method: 'DELETE',
      headers,
    })
    expect(unbindRes.status).toBe(200)

    const stateAfter = await loadBindingState(db)
    expect(stateAfter.bound).toBe(false)
    expect(hasFeature('open_registration', stateAfter)).toBe(false)

    // Step 8: Open registration blocked again
    const blockedRes = await app.request('/api/system/options/auth_signup_mode', {
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

    await createLicenseBinding(db, {
      cloudBindingId: 'fake-binding',
      instanceId: 'test-instance',
      cloudAccountId: 'test-account',
      refreshToken: 'test-token',
      cachedCert: fakePaseto,
      cachedExpiresAt: nowSec() + 3600,
      lastRefreshAt: nowSec(),
    })

    const state = await loadBindingState(db)

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
