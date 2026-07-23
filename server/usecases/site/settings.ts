import {
  CAPTCHA_ENABLED_KEY,
  CAPTCHA_MIN_SCORE_KEY,
  CAPTCHA_PROVIDER_KEY,
  CAPTCHA_SECRET_OPTION_KEY,
  CAPTCHA_SITE_KEY_KEY,
  DEFAULT_CAPTCHA_PROVIDER,
} from '@shared/captcha'
import {
  DEFAULT_ORG_QUOTA,
  DEFAULT_ORG_TRAFFIC_QUOTA,
  DEFAULT_SITE_DESCRIPTION,
  DEFAULT_SITE_NAME,
  SignupMode,
} from '@shared/constants'
import type {
  SiteCaptchaSettings,
  SiteIdentitySettings,
  SiteQuotaSettings,
  SiteRegistrationSettings,
  SiteSettings,
  SiteWebDavSettings,
  UpdateSiteCaptchaInput,
  UpdateSiteIdentityInput,
  UpdateSiteQuotasInput,
  UpdateSiteRegistrationInput,
  UpdateSiteWebDavInput,
} from '@shared/schemas'
import { readCaptchaConfig } from '../../domain/captcha'
import { hasFeature } from '../../domain/licensing'
import { normalizePublicOrigin, SITE_PUBLIC_ORIGIN_KEY } from '../../domain/site-public-origin'
import { WEBDAV_AUTH_CHALLENGE, webDavPathUrl, webDavPublicUrl } from '../../domain/webdav-public-url'
import { badRequest, featureBlocked, type LicenseBindingRepo, type SystemOptionsRepo } from '../ports'
import { loadBindingState, resolveEffectiveSignupMode } from './licensing'
import { resetSitePublicOriginCache } from './public-origin'

export const SITE_SETTING_KEYS = {
  name: 'site_name',
  description: 'site_description',
  publicOrigin: SITE_PUBLIC_ORIGIN_KEY,
  signupMode: 'auth_signup_mode',
  captchaEnabled: CAPTCHA_ENABLED_KEY,
  captchaProvider: CAPTCHA_PROVIDER_KEY,
  captchaSiteKey: CAPTCHA_SITE_KEY_KEY,
  captchaSecretKey: CAPTCHA_SECRET_OPTION_KEY,
  captchaMinScore: CAPTCHA_MIN_SCORE_KEY,
  defaultOrgQuota: 'default_org_quota',
  defaultTeamQuota: 'default_team_quota',
  defaultMonthlyTrafficQuota: 'default_org_monthly_traffic_quota',
  webdavVerifiedOrigin: 'webdav_verified_origin',
  webdavVerifiedAt: 'webdav_verified_at',
  webdavVerificationError: 'webdav_verification_error',
  webdavEnabled: 'webdav_enabled',
  webdavDomain: 'webdav_domain',
} as const

const ALL_SETTING_KEYS = Object.values(SITE_SETTING_KEYS)

export type SiteSettingsDeps = {
  systemOptions: SystemOptionsRepo
  licenseBinding: LicenseBindingRepo
}

function optionMap(rows: Array<{ key: string; value: string }>): Map<string, string> {
  return new Map(rows.map((row) => [row.key, row.value]))
}

function configuredSignupMode(raw: string | undefined): SignupMode {
  if (raw === SignupMode.INVITE_ONLY || raw === SignupMode.CLOSED) return raw
  return SignupMode.OPEN
}

function positiveInteger(raw: string | undefined, fallback: number): number {
  const value = Number(raw)
  return Number.isInteger(value) && value > 0 ? value : fallback
}

function nonNegativeInteger(raw: string | undefined, fallback: number): number {
  const value = Number(raw)
  return Number.isInteger(value) && value >= 0 ? value : fallback
}

function captchaMinScore(raw: string | undefined): number | null {
  if (!raw?.trim()) return null
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error('Stored captcha minimum score is invalid')
  return value
}

function identityFrom(values: Map<string, string>, requestUrl: string): SiteIdentitySettings {
  return {
    name: values.get(SITE_SETTING_KEYS.name) ?? DEFAULT_SITE_NAME,
    description: values.get(SITE_SETTING_KEYS.description) ?? DEFAULT_SITE_DESCRIPTION,
    publicUrl: normalizePublicOrigin(values.get(SITE_SETTING_KEYS.publicOrigin)) ?? new URL(requestUrl).origin,
  }
}

function captchaFrom(values: Map<string, string>): SiteCaptchaSettings {
  const provider = values.get(SITE_SETTING_KEYS.captchaProvider)
  return {
    enabled: values.get(SITE_SETTING_KEYS.captchaEnabled) === 'true',
    provider:
      provider === 'google-recaptcha' ||
      provider === 'cloudflare-turnstile' ||
      provider === 'hcaptcha' ||
      provider === 'captchafox'
        ? provider
        : DEFAULT_CAPTCHA_PROVIDER,
    siteKey: values.get(SITE_SETTING_KEYS.captchaSiteKey) ?? '',
    secretConfigured: !!values.get(SITE_SETTING_KEYS.captchaSecretKey)?.trim(),
    minScore: captchaMinScore(values.get(SITE_SETTING_KEYS.captchaMinScore)),
  }
}

function quotasFrom(values: Map<string, string>): SiteQuotaSettings {
  const defaultOrgBytes = positiveInteger(values.get(SITE_SETTING_KEYS.defaultOrgQuota), DEFAULT_ORG_QUOTA)
  return {
    defaultOrgBytes,
    defaultTeamBytes: positiveInteger(values.get(SITE_SETTING_KEYS.defaultTeamQuota), defaultOrgBytes),
    defaultMonthlyTrafficBytes: nonNegativeInteger(
      values.get(SITE_SETTING_KEYS.defaultMonthlyTrafficQuota),
      DEFAULT_ORG_TRAFFIC_QUOTA,
    ),
  }
}

function isWebDavEnabled(values: Map<string, string>): boolean {
  return values.get(SITE_SETTING_KEYS.webdavEnabled) !== 'false'
}

function webdavFrom(values: Map<string, string>, requestUrl: string): SiteWebDavSettings {
  const publicUrl = normalizePublicOrigin(values.get(SITE_SETTING_KEYS.publicOrigin)) ?? new URL(requestUrl).origin
  const enabled = isWebDavEnabled(values)
  const domain = values.get(SITE_SETTING_KEYS.webdavDomain)?.trim() ?? ''
  const candidate = webDavPublicUrl(publicUrl, domain)
  const verifiedOrigin = normalizePublicOrigin(values.get(SITE_SETTING_KEYS.webdavVerifiedOrigin))
  const error = values.get(SITE_SETTING_KEYS.webdavVerificationError)?.trim() || null
  const ready = candidate !== null && candidate.origin === verifiedOrigin
  const lastVerifiedAt = ready ? values.get(SITE_SETTING_KEYS.webdavVerifiedAt)?.trim() || null : null

  return {
    enabled,
    domain,
    pathUrl: webDavPathUrl(requestUrl, publicUrl),
    candidateUrl: candidate ? `${candidate.origin}/` : null,
    status: enabled ? (ready ? 'ready' : error ? 'failed' : 'unverified') : 'disabled',
    lastVerifiedAt,
    error: enabled && !ready ? error : null,
  }
}

export async function getSiteWebDavRuntimeConfig(
  deps: Pick<SiteSettingsDeps, 'systemOptions'>,
): Promise<{ enabled: boolean; domain: string }> {
  const values = optionMap(
    await deps.systemOptions.getMany([SITE_SETTING_KEYS.webdavEnabled, SITE_SETTING_KEYS.webdavDomain]),
  )
  return {
    enabled: isWebDavEnabled(values),
    domain: values.get(SITE_SETTING_KEYS.webdavDomain)?.trim() ?? '',
  }
}

async function registrationFrom(
  deps: Pick<SiteSettingsDeps, 'licenseBinding'>,
  values: Map<string, string>,
): Promise<SiteRegistrationSettings> {
  const raw = values.get(SITE_SETTING_KEYS.signupMode)
  return {
    configuredMode: configuredSignupMode(raw),
    effectiveMode: await resolveEffectiveSignupMode(deps, raw),
  }
}

export async function getSiteSettings(
  deps: Pick<SiteSettingsDeps, 'systemOptions' | 'licenseBinding'>,
  requestUrl: string,
): Promise<SiteSettings> {
  const values = optionMap(await deps.systemOptions.getMany(ALL_SETTING_KEYS))
  return {
    identity: identityFrom(values, requestUrl),
    registration: await registrationFrom(deps, values),
    captcha: captchaFrom(values),
    quotas: quotasFrom(values),
    webdav: webdavFrom(values, requestUrl),
  }
}

export async function updateSiteIdentity(
  deps: SiteSettingsDeps,
  input: UpdateSiteIdentityInput,
): Promise<SiteIdentitySettings> {
  const publicUrl = normalizePublicOrigin(input.publicUrl)
  if (!publicUrl) throw badRequest('Public URL must be an HTTP or HTTPS origin')

  const current = optionMap(
    await deps.systemOptions.getMany([
      SITE_SETTING_KEYS.name,
      SITE_SETTING_KEYS.description,
      SITE_SETTING_KEYS.publicOrigin,
    ]),
  )
  const identityChanged =
    input.name !== (current.get(SITE_SETTING_KEYS.name) ?? DEFAULT_SITE_NAME) ||
    input.description !== (current.get(SITE_SETTING_KEYS.description) ?? DEFAULT_SITE_DESCRIPTION)
  if (identityChanged) {
    const state = await loadBindingState(deps)
    if (!hasFeature('white_label', state)) {
      throw featureBlocked('Feature not available', {
        metadata: { feature: 'white_label', upgradeUrl: '/settings/billing' },
      })
    }
  }

  const publicUrlChanged = normalizePublicOrigin(current.get(SITE_SETTING_KEYS.publicOrigin)) !== publicUrl
  await deps.systemOptions.setMany([
    { key: SITE_SETTING_KEYS.name, value: input.name },
    { key: SITE_SETTING_KEYS.description, value: input.description },
    { key: SITE_SETTING_KEYS.publicOrigin, value: publicUrl },
    ...(publicUrlChanged
      ? [
          { key: SITE_SETTING_KEYS.webdavVerifiedOrigin, value: '' },
          { key: SITE_SETTING_KEYS.webdavVerifiedAt, value: '' },
          { key: SITE_SETTING_KEYS.webdavVerificationError, value: '' },
        ]
      : []),
  ])
  resetSitePublicOriginCache()
  return { ...input, publicUrl }
}

export async function verifySiteWebDav(
  deps: Pick<SiteSettingsDeps, 'systemOptions'>,
  requestUrl: string,
  fetcher: typeof fetch,
): Promise<SiteWebDavSettings> {
  const values = optionMap(await deps.systemOptions.getMany(ALL_SETTING_KEYS))
  const current = webdavFrom(values, requestUrl)
  if (!current.enabled) throw badRequest('WebDAV must be enabled before its domain can be verified')
  const candidate = current.candidateUrl
  let error: string | null = null

  await deps.systemOptions.setMany([
    { key: SITE_SETTING_KEYS.webdavVerifiedOrigin, value: '' },
    { key: SITE_SETTING_KEYS.webdavVerifiedAt, value: '' },
    { key: SITE_SETTING_KEYS.webdavVerificationError, value: '' },
  ])

  if (!candidate) {
    error = 'The Public URL must use a hostname before a WebDAV domain can be verified.'
  } else {
    try {
      const response = await fetcher(candidate, {
        method: 'OPTIONS',
        redirect: 'manual',
        signal: AbortSignal.timeout(10_000),
      })
      if (response.status !== 401 || response.headers.get('WWW-Authenticate') !== WEBDAV_AUTH_CHALLENGE) {
        error = `WebDAV verification returned HTTP ${response.status} without the expected authentication challenge.`
      }
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'WebDAV verification request failed.'
    }
  }

  const verifiedAt = error ? '' : new Date().toISOString()
  await deps.systemOptions.setMany([
    { key: SITE_SETTING_KEYS.webdavVerifiedOrigin, value: error || !candidate ? '' : new URL(candidate).origin },
    { key: SITE_SETTING_KEYS.webdavVerifiedAt, value: verifiedAt },
    { key: SITE_SETTING_KEYS.webdavVerificationError, value: error ?? '' },
  ])
  const updatedValues = optionMap(await deps.systemOptions.getMany(ALL_SETTING_KEYS))
  return webdavFrom(updatedValues, requestUrl)
}

export async function updateSiteWebDav(
  deps: Pick<SiteSettingsDeps, 'systemOptions'>,
  input: UpdateSiteWebDavInput,
  requestUrl: string,
): Promise<SiteWebDavSettings> {
  const domain = input.domain.trim().toLowerCase()
  const currentDomain = (await deps.systemOptions.getValue(SITE_SETTING_KEYS.webdavDomain))?.trim() ?? ''
  const domainChanged = currentDomain !== domain

  await deps.systemOptions.setMany([
    { key: SITE_SETTING_KEYS.webdavEnabled, value: String(input.enabled) },
    { key: SITE_SETTING_KEYS.webdavDomain, value: domain },
    ...(domainChanged
      ? [
          { key: SITE_SETTING_KEYS.webdavVerifiedOrigin, value: '' },
          { key: SITE_SETTING_KEYS.webdavVerifiedAt, value: '' },
          { key: SITE_SETTING_KEYS.webdavVerificationError, value: '' },
        ]
      : []),
  ])

  return webdavFrom(optionMap(await deps.systemOptions.getMany(ALL_SETTING_KEYS)), requestUrl)
}

export async function updateSiteRegistration(
  deps: SiteSettingsDeps,
  input: UpdateSiteRegistrationInput,
): Promise<SiteRegistrationSettings> {
  if (input.mode === SignupMode.OPEN) {
    const state = await loadBindingState(deps)
    if (!hasFeature('open_registration', state)) {
      throw featureBlocked('Feature not available', {
        metadata: { feature: 'open_registration', upgradeUrl: '/settings/billing' },
      })
    }
  }
  await deps.systemOptions.set(SITE_SETTING_KEYS.signupMode, input.mode)
  return {
    configuredMode: input.mode,
    effectiveMode: await resolveEffectiveSignupMode(deps, input.mode),
  }
}

export async function updateSiteCaptcha(
  deps: SiteSettingsDeps,
  input: UpdateSiteCaptchaInput,
): Promise<SiteCaptchaSettings> {
  const existingSecret = await deps.systemOptions.getValue(SITE_SETTING_KEYS.captchaSecretKey)
  const secretKey = Object.hasOwn(input, 'secretKey') ? (input.secretKey ?? '') : (existingSecret ?? '')
  const values = {
    [CAPTCHA_ENABLED_KEY]: String(input.enabled),
    [CAPTCHA_PROVIDER_KEY]: input.provider,
    [CAPTCHA_SITE_KEY_KEY]: input.siteKey.trim(),
    [CAPTCHA_SECRET_OPTION_KEY]: secretKey.trim(),
    [CAPTCHA_MIN_SCORE_KEY]: input.minScore === null ? '' : String(input.minScore),
  }
  try {
    readCaptchaConfig(values)
  } catch (error) {
    throw badRequest(error instanceof Error ? error.message : 'Captcha configuration is invalid')
  }

  await deps.systemOptions.setMany(Object.entries(values).map(([key, value]) => ({ key, value })))
  return captchaFrom(optionMap(Object.entries(values).map(([key, value]) => ({ key, value }))))
}

export async function updateSiteQuotas(
  deps: SiteSettingsDeps,
  input: UpdateSiteQuotasInput,
): Promise<SiteQuotaSettings> {
  await deps.systemOptions.setMany([
    { key: SITE_SETTING_KEYS.defaultOrgQuota, value: String(input.defaultOrgBytes) },
    { key: SITE_SETTING_KEYS.defaultTeamQuota, value: String(input.defaultTeamBytes) },
    { key: SITE_SETTING_KEYS.defaultMonthlyTrafficQuota, value: String(input.defaultMonthlyTrafficBytes) },
  ])
  return input
}
