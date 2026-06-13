import {
  CAPTCHA_ENABLED_KEY,
  CAPTCHA_MIN_SCORE_KEY,
  CAPTCHA_PROVIDER_KEY,
  CAPTCHA_PROVIDERS,
  CAPTCHA_SECRET_OPTION_KEY,
  CAPTCHA_SITE_KEY_KEY,
  type CaptchaProvider,
  DEFAULT_CAPTCHA_PROVIDER,
} from '@shared/captcha'

export const CAPTCHA_AUTH_ENDPOINTS = ['/sign-up/email', '/sign-in/email', '/sign-in/username'] as const

export type CaptchaConfig = {
  enabled: boolean
  provider: CaptchaProvider
  siteKey: string
  secretKey: string
  minScore?: number
}

export type CaptchaOptionValues = Partial<Record<string, string>>

export function isCaptchaProvider(value: string): value is CaptchaProvider {
  return (CAPTCHA_PROVIDERS as readonly string[]).includes(value)
}

export function readCaptchaConfig(options: CaptchaOptionValues): CaptchaConfig | null {
  if (options[CAPTCHA_ENABLED_KEY] !== 'true') return null

  const provider = options[CAPTCHA_PROVIDER_KEY] ?? DEFAULT_CAPTCHA_PROVIDER
  if (!isCaptchaProvider(provider)) throw new Error('Captcha provider is invalid')

  const siteKey = options[CAPTCHA_SITE_KEY_KEY]?.trim() ?? ''
  if (!siteKey) throw new Error('Captcha site key is required before enabling captcha')

  const secretKey = options[CAPTCHA_SECRET_OPTION_KEY]?.trim() ?? ''
  if (!secretKey) throw new Error('Captcha secret key is required before enabling captcha')

  const minScore = readMinScore(options[CAPTCHA_MIN_SCORE_KEY])
  return { enabled: true, provider, siteKey, secretKey, minScore }
}

function readMinScore(raw: string | undefined): number | undefined {
  const value = raw?.trim()
  if (!value) return undefined
  const score = Number(value)
  if (!Number.isFinite(score) || score < 0 || score > 1) {
    throw new Error('Captcha minimum score must be between 0 and 1')
  }
  return score
}
