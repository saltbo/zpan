import { describe, expect, it } from 'vitest'
import en from './locales/en.json'
import zh from './locales/zh.json'

const enLocale = en as Record<string, string>
const zhLocale = zh as Record<string, string>

const ADMIN_SETTINGS_KEYS = [
  'admin.settings.title',
  'admin.settings.siteSection',
  'admin.settings.siteName',
  'admin.settings.siteDescription',
  'admin.settings.saved',
]

const ADMIN_NAV_SETTINGS_KEYS = ['admin.nav.settings']

const ALL_KEYS = [...ADMIN_SETTINGS_KEYS, ...ADMIN_NAV_SETTINGS_KEYS]

describe('admin.settings locale keys — presence', () => {
  for (const key of ALL_KEYS) {
    it(`en.json contains key "${key}"`, () => {
      expect(Object.hasOwn(enLocale, key)).toBe(true)
    })

    it(`zh.json contains key "${key}"`, () => {
      expect(Object.hasOwn(zhLocale, key)).toBe(true)
    })
  }
})

describe('admin.settings locale keys — non-empty values', () => {
  for (const key of ALL_KEYS) {
    it(`en.json value for "${key}" is not empty`, () => {
      expect(enLocale[key]).toBeTruthy()
    })

    it(`zh.json value for "${key}" is not empty`, () => {
      expect(zhLocale[key]).toBeTruthy()
    })
  }
})

describe('admin.settings locale keys — English values contract', () => {
  it('admin.settings.title is "Settings"', () => {
    expect(enLocale['admin.settings.title']).toBe('Settings')
  })

  it('admin.settings.siteSection is "Site Settings"', () => {
    expect(enLocale['admin.settings.siteSection']).toBe('Site Settings')
  })

  it('admin.settings.siteName is "Site Name"', () => {
    expect(enLocale['admin.settings.siteName']).toBe('Site Name')
  })

  it('admin.settings.siteDescription is "Site Description"', () => {
    expect(enLocale['admin.settings.siteDescription']).toBe('Site Description')
  })

  it('admin.settings.saved is "Settings saved"', () => {
    expect(enLocale['admin.settings.saved']).toBe('Settings saved')
  })

  it('admin.nav.settings is "Settings"', () => {
    expect(enLocale['admin.nav.settings']).toBe('Settings')
  })
})

describe('admin.settings locale keys — i18n runtime translation', () => {
  it('translates admin.settings.title to English', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('en')
    expect(i18n.t('admin.settings.title')).toBe('Settings')
  })

  it('translates admin.settings.title to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('admin.settings.title')).toBe('设置')
  })

  it('translates admin.settings.siteSection to English', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('en')
    expect(i18n.t('admin.settings.siteSection')).toBe('Site Settings')
  })

  it('translates admin.settings.siteSection to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('admin.settings.siteSection')).toBe('站点设置')
  })

  it('translates admin.settings.siteName to English', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('en')
    expect(i18n.t('admin.settings.siteName')).toBe('Site Name')
  })

  it('translates admin.settings.siteName to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('admin.settings.siteName')).toBe('站点名称')
  })

  it('translates admin.settings.siteDescription to English', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('en')
    expect(i18n.t('admin.settings.siteDescription')).toBe('Site Description')
  })

  it('translates admin.settings.siteDescription to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('admin.settings.siteDescription')).toBe('站点描述')
  })

  it('translates admin.settings.saved to English', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('en')
    expect(i18n.t('admin.settings.saved')).toBe('Settings saved')
  })

  it('translates admin.settings.saved to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('admin.settings.saved')).toBe('设置已保存')
  })

  it('translates admin.nav.settings to English', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('en')
    expect(i18n.t('admin.nav.settings')).toBe('Settings')
  })

  it('translates admin.nav.settings to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('admin.nav.settings')).toBe('设置')
  })
})
