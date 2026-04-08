import { describe, expect, it } from 'vitest'
import en from './locales/en.json'
import zh from './locales/zh.json'

const enLocale = en as Record<string, string>
const zhLocale = zh as Record<string, string>

const ADMIN_SETTINGS_KEYS = [
  'admin.nav.settings',
  'admin.settings.title',
  'admin.settings.subtitle',
  'admin.settings.siteSection',
  'admin.settings.siteName',
  'admin.settings.siteDescription',
  'admin.settings.save',
  'admin.settings.saving',
  'admin.settings.saved',
  'admin.settings.saveFailed',
]

describe('admin.settings locale keys — presence and non-empty', () => {
  for (const key of ADMIN_SETTINGS_KEYS) {
    it(`en.json has non-empty "${key}"`, () => {
      expect(enLocale[key]).toBeTruthy()
    })
    it(`zh.json has non-empty "${key}"`, () => {
      expect(zhLocale[key]).toBeTruthy()
    })
  }
})

describe('admin.settings locale keys — i18n runtime', () => {
  it('translates admin.settings.title to English', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('en')
    expect(i18n.t('admin.settings.title')).toBe('System Settings')
  })

  it('translates admin.settings.title to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('admin.settings.title')).toBe('系统设置')
  })

  it('translates admin.settings.siteName to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('admin.settings.siteName')).toBe('站点名称')
  })
})
