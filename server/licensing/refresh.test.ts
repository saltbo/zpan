// @vitest-environment node
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { generateKeys, sign } from 'paseto-ts/v4'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as authSchema from '../db/auth-schema'
import * as appSchema from '../db/schema'
import { invalidateEntitlementCache } from './entitlement'
import { createLicenseBinding, loadLicenseState } from './license-state'
import { PUBLIC_KEYS } from './public-keys'
import { performRefresh } from './refresh'

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS license_bindings (
    id TEXT PRIMARY KEY,
    cloud_binding_id TEXT NOT NULL,
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
    edition: 'pro',
    authorizedHosts: [],
    licenseValidUntil: now + 365 * 24 * 60 * 60,
    issuedAt: now,
    notBefore: now,
    expiresAt: now + 3600,
    ...overrides,
  })
}

async function seedBinding(
  db: DB,
  overrides: Partial<Parameters<typeof createLicenseBinding>[1]> & { lastRefreshError?: string } = {},
) {
  const now = nowSec()
  const lastRefreshError = overrides.lastRefreshError
  await createLicenseBinding(db, {
    cloudBindingId: 'bind-1',
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
    invalidateEntitlementCache()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('is a no-op when no binding exists', async () => {
    const db = makeDb()
    await expect(performRefresh(db, 'https://cloud.zpan.space')).resolves.toBeUndefined()
  })

  it('rotates refresh_token and stores PASETO certificate from cloud', async () => {
    const db = makeDb()
    await seedBinding(db)

    const cert = signAssertion({ expiresAt: nowSec() + 86400 })

    const cloudPayload = {
      refresh_token: 'new-rt',
      certificate: cert,
      binding: { id: 'bind-1', instance_id: 'inst-abc', authorized_hosts: [] },
      account: { id: 'acct-1', email: 'acct@example.com' },
    }
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => cloudPayload,
      text: async () => '',
    } as unknown as Response)

    await performRefresh(db, 'https://cloud.zpan.space')

    const state = await loadLicenseState(db)
    expect(state.refreshToken).toBe('new-rt')
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
      refresh_token: 'new-rt-paseto',
      certificate: cert,
      binding: { id: 'bind-1', instance_id: 'inst-abc', authorized_hosts: [] },
      account: { id: 'acct-1', email: 'acct@example.com' },
    }
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => cloudPayload,
      text: async () => '',
    } as unknown as Response)

    await performRefresh(db, 'https://cloud.zpan.space')

    const state = await loadLicenseState(db)
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

    await performRefresh(db, 'https://cloud.zpan.space')

    const state = await loadLicenseState(db)
    expect(state.refreshToken).toBeNull()
  })

  it('updates last_refresh_error on network error, keeps binding', async () => {
    const db = makeDb()
    await seedBinding(db)

    vi.mocked(fetch).mockRejectedValueOnce(new Error('Connection timeout'))

    await performRefresh(db, 'https://cloud.zpan.space')

    const state = await loadLicenseState(db)
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
        refresh_token: 'new-rt',
        certificate: cert,
        binding: { id: 'bind-1', instance_id: 'wrong-instance', authorized_hosts: [] },
        account: { id: 'acct-1', email: 'acct@example.com' },
      }),
      text: async () => '',
    } as unknown as Response)

    await performRefresh(db, 'https://cloud.zpan.space')

    const state = await loadLicenseState(db)
    expect(state.refreshToken).toBe('old-rt')
    expect(state.cachedCert).toBe('old-cert')
    expect(state.cachedExpiresAt).toBe(1234567890)
    expect(state.lastRefreshError).toBe('Invalid certificate from cloud')
  })
})
