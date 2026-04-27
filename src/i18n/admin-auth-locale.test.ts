import { describe, expect, it } from 'vitest'
import en from './locales/en.json'
import zh from './locales/zh.json'

const enLocale = en as Record<string, string>
const zhLocale = zh as Record<string, string>

const ADMIN_NAV_AUTH_KEYS = ['admin.nav.auth']

const ADMIN_AUTH_KEYS = [
  'admin.auth.title',
  'admin.auth.description',
  'admin.auth.registrationSection',
  'admin.auth.registrationOpen',
  'admin.auth.registrationOpenDesc',
  'admin.auth.registrationInviteOnly',
  'admin.auth.registrationInviteOnlyDesc',
  'admin.auth.registrationClosed',
  'admin.auth.registrationClosedDesc',
  'admin.auth.registrationSaved',
  'admin.auth.inviteCodesSection',
  'admin.auth.generateCodes',
  'admin.auth.generateTitle',
  'admin.auth.codeCount',
  'admin.auth.expiresInDays',
  'admin.auth.expiresInDaysHint',
  'admin.auth.colCode',
  'admin.auth.colStatus',
  'admin.auth.colUsedBy',
  'admin.auth.colExpiresAt',
  'admin.auth.colCreatedAt',
  'admin.auth.colActions',
  'admin.auth.statusAvailable',
  'admin.auth.statusUsed',
  'admin.auth.statusExpired',
  'admin.auth.statusEnabled',
  'admin.auth.statusDisabled',
  'admin.auth.noInviteCodes',
  'admin.auth.codesGenerated',
  'admin.auth.codeDeleted',
  'admin.auth.codeCopied',
  'admin.auth.oauthSection',
  'admin.auth.addProvider',
  'admin.auth.addProviderTitle',
  'admin.auth.editProviderTitle',
  'admin.auth.providerType',
  'admin.auth.providerBuiltin',
  'admin.auth.providerOidc',
  'admin.auth.provider',
  'admin.auth.clientId',
  'admin.auth.clientSecret',
  'admin.auth.enabled',
  'admin.auth.discoveryUrl',
  'admin.auth.scopes',
  'admin.auth.scopesHint',
  'admin.auth.providerId',
  'admin.auth.providerIdHint',
  'admin.auth.providerSaved',
  'admin.auth.providerDeleted',
  'admin.auth.noProviders',
  'admin.auth.deleteProviderTitle',
  'admin.auth.deleteProviderConfirm',
  'admin.auth.emailSection',
  'admin.auth.emailProvider',
  'admin.auth.emailSmtp',
  'admin.auth.emailHttp',
  'admin.auth.emailFrom',
  'admin.auth.smtpHost',
  'admin.auth.smtpPort',
  'admin.auth.smtpUser',
  'admin.auth.smtpPass',
  'admin.auth.smtpSecure',
  'admin.auth.httpUrl',
  'admin.auth.httpApiKey',
  'admin.auth.testEmail',
  'admin.auth.testEmailTo',
  'admin.auth.testEmailSent',
  'admin.auth.testEmailFailed',
  'admin.auth.emailSaved',
  'admin.auth.emailNotConfigured',
]

const ALL_KEYS = [...ADMIN_NAV_AUTH_KEYS, ...ADMIN_AUTH_KEYS]

describe('admin.auth locale keys — presence', () => {
  for (const key of ALL_KEYS) {
    it(`en.json contains key "${key}"`, () => {
      expect(Object.hasOwn(enLocale, key)).toBe(true)
    })

    it(`zh.json contains key "${key}"`, () => {
      expect(Object.hasOwn(zhLocale, key)).toBe(true)
    })
  }
})

describe('admin.auth locale keys — non-empty values', () => {
  for (const key of ALL_KEYS) {
    it(`en.json value for "${key}" is not empty`, () => {
      expect(enLocale[key]).toBeTruthy()
    })

    it(`zh.json value for "${key}" is not empty`, () => {
      expect(zhLocale[key]).toBeTruthy()
    })
  }
})

describe('admin.auth locale keys — English values contract', () => {
  it('admin.nav.auth is "OAuth"', () => {
    expect(enLocale['admin.nav.auth']).toBe('OAuth')
  })

  it('admin.auth.title is "OAuth Providers"', () => {
    expect(enLocale['admin.auth.title']).toBe('OAuth Providers')
  })

  it('admin.auth.description is "Manage third-party sign-in providers and custom OIDC connections for this instance."', () => {
    expect(enLocale['admin.auth.description']).toBe(
      'Manage third-party sign-in providers and custom OIDC connections for this instance.',
    )
  })

  it('admin.auth.registrationSection is "Registration Mode"', () => {
    expect(enLocale['admin.auth.registrationSection']).toBe('Registration Mode')
  })

  it('admin.auth.registrationOpen is "Open"', () => {
    expect(enLocale['admin.auth.registrationOpen']).toBe('Open')
  })

  it('admin.auth.registrationOpenDesc is "Anyone can sign up"', () => {
    expect(enLocale['admin.auth.registrationOpenDesc']).toBe('Anyone can sign up')
  })

  it('admin.auth.registrationInviteOnly is "Invite Only"', () => {
    expect(enLocale['admin.auth.registrationInviteOnly']).toBe('Invite Only')
  })

  it('admin.auth.registrationInviteOnlyDesc is "Users need an invite code to sign up"', () => {
    expect(enLocale['admin.auth.registrationInviteOnlyDesc']).toBe('Users need an invite code to sign up')
  })

  it('admin.auth.registrationClosed is "Closed"', () => {
    expect(enLocale['admin.auth.registrationClosed']).toBe('Closed')
  })

  it('admin.auth.registrationClosedDesc is "No new sign-ups allowed"', () => {
    expect(enLocale['admin.auth.registrationClosedDesc']).toBe('No new sign-ups allowed')
  })

  it('admin.auth.registrationSaved is "Registration mode saved"', () => {
    expect(enLocale['admin.auth.registrationSaved']).toBe('Registration mode saved')
  })

  it('admin.auth.inviteCodesSection is "Invite Codes"', () => {
    expect(enLocale['admin.auth.inviteCodesSection']).toBe('Invite Codes')
  })

  it('admin.auth.generateCodes is "Generate Codes"', () => {
    expect(enLocale['admin.auth.generateCodes']).toBe('Generate Codes')
  })

  it('admin.auth.statusAvailable is "Available"', () => {
    expect(enLocale['admin.auth.statusAvailable']).toBe('Available')
  })

  it('admin.auth.statusUsed is "Used"', () => {
    expect(enLocale['admin.auth.statusUsed']).toBe('Used')
  })

  it('admin.auth.statusExpired is "Expired"', () => {
    expect(enLocale['admin.auth.statusExpired']).toBe('Expired')
  })

  it('admin.auth.oauthSection is "OAuth Providers"', () => {
    expect(enLocale['admin.auth.oauthSection']).toBe('OAuth Providers')
  })

  it('admin.auth.addProvider is "Add Provider"', () => {
    expect(enLocale['admin.auth.addProvider']).toBe('Add Provider')
  })

  it('admin.auth.providerBuiltin is "Built-in Provider"', () => {
    expect(enLocale['admin.auth.providerBuiltin']).toBe('Built-in Provider')
  })

  it('admin.auth.providerOidc is "Custom OIDC"', () => {
    expect(enLocale['admin.auth.providerOidc']).toBe('Custom OIDC')
  })

  it('admin.auth.emailSection is "Email Configuration"', () => {
    expect(enLocale['admin.auth.emailSection']).toBe('Email Configuration')
  })

  it('admin.auth.emailSmtp is "SMTP"', () => {
    expect(enLocale['admin.auth.emailSmtp']).toBe('SMTP')
  })

  it('admin.auth.emailHttp is "HTTP API"', () => {
    expect(enLocale['admin.auth.emailHttp']).toBe('HTTP API')
  })

  it('admin.auth.testEmail is "Send Test Email"', () => {
    expect(enLocale['admin.auth.testEmail']).toBe('Send Test Email')
  })

  it('admin.auth.testEmailSent is "Test email sent"', () => {
    expect(enLocale['admin.auth.testEmailSent']).toBe('Test email sent')
  })

  it('admin.auth.testEmailFailed is "Test email failed"', () => {
    expect(enLocale['admin.auth.testEmailFailed']).toBe('Test email failed')
  })

  it('admin.auth.emailSaved is "Email configuration saved"', () => {
    expect(enLocale['admin.auth.emailSaved']).toBe('Email configuration saved')
  })

  it('admin.auth.emailNotConfigured is "Email not configured yet"', () => {
    expect(enLocale['admin.auth.emailNotConfigured']).toBe('Email not configured yet')
  })

  it('admin.auth.providerSaved is "Provider saved"', () => {
    expect(enLocale['admin.auth.providerSaved']).toBe('Provider saved')
  })

  it('admin.auth.providerDeleted is "Provider deleted"', () => {
    expect(enLocale['admin.auth.providerDeleted']).toBe('Provider deleted')
  })

  it('admin.auth.noProviders is "No OAuth providers configured"', () => {
    expect(enLocale['admin.auth.noProviders']).toBe('No OAuth providers configured')
  })

  it('admin.auth.codesGenerated is "Invite codes generated"', () => {
    expect(enLocale['admin.auth.codesGenerated']).toBe('Invite codes generated')
  })

  it('admin.auth.codeDeleted is "Invite code deleted"', () => {
    expect(enLocale['admin.auth.codeDeleted']).toBe('Invite code deleted')
  })

  it('admin.auth.codeCopied is "Code copied to clipboard"', () => {
    expect(enLocale['admin.auth.codeCopied']).toBe('Code copied to clipboard')
  })
})

describe('admin.auth locale keys — i18n runtime translation', () => {
  it('translates admin.nav.auth to English', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('en')
    expect(i18n.t('admin.nav.auth')).toBe('OAuth')
  })

  it('translates admin.nav.auth to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('admin.nav.auth')).toBe('OAuth')
  })

  it('translates admin.auth.title to English', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('en')
    expect(i18n.t('admin.auth.title')).toBe('OAuth Providers')
  })

  it('translates admin.auth.title to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('admin.auth.title')).toBe('OAuth 提供商')
  })

  it('translates admin.auth.description to English', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('en')
    expect(i18n.t('admin.auth.description')).toBe(
      'Manage third-party sign-in providers and custom OIDC connections for this instance.',
    )
  })

  it('translates admin.auth.description to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('admin.auth.description')).toBe('管理第三方登录提供商以及自定义 OIDC 连接。')
  })

  it('translates admin.auth.registrationSection to English', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('en')
    expect(i18n.t('admin.auth.registrationSection')).toBe('Registration Mode')
  })

  it('translates admin.auth.registrationSection to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('admin.auth.registrationSection')).toBe('注册模式')
  })

  it('translates admin.auth.registrationOpen to English', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('en')
    expect(i18n.t('admin.auth.registrationOpen')).toBe('Open')
  })

  it('translates admin.auth.registrationOpen to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('admin.auth.registrationOpen')).toBe('开放')
  })

  it('translates admin.auth.registrationInviteOnly to English', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('en')
    expect(i18n.t('admin.auth.registrationInviteOnly')).toBe('Invite Only')
  })

  it('translates admin.auth.registrationInviteOnly to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('admin.auth.registrationInviteOnly')).toBe('邀请制')
  })

  it('translates admin.auth.registrationClosed to English', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('en')
    expect(i18n.t('admin.auth.registrationClosed')).toBe('Closed')
  })

  it('translates admin.auth.registrationClosed to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('admin.auth.registrationClosed')).toBe('关闭')
  })

  it('translates admin.auth.oauthSection to English', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('en')
    expect(i18n.t('admin.auth.oauthSection')).toBe('OAuth Providers')
  })

  it('translates admin.auth.oauthSection to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('admin.auth.oauthSection')).toBe('OAuth 提供商')
  })

  it('translates admin.auth.emailSection to English', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('en')
    expect(i18n.t('admin.auth.emailSection')).toBe('Email Configuration')
  })

  it('translates admin.auth.emailSection to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('admin.auth.emailSection')).toBe('邮件配置')
  })

  it('translates admin.auth.inviteCodesSection to English', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('en')
    expect(i18n.t('admin.auth.inviteCodesSection')).toBe('Invite Codes')
  })

  it('translates admin.auth.inviteCodesSection to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('admin.auth.inviteCodesSection')).toBe('邀请码')
  })

  it('translates admin.auth.noInviteCodes to English', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('en')
    expect(i18n.t('admin.auth.noInviteCodes')).toBe('No invite codes')
  })

  it('translates admin.auth.noInviteCodes to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('admin.auth.noInviteCodes')).toBe('暂无邀请码')
  })

  it('translates admin.auth.noProviders to English', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('en')
    expect(i18n.t('admin.auth.noProviders')).toBe('No OAuth providers configured')
  })

  it('translates admin.auth.noProviders to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('admin.auth.noProviders')).toBe('暂未配置 OAuth 提供商')
  })

  it('translates admin.auth.emailSaved to English', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('en')
    expect(i18n.t('admin.auth.emailSaved')).toBe('Email configuration saved')
  })

  it('translates admin.auth.emailSaved to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('admin.auth.emailSaved')).toBe('邮件配置已保存')
  })
})
