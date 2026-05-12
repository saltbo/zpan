export const CAPTCHA_ENABLED_KEY = 'captcha_enabled'
export const CAPTCHA_SITE_KEY_KEY = 'captcha_turnstile_site_key'
// Persisted system_options key. Keep this as the full literal.
export const CAPTCHA_SECRET_OPTION_KEY = 'captcha_turnstile_secret_key'

export const CAPTCHA_PUBLIC_KEYS = [CAPTCHA_ENABLED_KEY, CAPTCHA_SITE_KEY_KEY] as const
export const CAPTCHA_PRIVATE_KEYS = [CAPTCHA_SECRET_OPTION_KEY] as const
