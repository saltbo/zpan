// @vitest-environment node
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { generateKeys, sign } from 'paseto-ts/v4'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLicensingCloudGateway } from '../adapters/gateways/licensing-cloud'
import { createLicenseBindingRepo } from '../adapters/repos/license-binding'
import * as authSchema from '../db/auth-schema'
import * as appSchema from '../db/schema'
import { PUBLIC_KEYS } from '../domain/license-keys'
import { performRefresh, runLicensingRefresh } from './licensing'
import type { CreateLicenseBindingInput, EntitlementRefreshResponse, LicensingCloudGateway } from './ports'

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS license_bindings (
    id TEXT PRIMARY KEY,
    cloud_binding_id TEXT NOT NULL,
    cloud_store_id TEXT,
    instance_id TEXT NOT NULL,
    cloud_account_id TEXT NOT NULL,
    cloud_account_email TEXT,
    status TEXT NOT NULL,
    refresh_token TEXT,
    cached_certificate TEXT,
    cached_certificate_expires_at INTEGER,
    bound_at INTEGER NOT NULL,
    disconnected_at INTEGER,
    last_refresh_at INTEGER,
    last_refresh_error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS license_bindings_active_uniq ON license_bindings(status) WHERE status = 'active';
  CREATE INDEX IF NOT EXISTS license_bindings_cloud_binding_idx ON license_bindings(cloud_binding_id);
  CREATE INDEX IF NOT EXISTS license_bindings_instance_idx ON license_bindings(instance_id);
`

const { secretKey: TEST_SECRET, publicKey: TEST_PUBLIC } = generateKeys('public')
const originalKeys: string[] = []

beforeAll(() => {
  originalKeys.push(...PUBLIC_KEYS)
  PUBLIC_KEYS.length = 0
  PUBLIC_KEYS.push(TEST_PUBLIC)
})

afterAll(() => {
  PUBLIC_KEYS.length = 0
  for (const k of originalKeys) PUBLIC_KEYS.push(k)
})

function makeDb() {
  const sqlite = new Database(':memory:')
  sqlite.exec(SCHEMA_SQL)
  return drizzle(sqlite, { schema: { ...appSchema, ...authSchema } })
}

type DB = ReturnType<typeof makeDb>

function nowSec(): number {
  return Math.floor(Date.now() / 1000)
}

function signAssertion(overrides: Record<string, unknown> = {}): string {
  const now = nowSec()
  return sign(TEST_SECRET, {
    type: 'zpan.license',
    issuer: 'https://cloud.zpan.space',
    subject: 'bind-1',
    accountId: 'acct-1',
    instanceId: 'inst-abc',
    storeId: 'store-1',
    edition: 'pro',
    authorizedHosts: [],
    licenseValidUntil: now + 365 * 24 * 60 * 60,
    issuedAt: now,
    notBefore: now,
    expiresAt: now + 3600,
    ...overrides,
  })
}

async function seedBinding(db: DB, overrides: Partial<CreateLicenseBindingInput> & { lastRefreshError?: string } = {}) {
  const now = nowSec()
  const lastRefreshError = overrides.lastRefreshError
  await createLicenseBindingRepo(db).createLicenseBinding({
    cloudBindingId: 'bind-1',
    cloudStoreId: 'store-old',
    instanceId: 'inst-abc',
    cloudAccountId: 'acct-1',
    refreshToken: 'old-rt',
    cachedCert: signAssertion(),
    cachedExpiresAt: now + 3600,
    lastRefreshAt: now,
    ...overrides,
  })
  if (lastRefreshError) {
    await db.update(appSchema.licenseBindings).set({ lastRefreshError })
  }
}

describe('performRefresh', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('is a no-op when no binding exists', async () => {
    const db = makeDb()
    await expect(
      performRefresh(
        { licensingCloud: createLicensingCloudGateway(), licenseBinding: createLicenseBindingRepo(db) },
        'https://cloud.zpan.space',
      ),
    ).resolves.toBeUndefined()
  })

  it('rotates refreshToken and stores PASETO certificate from cloud', async () => {
    const db = makeDb()
    await seedBinding(db)

    const cert = signAssertion({ expiresAt: nowSec() + 86400 })

    const cloudPayload = {
      refreshToken: 'new-rt',
      certificate: cert,
      binding: { id: 'bind-1', storeId: 'store-new', instanceId: 'inst-abc', authorizedHosts: [] },
      account: { id: 'acct-1', email: 'acct@example.com' },
    }
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => cloudPayload,
      text: async () => '',
    } as unknown as Response)

    await performRefresh(
      { licensingCloud: createLicensingCloudGateway(), licenseBinding: createLicenseBindingRepo(db) },
      'https://cloud.zpan.space',
    )

    const state = await createLicenseBindingRepo(db).loadLicenseState()
    expect(state.refreshToken).toBe('new-rt')
    expect(state.cloudStoreId).toBe('store-new')
    expect(state.cachedCert).toBe(cert)
    expect(state.lastRefreshAt).toBeTruthy()
    expect(state.lastRefreshError).toBeNull()
  })

  it('stores raw PASETO cert and extracts expiresAt metadata', async () => {
    const db = makeDb()
    await seedBinding(db)

    const expiresAt = nowSec() + 3600
    const cert = signAssertion({ expiresAt })

    const cloudPayload = {
      refreshToken: 'new-rt-paseto',
      certificate: cert,
      binding: { id: 'bind-1', storeId: 'store-new', instanceId: 'inst-abc', authorizedHosts: [] },
      account: { id: 'acct-1', email: 'acct@example.com' },
    }
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => cloudPayload,
      text: async () => '',
    } as unknown as Response)

    await performRefresh(
      { licensingCloud: createLicensingCloudGateway(), licenseBinding: createLicenseBindingRepo(db) },
      'https://cloud.zpan.space',
    )

    const state = await createLicenseBindingRepo(db).loadLicenseState()
    expect(state.refreshToken).toBe('new-rt-paseto')
    expect(state.cachedCert).toBe(cert)
    expect(state.cachedExpiresAt).toBe(expiresAt)
  })

  it('clears binding on CloudUnboundError (401)', async () => {
    const db = makeDb()
    await seedBinding(db)

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({}),
      text: async () => '',
    } as unknown as Response)

    await performRefresh(
      { licensingCloud: createLicensingCloudGateway(), licenseBinding: createLicenseBindingRepo(db) },
      'https://cloud.zpan.space',
    )

    const state = await createLicenseBindingRepo(db).loadLicenseState()
    expect(state.refreshToken).toBeNull()
  })

  it('updates last_refresh_error on network error, keeps binding', async () => {
    const db = makeDb()
    await seedBinding(db)

    vi.mocked(fetch).mockRejectedValueOnce(new Error('Connection timeout'))

    await performRefresh(
      { licensingCloud: createLicensingCloudGateway(), licenseBinding: createLicenseBindingRepo(db) },
      'https://cloud.zpan.space',
    )

    const state = await createLicenseBindingRepo(db).loadLicenseState()
    expect(state.refreshToken).toBe('old-rt')
    expect(state.lastRefreshError).toBe('Connection timeout')
  })

  it('keeps the previous binding when cloud returns an invalid certificate', async () => {
    const db = makeDb()
    await seedBinding(db, {
      cachedCert: 'old-cert',
      cachedExpiresAt: 1234567890,
    })

    const cert = signAssertion({ instanceId: 'wrong-instance' })

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        refreshToken: 'new-rt',
        certificate: cert,
        binding: { id: 'bind-1', instanceId: 'wrong-instance', authorizedHosts: [] },
        account: { id: 'acct-1', email: 'acct@example.com' },
      }),
      text: async () => '',
    } as unknown as Response)

    await performRefresh(
      { licensingCloud: createLicensingCloudGateway(), licenseBinding: createLicenseBindingRepo(db) },
      'https://cloud.zpan.space',
    )

    const state = await createLicenseBindingRepo(db).loadLicenseState()
    expect(state.refreshToken).toBe('old-rt')
    expect(state.cachedCert).toBe('old-cert')
    expect(state.cachedExpiresAt).toBe(1234567890)
    expect(state.lastRefreshError).toBe('Invalid certificate from cloud')
  })

  it('keeps the previous binding when cloud omits certificate', async () => {
    const db = makeDb()
    await seedBinding(db)

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        refreshToken: 'new-rt',
        binding: { id: 'bind-1', instanceId: 'inst-abc', authorizedHosts: [] },
        account: { id: 'acct-1', email: 'acct@example.com' },
      }),
      text: async () => '',
    } as unknown as Response)

    await performRefresh(
      { licensingCloud: createLicensingCloudGateway(), licenseBinding: createLicenseBindingRepo(db) },
      'https://cloud.zpan.space',
    )

    const state = await createLicenseBindingRepo(db).loadLicenseState()
    expect(state.refreshToken).toBe('old-rt')
    expect(state.lastRefreshError).toBe('Cloud response missing certificate')
  })
})

describe('runLicensingRefresh', () => {
  const CLOUD_URL = 'https://cloud.zpan.space'

  function fakeCloud(refreshEntitlement: LicensingCloudGateway['refreshEntitlement']): LicensingCloudGateway {
    return { refreshEntitlement } as unknown as LicensingCloudGateway
  }

  function successPayload(): EntitlementRefreshResponse {
    return {
      refreshToken: 'new-rt',
      certificate: signAssertion({ expiresAt: nowSec() + 86400 }),
      binding: { id: 'bind-1', instanceId: 'inst-abc', storeId: 'store-new', authorizedHosts: [] },
      account: { id: 'acct-1', email: 'acct@example.com' },
    }
  }

  it('is a no-op (never calls cloud) when no binding exists', async () => {
    const db = makeDb()
    const refresh = vi.fn(async () => successPayload())

    await expect(
      runLicensingRefresh(
        { licenseBinding: createLicenseBindingRepo(db), licensingCloud: fakeCloud(refresh) },
        CLOUD_URL,
      ),
    ).resolves.toBeUndefined()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('skips the refresh when lastRefreshAt is within the 5-minute dedup window', async () => {
    const db = makeDb()
    await seedBinding(db, { lastRefreshAt: nowSec() - 120 })
    const refresh = vi.fn(async () => successPayload())

    await runLicensingRefresh(
      { licenseBinding: createLicenseBindingRepo(db), licensingCloud: fakeCloud(refresh) },
      CLOUD_URL,
    )

    expect(refresh).not.toHaveBeenCalled()
  })

  it('refreshes when lastRefreshAt is older than the dedup window', async () => {
    const db = makeDb()
    await seedBinding(db, { lastRefreshAt: nowSec() - 600 })
    const refresh = vi.fn(async () => successPayload())

    await runLicensingRefresh(
      { licenseBinding: createLicenseBindingRepo(db), licensingCloud: fakeCloud(refresh) },
      CLOUD_URL,
    )

    expect(refresh).toHaveBeenCalledOnce()
  })

  it('refreshes when lastRefreshAt is null', async () => {
    const db = makeDb()
    await seedBinding(db)
    await db.update(appSchema.licenseBindings).set({ lastRefreshAt: null })
    const refresh = vi.fn(async () => successPayload())

    await runLicensingRefresh(
      { licenseBinding: createLicenseBindingRepo(db), licensingCloud: fakeCloud(refresh) },
      CLOUD_URL,
    )

    expect(refresh).toHaveBeenCalledOnce()
  })

  it('logs licensing.refresh.ok on a successful refresh', async () => {
    const db = makeDb()
    await seedBinding(db, { lastRefreshAt: nowSec() - 600 })
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const refresh = vi.fn(async () => successPayload())

    await runLicensingRefresh(
      { licenseBinding: createLicenseBindingRepo(db), licensingCloud: fakeCloud(refresh) },
      CLOUD_URL,
    )

    expect(consoleSpy).toHaveBeenCalledWith('licensing.refresh.ok')
    consoleSpy.mockRestore()
  })

  it('swallows and logs licensing.refresh.error when the refresh propagates a failure', async () => {
    const db = makeDb()
    await seedBinding(db, { lastRefreshAt: nowSec() - 600 })
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    // A non-Error rejection is the only failure performRefresh re-throws; an Error
    // is swallowed internally as a refresh-error on the binding.
    const refresh = vi.fn(async () => {
      throw 'cloud exploded'
    })

    await expect(
      runLicensingRefresh(
        { licenseBinding: createLicenseBindingRepo(db), licensingCloud: fakeCloud(refresh) },
        CLOUD_URL,
      ),
    ).resolves.toBeUndefined()

    expect(consoleSpy).toHaveBeenCalledWith('licensing.refresh.error code=cloud exploded')
    consoleSpy.mockRestore()
  })
})
