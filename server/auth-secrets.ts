// Versioned better-auth secrets.
//
// better-auth encrypts data at rest (notably the jwt() plugin's JWKS private
// keys) with its secret. A single BETTER_AUTH_SECRET means a rotation — or two
// deployments that share a database but hold different secrets, like Worker
// Previews on the shared staging D1 — leaves earlier ciphertext undecryptable
// and /api/auth/oauth2/token starts returning 500.
//
// BETTER_AUTH_SECRETS ("<version>:<secret>,<version>:<secret>", current first)
// turns on better-auth's versioned envelopes: new data is encrypted with the
// first (current) version and any listed version can decrypt. BETTER_AUTH_SECRET
// remains required: better-auth uses it as the legacy key for payloads written
// before versioning, and ZPan derives its own short-lived tokens from it.

export interface AuthSecretVersion {
  version: number
  value: string
}

export interface AuthSecretConfig {
  /** Legacy single secret (BETTER_AUTH_SECRET). */
  secret: string
  /** Versioned secrets (BETTER_AUTH_SECRETS); the first entry is current. */
  secrets?: AuthSecretVersion[]
}

type GetEnv = (key: string) => string | undefined

export function parseAuthSecrets(raw: string | undefined): AuthSecretVersion[] | undefined {
  if (!raw?.trim()) return undefined
  const seen = new Set<number>()
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const colon = entry.indexOf(':')
      if (colon === -1) {
        throw new Error('Invalid BETTER_AUTH_SECRETS entry. Expected "<version>:<secret>" separated by commas.')
      }
      const versionText = entry.slice(0, colon).trim()
      const version = Number(versionText)
      if (!/^\d+$/.test(versionText) || !Number.isSafeInteger(version)) {
        throw new Error(`Invalid BETTER_AUTH_SECRETS version "${versionText}". Versions must be non-negative integers.`)
      }
      const value = entry.slice(colon + 1).trim()
      if (!value) throw new Error(`BETTER_AUTH_SECRETS version ${version} has an empty secret.`)
      if (seen.has(version)) throw new Error(`BETTER_AUTH_SECRETS lists version ${version} more than once.`)
      seen.add(version)
      return { version, value }
    })
}

export function resolveAuthSecrets(getEnv: GetEnv, missingMessage: string): AuthSecretConfig {
  const secret = getEnv('BETTER_AUTH_SECRET')
  if (!secret) throw new Error(missingMessage)
  const secrets = parseAuthSecrets(getEnv('BETTER_AUTH_SECRETS'))
  return secrets?.length ? { secret, secrets } : { secret }
}
