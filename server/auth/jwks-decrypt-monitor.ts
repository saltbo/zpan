// Passive detection of a JWKS private key the deployed auth secrets cannot
// decrypt (#607, #609).
//
// better-auth's jwt() plugin throws "Failed to decrypt private key" when the
// stored signing key was encrypted with a secret this deployment does not hold,
// and /api/auth/oauth2/token answers 500. The error carries neither the key id
// nor the secret version, so this monitor watches better-auth's logger for it,
// then checks every stored key once and emits ONE structured log line naming the
// undecryptable rows and the secret each was tried with. The line is the input
// for `pnpm reset:preview-jwks --id <id>` on staging.
//
// The monitor only observes: the failing request is answered exactly as before,
// nothing is written or deleted, and the line never contains key material or
// secret values. It fires at most once per isolate so a broken key cannot flood
// the logs.

import { parseEnvelope, symmetricDecrypt } from 'better-auth/crypto'
import type { AuthSecretConfig } from '../auth-secrets'

export const JWKS_DECRYPT_FAILED_EVENT = 'auth.jwks.decrypt_failed'

const DECRYPT_FAILURE_MARKER = 'Failed to decrypt private key'

export interface StoredJwk {
  id: string
  alg: string | null
  privateKey: string
  expiresAt: Date | null
}

/** Which secret encrypted a stored key, read from better-auth's envelope. */
export type JwkEncryption = { kind: 'legacy' } | { kind: 'versioned'; version: number } | { kind: 'plaintext' }

export type JwkDecryptFailureReason = 'version_not_configured' | 'decrypt_failed' | 'unreadable'

export interface UndecryptableJwk {
  id: string
  alg: string | null
  expired: boolean
  /** `legacy`, `v<n>`, or `unknown` when the stored value cannot be parsed. */
  encryptedWith: string
  /** The secret the check used: `BETTER_AUTH_SECRET`, `BETTER_AUTH_SECRETS v<n>`, or `none`. */
  tried: string
  reason: JwkDecryptFailureReason
}

export interface JwksDecryptMonitorState {
  triggered: boolean
}

export interface JwksDecryptMonitorOptions {
  listKeys: () => Promise<StoredJwk[]>
  secrets: AuthSecretConfig
  /** Receives the single structured line. Defaults to console.error. */
  emit?: (line: string) => void
  /** Keeps the check alive after the response (Workers `waitUntil`). */
  runInBackground?: (task: Promise<unknown>) => void
  /** Rate-limit state; defaults to one shared per isolate. */
  state?: JwksDecryptMonitorState
  now?: () => Date
}

export interface JwksDecryptMonitor {
  /** Feed every better-auth log call; returns the background check when one starts. */
  observe(message: unknown, args: readonly unknown[]): Promise<void> | undefined
}

const isolateState: JwksDecryptMonitorState = { triggered: false }

export function isJwksDecryptFailure(message: unknown, args: readonly unknown[] = []): boolean {
  return [message, ...args].some((value) => mentionsDecryptFailure(value, 0))
}

function mentionsDecryptFailure(value: unknown, depth: number): boolean {
  if (depth > 3 || value === null || value === undefined) return false
  if (typeof value === 'string') return value.includes(DECRYPT_FAILURE_MARKER)
  if (value instanceof Error) {
    return value.message.includes(DECRYPT_FAILURE_MARKER) || mentionsDecryptFailure(value.cause, depth + 1)
  }
  return false
}

/**
 * better-auth stores the private key as JSON: a JSON string holding the
 * ciphertext when encryption is on, or the JWK object itself when it is off.
 */
export function classifyJwkEncryption(storedPrivateKey: string): { encryption: JwkEncryption; ciphertext: string } {
  const parsed: unknown = JSON.parse(storedPrivateKey)
  if (typeof parsed !== 'string') return { encryption: { kind: 'plaintext' }, ciphertext: '' }
  const envelope = parseEnvelope(parsed)
  if (envelope) return { encryption: { kind: 'versioned', version: envelope.version }, ciphertext: envelope.ciphertext }
  return { encryption: { kind: 'legacy' }, ciphertext: parsed }
}

async function checkKey(key: StoredJwk, secrets: AuthSecretConfig, now: Date): Promise<UndecryptableJwk | null> {
  const base = { id: key.id, alg: key.alg, expired: key.expiresAt !== null && key.expiresAt < now }
  let classified: ReturnType<typeof classifyJwkEncryption>
  try {
    classified = classifyJwkEncryption(key.privateKey)
  } catch {
    return { ...base, encryptedWith: 'unknown', tried: 'none', reason: 'unreadable' }
  }
  const { encryption, ciphertext } = classified
  if (encryption.kind === 'plaintext') return null

  let encryptedWith: string
  let tried: string
  let secret: string | undefined
  if (encryption.kind === 'versioned') {
    encryptedWith = `v${encryption.version}`
    secret = secrets.secrets?.find((entry) => entry.version === encryption.version)?.value
    if (!secret) return { ...base, encryptedWith, tried: 'none', reason: 'version_not_configured' }
    tried = `BETTER_AUTH_SECRETS v${encryption.version}`
  } else {
    encryptedWith = 'legacy'
    secret = secrets.secret
    tried = 'BETTER_AUTH_SECRET'
  }

  try {
    // The decrypted key is discarded immediately; only success matters.
    await symmetricDecrypt({ key: secret, data: ciphertext })
    return null
  } catch {
    return { ...base, encryptedWith, tried, reason: 'decrypt_failed' }
  }
}

export async function findUndecryptableJwks(
  keys: readonly StoredJwk[],
  secrets: AuthSecretConfig,
  now: Date = new Date(),
): Promise<UndecryptableJwk[]> {
  const results = await Promise.all(keys.map((key) => checkKey(key, secrets, now)))
  return results.filter((result): result is UndecryptableJwk => result !== null)
}

function formatField(key: string, value: unknown): string {
  return `${key}=${JSON.stringify(value)}`
}

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}

export function createJwksDecryptMonitor(options: JwksDecryptMonitorOptions): JwksDecryptMonitor {
  const state = options.state ?? isolateState
  const emit = options.emit ?? ((line: string) => console.error(line))
  const now = options.now ?? (() => new Date())
  const configuredVersions = options.secrets.secrets?.map((entry) => entry.version) ?? []

  const report = async () => {
    const fields: string[] = [JWKS_DECRYPT_FAILED_EVENT]
    try {
      const keys = await options.listKeys()
      const undecryptable = await findUndecryptableJwks(keys, options.secrets, now())
      fields.push(formatField('keys', keys.length), formatField('undecryptable', undecryptable))
    } catch (error) {
      fields.push(formatField('check_error', describeError(error)))
    }
    fields.push(formatField('configured_versions', configuredVersions))
    emit(fields.join(' '))
  }

  return {
    observe(message, args) {
      if (state.triggered || !isJwksDecryptFailure(message, args)) return undefined
      state.triggered = true
      const task = report().catch(() => {})
      options.runInBackground?.(task)
      return task
    },
  }
}

export type BetterAuthLogLevel = 'debug' | 'info' | 'warn' | 'error'

/**
 * A better-auth `logger.log` that prints exactly what better-auth's default
 * (uncoloured) logger prints and also feeds the JWKS monitor. better-auth still
 * applies its own level filter before calling it.
 */
export function createBetterAuthLogSink(monitor: JwksDecryptMonitor, now: () => Date = () => new Date()) {
  return (level: BetterAuthLogLevel, message: string, ...args: unknown[]): void => {
    const line = `${now().toISOString()} ${level.toUpperCase()} [Better Auth]: ${message}`
    if (level === 'error') console.error(line, ...args)
    else if (level === 'warn') console.warn(line, ...args)
    else console.log(line, ...args)
    monitor.observe(message, args)
  }
}
