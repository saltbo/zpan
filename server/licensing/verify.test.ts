// @vitest-environment node
import { generateKeys, sign } from 'paseto-ts/v4'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PUBLIC_KEYS } from './public-keys'
import { verifyCertificate } from './verify'

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

function futureIso(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString()
}

function pastIso(offsetMs: number): string {
  return new Date(Date.now() - offsetMs).toISOString()
}

function signCert(overrides: Record<string, unknown> = {}, key = TEST_SECRET): string {
  return sign(key, {
    account_id: 'acct-1',
    instance_id: 'inst-abc',
    plan: 'pro',
    plan_source: 'membership',
    features: ['white_label'],
    hosts: ['https://zpan.example.com'],
    issued_at: new Date().toISOString(),
    expires_at: futureIso(3_600_000), // 1 hour from now
    ...overrides,
  })
}

describe('verifyCertificate', () => {
  it('returns entitlement for a valid cert signed by PUBLIC_KEYS[0]', () => {
    const cert = signCert()
    const result = verifyCertificate(cert, 'inst-abc')

    expect(result).not.toBeNull()
    expect(result?.plan).toBe('pro')
    expect(result?.features).toEqual(['white_label'])
    expect(result?.instance_id).toBe('inst-abc')
    expect(result?.account_id).toBe('acct-1')
    expect(result?.plan_source).toBe('membership')
    expect(result?.hosts).toEqual(['https://zpan.example.com'])
  })

  it('returns null for a cert with an invalid signature', () => {
    const cert = signCert()
    // Corrupt the cert by altering a character in the payload segment
    const corrupted = `${cert.slice(0, -5)}XXXXX`
    expect(verifyCertificate(corrupted, 'inst-abc')).toBeNull()
  })

  it('returns null for an expired cert', () => {
    const cert = signCert({ expires_at: pastIso(1000) })
    expect(verifyCertificate(cert, 'inst-abc')).toBeNull()
  })

  it('returns null when instance_id does not match', () => {
    const cert = signCert({ instance_id: 'inst-abc' })
    expect(verifyCertificate(cert, 'inst-DIFFERENT')).toBeNull()
  })

  it('verifies a cert signed by a second key when two keys are in PUBLIC_KEYS', () => {
    const { secretKey: altSecret, publicKey: altPublic } = generateKeys('public')
    PUBLIC_KEYS.push(altPublic)

    try {
      const cert = signCert({ instance_id: 'inst-xyz' }, altSecret)
      const result = verifyCertificate(cert, 'inst-xyz')
      expect(result).not.toBeNull()
      expect(result?.plan).toBe('pro')
    } finally {
      PUBLIC_KEYS.splice(PUBLIC_KEYS.indexOf(altPublic), 1)
    }
  })

  it('returns null when the cert is not a valid PASETO token at all', () => {
    expect(verifyCertificate('not-a-token', 'inst-abc')).toBeNull()
  })
})
