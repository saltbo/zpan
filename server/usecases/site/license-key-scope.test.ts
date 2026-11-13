// @vitest-environment node
import { generateKeys, sign } from 'paseto-ts/v4'
import { afterEach, describe, expect, it } from 'vitest'
import {
  getBuiltinLicenseKeys,
  trustLicenseKeyForTesting,
  untrustLicenseKeyForTesting,
} from '../../domain/license-keys'
import { verifyCertificateResult } from './licensing'

// The builtin secrets are not available to tests, so each builtin scope is exercised
// end to end with a throwaway key that carries exactly that builtin key's scope.
const registered: string[] = []

function scopedSigner(name: string): (claims: Record<string, unknown>) => string {
  const builtin = getBuiltinLicenseKeys().find((key) => key.name === name)
  if (!builtin) throw new Error(`missing builtin key ${name}`)
  const { secretKey, publicKey } = generateKeys('public')
  trustLicenseKeyForTesting({ ...builtin, name: `${name}-test`, publicKey })
  registered.push(publicKey)
  return (claims) => {
    const now = Math.floor(Date.now() / 1000)
    return sign(secretKey, {
      type: 'zpan.license',
      subject: 'bind-1',
      accountId: 'acct-1',
      instanceId: 'inst-1',
      edition: 'pro',
      licenseValidUntil: now + 86_400,
      issuedAt: now,
      notBefore: now,
      expiresAt: now + 3_600,
      ...claims,
    })
  }
}

afterEach(() => {
  for (const key of registered.splice(0)) untrustLicenseKeyForTesting(key)
})

const PRODUCTION = 'https://cloud.zpan.space'
const STAGING = 'https://staging-zpan-cloud.saltbo.workers.dev'

describe('production-scoped key', () => {
  it('accepts its issuer with an exact host', () => {
    const cert = scopedSigner('production')({ issuer: PRODUCTION, authorizedHosts: ['files.example.com'] })
    expect(verifyCertificateResult(cert, { instanceId: 'inst-1', currentHost: 'files.example.com' }).ok).toBe(true)
  })

  it('rejects a staging or loopback issuer even when the instance is configured for it', () => {
    const signer = scopedSigner('production')
    for (const issuer of [STAGING, 'http://localhost:5186']) {
      const cert = signer({ issuer, authorizedHosts: ['localhost'] })
      expect(verifyCertificateResult(cert, { instanceId: 'inst-1', cloudBaseUrl: issuer })).toEqual({
        ok: false,
        reason: 'issuer',
      })
    }
  })

  it('rejects a host outside the exact list', () => {
    const cert = scopedSigner('production')({ issuer: PRODUCTION, authorizedHosts: ['files.example.com'] })
    expect(verifyCertificateResult(cert, { instanceId: 'inst-1', currentHost: 'a.files.example.com' })).toEqual({
      ok: false,
      reason: 'host',
    })
  })
})

describe('staging-scoped key', () => {
  const host = 'pr-602-zpan.saltbo.workers.dev'

  it('accepts its issuer with an exact single-label workers.dev host', () => {
    const cert = scopedSigner('staging')({ issuer: STAGING, authorizedHosts: [host] })
    expect(verifyCertificateResult(cert, { instanceId: 'inst-1', cloudBaseUrl: STAGING, currentHost: host }).ok).toBe(
      true,
    )
  })

  it('rejects the production issuer', () => {
    const cert = scopedSigner('staging')({ issuer: PRODUCTION, authorizedHosts: [host] })
    expect(verifyCertificateResult(cert, { instanceId: 'inst-1', currentHost: host })).toEqual({
      ok: false,
      reason: 'issuer',
    })
  })

  it('still requires the configured cloud issuer', () => {
    const cert = scopedSigner('staging')({ issuer: STAGING, authorizedHosts: [host] })
    expect(verifyCertificateResult(cert, { instanceId: 'inst-1', currentHost: host })).toEqual({
      ok: false,
      reason: 'issuer',
    })
  })

  it.each([
    ['custom domain', 'files.example.com'],
    ['nested subdomain', 'a.pr-602-zpan.saltbo.workers.dev'],
    ['other account', 'pr-602-zpan.other.workers.dev'],
    ['loopback', 'localhost'],
  ])('rejects an authorized %s even when it is the current host', (_label, outOfScope) => {
    const cert = scopedSigner('staging')({ issuer: STAGING, authorizedHosts: [outOfScope] })
    expect(
      verifyCertificateResult(cert, { instanceId: 'inst-1', cloudBaseUrl: STAGING, currentHost: outOfScope }),
    ).toEqual({ ok: false, reason: 'host' })
  })

  it('rejects the whole certificate when any authorized host is out of scope', () => {
    const cert = scopedSigner('staging')({ issuer: STAGING, authorizedHosts: [host, 'files.example.com'] })
    expect(verifyCertificateResult(cert, { instanceId: 'inst-1', cloudBaseUrl: STAGING, currentHost: host })).toEqual({
      ok: false,
      reason: 'host',
    })
    expect(verifyCertificateResult(cert, { instanceId: 'inst-1', cloudBaseUrl: STAGING })).toEqual({
      ok: false,
      reason: 'host',
    })
  })

  it('rejects an in-scope host that is not in the exact list', () => {
    const cert = scopedSigner('staging')({ issuer: STAGING, authorizedHosts: [host] })
    expect(
      verifyCertificateResult(cert, {
        instanceId: 'inst-1',
        cloudBaseUrl: STAGING,
        currentHost: 'pr-603-zpan.saltbo.workers.dev',
      }),
    ).toEqual({ ok: false, reason: 'host' })
  })
})

describe('dev-scoped key', () => {
  const issuer = 'http://localhost:5186'

  it('accepts a loopback issuer with a loopback host', () => {
    const cert = scopedSigner('dev')({ issuer, authorizedHosts: ['localhost:5185'] })
    expect(
      verifyCertificateResult(cert, { instanceId: 'inst-1', cloudBaseUrl: issuer, currentHost: 'localhost:5185' }).ok,
    ).toBe(true)
  })

  it.each([PRODUCTION, STAGING])('rejects the non-loopback issuer %s', (wrongIssuer) => {
    const cert = scopedSigner('dev')({ issuer: wrongIssuer, authorizedHosts: ['localhost'] })
    expect(verifyCertificateResult(cert, { instanceId: 'inst-1', cloudBaseUrl: wrongIssuer })).toEqual({
      ok: false,
      reason: 'issuer',
    })
  })

  it.each(['files.example.com', 'pr-1-zpan.saltbo.workers.dev'])('rejects the non-loopback host %s', (host) => {
    const cert = scopedSigner('dev')({ issuer, authorizedHosts: [host] })
    expect(verifyCertificateResult(cert, { instanceId: 'inst-1', cloudBaseUrl: issuer, currentHost: host })).toEqual({
      ok: false,
      reason: 'host',
    })
  })
})
