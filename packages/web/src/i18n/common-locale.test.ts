import { describe, expect, it } from 'vitest'
import en from './locales/en.json'
import zh from './locales/zh.json'

const enLocale = en as Record<string, string>
const zhLocale = zh as Record<string, string>

const NEW_COMMON_KEYS = ['common.close', 'common.sidebar', 'common.sidebarDescription', 'common.toggleSidebar']

describe('common locale keys — presence', () => {
  for (const key of NEW_COMMON_KEYS) {
    it(`en.json contains key "${key}"`, () => {
      expect(Object.hasOwn(enLocale, key)).toBe(true)
    })

    it(`zh.json contains key "${key}"`, () => {
      expect(Object.hasOwn(zhLocale, key)).toBe(true)
    })
  }
})

describe('common locale keys — non-empty values', () => {
  for (const key of NEW_COMMON_KEYS) {
    it(`en.json value for "${key}" is not empty`, () => {
      expect(enLocale[key]).toBeTruthy()
    })

    it(`zh.json value for "${key}" is not empty`, () => {
      expect(zhLocale[key]).toBeTruthy()
    })
  }
})

describe('common locale keys — English values contract', () => {
  it('common.close is "Close"', () => {
    expect(enLocale['common.close']).toBe('Close')
  })

  it('common.sidebar is "Sidebar"', () => {
    expect(enLocale['common.sidebar']).toBe('Sidebar')
  })

  it('common.sidebarDescription is "Displays the mobile sidebar."', () => {
    expect(enLocale['common.sidebarDescription']).toBe('Displays the mobile sidebar.')
  })

  it('common.toggleSidebar is "Toggle Sidebar"', () => {
    expect(enLocale['common.toggleSidebar']).toBe('Toggle Sidebar')
  })
})

describe('common locale keys — Chinese values contract', () => {
  it('common.close is "关闭"', () => {
    expect(zhLocale['common.close']).toBe('关闭')
  })

  it('common.sidebar is "侧边栏"', () => {
    expect(zhLocale['common.sidebar']).toBe('侧边栏')
  })

  it('common.sidebarDescription is "显示移动端侧边栏。"', () => {
    expect(zhLocale['common.sidebarDescription']).toBe('显示移动端侧边栏。')
  })

  it('common.toggleSidebar is "切换侧边栏"', () => {
    expect(zhLocale['common.toggleSidebar']).toBe('切换侧边栏')
  })
})

describe('common locale keys — i18n runtime translation', () => {
  it('translates common.close to English', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('en')
    expect(i18n.t('common.close')).toBe('Close')
  })

  it('translates common.close to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('common.close')).toBe('关闭')
  })

  it('translates common.sidebar to English', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('en')
    expect(i18n.t('common.sidebar')).toBe('Sidebar')
  })

  it('translates common.sidebar to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('common.sidebar')).toBe('侧边栏')
  })

  it('translates common.sidebarDescription to English', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('en')
    expect(i18n.t('common.sidebarDescription')).toBe('Displays the mobile sidebar.')
  })

  it('translates common.sidebarDescription to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('common.sidebarDescription')).toBe('显示移动端侧边栏。')
  })

  it('translates common.toggleSidebar to English', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('en')
    expect(i18n.t('common.toggleSidebar')).toBe('Toggle Sidebar')
  })

  it('translates common.toggleSidebar to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('common.toggleSidebar')).toBe('切换侧边栏')
  })
})

describe('locale key parity — en.json and zh.json have identical key sets', () => {
  it('en.json and zh.json have the same number of keys', () => {
    expect(Object.keys(enLocale).length).toBe(Object.keys(zhLocale).length)
  })

  it('every key in en.json exists in zh.json', () => {
    const enKeys = Object.keys(enLocale).sort()
    const zhKeys = Object.keys(zhLocale).sort()
    expect(enKeys).toEqual(zhKeys)
  })

  it('no key has an empty value in en.json', () => {
    for (const key of Object.keys(enLocale)) {
      expect(enLocale[key], `en.json key "${key}" must not be empty`).toBeTruthy()
    }
  })

  it('no key has an empty value in zh.json', () => {
    for (const key of Object.keys(zhLocale)) {
      expect(zhLocale[key], `zh.json key "${key}" must not be empty`).toBeTruthy()
    }
  })
})
