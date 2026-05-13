export const CAPTCHA_ENABLED_KEY = 'captcha_enabled'
export const CAPTCHA_PROVIDER_KEY = 'captcha_provider'
export const CAPTCHA_SITE_KEY_KEY = 'captcha_site_key'
export const CAPTCHA_SECRET_OPTION_KEY = 'captcha_secret_key' as const
export const CAPTCHA_MIN_SCORE_KEY = 'captcha_min_score'

export const CAPTCHA_PROVIDERS = ['google-recaptcha', 'cloudflare-turnstile', 'hcaptcha', 'captchafox'] as const

export type CaptchaProvider = (typeof CAPTCHA_PROVIDERS)[number]

export const DEFAULT_CAPTCHA_PROVIDER: CaptchaProvider = 'cloudflare-turnstile'

export const CAPTCHA_PUBLIC_KEYS = [CAPTCHA_ENABLED_KEY, CAPTCHA_PROVIDER_KEY, CAPTCHA_SITE_KEY_KEY] as const
export const CAPTCHA_PRIVATE_KEYS = [CAPTCHA_SECRET_OPTION_KEY, CAPTCHA_MIN_SCORE_KEY] as const
