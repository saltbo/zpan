import { describe, expect, it } from 'vitest'
import en from './locales/en.json'
import zh from './locales/zh.json'

const enLocale = en as Record<string, string>
const zhLocale = zh as Record<string, string>

const ADMIN_USERS_KEYS = [
  'admin.users.title',
  'admin.users.placeholder',
  'admin.users.searchPlaceholder',
  'admin.users.colName',
  'admin.users.colEmail',
  'admin.users.colRole',
  'admin.users.colStatus',
  'admin.users.colQuota',
  'admin.users.colCreatedAt',
  'admin.users.colActions',
  'admin.users.active',
  'admin.users.disabled',
  'admin.users.enable',
  'admin.users.disable',
  'admin.users.setQuota',
  'admin.users.setQuotaFor',
  'admin.users.quotaLabel',
  'admin.users.currentUsage',
  'admin.users.quotaUpdated',
  'admin.users.statusUpdated',
  'admin.users.deleteTitle',
  'admin.users.deleteConfirm',
  'admin.users.userDeleted',
  'admin.users.noUsers',
  'admin.users.prevPage',
  'admin.users.nextPage',
  'admin.users.pageInfo',
  'admin.users.roleAdmin',
  'admin.users.roleMember',
  'admin.users.inviteUser',
  'admin.users.inviteDialogTitle',
  'admin.users.inviteDialogDescription',
  'admin.users.inviteEmail',
  'admin.users.inviteEmailPlaceholder',
  'admin.users.sendInvite',
  'admin.users.inviteCreated',
  'admin.users.inviteResent',
  'admin.users.inviteRevoked',
  'admin.users.noInvitations',
  'admin.users.inviteColEmail',
  'admin.users.inviteColStatus',
  'admin.users.inviteColInvitedBy',
  'admin.users.inviteColCreatedAt',
  'admin.users.inviteColExpiresAt',
  'admin.users.copyInviteLink',
  'admin.users.inviteLinkCopied',
  'admin.users.resendInvite',
  'admin.users.revokeInvite',
  'admin.users.inviteStatus.pending',
  'admin.users.inviteStatus.accepted',
  'admin.users.inviteStatus.expired',
  'admin.users.inviteStatus.revoked',
]

// Keys that contain interpolation placeholders and the expected placeholder tokens
const INTERPOLATED_KEYS: Record<string, string[]> = {
  'admin.users.setQuotaFor': ['{{name}}'],
  'admin.users.currentUsage': ['{{used}}'],
  'admin.users.deleteConfirm': ['{{name}}'],
  'admin.users.pageInfo': ['{{page}}', '{{total}}'],
  'admin.users.inviteDialogDescription': ['{{count}}'],
}

describe('admin.users locale keys — presence', () => {
  for (const key of ADMIN_USERS_KEYS) {
    it(`en.json contains key "${key}"`, () => {
      expect(Object.hasOwn(enLocale, key)).toBe(true)
    })

    it(`zh.json contains key "${key}"`, () => {
      expect(Object.hasOwn(zhLocale, key)).toBe(true)
    })
  }
})

describe('admin.users locale keys — non-empty values', () => {
  for (const key of ADMIN_USERS_KEYS) {
    it(`en.json value for "${key}" is not empty`, () => {
      expect(enLocale[key]).toBeTruthy()
    })

    it(`zh.json value for "${key}" is not empty`, () => {
      expect(zhLocale[key]).toBeTruthy()
    })
  }
})

describe('admin.users locale keys — interpolation placeholder parity', () => {
  for (const [key, placeholders] of Object.entries(INTERPOLATED_KEYS)) {
    for (const placeholder of placeholders) {
      it(`en.json key "${key}" contains placeholder ${placeholder}`, () => {
        expect(enLocale[key]).toContain(placeholder)
      })

      it(`zh.json key "${key}" contains placeholder ${placeholder}`, () => {
        expect(zhLocale[key]).toContain(placeholder)
      })
    }
  }
})

describe('admin.users locale keys — English values contract', () => {
  it('admin.users.title is "Users"', () => {
    expect(enLocale['admin.users.title']).toBe('Users')
  })

  it('admin.users.active is "Active"', () => {
    expect(enLocale['admin.users.active']).toBe('Active')
  })

  it('admin.users.disabled is "Disabled"', () => {
    expect(enLocale['admin.users.disabled']).toBe('Disabled')
  })

  it('admin.users.enable is "Enable"', () => {
    expect(enLocale['admin.users.enable']).toBe('Enable')
  })

  it('admin.users.disable is "Disable"', () => {
    expect(enLocale['admin.users.disable']).toBe('Disable')
  })

  it('admin.users.setQuota is "Set Quota"', () => {
    expect(enLocale['admin.users.setQuota']).toBe('Set Quota')
  })

  it('admin.users.quotaUpdated is "Quota updated"', () => {
    expect(enLocale['admin.users.quotaUpdated']).toBe('Quota updated')
  })

  it('admin.users.statusUpdated is "User status updated"', () => {
    expect(enLocale['admin.users.statusUpdated']).toBe('User status updated')
  })

  it('admin.users.deleteTitle is "Delete User"', () => {
    expect(enLocale['admin.users.deleteTitle']).toBe('Delete User')
  })

  it('admin.users.userDeleted is "User deleted"', () => {
    expect(enLocale['admin.users.userDeleted']).toBe('User deleted')
  })

  it('admin.users.noUsers is "No users found"', () => {
    expect(enLocale['admin.users.noUsers']).toBe('No users found')
  })

  it('admin.users.prevPage is "Previous"', () => {
    expect(enLocale['admin.users.prevPage']).toBe('Previous')
  })

  it('admin.users.nextPage is "Next"', () => {
    expect(enLocale['admin.users.nextPage']).toBe('Next')
  })

  it('admin.users.searchPlaceholder is "Search by name or email"', () => {
    expect(enLocale['admin.users.searchPlaceholder']).toBe('Search by name or email')
  })

  it('admin.users.quotaLabel is "Quota (GB)"', () => {
    expect(enLocale['admin.users.quotaLabel']).toBe('Quota (GB)')
  })
})

describe('admin.users locale keys — i18n runtime translation', () => {
  it('translates admin.users.title to English', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('en')
    expect(i18n.t('admin.users.title')).toBe('Users')
  })

  it('translates admin.users.title to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('admin.users.title')).toBe('用户')
  })

  it('translates admin.users.active to English', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('en')
    expect(i18n.t('admin.users.active')).toBe('Active')
  })

  it('translates admin.users.active to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('admin.users.active')).toBe('正常')
  })

  it('translates admin.users.disabled to English', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('en')
    expect(i18n.t('admin.users.disabled')).toBe('Disabled')
  })

  it('translates admin.users.disabled to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('admin.users.disabled')).toBe('已禁用')
  })

  it('interpolates admin.users.setQuotaFor with name in English', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('en')
    expect(i18n.t('admin.users.setQuotaFor', { name: 'Alice' })).toBe('Set storage quota for Alice')
  })

  it('interpolates admin.users.setQuotaFor with name in Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('admin.users.setQuotaFor', { name: 'Alice' })).toBe('为 Alice 设置存储配额')
  })

  it('interpolates admin.users.currentUsage with used value in English', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('en')
    expect(i18n.t('admin.users.currentUsage', { used: '2.50' })).toBe('Current usage: 2.50 GB')
  })

  it('interpolates admin.users.deleteConfirm with name in English', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('en')
    const result = i18n.t('admin.users.deleteConfirm', { name: 'Bob' })
    expect(result).toContain('Bob')
    expect(result).toContain('cannot be undone')
  })

  it('interpolates admin.users.pageInfo with page and total in English', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('en')
    expect(i18n.t('admin.users.pageInfo', { page: 2, total: 5 })).toBe('Page 2 of 5')
  })

  it('interpolates admin.users.pageInfo with page and total in Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('admin.users.pageInfo', { page: 2, total: 5 })).toBe('第 2 页，共 5 页')
  })

  it('translates admin.users.deleteTitle to English', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('en')
    expect(i18n.t('admin.users.deleteTitle')).toBe('Delete User')
  })

  it('translates admin.users.deleteTitle to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('admin.users.deleteTitle')).toBe('删除用户')
  })

  it('translates admin.users.quotaUpdated to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('admin.users.quotaUpdated')).toBe('配额已更新')
  })

  it('translates admin.users.userDeleted to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('admin.users.userDeleted')).toBe('用户已删除')
  })
})
