// @vitest-environment node
import { generateKeys, sign } from 'paseto-ts/v4'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PUBLIC_KEYS } from './public-keys'
import { verifyCertificate } from './verify'

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

function nowSec(): number {
  return Math.floor(Date.now() / 1000)
}

function signCert(overrides: Record<string, unknown> = {}, key = TEST_SECRET): string {
  const now = nowSec()
  return sign(key, {
    type: 'zpan.license',
    issuer: 'https://cloud.zpan.space',
    subject: 'bind-1',
    accountId: 'acct-1',
    instanceId: 'inst-abc',
    edition: 'pro',
    authorizedHosts: ['zpan.example.com'],
    licenseValidUntil: now + 365 * 24 * 60 * 60,
    issuedAt: now,
    notBefore: now,
    expiresAt: now + 3600,
    ...overrides,
  })
}

describe('verifyCertificate', () => {
  it('returns assertion for a valid cert signed by PUBLIC_KEYS[0]', () => {
    const cert = signCert()
    const result = verifyCertificate(cert, { instanceId: 'inst-abc', currentHost: 'zpan.example.com' })

    expect(result).not.toBeNull()
    expect(result?.type).toBe('zpan.license')
    expect(result?.edition).toBe('pro')
    expect(result?.instanceId).toBe('inst-abc')
    expect(result?.accountId).toBe('acct-1')
    expect(result?.authorizedHosts).toEqual(['zpan.example.com'])
  })

  it('returns null for a cert with an invalid signature', () => {
    const cert = signCert()
    expect(verifyCertificate(`${cert.slice(0, -5)}XXXXX`, { instanceId: 'inst-abc' })).toBeNull()
  })

  it('returns null for an expired cert', () => {
    const cert = signCert({ expiresAt: nowSec() - 1 })
    expect(verifyCertificate(cert, { instanceId: 'inst-abc' })).toBeNull()
  })

  it('returns null when instanceId does not match', () => {
    const cert = signCert()
    expect(verifyCertificate(cert, { instanceId: 'inst-DIFFERENT' })).toBeNull()
  })

  it('returns null when host is not authorized', () => {
    const cert = signCert()
    expect(verifyCertificate(cert, { instanceId: 'inst-abc', currentHost: 'other.example.com' })).toBeNull()
  })

  it('verifies a cert signed by a second key when two keys are in PUBLIC_KEYS', () => {
    const { secretKey: altSecret, publicKey: altPublic } = generateKeys('public')
    PUBLIC_KEYS.push(altPublic)

    try {
      const cert = signCert({ instanceId: 'inst-xyz' }, altSecret)
      const result = verifyCertificate(cert, { instanceId: 'inst-xyz' })
      expect(result).not.toBeNull()
      expect(result?.edition).toBe('pro')
    } finally {
      PUBLIC_KEYS.splice(PUBLIC_KEYS.indexOf(altPublic), 1)
    }
  })

  it('returns null when the cert is not a valid PASETO token at all', () => {
    expect(verifyCertificate('not-a-token', { instanceId: 'inst-abc' })).toBeNull()
  })
})
