// @vitest-environment node
//
// Unit tests for the licensing admin usecases (initiatePairing / pollPairing /
// triggerRefresh / unbindLicense). Fake ports throughout; the real (in-module)
// certificate verification runs against a test keypair swapped into PUBLIC_KEYS,
// so the cert-acceptance and rejection branches are exercised end to end.
//
// The cert→features→state derivation and the HTTP wiring are covered by
// license-policy.integration.test.ts and licensing-admin.integration.test.ts —
// this file does not duplicate them.

import { generateKeys, sign } from 'paseto-ts/v4'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PUBLIC_KEYS } from '../../domain/license-keys'
import {
  type ActivityRepo,
  AppError,
  type CloudInstanceInfo,
  type InstanceRepo,
  type LicenseBindingRepo,
  type LicenseState,
  type LicensingCloudGateway,
  type PairingPollResponse,
  type PairingResponse,
} from '../ports'
import { initiatePairing, pollPairing, triggerRefresh, unbindLicense } from './licensing'

// Asserts a rejected pairing carries the 502 INVALID_CERTIFICATE AppError with the
// rejection reason (+ optional cloud-unbind failure) folded into metadata.
function expectInvalidCertificate(
  out: { ok: boolean } & Record<string, unknown>,
  expected: { certificateReason: string; cloudUnbindError?: string },
) {
  expect(out.ok).toBe(false)
  const error = (out as unknown as { error: AppError }).error
  expect(error).toBeInstanceOf(AppError)
  expect(error.httpStatus).toBe(502)
  expect(error.message).toBe('Invalid certificate')
  expect(error.meta.reason).toBe('INVALID_CERTIFICATE')
  expect(error.meta.metadata).toEqual({
    certificateReason: expected.certificateReason,
    ...(expected.cloudUnbindError ? { cloudUnbindError: expected.cloudUnbindError } : {}),
  })
}

const BASE_URL = 'https://cloud.zpan.space'
const INSTANCE_ID = 'inst-1'
const HOST = 'localhost'

const { secretKey: TRUSTED_SECRET, publicKey: TRUSTED_PUBLIC } = generateKeys('public')
const { secretKey: UNTRUSTED_SECRET } = generateKeys('public')
const originalKeys: string[] = []

beforeAll(() => {
  originalKeys.push(...PUBLIC_KEYS)
  PUBLIC_KEYS.length = 0
  PUBLIC_KEYS.push(TRUSTED_PUBLIC)
})

afterAll(() => {
  PUBLIC_KEYS.length = 0
  for (const k of originalKeys.splice(0)) PUBLIC_KEYS.push(k)
})

function nowSec(): number {
  return Math.floor(Date.now() / 1000)
}

function signCert(opts: { instanceId?: string; secret?: string; expired?: boolean } = {}): string {
  const now = nowSec()
  return sign(opts.secret ?? TRUSTED_SECRET, {
    type: 'zpan.license',
    issuer: BASE_URL,
    subject: 'bind-1',
    accountId: 'acct-1',
    instanceId: opts.instanceId ?? INSTANCE_ID,
    edition: 'pro',
    authorizedHosts: [HOST],
    licenseValidUntil: now + 365 * 24 * 60 * 60,
    issuedAt: now,
    notBefore: now,
    expiresAt: opts.expired ? now - 1 : now + 3600,
  })
}

function makeInstanceRepo(): InstanceRepo {
  return {
    getOrCreateInstanceId: vi.fn(async () => INSTANCE_ID),
    getInstanceDisplayName: vi.fn(async () => 'My ZPan'),
  }
}

function makeActivityRepo() {
  const record = vi.fn(async () => {})
  const activity = { record } as unknown as ActivityRepo
  return { activity, record }
}

// A LicenseBindingRepo whose loadLicenseState returns the given state and whose
// mutating methods are spies, so tests assert what was persisted/cleared.
function makeBindingRepo(state: Partial<LicenseState> = {}) {
  const loaded: LicenseState = {
    id: 'lb-1',
    cloudBindingId: 'bind-1',
    cloudStoreId: 'store-1',
    instanceId: INSTANCE_ID,
    cloudAccountId: 'acct-1',
    cloudAccountEmail: 'owner@example.com',
    status: 'active',
    refreshToken: null,
    cachedCert: null,
    cachedExpiresAt: null,
    boundAt: nowSec(),
    disconnectedAt: null,
    lastRefreshAt: null,
    lastRefreshError: null,
    ...state,
  }
  const createLicenseBinding = vi.fn(async () => {})
  const clearLicenseBinding = vi.fn(async () => {})
  const licenseBinding = {
    loadLicenseState: vi.fn(async () => loaded),
    loadActiveLicenseBinding: vi.fn(async () => null),
    createLicenseBinding,
    updateLicenseBindingAfterRefresh: vi.fn(async () => {}),
    setLicenseRefreshError: vi.fn(async () => {}),
    clearLicenseBinding,
  } as unknown as LicenseBindingRepo
  return { licenseBinding, createLicenseBinding, clearLicenseBinding }
}

// Override values are loosely typed (the whole object is cast to the gateway
// below): this lets inline `vi.fn` fakes return literal `status` values without
// each call site re-annotating PairingPollResponse, while keeping key names checked.
function makeCloud(overrides: Partial<Record<keyof LicensingCloudGateway, (...args: never[]) => unknown>> = {}) {
  const cloud = {
    createPairing: vi.fn(async () => ({}) as PairingResponse),
    pollPairing: vi.fn(async () => ({ status: 'pending' }) as PairingPollResponse),
    refreshEntitlement: vi.fn(),
    unbindCloudLicense: vi.fn(async () => {}),
    confirmCloudLicense: vi.fn(async () => {}),
    createBoundCloudClient: vi.fn(),
    requestCloudJson: vi.fn(),
    ...overrides,
  } as unknown as LicensingCloudGateway
  return cloud
}

const RUNTIME = { runtime: 'node' as const, platform: 'node' as const }

beforeEach(() => vi.clearAllMocks())

describe('initiatePairing', () => {
  it('builds the instance info and returns the cloud pairing response', async () => {
    const pairing: PairingResponse = {
      code: 'ABC-123',
      pairingUrl: `${BASE_URL}/pair`,
      expiresAt: '2026-01-01T00:00:00Z',
    }
    const createPairing = vi.fn(async () => pairing)
    const deps = { instance: makeInstanceRepo(), licensingCloud: makeCloud({ createPairing }) }

    const result = await initiatePairing(deps, { baseUrl: BASE_URL, instanceUrl: 'http://localhost', runtime: RUNTIME })

    expect(result).toBe(pairing)
    expect(createPairing).toHaveBeenCalledTimes(1)
    const [calledBaseUrl, instance] = createPairing.mock.calls[0] as unknown as [string, CloudInstanceInfo]
    expect(calledBaseUrl).toBe(BASE_URL)
    expect(instance.id).toBe(INSTANCE_ID)
    expect(instance.url).toBe('http://localhost')
  })

  it('propagates a cloud-gateway error (handler maps it)', async () => {
    const createPairing = vi.fn(async () => {
      throw new Error('cloud down')
    })
    const deps = { instance: makeInstanceRepo(), licensingCloud: makeCloud({ createPairing }) }

    await expect(
      initiatePairing(deps, { baseUrl: BASE_URL, instanceUrl: 'http://localhost', runtime: RUNTIME }),
    ).rejects.toThrow('cloud down')
  })
})

describe('pollPairing', () => {
  const params = { baseUrl: BASE_URL, code: 'CODE-1', currentHost: HOST, userId: 'u1', orgId: 'o1' }

  function makeDeps(cloud: LicensingCloudGateway, binding = makeBindingRepo()) {
    const activity = makeActivityRepo()
    const deps = {
      instance: makeInstanceRepo(),
      licensingCloud: cloud,
      licenseBinding: binding.licenseBinding,
      activity: activity.activity,
    }
    return { deps, ...binding, ...activity }
  }

  it('returns the status unchanged when the cloud reports pending', async () => {
    const cloud = makeCloud({ pollPairing: vi.fn(async () => ({ status: 'pending' })) })
    const { deps, createLicenseBinding } = makeDeps(cloud)

    const out = await pollPairing(deps, params)

    expect(out).toEqual({ ok: true, status: 'pending' })
    expect(createLicenseBinding).not.toHaveBeenCalled()
  })

  it('forwards denied / expired statuses without persisting a binding', async () => {
    const cloud = makeCloud({ pollPairing: vi.fn(async () => ({ status: 'expired' })) })
    const { deps, createLicenseBinding } = makeDeps(cloud)

    const out = await pollPairing(deps, params)

    expect(out).toEqual({ ok: true, status: 'expired' })
    expect(createLicenseBinding).not.toHaveBeenCalled()
  })

  it('persists the binding, confirms with cloud, records activity, and returns approved on a valid cert', async () => {
    const certificate = signCert()
    const cloud = makeCloud({
      pollPairing: vi.fn(async () => ({
        status: 'approved',
        refreshToken: 'rt-secret',
        certificate,
        binding: { id: 'bind-1', instanceId: INSTANCE_ID, storeId: 'store-1', authorizedHosts: [HOST] },
        account: { id: 'acct-1', email: 'acct@example.com' },
      })),
    })
    const { deps, createLicenseBinding, record } = makeDeps(cloud)

    const out = await pollPairing(deps, params)

    expect(out).toEqual({ ok: true, status: 'approved', edition: 'pro', cloudStoreId: 'store-1' })
    expect(createLicenseBinding).toHaveBeenCalledWith(
      expect.objectContaining({
        cloudBindingId: 'bind-1',
        cloudStoreId: 'store-1',
        instanceId: INSTANCE_ID,
        refreshToken: 'rt-secret',
        cachedCert: certificate,
      }),
    )
    expect(cloud.confirmCloudLicense).toHaveBeenCalledWith(BASE_URL, 'bind-1', 'rt-secret')
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'license_pair', targetName: 'acct@example.com' }),
    )
  })

  it('still succeeds when the best-effort cloud confirm throws', async () => {
    const cloud = makeCloud({
      pollPairing: vi.fn(async () => ({
        status: 'approved',
        refreshToken: 'rt-secret',
        certificate: signCert(),
        binding: { id: 'bind-1', instanceId: INSTANCE_ID, storeId: 'store-1', authorizedHosts: [HOST] },
        account: { id: 'acct-1', email: 'acct@example.com' },
      })),
      confirmCloudLicense: vi.fn(async () => {
        throw new Error('confirm failed')
      }),
    })
    const { deps, createLicenseBinding } = makeDeps(cloud)

    const out = await pollPairing(deps, params)

    expect(out).toEqual({ ok: true, status: 'approved', edition: 'pro', cloudStoreId: 'store-1' })
    expect(createLicenseBinding).toHaveBeenCalled()
  })

  it('falls back to the account id for activity when the email is absent', async () => {
    const cloud = makeCloud({
      pollPairing: vi.fn(async () => ({
        status: 'approved',
        refreshToken: 'rt-secret',
        certificate: signCert(),
        binding: { id: 'bind-1', instanceId: INSTANCE_ID, storeId: 'store-1', authorizedHosts: [HOST] },
        account: { id: 'acct-1' },
      })),
    })
    const { deps, record } = makeDeps(cloud)

    await pollPairing(deps, params)

    expect(record).toHaveBeenCalledWith(expect.objectContaining({ targetName: 'acct-1' }))
  })

  it('rejects an untrusted-key cert and rolls back the orphaned cloud binding', async () => {
    const cloud = makeCloud({
      pollPairing: vi.fn(async () => ({
        status: 'approved',
        refreshToken: 'rt-secret',
        certificate: signCert({ secret: UNTRUSTED_SECRET }),
        binding: { id: 'cb-1', instanceId: INSTANCE_ID, storeId: 'store-1', authorizedHosts: [HOST] },
        account: { id: 'acct-1', email: 'owner@example.com' },
      })),
    })
    const { deps, createLicenseBinding, record } = makeDeps(cloud)

    const out = await pollPairing(deps, params)

    expectInvalidCertificate(out, { certificateReason: 'signature' })
    expect(cloud.unbindCloudLicense).toHaveBeenCalledWith(BASE_URL, 'cb-1', 'rt-secret')
    expect(createLicenseBinding).not.toHaveBeenCalled()
    expect(record).not.toHaveBeenCalled()
  })

  it('surfaces the specific claim rejection reason (wrong instance)', async () => {
    const cloud = makeCloud({
      pollPairing: vi.fn(async () => ({
        status: 'approved',
        refreshToken: 'rt-secret',
        certificate: signCert({ instanceId: 'other-instance' }),
        binding: { id: 'cb-1', instanceId: INSTANCE_ID, storeId: 'store-1', authorizedHosts: [HOST] },
        account: { id: 'acct-1', email: 'owner@example.com' },
      })),
    })
    const { deps } = makeDeps(cloud)

    const out = await pollPairing(deps, params)

    expectInvalidCertificate(out, { certificateReason: 'instance' })
  })

  it('reports no_certificate when the approval omits the cert (nothing to roll back)', async () => {
    const cloud = makeCloud({
      pollPairing: vi.fn(async () => ({ status: 'approved', refreshToken: 'rt-secret' })),
    })
    const { deps, createLicenseBinding } = makeDeps(cloud)

    const out = await pollPairing(deps, params)

    // No binding.id on the response → rollback is a no-op (null).
    expectInvalidCertificate(out, { certificateReason: 'no_certificate' })
    expect(cloud.unbindCloudLicense).not.toHaveBeenCalled()
    expect(createLicenseBinding).not.toHaveBeenCalled()
  })

  it('reports incomplete_response when the cert is valid but binding/account metadata is missing', async () => {
    const cloud = makeCloud({
      pollPairing: vi.fn(async () => ({ status: 'approved', refreshToken: 'rt-secret', certificate: signCert() })),
    })
    const { deps } = makeDeps(cloud)

    const out = await pollPairing(deps, params)

    expectInvalidCertificate(out, { certificateReason: 'incomplete_response' })
  })

  it('captures the cloud-unbind failure message during rollback', async () => {
    const cloud = makeCloud({
      pollPairing: vi.fn(async () => ({
        status: 'approved',
        refreshToken: 'rt-secret',
        certificate: signCert({ secret: UNTRUSTED_SECRET }),
        binding: { id: 'cb-1', instanceId: INSTANCE_ID, storeId: 'store-1', authorizedHosts: [HOST] },
        account: { id: 'acct-1', email: 'owner@example.com' },
      })),
      unbindCloudLicense: vi.fn(async () => {
        throw new Error('cloud rejected unbind')
      }),
    })
    const { deps } = makeDeps(cloud)

    const out = await pollPairing(deps, params)

    expectInvalidCertificate(out, { certificateReason: 'signature', cloudUnbindError: 'cloud rejected unbind' })
  })
})

describe('triggerRefresh', () => {
  const params = { baseUrl: BASE_URL, instanceUrl: 'http://localhost', runtime: RUNTIME, userId: 'u1', orgId: 'o1' }

  it('runs the refresh, records activity, and returns the resulting last_refresh_at', async () => {
    const cert = signCert()
    const refreshAt = nowSec()
    const refreshEntitlement = vi.fn(async () => ({
      refreshToken: 'new-token',
      certificate: cert,
      binding: { id: 'bind-1', instanceId: INSTANCE_ID, storeId: 'store-1', authorizedHosts: [HOST] },
      account: { id: 'acct-1', email: 'acct@example.com' },
    }))
    const binding = makeBindingRepo({ refreshToken: 'old-token', lastRefreshAt: refreshAt })
    const cloud = makeCloud({ refreshEntitlement })
    const activity = makeActivityRepo()
    const deps = {
      instance: makeInstanceRepo(),
      licensingCloud: cloud,
      licenseBinding: binding.licenseBinding,
      activity: activity.activity,
    }

    const out = await triggerRefresh(deps, params)

    expect(refreshEntitlement).toHaveBeenCalledTimes(1)
    expect(out).toEqual({ lastRefreshAt: refreshAt })
    expect(activity.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'license_refresh', targetName: 'license binding' }),
    )
  })

  it('returns last_refresh_at null and skips the cloud call when unbound', async () => {
    const binding = makeBindingRepo({ refreshToken: null, lastRefreshAt: null })
    const cloud = makeCloud()
    const activity = makeActivityRepo()
    const deps = {
      instance: makeInstanceRepo(),
      licensingCloud: cloud,
      licenseBinding: binding.licenseBinding,
      activity: activity.activity,
    }

    const out = await triggerRefresh(deps, params)

    expect(out).toEqual({ lastRefreshAt: null })
    expect(cloud.refreshEntitlement).not.toHaveBeenCalled()
    expect(activity.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'license_refresh' }))
  })
})

describe('unbindLicense', () => {
  const params = { baseUrl: BASE_URL, userId: 'u1', orgId: 'o1' }

  it('unbinds from cloud, clears the local binding, and records activity', async () => {
    const binding = makeBindingRepo({ refreshToken: 'old-token', cloudBindingId: 'bind-1' })
    const cloud = makeCloud()
    const activity = makeActivityRepo()
    const deps = { licensingCloud: cloud, licenseBinding: binding.licenseBinding, activity: activity.activity }

    const out = await unbindLicense(deps, params)

    expect(out).toEqual({ ok: true })
    expect(cloud.unbindCloudLicense).toHaveBeenCalledWith(BASE_URL, 'bind-1', 'old-token')
    expect(binding.clearLicenseBinding).toHaveBeenCalledTimes(1)
    expect(activity.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'license_disconnect', metadata: undefined }),
    )
  })

  it('still clears locally and records the error when the cloud unbind fails', async () => {
    const binding = makeBindingRepo({ refreshToken: 'old-token', cloudBindingId: 'bind-1' })
    const cloud = makeCloud({
      unbindCloudLicense: vi.fn(async () => {
        throw new Error('Cloud unbind failed: 401')
      }),
    })
    const activity = makeActivityRepo()
    const deps = { licensingCloud: cloud, licenseBinding: binding.licenseBinding, activity: activity.activity }

    const out = await unbindLicense(deps, params)

    expect(out.ok).toBe(false)
    if (!out.ok) {
      expect(out.error.httpStatus).toBe(502)
      expect(out.error.meta.reason).toBe('CLOUD_UNBIND_FAILED')
      expect(out.error.meta.metadata).toEqual({ cloudUnbindError: 'Cloud unbind failed: 401' })
    }
    expect(binding.clearLicenseBinding).toHaveBeenCalledTimes(1)
    expect(activity.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'license_disconnect',
        metadata: { cloudUnbindError: 'Cloud unbind failed: 401' },
      }),
    )
  })

  it('skips the cloud call but still clears and records when no binding exists', async () => {
    const binding = makeBindingRepo({ refreshToken: null })
    const cloud = makeCloud()
    const activity = makeActivityRepo()
    const deps = { licensingCloud: cloud, licenseBinding: binding.licenseBinding, activity: activity.activity }

    const out = await unbindLicense(deps, params)

    expect(out).toEqual({ ok: true })
    expect(cloud.unbindCloudLicense).not.toHaveBeenCalled()
    expect(binding.clearLicenseBinding).toHaveBeenCalledTimes(1)
    expect(activity.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'license_disconnect' }))
  })
})
