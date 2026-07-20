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
  UpdateSiteCaptchaInput,
  UpdateSiteIdentityInput,
  UpdateSiteQuotasInput,
  UpdateSiteRegistrationInput,
} from '@shared/schemas'
import { readCaptchaConfig } from '../../domain/captcha'
import { hasFeature } from '../../domain/licensing'
import { normalizePublicOrigin, SITE_PUBLIC_ORIGIN_KEY } from '../../domain/site-public-origin'
import {
  type ActivityRepo,
  badRequest,
  featureBlocked,
  type LicenseBindingRepo,
  type SystemOptionsRepo,
} from '../ports'
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
} as const

const ALL_SETTING_KEYS = Object.values(SITE_SETTING_KEYS)

export type SiteSettingsDeps = {
  systemOptions: SystemOptionsRepo
  licenseBinding: LicenseBindingRepo
  activity: ActivityRepo
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
  }
}

async function recordUpdate(
  deps: Pick<SiteSettingsDeps, 'activity'>,
  actor: { userId: string; orgId: string },
  action: string,
  fields: string[],
): Promise<void> {
  await deps.activity.record({
    ...actor,
    action,
    targetType: 'site_settings',
    targetName: action,
    metadata: { fields },
  })
}

export async function updateSiteIdentity(
  deps: SiteSettingsDeps,
  actor: { userId: string; orgId: string },
  input: UpdateSiteIdentityInput,
): Promise<SiteIdentitySettings> {
  const publicUrl = normalizePublicOrigin(input.publicUrl)
  if (!publicUrl) throw badRequest('Public URL must be an HTTP or HTTPS origin')

  const current = optionMap(await deps.systemOptions.getMany([SITE_SETTING_KEYS.name, SITE_SETTING_KEYS.description]))
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

  await deps.systemOptions.setMany([
    { key: SITE_SETTING_KEYS.name, value: input.name },
    { key: SITE_SETTING_KEYS.description, value: input.description },
    { key: SITE_SETTING_KEYS.publicOrigin, value: publicUrl },
  ])
  resetSitePublicOriginCache()
  await recordUpdate(deps, actor, 'site_identity_update', ['name', 'description', 'publicUrl'])
  return { ...input, publicUrl }
}

export async function updateSiteRegistration(
  deps: SiteSettingsDeps,
  actor: { userId: string; orgId: string },
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
  await recordUpdate(deps, actor, 'site_registration_update', ['mode'])
  return {
    configuredMode: input.mode,
    effectiveMode: await resolveEffectiveSignupMode(deps, input.mode),
  }
}

export async function updateSiteCaptcha(
  deps: SiteSettingsDeps,
  actor: { userId: string; orgId: string },
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
  await recordUpdate(deps, actor, 'site_captcha_update', ['enabled', 'provider', 'siteKey', 'secretKey', 'minScore'])
  return captchaFrom(optionMap(Object.entries(values).map(([key, value]) => ({ key, value }))))
}

export async function updateSiteQuotas(
  deps: SiteSettingsDeps,
  actor: { userId: string; orgId: string },
  input: UpdateSiteQuotasInput,
): Promise<SiteQuotaSettings> {
  await deps.systemOptions.setMany([
    { key: SITE_SETTING_KEYS.defaultOrgQuota, value: String(input.defaultOrgBytes) },
    { key: SITE_SETTING_KEYS.defaultTeamQuota, value: String(input.defaultTeamBytes) },
    { key: SITE_SETTING_KEYS.defaultMonthlyTrafficQuota, value: String(input.defaultMonthlyTrafficBytes) },
  ])
  await recordUpdate(deps, actor, 'site_quotas_update', [
    'defaultOrgBytes',
    'defaultTeamBytes',
    'defaultMonthlyTrafficBytes',
  ])
  return input
}
