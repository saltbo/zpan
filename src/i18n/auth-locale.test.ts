import { describe, expect, it } from 'vitest'
import en from './locales/en.json'
import zh from './locales/zh.json'

const enLocale = en as Record<string, string>
const zhLocale = zh as Record<string, string>

const AUTH_KEYS = [
  'auth.username',
  'auth.usernamePlaceholder',
  'auth.usernameInvalid',
  'auth.emailOrUsername',
  'auth.emailOrUsernamePlaceholder',
  'auth.inviteCode',
  'auth.inviteCodePlaceholder',
  'auth.registrationClosed',
  'auth.orContinueWith',
]

describe('auth locale keys — presence', () => {
  for (const key of AUTH_KEYS) {
    it(`en.json contains key "${key}"`, () => {
      expect(Object.hasOwn(enLocale, key)).toBe(true)
    })

    it(`zh.json contains key "${key}"`, () => {
      expect(Object.hasOwn(zhLocale, key)).toBe(true)
    })
  }
})

describe('auth locale keys — non-empty values', () => {
  for (const key of AUTH_KEYS) {
    it(`en.json value for "${key}" is not empty`, () => {
      expect(enLocale[key]).toBeTruthy()
    })

    it(`zh.json value for "${key}" is not empty`, () => {
      expect(zhLocale[key]).toBeTruthy()
    })
  }
})

describe('auth locale keys — English values contract', () => {
  it('auth.username is "Username"', () => {
    expect(enLocale['auth.username']).toBe('Username')
  })

  it('auth.usernamePlaceholder is "3-30 chars: letters, numbers, underscore"', () => {
    expect(enLocale['auth.usernamePlaceholder']).toBe('3-30 chars: letters, numbers, underscore')
  })

  it('auth.usernameInvalid is "Username must be 3-30 characters: letters, numbers, or underscore"', () => {
    expect(enLocale['auth.usernameInvalid']).toBe('Username must be 3-30 characters: letters, numbers, or underscore')
  })

  it('auth.emailOrUsername is "Email or Username"', () => {
    expect(enLocale['auth.emailOrUsername']).toBe('Email or Username')
  })

  it('auth.emailOrUsernamePlaceholder is "Enter your email or username"', () => {
    expect(enLocale['auth.emailOrUsernamePlaceholder']).toBe('Enter your email or username')
  })

  it('auth.inviteCode is "Invite Code"', () => {
    expect(enLocale['auth.inviteCode']).toBe('Invite Code')
  })

  it('auth.inviteCodePlaceholder is "Enter your invite code"', () => {
    expect(enLocale['auth.inviteCodePlaceholder']).toBe('Enter your invite code')
  })

  it('auth.registrationClosed is "Registration is currently closed."', () => {
    expect(enLocale['auth.registrationClosed']).toBe('Registration is currently closed.')
  })

  it('auth.orContinueWith is "or continue with"', () => {
    expect(enLocale['auth.orContinueWith']).toBe('or continue with')
  })
})

describe('auth locale keys — Chinese values contract', () => {
  it('auth.username is "用户名"', () => {
    expect(zhLocale['auth.username']).toBe('用户名')
  })

  it('auth.usernameInvalid is non-empty and differs from English', () => {
    expect(zhLocale['auth.usernameInvalid']).toBeTruthy()
    expect(zhLocale['auth.usernameInvalid']).not.toBe(enLocale['auth.usernameInvalid'])
  })

  it('auth.emailOrUsername is "邮箱或用户名"', () => {
    expect(zhLocale['auth.emailOrUsername']).toBe('邮箱或用户名')
  })

  it('auth.inviteCode is "邀请码"', () => {
    expect(zhLocale['auth.inviteCode']).toBe('邀请码')
  })

  it('auth.registrationClosed is "注册已关闭。"', () => {
    expect(zhLocale['auth.registrationClosed']).toBe('注册已关闭。')
  })

  it('auth.orContinueWith is "或通过以下方式继续"', () => {
    expect(zhLocale['auth.orContinueWith']).toBe('或通过以下方式继续')
  })
})

describe('auth locale keys — i18n runtime translation', () => {
  it('translates auth.username to English', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('en')
    expect(i18n.t('auth.username')).toBe('Username')
  })

  it('translates auth.username to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('auth.username')).toBe('用户名')
  })

  it('translates auth.emailOrUsername to English', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('en')
    expect(i18n.t('auth.emailOrUsername')).toBe('Email or Username')
  })

  it('translates auth.emailOrUsername to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('auth.emailOrUsername')).toBe('邮箱或用户名')
  })

  it('translates auth.inviteCode to English', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('en')
    expect(i18n.t('auth.inviteCode')).toBe('Invite Code')
  })

  it('translates auth.inviteCode to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('auth.inviteCode')).toBe('邀请码')
  })

  it('translates auth.registrationClosed to English', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('en')
    expect(i18n.t('auth.registrationClosed')).toBe('Registration is currently closed.')
  })

  it('translates auth.registrationClosed to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('auth.registrationClosed')).toBe('注册已关闭。')
  })

  it('translates auth.orContinueWith to English', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('en')
    expect(i18n.t('auth.orContinueWith')).toBe('or continue with')
  })

  it('translates auth.orContinueWith to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('auth.orContinueWith')).toBe('或通过以下方式继续')
  })

  it('translates auth.usernameInvalid to English', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('en')
    expect(i18n.t('auth.usernameInvalid')).toBe('Username must be 3-30 characters: letters, numbers, or underscore')
  })

  it('translates auth.usernameInvalid to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('auth.usernameInvalid')).toBe('用户名须为3-30位字母、数字或下划线')
  })
})
