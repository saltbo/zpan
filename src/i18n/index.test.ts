import { describe, expect, it } from 'vitest'
import en from './locales/en.json'
import zh from './locales/zh.json'

describe('locale key parity', () => {
  const enKeys = Object.keys(en).sort()
  const zhKeys = Object.keys(zh).sort()

  it('en.json and zh.json have the same number of keys', () => {
    expect(enKeys.length).toBe(zhKeys.length)
  })

  it('every key in en.json exists in zh.json', () => {
    expect(enKeys).toEqual(zhKeys)
  })

  it('no key has an empty value in en.json', () => {
    for (const key of enKeys) {
      expect((en as Record<string, string>)[key]).toBeTruthy()
    }
  })

  it('no key has an empty value in zh.json', () => {
    for (const key of zhKeys) {
      expect((zh as Record<string, string>)[key]).toBeTruthy()
    }
  })
})

describe('i18n initialization', () => {
  it('initializes successfully and marks isInitialized', async () => {
    const { default: i18n } = await import('./index')
    expect(i18n.isInitialized).toBe(true)
  })

  it('uses English as the fallback language', async () => {
    const { default: i18n } = await import('./index')
    const fallback = i18n.options.fallbackLng
    // fallbackLng may be stored as a string or string[]
    const normalized = Array.isArray(fallback) ? fallback[0] : fallback
    expect(normalized).toBe('en')
  })

  it('returns the English translation for a known key', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('en')
    expect(i18n.t('auth.signIn')).toBe('Sign In')
  })

  it('returns the Chinese translation after switching to zh', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('auth.signIn')).toBe('登录')
  })

  it('falls back to English for an unknown language', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('fr')
    expect(i18n.t('auth.signIn')).toBe('Sign In')
  })

  it('returns the translation key itself when the key does not exist', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('en')
    expect(i18n.t('nonexistent.key')).toBe('nonexistent.key')
  })

  it('has escapeValue disabled in interpolation config', async () => {
    const { default: i18n } = await import('./index')
    expect(i18n.options.interpolation?.escapeValue).toBe(false)
  })

  it('has both en and zh resources loaded', async () => {
    const { default: i18n } = await import('./index')
    expect(i18n.hasResourceBundle('en', 'translation')).toBe(true)
    expect(i18n.hasResourceBundle('zh', 'translation')).toBe(true)
  })
})
