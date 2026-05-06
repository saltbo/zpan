// @vitest-environment node
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { generateKeys, sign } from 'paseto-ts/v4'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import * as authSchema from '../db/auth-schema'
import * as appSchema from '../db/schema'
import { invalidateEntitlementCache, loadEntitlement } from './entitlement'
import { createLicenseBinding } from './license-state'
import { PUBLIC_KEYS } from './public-keys'

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
    instanceId: 'inst-1',
    edition: 'pro',
    authorizedHosts: [],
    licenseValidUntil: now + 365 * 24 * 60 * 60,
    issuedAt: now,
    notBefore: now,
    expiresAt: now + 3600,
    ...overrides,
  })
}

async function seedBinding(db: DB, cachedCert: string | null) {
  const now = nowSec()
  await createLicenseBinding(db, {
    cloudBindingId: 'bind-1',
    instanceId: 'inst-1',
    cloudAccountId: 'acct-1',
    refreshToken: 'token',
    cachedCert: cachedCert ?? '',
    cachedExpiresAt: now + 3600,
    lastRefreshAt: now,
  })
  if (cachedCert === null) {
    await db.update(appSchema.licenseBindings).set({ cachedCertificate: null })
  }
}

describe('loadEntitlement', () => {
  beforeEach(() => {
    invalidateEntitlementCache()
  })

  afterEach(() => {
    invalidateEntitlementCache()
  })

  it('returns null when no binding exists', async () => {
    const db = makeDb()
    const result = await loadEntitlement(db)
    expect(result).toBeNull()
  })

  it('returns null when binding has no cachedCert', async () => {
    const db = makeDb()
    await seedBinding(db, null)

    const result = await loadEntitlement(db)
    expect(result).toBeNull()
  })

  it('returns entitlement summary for a valid PASETO assertion', async () => {
    const db = makeDb()
    const licenseValidUntil = nowSec() + 365 * 24 * 60 * 60
    const certificateExpiresAt = nowSec() + 3600

    await seedBinding(
      db,
      signAssertion({
        licenseValidUntil,
        expiresAt: certificateExpiresAt,
      }),
    )

    const result = await loadEntitlement(db)
    expect(result).not.toBeNull()
    expect(result?.edition).toBe('pro')
    expect(result?.licenseValidUntil).toBe(licenseValidUntil)
    expect(result?.certificateExpiresAt).toBe(certificateExpiresAt)
  })

  it('returns null for an expired PASETO assertion', async () => {
    const db = makeDb()

    await seedBinding(
      db,
      signAssertion({ issuedAt: nowSec() - 100, notBefore: nowSec() - 100, expiresAt: nowSec() - 1 }),
    )

    const result = await loadEntitlement(db)
    expect(result).toBeNull()
  })
})

describe('invalidateEntitlementCache', () => {
  it('clears cached state so next call re-reads from DB', async () => {
    const db = makeDb()

    await loadEntitlement(db)

    await seedBinding(db, signAssertion())

    invalidateEntitlementCache()

    const result = await loadEntitlement(db)
    expect(result?.edition).toBe('pro')
  })
})
