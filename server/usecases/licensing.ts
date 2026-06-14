// All licensing application logic in one module: certificate/token verification,
// active-binding state derivation, the cloud refresh cycle, and the license-gated
// policy decisions built on top. Everything reaches the outside world through the
// LicenseBinding / LicensingCloud ports; the verification helpers are pure.

import { FREE_TEAM_LIMIT, SignupMode, ZPAN_CLOUD_URL_DEFAULT } from '@shared/constants'
import type { BindingState, LicenseAssertion } from '@shared/types'
import { verify } from 'paseto-ts/v4'
import { z } from 'zod'
import { getTrustedPublicKeys } from '../domain/license-keys'
import { effectiveFeatures, hasFeature } from '../domain/licensing'
import {
  type CloudInstanceInfo,
  CloudInvalidResponseError,
  CloudNetworkError,
  CloudUnboundError,
  type LicenseBindingRepo,
  type LicensingCloudGateway,
  type MemberCountRepo,
  type SystemOptionsRepo,
} from './ports'

// ─── Certificate / token verification (pure) ─────────────────────────────────

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

// ─── Active-binding state ────────────────────────────────────────────────────

export interface BindingStateOptions {
  currentHost?: string | null
  cloudBaseUrl?: string | null
}

// Reads the active license binding and derives the runtime BindingState by
// verifying the cached certificate. Orchestration: repo read + pure verify.
export async function loadBindingState(
  deps: { licenseBinding: LicenseBindingRepo },
  options: BindingStateOptions = {},
): Promise<BindingState> {
  const state = await deps.licenseBinding.loadLicenseState()
  if (!state.refreshToken) return { bound: false }

  const result: BindingState = {
    bound: true,
    active: false,
    account_email: state.cloudAccountEmail ?? undefined,
    last_refresh_at: state.lastRefreshAt ?? undefined,
    last_refresh_error: state.lastRefreshError ?? undefined,
  }

  if (state.cachedCert && state.instanceId) {
    const assertion = verifyCertificate(state.cachedCert, {
      instanceId: state.instanceId,
      currentHost: options.currentHost,
      cloudBaseUrl: options.cloudBaseUrl,
    })
    if (assertion) {
      result.active = true
      result.edition = assertion.edition
      result.features = effectiveFeatures(assertion.edition)
      result.license_id = assertion.licenseId
      result.license_valid_until = assertion.licenseValidUntil
      result.certificate_expires_at = assertion.expiresAt
    }
  }

  return result
}

// ─── Cloud refresh cycle ─────────────────────────────────────────────────────

const INVALID_CERTIFICATE_ERROR = 'Invalid certificate from cloud'
const INVALID_ENTITLEMENT_RESPONSE_ERROR = 'Invalid entitlement response from cloud'
const DEDUP_WINDOW_SEC = 5 * 60

function normaliseCert(
  raw: string,
  options: { instanceId: string; cloudBaseUrl: string },
): { cert: string; certificateExpiresAt: number | null } {
  const assertion = verifyCertificate(raw, { instanceId: options.instanceId, cloudBaseUrl: options.cloudBaseUrl })
  return { cert: raw, certificateExpiresAt: assertion?.expiresAt ?? null }
}

export async function performRefresh(
  deps: { licensingCloud: LicensingCloudGateway; licenseBinding: LicenseBindingRepo },
  baseUrl: string,
  instance?: CloudInstanceInfo,
): Promise<void> {
  const state = await deps.licenseBinding.loadLicenseState()
  if (!state.refreshToken || !state.instanceId) return

  try {
    const data = await deps.licensingCloud.refreshEntitlement(baseUrl, state.refreshToken, instance)
    const { cert, certificateExpiresAt } = normaliseCert(data.certificate, {
      instanceId: state.instanceId,
      cloudBaseUrl: baseUrl,
    })
    if (!certificateExpiresAt) {
      await deps.licenseBinding.setLicenseRefreshError(state.id, INVALID_CERTIFICATE_ERROR)
      return
    }
    if (!data.binding?.storeId || !data.account) {
      await deps.licenseBinding.setLicenseRefreshError(state.id, INVALID_ENTITLEMENT_RESPONSE_ERROR)
      return
    }

    await deps.licenseBinding.updateLicenseBindingAfterRefresh({
      id: state.id,
      refreshToken: data.refreshToken,
      cloudStoreId: data.binding.storeId,
      cachedCert: cert,
      cachedExpiresAt: certificateExpiresAt,
      cloudAccountEmail: data.account.email,
      lastRefreshAt: Math.floor(Date.now() / 1000),
    })
  } catch (err) {
    if (err instanceof CloudUnboundError) {
      await deps.licenseBinding.clearLicenseBinding('revoked')
      return
    }

    if (err instanceof CloudInvalidResponseError || err instanceof CloudNetworkError || err instanceof Error) {
      await deps.licenseBinding.setLicenseRefreshError(state.id, err.message)
      return
    }

    throw err
  }
}

export type LicensingRefreshDeps = { licenseBinding: LicenseBindingRepo; licensingCloud: LicensingCloudGateway }

// Cron/route-safe entry over performRefresh: skips when unbound or refreshed
// within the dedup window, and swallows every error (the scheduler must never
// see a rejection). performRefresh itself owns the network/cert handling.
export async function runLicensingRefresh(
  deps: LicensingRefreshDeps,
  cloudBaseUrl: string,
  instance?: CloudInstanceInfo,
): Promise<void> {
  const state = await deps.licenseBinding.loadLicenseState()
  if (!state.refreshToken) return // unbound — no-op

  const nowSec = Math.floor(Date.now() / 1000)
  if (state.lastRefreshAt != null && nowSec - state.lastRefreshAt < DEDUP_WINDOW_SEC) return

  try {
    if (instance) {
      await performRefresh(deps, cloudBaseUrl, instance)
    } else {
      await performRefresh(deps, cloudBaseUrl)
    }
    console.log('licensing.refresh.ok')
  } catch (err) {
    const code = err instanceof Error ? err.message : String(err)
    console.error(`licensing.refresh.error code=${code}`)
  }
}

// ─── License-gated policy ────────────────────────────────────────────────────

export type TeamCountDeps = { memberCount: MemberCountRepo; licenseBinding: LicenseBindingRepo }

export async function checkTeamLimit(
  deps: TeamCountDeps,
  userId: string,
): Promise<{ allowed: boolean; count: number; limit: number }> {
  const [count, state] = await Promise.all([
    deps.memberCount.countUserOrgs(userId),
    loadBindingState({ licenseBinding: deps.licenseBinding }),
  ])
  const unlimited = hasFeature('teams_unlimited', state)
  return { allowed: unlimited || count < FREE_TEAM_LIMIT, count, limit: FREE_TEAM_LIMIT }
}

export type SignupModeDeps = { systemOptions: SystemOptionsRepo; licenseBinding: LicenseBindingRepo }

/**
 * Returns the effective signup mode.
 *
 * Rule: `open` requires the `open_registration` Pro feature. Without it the
 * effective mode falls back to `invite-only`. All other stored values
 * (invite_only, closed) are returned unchanged. Unknown/empty values retain
 * the existing default-to-open behaviour and are not subject to the Pro check.
 */
export async function getEffectiveSignupMode(deps: SignupModeDeps): Promise<SignupMode> {
  const raw = await deps.systemOptions.getValue('auth_signup_mode')

  if (raw === SignupMode.INVITE_ONLY || raw === SignupMode.CLOSED) return raw
  if (raw !== SignupMode.OPEN) return SignupMode.OPEN // unknown/empty → open (existing behaviour)

  // Stored value is explicitly 'open' — gate behind Pro feature
  const state = await loadBindingState({ licenseBinding: deps.licenseBinding })
  return hasFeature('open_registration', state) ? SignupMode.OPEN : SignupMode.INVITE_ONLY
}
