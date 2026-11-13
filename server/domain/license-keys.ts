// Cloud public keys for verifying PASETO v4 entitlement certificates.
//
// The trusted set is hardcoded here and nowhere else: there is no env var or other
// runtime configuration that adds a key. Each key carries a fixed scope — the cloud
// issuer allowed to sign with it and the hosts its certificates may authorize — so
// a certificate is accepted only when:
//
//   1. its signature verifies with one of these keys,
//   2. its issuer equals that key's issuer (and the configured cloud issuer), and
//   3. every authorized host, and the current host, lies inside that key's host scope
//      (on top of the exact authorizedHosts match).
//
// Scopes:
//   - production — issuer https://cloud.zpan.space; exact authorizedHosts only.
//   - staging    — issuer https://staging-zpan-cloud.saltbo.workers.dev; every host
//                  must be exactly <one-label>.saltbo.workers.dev.
//   - dev        — issuer is a loopback origin (localhost / 127.0.0.1 / [::1], any
//                  port); every host must be a loopback host. Its secret half lives
//                  in zpan-cloud/.dev.vars for local Pro testing (see CONTRIBUTING).
//
// Rotation: add the new key (with its scope) here and deploy ZPan; update the cloud
// LICENSE_SIGNING_KEY and deploy; after 24 h (old certs expired) drop the old key.
//
// Keys are PASERK k4.public.* strings (Ed25519, 32 raw bytes, base64url-encoded).

export type LicenseKeyIssuerScope = { kind: 'exact'; origin: string } | { kind: 'loopback' }

export type LicenseKeyHostScope =
  // Only the certificate's exact authorizedHosts list applies.
  | { kind: 'exact' }
  // Every host must be exactly `<one DNS label>.<account>.workers.dev` (no port).
  | { kind: 'workers-dev-account'; account: string }
  // Every host must be localhost / 127.0.0.1 / [::1] (any port).
  | { kind: 'loopback' }

export interface TrustedLicenseKey {
  name: string
  publicKey: string
  issuer: LicenseKeyIssuerScope
  hosts: LicenseKeyHostScope
}

const BUILTIN_LICENSE_KEYS: readonly TrustedLicenseKey[] = Object.freeze([
  {
    // cloud.zpan.space production key — provisioned 2026-04-24
    name: 'production',
    publicKey: 'k4.public.N_r-lhhAfhR8sOk0pl8zlzU5dNRl2tvpUT94uODPZ1w',
    issuer: { kind: 'exact', origin: 'https://cloud.zpan.space' },
    hosts: { kind: 'exact' },
  },
  {
    // zpan-cloud staging key — provisioned 2026-06-10
    name: 'staging',
    publicKey: 'k4.public.1wNfC6XwZPu991UOy5VrdxENoLJmpmwUf3ELy4pcX4w',
    issuer: { kind: 'exact', origin: 'https://staging-zpan-cloud.saltbo.workers.dev' },
    hosts: { kind: 'workers-dev-account', account: 'saltbo' },
  },
  {
    // Local development key (zpan-cloud/.dev.vars) — provisioned 2026-11-13
    name: 'dev',
    publicKey: 'k4.public.NUBZxtlyXnxOQpU6YA9GZ9Sa8dQzp4L0mUsojewwylM',
    issuer: { kind: 'loopback' },
    hosts: { kind: 'loopback' },
  },
] satisfies TrustedLicenseKey[])

// Keys trusted only by test code (unit/integration tests and the E2E-only server
// entries under e2e/). Nothing in the production runtime writes to this list, and no
// configuration value can reach it.
const TEST_LICENSE_KEYS: TrustedLicenseKey[] = []

export function trustLicenseKeyForTesting(key: TrustedLicenseKey): void {
  const id = JSON.stringify(key)
  if (!TEST_LICENSE_KEYS.some((existing) => JSON.stringify(existing) === id)) {
    TEST_LICENSE_KEYS.unshift(key)
  }
}

export function untrustLicenseKeyForTesting(publicKey: string): void {
  for (let i = TEST_LICENSE_KEYS.length - 1; i >= 0; i--) {
    if (TEST_LICENSE_KEYS[i]!.publicKey === publicKey) TEST_LICENSE_KEYS.splice(i, 1)
  }
}

export function getBuiltinLicenseKeys(): readonly TrustedLicenseKey[] {
  return BUILTIN_LICENSE_KEYS
}

export function getTrustedLicenseKeys(): TrustedLicenseKey[] {
  return [...TEST_LICENSE_KEYS, ...BUILTIN_LICENSE_KEYS]
}

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]'])
const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

function parseHost(host: string): URL | null {
  try {
    const url = new URL(`http://${host}`)
    // Reject anything that is not a bare host[:port] (paths, credentials, etc.).
    return url.host === host.toLowerCase() && url.pathname === '/' && !url.username && !url.password ? url : null
  } catch {
    return null
  }
}

export function licenseKeyAllowsIssuer(key: TrustedLicenseKey, issuer: unknown): boolean {
  if (typeof issuer !== 'string') return false
  if (key.issuer.kind === 'exact') return issuer === key.issuer.origin
  let url: URL
  try {
    url = new URL(issuer)
  } catch {
    return false
  }
  return (
    (url.protocol === 'http:' || url.protocol === 'https:') &&
    url.origin === issuer &&
    LOOPBACK_HOSTNAMES.has(url.hostname)
  )
}

// `host` is a normalized host[:port] (lowercase, default port removed).
export function licenseKeyAllowsHost(key: TrustedLicenseKey, host: string): boolean {
  const scope = key.hosts
  if (scope.kind === 'exact') return true
  const url = parseHost(host)
  if (!url) return false
  if (scope.kind === 'loopback') return LOOPBACK_HOSTNAMES.has(url.hostname)
  if (url.port) return false
  const parts = url.hostname.split('.')
  return (
    parts.length === 4 &&
    DNS_LABEL.test(parts[0]!) &&
    parts[1] === scope.account &&
    parts[2] === 'workers' &&
    parts[3] === 'dev'
  )
}
