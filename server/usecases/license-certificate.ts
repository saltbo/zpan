import { ZPAN_CLOUD_URL_DEFAULT } from '@shared/constants'
import type { LicenseAssertion } from '@shared/types'
import { verify } from 'paseto-ts/v4'
import { z } from 'zod'
import { getTrustedPublicKeys } from '../domain/license-keys'

export interface VerifyCertificateOptions {
  instanceId: string
  currentHost?: string | null
  cloudBaseUrl?: string | null
}

// Why a certificate was rejected. 'signature' means no trusted public key could
// verify the token — i.e. the cloud signed with a key ZPan doesn't trust (the most
// common cause: a rotated/mismatched signing key). The rest mean the signature was
// valid but a claim did not match.
export type CertificateRejectionReason =
  | 'signature'
  | 'type'
  | 'issuer'
  | 'instance'
  | 'edition'
  | 'not_yet_valid'
  | 'expired'
  | 'host'

export type VerifyCertificateResult =
  | { ok: true; assertion: LicenseAssertion }
  | { ok: false; reason: CertificateRejectionReason }

export function trustedIssuerFromCloudUrl(baseUrl: string | null | undefined): string {
  const raw = baseUrl || ZPAN_CLOUD_URL_DEFAULT
  try {
    return new URL(raw).origin
  } catch {
    return new URL(ZPAN_CLOUD_URL_DEFAULT).origin
  }
}

export function normalizeHost(host: string | null | undefined): string | null {
  if (!host) return null
  try {
    return new URL(host.includes('://') ? host : `http://${host}`).host.toLowerCase()
  } catch {
    return host.split('/')[0]?.toLowerCase() || null
  }
}

export function verifyCertificate(cert: string, options: VerifyCertificateOptions): LicenseAssertion | null {
  const result = verifyCertificateResult(cert, options)
  return result.ok ? result.assertion : null
}

// Detailed variant: returns the specific rejection reason so callers (e.g. the
// pairing poll handler) can surface why a certificate failed instead of a bare null.
export function verifyCertificateResult(cert: string, options: VerifyCertificateOptions): VerifyCertificateResult {
  let claimReason: CertificateRejectionReason | null = null

  for (const key of getTrustedPublicKeys()) {
    const outcome = tryVerify(cert, key, options)
    if (outcome.ok) return outcome
    // Signature passed for this key but a claim failed — remember the first such
    // reason. We keep looping in case another key yields a fully valid assertion.
    if (outcome.reason !== 'signature' && claimReason === null) {
      claimReason = outcome.reason
    }
  }

  // A claim reason outranks 'signature': if any key validated the signature, the
  // real problem is the claim, not a key mismatch.
  return { ok: false, reason: claimReason ?? 'signature' }
}

function tryVerify(cert: string, publicKey: string, options: VerifyCertificateOptions): VerifyCertificateResult {
  let payload: LicenseAssertion
  try {
    ;({ payload } = verify<LicenseAssertion>(publicKey, cert, { validatePayload: false }))
  } catch {
    return { ok: false, reason: 'signature' }
  }

  const now = Math.floor(Date.now() / 1000)
  const currentHost = normalizeHost(options.currentHost)
  const authorizedHosts = Array.isArray(payload.authorizedHosts)
    ? payload.authorizedHosts.map((host) => normalizeHost(host)).filter((host): host is string => Boolean(host))
    : []

  if (payload.type !== 'zpan.license') {
    return { ok: false, reason: 'type' }
  }
  if (payload.issuer !== trustedIssuerFromCloudUrl(options.cloudBaseUrl)) {
    return { ok: false, reason: 'issuer' }
  }
  if (payload.instanceId !== options.instanceId) {
    return { ok: false, reason: 'instance' }
  }
  if (payload.edition !== 'pro' && payload.edition !== 'business') {
    return { ok: false, reason: 'edition' }
  }
  if (payload.notBefore > now) {
    return { ok: false, reason: 'not_yet_valid' }
  }
  if (payload.expiresAt <= now) {
    return { ok: false, reason: 'expired' }
  }
  if (currentHost && !authorizedHosts.includes(currentHost)) {
    return { ok: false, reason: 'host' }
  }

  return { ok: true, assertion: { ...payload, authorizedHosts } }
}

const CLOUD_EVENT_TOKEN_MAX_TTL_SECONDS = 5 * 60

const cloudEventTokenSchema = z.object({
  type: z.literal('commerce.fulfillment.token'),
  purpose: z.literal('store.delivery'),
  issuer: z.string().min(1),
  audience: z.string().min(1),
  boundLicenseId: z.string().min(1),
  eventId: z.string().min(1),
  payloadHash: z
    .string()
    .regex(/^[0-9a-f]{64}$/i)
    .optional(),
  issuedAt: z.number().int(),
  notBefore: z.number().int().optional(),
  expiresAt: z.number().int(),
})

export type CloudEventToken = z.infer<typeof cloudEventTokenSchema>

export interface VerifyCloudEventTokenOptions {
  cloudBaseUrl: string
  instanceId: string
  boundLicenseId: string
  payloadHash: string
}

export function verifyCloudEventToken(token: string, options: VerifyCloudEventTokenOptions): CloudEventToken | null {
  for (const key of getTrustedPublicKeys()) {
    const event = tryVerifyCloudEventToken(token, key, options)
    if (event) return event
  }
  return null
}

function tryVerifyCloudEventToken(
  token: string,
  publicKey: string,
  options: VerifyCloudEventTokenOptions,
): CloudEventToken | null {
  try {
    const { payload } = verify<Record<string, unknown>>(publicKey, token, { validatePayload: false })
    const parsed = cloudEventTokenSchema.safeParse(payload)
    if (!parsed.success) return null

    const event = parsed.data
    const now = Math.floor(Date.now() / 1000)
    if (event.issuer !== trustedIssuerFromCloudUrl(options.cloudBaseUrl)) return null
    if (event.audience !== options.instanceId && event.audience !== options.boundLicenseId) return null
    if (event.boundLicenseId !== options.boundLicenseId) return null
    if (event.payloadHash && event.payloadHash !== options.payloadHash) return null
    if (event.issuedAt > now) return null
    if (event.notBefore && event.notBefore > now) return null
    if (event.expiresAt <= now) return null
    if (event.expiresAt - event.issuedAt > CLOUD_EVENT_TOKEN_MAX_TTL_SECONDS) return null

    return event
  } catch {
    return null
  }
}
