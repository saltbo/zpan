// Cloud public keys for verifying PASETO v4 entitlement certificates.
//
// ZPan verifies every entitlement certificate against the trusted set, which is
// merged from two sources at runtime (see getTrustedPublicKeys):
//
//   1. BUILTIN_PUBLIC_KEYS — staging + production. Their secret halves live only
//      in CF Worker secrets, so baking the public halves into the build is safe.
//
//   2. PUBLIC_KEYS — the runtime layer, populated from the ZPAN_LICENSE_PUBLIC_KEYS
//      env var (see registerEnvPublicKeys). Dev keys belong HERE, never in source:
//      a dev secret in zpan-cloud/.dev.vars leaks easily, and a hardcoded dev
//      public key would make every production build trust it — a leaked dev secret
//      could then mint certs accepted in production. Keeping dev keys in env means a
//      leak is rotated via config (no code change), and production never trusts a
//      dev key unless its operator explicitly sets the var.
//
// Rotation (staging/prod): add the new key to BUILTIN_PUBLIC_KEYS and deploy ZPan;
// update the cloud LICENSE_SIGNING_KEY and deploy; after 24 h (old certs expired)
// drop the old key and deploy again.
//
// Keys are PASERK k4.public.* strings (Ed25519, 32 raw bytes, base64url-encoded).

const BUILTIN_PUBLIC_KEYS: readonly string[] = [
  // zpan-cloud staging key — provisioned 2026-05-09
  'k4.public.CCpUZ1yRWkFQy4fPZAblCYfzeJn4vDwPQrjtfiySwFc',
  // cloud.zpan.space production key — provisioned 2026-04-24
  'k4.public.N_r-lhhAfhR8sOk0pl8zlzU5dNRl2tvpUT94uODPZ1w',
]

// Runtime-registered keys: env-configured dev/rotation keys, plus test-injected
// keys. Mutated in place so tests can swap the trusted set without re-wiring imports.
export const PUBLIC_KEYS: string[] = []

const PASERK_PUBLIC_PREFIX = 'k4.public.'

function parseEnvPublicKeys(raw: string | undefined | null): string[] {
  if (!raw) return []
  return raw
    .split(/[\s,]+/)
    .map((key) => key.trim())
    .filter((key) => key.startsWith(PASERK_PUBLIC_PREFIX))
}

// Called once per platform creation with ZPAN_LICENSE_PUBLIC_KEYS. Idempotent:
// re-registering the same env value (e.g. per CF request) just re-sets the layer.
export function registerEnvPublicKeys(raw: string | undefined | null): void {
  const parsed = parseEnvPublicKeys(raw)
  PUBLIC_KEYS.length = 0
  PUBLIC_KEYS.push(...parsed)
}

export function getTrustedPublicKeys(): string[] {
  return [...BUILTIN_PUBLIC_KEYS, ...PUBLIC_KEYS]
}
