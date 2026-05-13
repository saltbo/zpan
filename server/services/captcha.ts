import type { CaptchaOptions } from 'better-auth/plugins'
import { eq, inArray } from 'drizzle-orm'
import {
  CAPTCHA_ENABLED_KEY,
  CAPTCHA_MIN_SCORE_KEY,
  CAPTCHA_PROVIDER_KEY,
  CAPTCHA_PROVIDERS,
  CAPTCHA_SECRET_OPTION_KEY,
  CAPTCHA_SITE_KEY_KEY,
  type CaptchaProvider,
  DEFAULT_CAPTCHA_PROVIDER,
} from '../../shared/captcha'
import { systemOptions } from '../db/schema'
import type { Database } from '../platform/interface'

export const CAPTCHA_AUTH_ENDPOINTS = ['/sign-up/email', '/sign-in/email', '/sign-in/username'] as const

export type CaptchaConfig = {
  enabled: boolean
  provider: CaptchaProvider
  siteKey: string
  secretKey: string
  minScore?: number
}

type CaptchaOptionValues = Partial<Record<string, string>>

const CAPTCHA_OPTION_KEYS = [
  CAPTCHA_ENABLED_KEY,
  CAPTCHA_PROVIDER_KEY,
  CAPTCHA_SITE_KEY_KEY,
  CAPTCHA_SECRET_OPTION_KEY,
  CAPTCHA_MIN_SCORE_KEY,
] as const

export async function isCaptchaEnabled(db: Database): Promise<boolean> {
  const [row] = await db
    .select({ value: systemOptions.value })
    .from(systemOptions)
    .where(eq(systemOptions.key, CAPTCHA_ENABLED_KEY))
  return row?.value === 'true'
}

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

export async function loadCaptchaConfig(db: Database): Promise<CaptchaConfig | null> {
  const rows = await db
    .select({ key: systemOptions.key, value: systemOptions.value })
    .from(systemOptions)
    .where(inArray(systemOptions.key, [...CAPTCHA_OPTION_KEYS]))

  const values: CaptchaOptionValues = {}
  for (const row of rows) values[row.key] = row.value
  return readCaptchaConfig(values)
}

export async function loadCaptchaOptionValues(db: Database): Promise<CaptchaOptionValues> {
  const rows = await db
    .select({ key: systemOptions.key, value: systemOptions.value })
    .from(systemOptions)
    .where(inArray(systemOptions.key, [...CAPTCHA_OPTION_KEYS]))

  const values: CaptchaOptionValues = {}
  for (const row of rows) values[row.key] = row.value
  return values
}

export function toBetterAuthCaptchaOptions(config: CaptchaConfig): CaptchaOptions {
  const base = {
    provider: config.provider,
    secretKey: config.secretKey,
    endpoints: [...CAPTCHA_AUTH_ENDPOINTS],
  }

  if (config.provider === 'google-recaptcha') {
    return config.minScore === undefined ? base : { ...base, minScore: config.minScore }
  }

  if (config.provider === 'hcaptcha' || config.provider === 'captchafox') {
    return { ...base, siteKey: config.siteKey }
  }

  return base
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
