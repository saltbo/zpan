// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  getBuiltinLicenseKeys,
  getTrustedLicenseKeys,
  licenseKeyAllowsHost,
  licenseKeyAllowsIssuer,
  type TrustedLicenseKey,
  trustLicenseKeyForTesting,
  untrustLicenseKeyForTesting,
} from './license-keys'

function builtin(name: string): TrustedLicenseKey {
  const key = getBuiltinLicenseKeys().find((candidate) => candidate.name === name)
  if (!key) throw new Error(`missing builtin key ${name}`)
  return key
}

describe('builtin license keys', () => {
  it('hardcodes exactly the production, staging and dev keys', () => {
    expect(getBuiltinLicenseKeys().map(({ name, publicKey }) => [name, publicKey])).toEqual([
      ['production', 'k4.public.N_r-lhhAfhR8sOk0pl8zlzU5dNRl2tvpUT94uODPZ1w'],
      ['staging', 'k4.public.1wNfC6XwZPu991UOy5VrdxENoLJmpmwUf3ELy4pcX4w'],
      ['dev', 'k4.public.NUBZxtlyXnxOQpU6YA9GZ9Sa8dQzp4L0mUsojewwylM'],
    ])
  })

  it('is frozen', () => {
    expect(Object.isFrozen(getBuiltinLicenseKeys())).toBe(true)
  })

  it('trusts only the builtin keys when no test key is registered', () => {
    expect(getTrustedLicenseKeys()).toEqual([...getBuiltinLicenseKeys()])
  })

  it('adds and removes test keys only through the test hook', () => {
    const key: TrustedLicenseKey = {
      name: 'test',
      publicKey: 'k4.public.test-only',
      issuer: { kind: 'exact', origin: 'https://cloud.example' },
      hosts: { kind: 'exact' },
    }
    trustLicenseKeyForTesting(key)
    trustLicenseKeyForTesting(key)
    expect(getTrustedLicenseKeys().filter((k) => k.publicKey === key.publicKey)).toHaveLength(1)
    untrustLicenseKeyForTesting(key.publicKey)
    expect(getTrustedLicenseKeys()).toEqual([...getBuiltinLicenseKeys()])
  })
})

describe('production key scope', () => {
  const key = builtin('production')

  it('accepts only the production issuer', () => {
    expect(licenseKeyAllowsIssuer(key, 'https://cloud.zpan.space')).toBe(true)
    for (const issuer of [
      'https://staging-zpan-cloud.saltbo.workers.dev',
      'http://localhost:5186',
      'https://cloud.zpan.space/',
      'https://evil.example',
      undefined,
    ]) {
      expect(licenseKeyAllowsIssuer(key, issuer)).toBe(false)
    }
  })

  it('leaves host matching to the exact authorizedHosts list', () => {
    expect(licenseKeyAllowsHost(key, 'files.example.com')).toBe(true)
  })
})

describe('staging key scope', () => {
  const key = builtin('staging')

  it('accepts only the staging issuer', () => {
    expect(licenseKeyAllowsIssuer(key, 'https://staging-zpan-cloud.saltbo.workers.dev')).toBe(true)
    for (const issuer of ['https://cloud.zpan.space', 'http://localhost:5186', 'https://other.saltbo.workers.dev']) {
      expect(licenseKeyAllowsIssuer(key, issuer)).toBe(false)
    }
  })

  it.each([
    'pr-602-zpan.saltbo.workers.dev',
    'zpan.saltbo.workers.dev',
    'abc123-zpan.saltbo.workers.dev',
  ])('accepts the single-label workers.dev host %s', (host) => {
    expect(licenseKeyAllowsHost(key, host)).toBe(true)
  })

  it.each([
    ['nested subdomain', 'a.pr-1-zpan.saltbo.workers.dev'],
    ['other account', 'pr-1-zpan.other.workers.dev'],
    ['bare account host', 'saltbo.workers.dev'],
    ['suffix extension', 'pr-1-zpan.saltbo.workers.dev.evil.com'],
    ['explicit port', 'pr-1-zpan.saltbo.workers.dev:8443'],
    ['custom domain', 'files.example.com'],
    ['loopback', 'localhost:5185'],
    ['invalid label', '-zpan.saltbo.workers.dev'],
    ['path', 'pr-1-zpan.saltbo.workers.dev/path'],
  ])('rejects %s (%s)', (_label, host) => {
    expect(licenseKeyAllowsHost(key, host)).toBe(false)
  })
})

describe('dev key scope', () => {
  const key = builtin('dev')

  it.each([
    'http://localhost:5186',
    'http://127.0.0.1:9292',
    'http://[::1]:8787',
    'https://localhost',
  ])('accepts the loopback issuer %s', (issuer) => {
    expect(licenseKeyAllowsIssuer(key, issuer)).toBe(true)
  })

  it.each([
    'https://cloud.zpan.space',
    'https://staging-zpan-cloud.saltbo.workers.dev',
    'http://localhost.evil.example',
    'http://127.0.0.2:5186',
    'http://localhost:5186/',
    'ftp://localhost',
  ])('rejects the issuer %s', (issuer) => {
    expect(licenseKeyAllowsIssuer(key, issuer)).toBe(false)
  })

  it.each(['localhost', 'localhost:5185', '127.0.0.1:8222', '[::1]:5185'])('accepts the loopback host %s', (host) => {
    expect(licenseKeyAllowsHost(key, host)).toBe(true)
  })

  it.each([
    'zpan.example.com',
    'pr-1-zpan.saltbo.workers.dev',
    'localhost.evil.example',
    'evil.localhost',
    '127.0.0.2',
    '10.0.0.1',
  ])('rejects the host %s', (host) => {
    expect(licenseKeyAllowsHost(key, host)).toBe(false)
  })
})
