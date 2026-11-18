import { symmetricEncrypt } from 'better-auth/crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  classifyJwkEncryption,
  createBetterAuthLogSink,
  createJwksDecryptMonitor,
  findUndecryptableJwks,
  isJwksDecryptFailure,
  JWKS_DECRYPT_FAILED_EVENT,
  type StoredJwk,
} from './jwks-decrypt-monitor'

const LEGACY = 'legacy-secret-that-is-at-least-32-characters'
const OTHER = 'other-legacy-secret-at-least-32-characters'
const V1 = 'version-one-secret-that-is-at-least-32-chars'
const V2 = 'version-two-secret-that-is-at-least-32-chars'
const PRIVATE_JWK = JSON.stringify({ kty: 'OKP', crv: 'Ed25519', d: 'private-d', x: 'public-x' })
const DECRYPT_ERROR = new Error(
  'Failed to decrypt private key. Make sure the secret currently in use is the same as the one used to encrypt the private key.',
)

async function legacyKey(id: string, secret: string): Promise<StoredJwk> {
  const ciphertext = await symmetricEncrypt({ key: secret, data: PRIVATE_JWK })
  return { id, alg: 'EdDSA', privateKey: JSON.stringify(ciphertext), expiresAt: null }
}

async function versionedKey(id: string, version: number, secret: string): Promise<StoredJwk> {
  const ciphertext = await symmetricEncrypt({
    key: { keys: new Map([[version, secret]]), currentVersion: version },
    data: PRIVATE_JWK,
  })
  return { id, alg: 'EdDSA', privateKey: JSON.stringify(ciphertext), expiresAt: null }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('isJwksDecryptFailure', () => {
  it('matches the better-auth decrypt error in the message, an Error argument, or its cause', () => {
    expect(isJwksDecryptFailure('Failed to decrypt private key. Make sure…')).toBe(true)
    expect(isJwksDecryptFailure('BetterAuthError', [DECRYPT_ERROR])).toBe(true)
    expect(isJwksDecryptFailure('INTERNAL_SERVER_ERROR', [new Error('wrapped', { cause: DECRYPT_ERROR })])).toBe(true)
  })

  it('ignores unrelated log calls', () => {
    expect(isJwksDecryptFailure('Invalid origin', [new Error('nope'), { status: 500 }, 42, null])).toBe(false)
    expect(isJwksDecryptFailure(undefined)).toBe(false)
  })
})

describe('classifyJwkEncryption', () => {
  it('reads legacy, versioned and plaintext storage', async () => {
    expect(classifyJwkEncryption((await legacyKey('a', LEGACY)).privateKey).encryption).toEqual({ kind: 'legacy' })
    expect(classifyJwkEncryption((await versionedKey('b', 3, V1)).privateKey).encryption).toEqual({
      kind: 'versioned',
      version: 3,
    })
    expect(classifyJwkEncryption(PRIVATE_JWK).encryption).toEqual({ kind: 'plaintext' })
  })
})

describe('findUndecryptableJwks', () => {
  it('reports only the rows the configured secrets cannot decrypt, with the secret tried', async () => {
    const now = new Date('2026-11-12T00:00:00Z')
    const keys = [
      await legacyKey('legacy-ok', LEGACY),
      { ...(await legacyKey('legacy-bad', OTHER)), expiresAt: new Date('2026-01-01T00:00:00Z') },
      await versionedKey('v1-ok', 1, V1),
      await versionedKey('v1-bad', 1, V2),
      await versionedKey('v3-missing', 3, V1),
      { id: 'plain', alg: 'EdDSA', privateKey: PRIVATE_JWK, expiresAt: null },
      { id: 'garbled', alg: null, privateKey: 'not json', expiresAt: null },
    ]

    const result = await findUndecryptableJwks(keys, { secret: LEGACY, secrets: [{ version: 1, value: V1 }] }, now)

    expect(result).toEqual([
      {
        id: 'legacy-bad',
        alg: 'EdDSA',
        expired: true,
        encryptedWith: 'legacy',
        tried: 'BETTER_AUTH_SECRET',
        reason: 'decrypt_failed',
      },
      {
        id: 'v1-bad',
        alg: 'EdDSA',
        expired: false,
        encryptedWith: 'v1',
        tried: 'BETTER_AUTH_SECRETS v1',
        reason: 'decrypt_failed',
      },
      {
        id: 'v3-missing',
        alg: 'EdDSA',
        expired: false,
        encryptedWith: 'v3',
        tried: 'none',
        reason: 'version_not_configured',
      },
      { id: 'garbled', alg: null, expired: false, encryptedWith: 'unknown', tried: 'none', reason: 'unreadable' },
    ])
  })

  it('treats a versioned row as unconfigured when only BETTER_AUTH_SECRET is set', async () => {
    const result = await findUndecryptableJwks([await versionedKey('v1', 1, V1)], { secret: LEGACY })
    expect(result).toMatchObject([{ id: 'v1', reason: 'version_not_configured' }])
  })
})

describe('createJwksDecryptMonitor', () => {
  it('emits one structured line without key material or secret values', async () => {
    const bad = await versionedKey('kid-1', 1, V1)
    const emit = vi.fn()
    const monitor = createJwksDecryptMonitor({
      listKeys: async () => [bad, await legacyKey('kid-2', LEGACY)],
      secrets: { secret: LEGACY, secrets: [{ version: 2, value: V2 }] },
      emit,
      state: { triggered: false },
    })

    await monitor.observe('BetterAuthError', [DECRYPT_ERROR])

    expect(emit).toHaveBeenCalledTimes(1)
    const line = emit.mock.calls[0][0] as string
    expect(line).toBe(
      `${JWKS_DECRYPT_FAILED_EVENT} keys=2 undecryptable=[{"id":"kid-1","alg":"EdDSA","expired":false,"encryptedWith":"v1","tried":"none","reason":"version_not_configured"}] configured_versions=[2]`,
    )
    for (const forbidden of [bad.privateKey, LEGACY, V1, V2, 'private-d']) expect(line).not.toContain(forbidden)
  })

  it('checks and emits at most once per state, even for concurrent failures', async () => {
    const listKeys = vi.fn(async () => [])
    const emit = vi.fn()
    const runInBackground = vi.fn()
    const state = { triggered: false }
    const monitor = createJwksDecryptMonitor({ listKeys, secrets: { secret: LEGACY }, emit, runInBackground, state })

    expect(monitor.observe('Invalid origin', [])).toBeUndefined()
    expect(state.triggered).toBe(false)

    const first = monitor.observe('BetterAuthError', [DECRYPT_ERROR])
    const concurrent = monitor.observe('BetterAuthError', [DECRYPT_ERROR])
    await first
    const later = monitor.observe(DECRYPT_ERROR.message, [])

    expect(concurrent).toBeUndefined()
    expect(later).toBeUndefined()
    expect(listKeys).toHaveBeenCalledTimes(1)
    expect(runInBackground).toHaveBeenCalledTimes(1)
    expect(runInBackground).toHaveBeenCalledWith(first)
    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit.mock.calls[0][0]).toBe(`${JWKS_DECRYPT_FAILED_EVENT} keys=0 undecryptable=[] configured_versions=[]`)
  })

  it('shares one rate limit across monitors in the isolate by default', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const build = () => createJwksDecryptMonitor({ listKeys: async () => [], secrets: { secret: LEGACY } })

    await build().observe('BetterAuthError', [DECRYPT_ERROR])
    expect(build().observe('BetterAuthError', [DECRYPT_ERROR])).toBeUndefined()

    expect(errors).toHaveBeenCalledTimes(1)
    expect(errors.mock.calls[0][0]).toContain(JWKS_DECRYPT_FAILED_EVENT)
  })

  it('still emits the event when the key lookup fails', async () => {
    const emit = vi.fn()
    const monitor = createJwksDecryptMonitor({
      listKeys: async () => {
        throw new Error('D1_ERROR: no such table: jwks')
      },
      secrets: { secret: LEGACY, secrets: [{ version: 1, value: V1 }] },
      emit,
      state: { triggered: false },
    })

    await monitor.observe('BetterAuthError', [DECRYPT_ERROR])

    expect(emit).toHaveBeenCalledWith(
      `${JWKS_DECRYPT_FAILED_EVENT} check_error="Error: D1_ERROR: no such table: jwks" configured_versions=[1]`,
    )
  })
})

describe('createBetterAuthLogSink', () => {
  it('prints like the default better-auth logger and feeds the monitor', () => {
    const observe = vi.fn()
    const sink = createBetterAuthLogSink({ observe }, () => new Date('2026-11-12T01:02:03.000Z'))
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warns = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const logs = vi.spyOn(console, 'log').mockImplementation(() => {})

    sink('error', 'BetterAuthError', DECRYPT_ERROR)
    sink('warn', 'careful')
    sink('info', 'hello', 1)
    sink('debug', 'details')

    expect(errors).toHaveBeenCalledWith('2026-11-12T01:02:03.000Z ERROR [Better Auth]: BetterAuthError', DECRYPT_ERROR)
    expect(warns).toHaveBeenCalledWith('2026-11-12T01:02:03.000Z WARN [Better Auth]: careful')
    expect(logs).toHaveBeenCalledWith('2026-11-12T01:02:03.000Z INFO [Better Auth]: hello', 1)
    expect(logs).toHaveBeenCalledWith('2026-11-12T01:02:03.000Z DEBUG [Better Auth]: details')
    expect(observe).toHaveBeenCalledWith('BetterAuthError', [DECRYPT_ERROR])
    expect(observe).toHaveBeenCalledTimes(4)
  })

  it('defaults to the current time', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    createBetterAuthLogSink({ observe: () => undefined })('error', 'boom')
    expect(errors.mock.calls[0][0]).toMatch(/^\d{4}-\d{2}-\d{2}T.* ERROR \[Better Auth\]: boom$/)
  })
})
