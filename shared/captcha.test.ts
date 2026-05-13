import { describe, expect, it } from 'vitest'
import {
  CAPTCHA_ENABLED_KEY,
  CAPTCHA_MIN_SCORE_KEY,
  CAPTCHA_PRIVATE_KEYS,
  CAPTCHA_PROVIDER_KEY,
  CAPTCHA_PROVIDERS,
  CAPTCHA_PUBLIC_KEYS,
  CAPTCHA_SECRET_OPTION_KEY,
  CAPTCHA_SITE_KEY_KEY,
  DEFAULT_CAPTCHA_PROVIDER,
} from './captcha.js'

describe('captcha constants', () => {
  it('uses stable system option keys', () => {
    expect(CAPTCHA_ENABLED_KEY).toBe('captcha_enabled')
    expect(CAPTCHA_PROVIDER_KEY).toBe('captcha_provider')
    expect(CAPTCHA_SITE_KEY_KEY).toBe('captcha_site_key')
    expect(CAPTCHA_SECRET_OPTION_KEY).toBe('captcha_secret_key')
    expect(CAPTCHA_MIN_SCORE_KEY).toBe('captcha_min_score')
    expect(CAPTCHA_SECRET_OPTION_KEY).not.toMatch(/\.{3}/)
  })

  it('keeps only public captcha settings in public options', () => {
    expect(CAPTCHA_PUBLIC_KEYS).toEqual([CAPTCHA_ENABLED_KEY, CAPTCHA_PROVIDER_KEY, CAPTCHA_SITE_KEY_KEY])
    expect(CAPTCHA_PRIVATE_KEYS).toEqual([CAPTCHA_SECRET_OPTION_KEY, CAPTCHA_MIN_SCORE_KEY])
  })

  it('lists every supported Better Auth captcha provider', () => {
    expect(CAPTCHA_PROVIDERS).toEqual(['google-recaptcha', 'cloudflare-turnstile', 'hcaptcha', 'captchafox'])
    expect(DEFAULT_CAPTCHA_PROVIDER).toBe('cloudflare-turnstile')
  })
})
