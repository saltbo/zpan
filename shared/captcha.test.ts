import { describe, expect, it } from 'vitest'
import {
  CAPTCHA_ENABLED_KEY,
  CAPTCHA_PRIVATE_KEYS,
  CAPTCHA_PUBLIC_KEYS,
  CAPTCHA_SECRET_OPTION_KEY,
  CAPTCHA_SITE_KEY_KEY,
} from './captcha.js'

describe('captcha constants', () => {
  it('uses stable system option keys', () => {
    expect(CAPTCHA_ENABLED_KEY).toBe('captcha_enabled')
    expect(CAPTCHA_SITE_KEY_KEY).toBe('captcha_turnstile_site_key')
    expect(CAPTCHA_SECRET_OPTION_KEY).toBe('captcha_turnstile_secret_key')
    expect(CAPTCHA_SECRET_OPTION_KEY).not.toMatch(/\.{3}/)
  })

  it('keeps only public captcha settings in public options', () => {
    expect(CAPTCHA_PUBLIC_KEYS).toEqual([CAPTCHA_ENABLED_KEY, CAPTCHA_SITE_KEY_KEY])
    expect(CAPTCHA_PRIVATE_KEYS).toEqual([CAPTCHA_SECRET_OPTION_KEY])
  })
})
