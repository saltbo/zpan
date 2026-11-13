// @vitest-environment node
import { generateKeys, sign } from 'paseto-ts/v4'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { trustTestLicenseKey, untrustTestLicenseKey } from '../../test/license-keys'
import { verifyCertificate, verifyCertificateResult } from './licensing'

const { secretKey: TEST_SECRET, publicKey: TEST_PUBLIC } = generateKeys('public')

beforeAll(() => {
  trustTestLicenseKey(TEST_PUBLIC)
})

afterAll(() => {
  untrustTestLicenseKey(TEST_PUBLIC)
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
  it('returns assertion for a valid cert signed by a trusted test key', () => {
    const cert = signCert()
    const result = verifyCertificate(cert, { instanceId: 'inst-abc', currentHost: 'zpan.example.com' })

    expect(result).not.toBeNull()
    expect(result?.type).toBe('zpan.license')
    expect(result?.edition).toBe('pro')
    expect(result?.instanceId).toBe('inst-abc')
    expect(result?.accountId).toBe('acct-1')
    expect(result?.authorizedHosts).toEqual(['zpan.example.com'])
  })

  it('returns assertion for a valid business cert', () => {
    const cert = signCert({ edition: 'business', licenseId: 'lic-1' })
    const result = verifyCertificate(cert, { instanceId: 'inst-abc', currentHost: 'zpan.example.com' })

    expect(result).not.toBeNull()
    expect(result?.edition).toBe('business')
    expect(result?.licenseId).toBe('lic-1')
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

  it('returns null when edition is not supported', () => {
    const cert = signCert({ edition: 'enterprise' })
    expect(verifyCertificate(cert, { instanceId: 'inst-abc' })).toBeNull()
  })

  it('returns null when host is not authorized', () => {
    const cert = signCert()
    expect(verifyCertificate(cert, { instanceId: 'inst-abc', currentHost: 'other.example.com' })).toBeNull()
  })

  it('verifies a cert signed by a second key when two test keys are trusted', () => {
    const { secretKey: altSecret, publicKey: altPublic } = generateKeys('public')
    trustTestLicenseKey(altPublic)

    try {
      const cert = signCert({ instanceId: 'inst-xyz' }, altSecret)
      const result = verifyCertificate(cert, { instanceId: 'inst-xyz' })
      expect(result).not.toBeNull()
      expect(result?.edition).toBe('pro')
    } finally {
      untrustTestLicenseKey(altPublic)
    }
  })

  it('returns null when the cert is not a valid PASETO token at all', () => {
    expect(verifyCertificate('not-a-token', { instanceId: 'inst-abc' })).toBeNull()
  })
})

describe('verifyCertificateResult', () => {
  it('returns ok with the assertion for a valid cert', () => {
    const result = verifyCertificateResult(signCert(), { instanceId: 'inst-abc', currentHost: 'zpan.example.com' })
    expect(result).toEqual({ ok: true, assertion: expect.objectContaining({ edition: 'pro' }) })
  })

  it('reports "signature" when no trusted key can verify the token (mismatched signing key)', () => {
    const { secretKey: untrusted } = generateKeys('public')
    const cert = signCert({}, untrusted)
    expect(verifyCertificateResult(cert, { instanceId: 'inst-abc' })).toEqual({ ok: false, reason: 'signature' })
  })

  it('reports "expired" when the signature is valid but the cert is past expiry', () => {
    const cert = signCert({ expiresAt: nowSec() - 1 })
    expect(verifyCertificateResult(cert, { instanceId: 'inst-abc' })).toEqual({ ok: false, reason: 'expired' })
  })

  it('reports "instance" when the instanceId does not match', () => {
    expect(verifyCertificateResult(signCert(), { instanceId: 'inst-OTHER' })).toEqual({
      ok: false,
      reason: 'instance',
    })
  })

  it('reports "issuer" when the issuer is untrusted', () => {
    const cert = signCert({ issuer: 'https://evil.example.com' })
    expect(verifyCertificateResult(cert, { instanceId: 'inst-abc' })).toEqual({ ok: false, reason: 'issuer' })
  })

  it('reports "host" when the current host is not authorized', () => {
    expect(verifyCertificateResult(signCert(), { instanceId: 'inst-abc', currentHost: 'other.example.com' })).toEqual({
      ok: false,
      reason: 'host',
    })
  })
})

describe('hostPolicy claims', () => {
  const previewPolicy = { type: 'worker-preview', worker: 'zpan', account: 'saltbo' }

  it('checks only the exact authorizedHosts of a certificate carrying hostPolicy', () => {
    const cert = signCert({ hostPolicy: previewPolicy, authorizedHosts: ['zpan.example.com'] })
    expect(verifyCertificate(cert, { instanceId: 'inst-abc', currentHost: 'zpan.example.com' })).not.toBeNull()
    expect(verifyCertificate(cert, { instanceId: 'inst-abc', currentHost: 'pr-1-zpan.saltbo.workers.dev' })).toBeNull()
  })

  it('does not widen an empty authorizedHosts list', () => {
    const cert = signCert({ hostPolicy: previewPolicy, authorizedHosts: [] })
    expect(
      verifyCertificateResult(cert, { instanceId: 'inst-abc', currentHost: 'pr-1-zpan.saltbo.workers.dev' }),
    ).toEqual({
      ok: false,
      reason: 'host',
    })
  })

  it('rejects a certificate whose authorizedHosts contains a malformed entry', () => {
    const cert = signCert({ authorizedHosts: ['zpan.example.com', 'http://['] })
    expect(verifyCertificateResult(cert, { instanceId: 'inst-abc' })).toEqual({ ok: false, reason: 'host' })
  })
})
