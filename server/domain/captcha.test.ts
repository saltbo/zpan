import { describe, expect, it } from 'vitest'
import {
  CAPTCHA_ENABLED_KEY,
  CAPTCHA_MIN_SCORE_KEY,
  CAPTCHA_PROVIDER_KEY,
  CAPTCHA_SECRET_OPTION_KEY,
  CAPTCHA_SITE_KEY_KEY,
} from '../../shared/captcha.js'
import { toBetterAuthCaptchaOptions } from '../auth.js'
import { CAPTCHA_AUTH_ENDPOINTS, type CaptchaConfig, readCaptchaConfig } from './captcha.js'

const COMPLETE_CONFIG = {
  [CAPTCHA_ENABLED_KEY]: 'true',
  [CAPTCHA_SITE_KEY_KEY]: 'site-key',
  [CAPTCHA_SECRET_OPTION_KEY]: 'secret-key',
}

describe('captcha config', () => {
  it('treats absent settings as disabled', () => {
    expect(readCaptchaConfig({})).toBeNull()
  })

  it('requires provider config before enabling captcha', () => {
    expect(() => readCaptchaConfig({ [CAPTCHA_ENABLED_KEY]: 'true' })).toThrow(
      'Captcha site key is required before enabling captcha',
    )
    expect(() =>
      readCaptchaConfig({
        [CAPTCHA_ENABLED_KEY]: 'true',
        [CAPTCHA_SITE_KEY_KEY]: 'site-key',
      }),
    ).toThrow('Captcha secret key is required before enabling captcha')
    expect(() =>
      readCaptchaConfig({
        ...COMPLETE_CONFIG,
        [CAPTCHA_PROVIDER_KEY]: 'unknown',
      }),
    ).toThrow('Captcha provider is invalid')
  })

  it('parses every supported provider shape', () => {
    const providers = ['google-recaptcha', 'cloudflare-turnstile', 'hcaptcha', 'captchafox'] as const

    for (const provider of providers) {
      const config = readCaptchaConfig({
        ...COMPLETE_CONFIG,
        [CAPTCHA_PROVIDER_KEY]: provider,
      })

      expect(config).toMatchObject({ enabled: true, provider, siteKey: 'site-key', secretKey: 'secret-key' })
    }
  })

  it('validates optional reCAPTCHA minimum score', () => {
    expect(
      readCaptchaConfig({
        ...COMPLETE_CONFIG,
        [CAPTCHA_PROVIDER_KEY]: 'google-recaptcha',
        [CAPTCHA_MIN_SCORE_KEY]: '0.7',
      }),
    ).toMatchObject({ minScore: 0.7 })

    expect(() =>
      readCaptchaConfig({
        ...COMPLETE_CONFIG,
        [CAPTCHA_PROVIDER_KEY]: 'google-recaptcha',
        [CAPTCHA_MIN_SCORE_KEY]: '1.5',
      }),
    ).toThrow('Captcha minimum score must be between 0 and 1')
  })

  it('maps provider settings to Better Auth captcha options', () => {
    const baseConfig: CaptchaConfig = {
      enabled: true,
      provider: 'hcaptcha',
      siteKey: 'site-key',
      secretKey: 'secret-key',
    }

    expect(toBetterAuthCaptchaOptions(baseConfig)).toEqual({
      provider: 'hcaptcha',
      siteKey: 'site-key',
      secretKey: 'secret-key',
      endpoints: [...CAPTCHA_AUTH_ENDPOINTS],
    })

    expect(toBetterAuthCaptchaOptions({ ...baseConfig, provider: 'google-recaptcha', minScore: 0.8 })).toEqual({
      provider: 'google-recaptcha',
      secretKey: 'secret-key',
      minScore: 0.8,
      endpoints: [...CAPTCHA_AUTH_ENDPOINTS],
    })
  })
})
