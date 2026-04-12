import { describe, expect, it } from 'vitest'
import en from './locales/en.json'
import zh from './locales/zh.json'

const enLocale = en as Record<string, string>
const zhLocale = zh as Record<string, string>

const SETTINGS_PROFILE_KEYS = [
  'settings.profile.section',
  'settings.profile.displayName',
  'settings.profile.email',
  'settings.profile.emailReadonly',
  'settings.profile.changePassword',
  'settings.profile.currentPassword',
  'settings.profile.newPassword',
  'settings.profile.confirmPassword',
  'settings.profile.saved',
  'settings.profile.passwordChanged',
  'settings.profile.passwordMismatch',
]

const SETTINGS_APPEARANCE_KEYS = [
  'settings.appearance.section',
  'settings.appearance.theme',
  'settings.appearance.themeSystem',
  'settings.appearance.themeLight',
  'settings.appearance.themeDark',
  'settings.appearance.language',
]

const ALL_KEYS = [...SETTINGS_PROFILE_KEYS, ...SETTINGS_APPEARANCE_KEYS]

describe('settings locale keys — presence', () => {
  for (const key of ALL_KEYS) {
    it(`en.json contains key "${key}"`, () => {
      expect(Object.hasOwn(enLocale, key)).toBe(true)
    })

    it(`zh.json contains key "${key}"`, () => {
      expect(Object.hasOwn(zhLocale, key)).toBe(true)
    })
  }
})

describe('settings locale keys — non-empty values', () => {
  for (const key of ALL_KEYS) {
    it(`en.json value for "${key}" is not empty`, () => {
      expect(enLocale[key]).toBeTruthy()
    })

    it(`zh.json value for "${key}" is not empty`, () => {
      expect(zhLocale[key]).toBeTruthy()
    })
  }
})

describe('settings locale keys — English values contract', () => {
  it('settings.profile.section is "Profile"', () => {
    expect(enLocale['settings.profile.section']).toBe('Profile')
  })

  it('settings.profile.displayName is "Display Name"', () => {
    expect(enLocale['settings.profile.displayName']).toBe('Display Name')
  })

  it('settings.profile.email is "Email"', () => {
    expect(enLocale['settings.profile.email']).toBe('Email')
  })

  it('settings.profile.emailReadonly is "Email cannot be changed"', () => {
    expect(enLocale['settings.profile.emailReadonly']).toBe('Email cannot be changed')
  })

  it('settings.profile.changePassword is "Change Password"', () => {
    expect(enLocale['settings.profile.changePassword']).toBe('Change Password')
  })

  it('settings.profile.currentPassword is "Current Password"', () => {
    expect(enLocale['settings.profile.currentPassword']).toBe('Current Password')
  })

  it('settings.profile.newPassword is "New Password"', () => {
    expect(enLocale['settings.profile.newPassword']).toBe('New Password')
  })

  it('settings.profile.confirmPassword is "Confirm Password"', () => {
    expect(enLocale['settings.profile.confirmPassword']).toBe('Confirm Password')
  })

  it('settings.profile.saved is "Profile updated"', () => {
    expect(enLocale['settings.profile.saved']).toBe('Profile updated')
  })

  it('settings.profile.passwordChanged is "Password changed successfully"', () => {
    expect(enLocale['settings.profile.passwordChanged']).toBe('Password changed successfully')
  })

  it('settings.profile.passwordMismatch is "Passwords do not match"', () => {
    expect(enLocale['settings.profile.passwordMismatch']).toBe('Passwords do not match')
  })

  it('settings.appearance.section is "Appearance"', () => {
    expect(enLocale['settings.appearance.section']).toBe('Appearance')
  })

  it('settings.appearance.theme is "Theme"', () => {
    expect(enLocale['settings.appearance.theme']).toBe('Theme')
  })

  it('settings.appearance.themeSystem is "System"', () => {
    expect(enLocale['settings.appearance.themeSystem']).toBe('System')
  })

  it('settings.appearance.themeLight is "Light"', () => {
    expect(enLocale['settings.appearance.themeLight']).toBe('Light')
  })

  it('settings.appearance.themeDark is "Dark"', () => {
    expect(enLocale['settings.appearance.themeDark']).toBe('Dark')
  })

  it('settings.appearance.language is "Language"', () => {
    expect(enLocale['settings.appearance.language']).toBe('Language')
  })
})

describe('settings locale keys — Chinese values contract', () => {
  it('settings.profile.section is "个人资料"', () => {
    expect(zhLocale['settings.profile.section']).toBe('个人资料')
  })

  it('settings.profile.displayName is "显示名称"', () => {
    expect(zhLocale['settings.profile.displayName']).toBe('显示名称')
  })

  it('settings.profile.email is "邮箱"', () => {
    expect(zhLocale['settings.profile.email']).toBe('邮箱')
  })

  it('settings.profile.emailReadonly is "邮箱不可更改"', () => {
    expect(zhLocale['settings.profile.emailReadonly']).toBe('邮箱不可更改')
  })

  it('settings.profile.changePassword is "修改密码"', () => {
    expect(zhLocale['settings.profile.changePassword']).toBe('修改密码')
  })

  it('settings.profile.currentPassword is "当前密码"', () => {
    expect(zhLocale['settings.profile.currentPassword']).toBe('当前密码')
  })

  it('settings.profile.newPassword is "新密码"', () => {
    expect(zhLocale['settings.profile.newPassword']).toBe('新密码')
  })

  it('settings.profile.confirmPassword is "确认密码"', () => {
    expect(zhLocale['settings.profile.confirmPassword']).toBe('确认密码')
  })

  it('settings.profile.saved is "个人资料已更新"', () => {
    expect(zhLocale['settings.profile.saved']).toBe('个人资料已更新')
  })

  it('settings.profile.passwordChanged is "密码修改成功"', () => {
    expect(zhLocale['settings.profile.passwordChanged']).toBe('密码修改成功')
  })

  it('settings.profile.passwordMismatch is "两次密码输入不一致"', () => {
    expect(zhLocale['settings.profile.passwordMismatch']).toBe('两次密码输入不一致')
  })

  it('settings.appearance.section is "外观"', () => {
    expect(zhLocale['settings.appearance.section']).toBe('外观')
  })

  it('settings.appearance.theme is "主题"', () => {
    expect(zhLocale['settings.appearance.theme']).toBe('主题')
  })

  it('settings.appearance.themeSystem is "跟随系统"', () => {
    expect(zhLocale['settings.appearance.themeSystem']).toBe('跟随系统')
  })

  it('settings.appearance.themeLight is "浅色"', () => {
    expect(zhLocale['settings.appearance.themeLight']).toBe('浅色')
  })

  it('settings.appearance.themeDark is "深色"', () => {
    expect(zhLocale['settings.appearance.themeDark']).toBe('深色')
  })

  it('settings.appearance.language is "语言"', () => {
    expect(zhLocale['settings.appearance.language']).toBe('语言')
  })
})

describe('settings locale keys — i18n runtime translation', () => {
  it('translates settings.profile.section to English', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('en')
    expect(i18n.t('settings.profile.section')).toBe('Profile')
  })

  it('translates settings.profile.section to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('settings.profile.section')).toBe('个人资料')
  })

  it('translates settings.profile.displayName to English', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('en')
    expect(i18n.t('settings.profile.displayName')).toBe('Display Name')
  })

  it('translates settings.profile.displayName to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('settings.profile.displayName')).toBe('显示名称')
  })

  it('translates settings.profile.emailReadonly to English', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('en')
    expect(i18n.t('settings.profile.emailReadonly')).toBe('Email cannot be changed')
  })

  it('translates settings.profile.emailReadonly to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('settings.profile.emailReadonly')).toBe('邮箱不可更改')
  })

  it('translates settings.profile.changePassword to English', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('en')
    expect(i18n.t('settings.profile.changePassword')).toBe('Change Password')
  })

  it('translates settings.profile.changePassword to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('settings.profile.changePassword')).toBe('修改密码')
  })

  it('translates settings.profile.saved to English', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('en')
    expect(i18n.t('settings.profile.saved')).toBe('Profile updated')
  })

  it('translates settings.profile.saved to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('settings.profile.saved')).toBe('个人资料已更新')
  })

  it('translates settings.profile.passwordChanged to English', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('en')
    expect(i18n.t('settings.profile.passwordChanged')).toBe('Password changed successfully')
  })

  it('translates settings.profile.passwordChanged to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('settings.profile.passwordChanged')).toBe('密码修改成功')
  })

  it('translates settings.profile.passwordMismatch to English', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('en')
    expect(i18n.t('settings.profile.passwordMismatch')).toBe('Passwords do not match')
  })

  it('translates settings.profile.passwordMismatch to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('settings.profile.passwordMismatch')).toBe('两次密码输入不一致')
  })

  it('translates settings.appearance.section to English', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('en')
    expect(i18n.t('settings.appearance.section')).toBe('Appearance')
  })

  it('translates settings.appearance.section to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('settings.appearance.section')).toBe('外观')
  })

  it('translates settings.appearance.theme to English', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('en')
    expect(i18n.t('settings.appearance.theme')).toBe('Theme')
  })

  it('translates settings.appearance.theme to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('settings.appearance.theme')).toBe('主题')
  })

  it('translates settings.appearance.themeSystem to English', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('en')
    expect(i18n.t('settings.appearance.themeSystem')).toBe('System')
  })

  it('translates settings.appearance.themeSystem to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('settings.appearance.themeSystem')).toBe('跟随系统')
  })

  it('translates settings.appearance.themeLight to English', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('en')
    expect(i18n.t('settings.appearance.themeLight')).toBe('Light')
  })

  it('translates settings.appearance.themeLight to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('settings.appearance.themeLight')).toBe('浅色')
  })

  it('translates settings.appearance.themeDark to English', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('en')
    expect(i18n.t('settings.appearance.themeDark')).toBe('Dark')
  })

  it('translates settings.appearance.themeDark to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('settings.appearance.themeDark')).toBe('深色')
  })

  it('translates settings.appearance.language to English', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('en')
    expect(i18n.t('settings.appearance.language')).toBe('Language')
  })

  it('translates settings.appearance.language to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('settings.appearance.language')).toBe('语言')
  })
})
