// @vitest-environment node
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { generateKeys, sign } from 'paseto-ts/v4'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as authSchema from '../db/auth-schema'
import * as appSchema from '../db/schema'
import { invalidateEntitlementCache } from './entitlement'
import { LICENSE_KEYS, setLicenseOptions } from './license-state'
import { PUBLIC_KEYS } from './public-keys'
import { performRefresh } from './refresh'

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS system_options (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT '',
    public INTEGER DEFAULT 0
  );
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

function futureIso(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString()
}

function makeDb() {
  const sqlite = new Database(':memory:')
  sqlite.exec(SCHEMA_SQL)
  return drizzle(sqlite, { schema: { ...appSchema, ...authSchema } })
}

type DB = ReturnType<typeof makeDb>

async function seedBinding(db: DB, overrides: Partial<Record<string, string>> = {}) {
  await setLicenseOptions(db, {
    [LICENSE_KEYS.instanceId]: 'inst-abc',
    [LICENSE_KEYS.refreshToken]: 'old-rt',
    ...overrides,
  })
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

    const cert = sign(TEST_SECRET, {
      account_id: 'acct-1',
      instance_id: 'inst-abc',
      plan: 'pro',
      features: ['white_label'],
      issued_at: new Date().toISOString(),
      expires_at: futureIso(86400000),
    })

    const cloudPayload = { refresh_token: 'new-rt', certificate: cert }
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => cloudPayload,
      text: async () => '',
    } as unknown as Response)

    await performRefresh(db, 'https://cloud.zpan.space')

    const { loadLicenseState } = await import('./license-state')
    const state = await loadLicenseState(db)
    expect(state.refreshToken).toBe('new-rt')
    expect(state.cachedCert).toBe(cert)
    expect(state.lastRefreshAt).toBeTruthy()
    expect(state.lastRefreshError).toBeNull()
  })

  it('stores raw PASETO cert and extracts expiresAt metadata', async () => {
    const db = makeDb()
    await seedBinding(db)

    const cert = sign(TEST_SECRET, {
      account_id: 'acct-1',
      instance_id: 'inst-abc',
      plan: 'pro',
      features: ['white_label'],
      issued_at: new Date().toISOString(),
      expires_at: futureIso(3_600_000),
    })

    const cloudPayload = { refresh_token: 'new-rt-paseto', certificate: cert }
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => cloudPayload,
      text: async () => '',
    } as unknown as Response)

    await performRefresh(db, 'https://cloud.zpan.space')

    const { loadLicenseState } = await import('./license-state')
    const state = await loadLicenseState(db)
    expect(state.refreshToken).toBe('new-rt-paseto')
    expect(state.cachedCert).toBe(cert)
    expect(state.cachedExpiresAt).toBeTruthy()
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

    const { loadLicenseState } = await import('./license-state')
    const state = await loadLicenseState(db)
    expect(state.refreshToken).toBeNull()
  })

  it('updates last_refresh_error on network error, keeps binding', async () => {
    const db = makeDb()
    await seedBinding(db)

    vi.mocked(fetch).mockRejectedValueOnce(new Error('Connection timeout'))

    await performRefresh(db, 'https://cloud.zpan.space')

    const { loadLicenseState } = await import('./license-state')
    const state = await loadLicenseState(db)
    expect(state.refreshToken).toBe('old-rt')
    expect(state.lastRefreshError).toBe('Connection timeout')
  })

  it('keeps the previous binding when cloud returns an invalid certificate', async () => {
    const db = makeDb()
    await seedBinding(db, {
      [LICENSE_KEYS.cachedCert]: 'old-cert',
      [LICENSE_KEYS.cachedExpiresAt]: '1234567890',
    })

    const cert = sign(TEST_SECRET, {
      account_id: 'acct-1',
      instance_id: 'wrong-instance',
      plan: 'pro',
      features: ['white_label'],
      issued_at: new Date().toISOString(),
      expires_at: futureIso(3_600_000),
    })

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ refresh_token: 'new-rt', certificate: cert }),
      text: async () => '',
    } as unknown as Response)

    await performRefresh(db, 'https://cloud.zpan.space')

    const { loadLicenseState } = await import('./license-state')
    const state = await loadLicenseState(db)
    expect(state.refreshToken).toBe('old-rt')
    expect(state.cachedCert).toBe('old-cert')
    expect(state.cachedExpiresAt).toBe(1234567890)
    expect(state.lastRefreshError).toBe('Invalid certificate from cloud')
  })
})
