import {
  CAPTCHA_ENABLED_KEY,
  CAPTCHA_MIN_SCORE_KEY,
  CAPTCHA_PROVIDER_KEY,
  CAPTCHA_SECRET_OPTION_KEY,
  CAPTCHA_SITE_KEY_KEY,
} from '@shared/captcha'
import { DEFAULT_SITE_DESCRIPTION, DEFAULT_SITE_NAME } from '@shared/constants'
import type { SiteBranding, SiteConfig } from '@shared/schemas'
import { readCaptchaConfig } from '../../domain/captcha'
import { normalizePublicOrigin } from '../../domain/site-public-origin'
import { effectiveWebDavUrl } from '../../domain/webdav-public-url'
import type { LicenseBindingRepo, SystemOptionsRepo } from '../ports'
import { listPublicAuthProviders } from './auth-provider'
import { readBranding } from './branding'
import { resolveEffectiveSignupMode } from './licensing'
import { SITE_SETTING_KEYS } from './settings'

export type ConfigzDeps = {
  systemOptions: SystemOptionsRepo
  licenseBinding: LicenseBindingRepo
}

const CONFIG_KEYS = [
  SITE_SETTING_KEYS.name,
  SITE_SETTING_KEYS.description,
  SITE_SETTING_KEYS.publicOrigin,
  SITE_SETTING_KEYS.signupMode,
  SITE_SETTING_KEYS.captchaEnabled,
  SITE_SETTING_KEYS.captchaProvider,
  SITE_SETTING_KEYS.captchaSiteKey,
  SITE_SETTING_KEYS.captchaSecretKey,
  SITE_SETTING_KEYS.captchaMinScore,
  SITE_SETTING_KEYS.webdavEnabled,
  SITE_SETTING_KEYS.webdavDomain,
  SITE_SETTING_KEYS.webdavVerifiedOrigin,
]

function brandingView(config: Awaited<ReturnType<typeof readBranding>>): SiteBranding {
  return {
    logoUrl: config.logo_url,
    faviconUrl: config.favicon_url,
    wordmark: config.wordmark_text,
    hidePoweredBy: config.hide_powered_by,
    theme: {
      mode: config.theme.mode,
      preset: config.theme.preset,
      custom: config.theme.custom
        ? {
            primaryColor: config.theme.custom.primary_color,
            primaryForeground: config.theme.custom.primary_foreground,
            canvasColor: config.theme.custom.canvas_color,
            sidebarAccentColor: config.theme.custom.sidebar_accent_color,
            ringColor: config.theme.custom.ring_color,
          }
        : null,
      configured: config.theme.configured,
    },
  }
}

export async function getSiteConfig(deps: ConfigzDeps, requestUrl: string): Promise<SiteConfig> {
  const [rows, branding, providers] = await Promise.all([
    deps.systemOptions.getMany(CONFIG_KEYS),
    readBranding(deps),
    listPublicAuthProviders(deps),
  ])
  const values = new Map(rows.map((row) => [row.key, row.value]))
  const publicUrl = normalizePublicOrigin(values.get(SITE_SETTING_KEYS.publicOrigin)) ?? new URL(requestUrl).origin
  const captcha = readCaptchaConfig({
    [CAPTCHA_ENABLED_KEY]: values.get(SITE_SETTING_KEYS.captchaEnabled),
    [CAPTCHA_PROVIDER_KEY]: values.get(SITE_SETTING_KEYS.captchaProvider),
    [CAPTCHA_SITE_KEY_KEY]: values.get(SITE_SETTING_KEYS.captchaSiteKey),
    [CAPTCHA_SECRET_OPTION_KEY]: values.get(SITE_SETTING_KEYS.captchaSecretKey),
    [CAPTCHA_MIN_SCORE_KEY]: values.get(SITE_SETTING_KEYS.captchaMinScore),
  })

  return {
    site: {
      name: values.get(SITE_SETTING_KEYS.name) ?? DEFAULT_SITE_NAME,
      description: values.get(SITE_SETTING_KEYS.description) ?? DEFAULT_SITE_DESCRIPTION,
      publicUrl,
    },
    branding: brandingView(branding),
    auth: {
      signupMode: await resolveEffectiveSignupMode(deps, values.get(SITE_SETTING_KEYS.signupMode)),
      captcha: captcha ? { enabled: true, provider: captcha.provider, siteKey: captcha.siteKey } : { enabled: false },
      providers,
    },
    services: {
      webdav: {
        enabled: values.get(SITE_SETTING_KEYS.webdavEnabled) !== 'false',
        url: effectiveWebDavUrl(
          requestUrl,
          publicUrl,
          values.get(SITE_SETTING_KEYS.webdavVerifiedOrigin),
          values.get(SITE_SETTING_KEYS.webdavDomain),
        ),
      },
    },
  }
}
