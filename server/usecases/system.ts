// The system resource usecase. Owns every business decision behind the
// /api/system routes — instance-info origin resolution, the changelog freshness
// check, system-option visibility rules, and the option-write pipeline (signup
// Pro gate, captcha key visibility + validation, quota validation, persistence +
// activity logging). The http handlers only parse input, call these functions,
// and map the discriminated outcomes onto HTTP statuses.

import {
  CAPTCHA_ENABLED_KEY,
  CAPTCHA_MIN_SCORE_KEY,
  CAPTCHA_PRIVATE_KEYS,
  CAPTCHA_PROVIDER_KEY,
  CAPTCHA_PUBLIC_KEYS,
} from '@shared/captcha'
import { SignupMode } from '@shared/constants'
import { compareSemver } from '@shared/semver'
import type { InstanceInfo } from '@shared/types'
import { readCaptchaConfig } from '../domain/captcha'
import { hasFeature } from '../domain/licensing'
import { originFromRequestUrl } from '../domain/site-public-origin'
import { getAppVersion } from '../version'
import { loadCaptchaOptionValues } from './captcha'
import { buildInstanceInfo, type runtimeInfo } from './instance-info'
import { loadBindingState } from './licensing'
import type { ActivityRepo, ChangelogProvider, InstanceRepo, LicenseBindingRepo, SystemOptionsRepo } from './ports'
import { getSitePublicOrigin } from './site-public-origin'

// instance-info keeps RuntimeInfo private; mirror it off the public helper rather
// than reaching into the module. runtimeInfo needs the platform binding, which is
// a request-context value (not a port), so the handler computes it and passes it
// in here.
type RuntimeInfo = ReturnType<typeof runtimeInfo>

export type SystemDeps = {
  systemOptions: SystemOptionsRepo
  instance: InstanceRepo
  changelog: ChangelogProvider
  activity: ActivityRepo
  licenseBinding: LicenseBindingRepo
}

// ─── Instance info ───────────────────────────────────────────────────────────

// Resolves the public origin (stored site origin → request-derived → raw request
// origin) and builds the About-page instance info on top of it.
export async function resolveInstanceInfo(
  deps: Pick<SystemDeps, 'systemOptions' | 'instance'>,
  params: { requestUrl: string; runtime: RuntimeInfo },
): Promise<InstanceInfo> {
  const origin =
    (await getSitePublicOrigin(deps)) ?? originFromRequestUrl(params.requestUrl) ?? new URL(params.requestUrl).origin
  return buildInstanceInfo(deps, { url: origin, runtime: params.runtime })
}

// ─── Changelog ───────────────────────────────────────────────────────────────

export type ChangelogResult = {
  currentVersion: string
  latestVersion: string | null
  updateAvailable: boolean
  markdown: string
}

export async function getChangelog(
  deps: Pick<SystemDeps, 'changelog'>,
  params: { now: number; force: boolean },
): Promise<ChangelogResult> {
  const { latestVersion, markdown } = await deps.changelog.fetchChangelog(params.now, { force: params.force })
  const currentVersion = getAppVersion()
  const updateAvailable = latestVersion ? compareSemver(latestVersion, currentVersion) > 0 : false
  return { currentVersion, latestVersion, updateAvailable, markdown }
}

// ─── Option reads ────────────────────────────────────────────────────────────

export type SystemOptionView = { key: string; value: string; public: boolean }

export async function listSystemOptions(
  deps: Pick<SystemDeps, 'systemOptions'>,
  params: { isAdmin: boolean },
): Promise<{ items: SystemOptionView[]; total: number }> {
  const items = params.isAdmin ? await deps.systemOptions.list() : await deps.systemOptions.listPublic()
  return { items, total: items.length }
}

export type GetSystemOptionOutcome =
  | { ok: true; option: SystemOptionView }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'forbidden' }

export async function getSystemOption(
  deps: Pick<SystemDeps, 'systemOptions'>,
  params: { key: string; isAdmin: boolean },
): Promise<GetSystemOptionOutcome> {
  const row = await deps.systemOptions.get(params.key)
  if (!row) return { ok: false, reason: 'not_found' }
  if (!row.public && !params.isAdmin) return { ok: false, reason: 'forbidden' }
  return { ok: true, option: { key: row.key, value: row.value, public: row.public } }
}

// ─── Option write ────────────────────────────────────────────────────────────

export type SetSystemOptionOutcome =
  | { ok: true; created: boolean; option: SystemOptionView }
  | { ok: false; reason: 'feature_blocked'; feature: 'open_registration' }
  | { ok: false; reason: 'invalid'; message: string }

// Opening signup to the public is a Pro capability; setting auth_signup_mode to
// `open` without the feature is blocked. Other modes/values pass freely.
async function signupModeBlocked(
  deps: Pick<SystemDeps, 'licenseBinding'>,
  key: string,
  value: string,
): Promise<boolean> {
  if (key !== 'auth_signup_mode' || value !== SignupMode.OPEN) return false
  const state = await loadBindingState(deps)
  return !hasFeature('open_registration', state)
}

// Captcha keys carry a fixed public/private visibility regardless of the request,
// keeping the secret key out of the anonymous options list.
function resolveCaptchaVisibility(key: string, requested: boolean | undefined): boolean | undefined {
  if ((CAPTCHA_PUBLIC_KEYS as readonly string[]).includes(key)) return true
  if ((CAPTCHA_PRIVATE_KEYS as readonly string[]).includes(key)) return false
  return requested
}

// Validates the incoming captcha option against the full (would-be) config, but
// only surfaces the error when captcha is enabled — so configuring the pieces in
// any order is allowed and the failure only blocks an active misconfiguration.
async function validateCaptchaOption(
  deps: Pick<SystemDeps, 'systemOptions'>,
  key: string,
  value: string,
): Promise<{ message: string } | null> {
  if (!(key === CAPTCHA_PROVIDER_KEY || key === CAPTCHA_MIN_SCORE_KEY || key.startsWith('captcha_'))) return null
  const captchaValues = await loadCaptchaOptionValues(deps)
  captchaValues[key] = value
  try {
    readCaptchaConfig(captchaValues)
  } catch (err) {
    if (captchaValues[CAPTCHA_ENABLED_KEY] === 'true') {
      return { message: err instanceof Error ? err.message : 'Captcha configuration is invalid' }
    }
  }
  return null
}

// Returns the normalized value plus a validation error, if any. Quota options must
// be positive integers; the traffic quota is trimmed and may be zero.
function validateQuotaOption(key: string, raw: string): { value: string; error?: string } {
  if (key === 'default_org_quota' || key === 'default_team_quota') {
    const quota = Number(raw)
    if (!Number.isInteger(quota) || quota <= 0) {
      return { value: raw, error: 'Default organization quota must be a positive number' }
    }
    return { value: raw }
  }
  if (key === 'default_org_monthly_traffic_quota') {
    const value = raw.trim()
    const quota = Number(value)
    if (value === '' || !Number.isInteger(quota) || quota < 0) {
      return { value, error: 'Default organization monthly traffic quota must be a non-negative number' }
    }
    return { value }
  }
  return { value: raw }
}

export async function setSystemOption(
  deps: SystemDeps,
  params: { userId: string; orgId: string; key: string; value: string; public?: boolean },
): Promise<SetSystemOptionOutcome> {
  const { userId, orgId, key } = params

  if (await signupModeBlocked(deps, key, params.value)) {
    return { ok: false, reason: 'feature_blocked', feature: 'open_registration' }
  }

  const isPublic = resolveCaptchaVisibility(key, params.public)

  const captchaError = await validateCaptchaOption(deps, key, params.value)
  if (captchaError) return { ok: false, reason: 'invalid', message: captchaError.message }

  const { value, error: quotaError } = validateQuotaOption(key, params.value)
  if (quotaError) return { ok: false, reason: 'invalid', message: quotaError }

  const existing = await deps.systemOptions.get(key)
  const nextPublic = !!(isPublic ?? existing?.public ?? false)
  await deps.systemOptions.set(key, value, nextPublic)
  await deps.activity.record({
    orgId,
    userId,
    action: 'system_option_set',
    targetType: 'system',
    targetName: key,
    metadata: { key, public: nextPublic },
  })
  return { ok: true, created: !existing, option: { key, value, public: nextPublic } }
}

export async function deleteSystemOption(
  deps: Pick<SystemDeps, 'systemOptions' | 'activity'>,
  params: { userId: string; orgId: string; key: string },
): Promise<{ key: string; deleted: true }> {
  const { userId, orgId, key } = params
  await deps.systemOptions.delete(key)
  await deps.activity.record({
    orgId,
    userId,
    action: 'system_option_delete',
    targetType: 'system',
    targetName: key,
    metadata: { key },
  })
  return { key, deleted: true }
}
