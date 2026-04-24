// @vitest-environment node
import { sign, generateKeys } from 'paseto-ts/v4'
import { describe, expect, it, vi } from 'vitest'
import { verifyCertificate } from './verify'

// DEV keypair matching PUBLIC_KEYS[0] — used to sign test certs
const DEV_SECRET = 'k4.secret.K_XrtRH8ozh6oM38rkCz7oHxU_GbKIuExCg2jmBl9_VgfF29_7kGkFAnXvII1bHUBy2Yjw04DRdC4kmbuSND2Q'

function futureIso(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString()
}

function pastIso(offsetMs: number): string {
  return new Date(Date.now() - offsetMs).toISOString()
}

function signCert(overrides: Record<string, unknown> = {}, key = DEV_SECRET): string {
  return sign(key, {
    account_id: 'acct-1',
    instance_id: 'inst-abc',
    plan: 'pro',
    features: ['white_label'],
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
  })

  it('returns null for a cert with an invalid signature', () => {
    const cert = signCert()
    // Corrupt the cert by altering a character in the payload segment
    const corrupted = cert.slice(0, -5) + 'XXXXX'
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

  it('verifies a cert signed by a second key when two keys are in PUBLIC_KEYS', async () => {
    const { secretKey: altSecret, publicKey: altPublic } = generateKeys('public')

    // Temporarily inject the alt key into PUBLIC_KEYS for this test
    const { PUBLIC_KEYS } = await import('./public-keys')
    const original = [...PUBLIC_KEYS]
    PUBLIC_KEYS.push(altPublic)

    try {
      const cert = signCert({ instance_id: 'inst-xyz' }, altSecret)
      const result = verifyCertificate(cert, 'inst-xyz')
      expect(result).not.toBeNull()
      expect(result?.plan).toBe('pro')
    } finally {
      PUBLIC_KEYS.length = 0
      for (const k of original) PUBLIC_KEYS.push(k)
    }
  })

  it('returns null when the cert is not a valid PASETO token at all', () => {
    expect(verifyCertificate('not-a-token', 'inst-abc')).toBeNull()
  })
})
