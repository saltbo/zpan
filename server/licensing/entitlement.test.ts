// @vitest-environment node
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { generateKeys, sign } from 'paseto-ts/v4'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import * as authSchema from '../db/auth-schema'
import * as appSchema from '../db/schema'
import { invalidateEntitlementCache, loadEntitlement } from './entitlement'
import { PUBLIC_KEYS } from './public-keys'

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS license_binding (
    id INTEGER PRIMARY KEY,
    instance_id TEXT NOT NULL,
    cloud_account_id TEXT,
    cloud_account_email TEXT,
    refresh_token TEXT NOT NULL,
    cached_cert TEXT,
    cached_expires_at INTEGER,
    last_refresh_at INTEGER,
    last_refresh_error TEXT,
    bound_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS system_options (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT '',
    public INTEGER DEFAULT 0
  );
`

// Generate a fresh throwaway keypair for this test suite.
// We inject the public key into PUBLIC_KEYS so verifyCertificate sees it,
// and restore the original array after all tests complete.
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

describe('loadEntitlement', () => {
  beforeEach(() => {
    invalidateEntitlementCache()
  })

  afterEach(() => {
    invalidateEntitlementCache()
  })

  it('returns null when no binding row exists', async () => {
    const db = makeDb()
    const result = await loadEntitlement(db)
    expect(result).toBeNull()
  })

  it('returns null when binding has no cachedCert', async () => {
    const db = makeDb()
    await db.insert(appSchema.licenseBinding).values({
      id: 1,
      instanceId: 'inst-1',
      refreshToken: 'token',
      cachedCert: null,
      cachedExpiresAt: null,
      lastRefreshAt: null,
      lastRefreshError: null,
      boundAt: null,
    })

    const result = await loadEntitlement(db)
    expect(result).toBeNull()
  })

  it('returns entitlement summary for a valid PASETO cert', async () => {
    const db = makeDb()

    const cert = sign(TEST_SECRET, {
      account_id: 'acct-1',
      instance_id: 'inst-1',
      plan: 'pro',
      features: ['white_label'],
      issued_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    })

    await db.insert(appSchema.licenseBinding).values({
      id: 1,
      instanceId: 'inst-1',
      refreshToken: 'token',
      cachedCert: cert,
      cachedExpiresAt: null,
      lastRefreshAt: null,
      lastRefreshError: null,
      boundAt: null,
    })

    const result = await loadEntitlement(db)
    expect(result).not.toBeNull()
    expect(result?.plan).toBe('pro')
    expect(result?.features).toEqual(['white_label'])
  })

  it('returns null for an invalid/expired PASETO cert', async () => {
    const db = makeDb()

    const cert = sign(TEST_SECRET, {
      account_id: 'acct-1',
      instance_id: 'inst-1',
      plan: 'pro',
      features: ['white_label'],
      issued_at: new Date(Date.now() - 100000).toISOString(),
      expires_at: new Date(Date.now() - 1000).toISOString(), // expired
    })

    await db.insert(appSchema.licenseBinding).values({
      id: 1,
      instanceId: 'inst-1',
      refreshToken: 'token',
      cachedCert: cert,
      cachedExpiresAt: null,
      lastRefreshAt: null,
      lastRefreshError: null,
      boundAt: null,
    })

    const result = await loadEntitlement(db)
    expect(result).toBeNull()
  })
})

describe('invalidateEntitlementCache', () => {
  it('clears cached state so next call re-reads from DB', async () => {
    const db = makeDb()

    // Load once — result is null, cached
    await loadEntitlement(db)

    // Now insert a binding
    const cert = sign(TEST_SECRET, {
      account_id: 'acct-1',
      instance_id: 'inst-1',
      plan: 'pro',
      features: ['team_quotas'],
      issued_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    })

    await db.insert(appSchema.licenseBinding).values({
      id: 1,
      instanceId: 'inst-1',
      refreshToken: 'token',
      cachedCert: cert,
      cachedExpiresAt: null,
      lastRefreshAt: null,
      lastRefreshError: null,
      boundAt: null,
    })

    // Without invalidation, the cached null would be returned
    invalidateEntitlementCache()

    const result = await loadEntitlement(db)
    expect(result?.plan).toBe('pro')
  })
})
