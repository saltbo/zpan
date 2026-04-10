import { describe, expect, it } from 'vitest'
import en from './locales/en.json'
import zh from './locales/zh.json'

const enLocale = en as Record<string, string>
const zhLocale = zh as Record<string, string>

const ADMIN_STORAGES_KEYS = [
  'admin.storages.title',
  'admin.storages.placeholder',
  'admin.storages.add',
  'admin.storages.addTitle',
  'admin.storages.editTitle',
  'admin.storages.deleteTitle',
  'admin.storages.deleteConfirm',
  'admin.storages.deleteHasFiles',
  'admin.storages.created',
  'admin.storages.updated',
  'admin.storages.deleted',
  'admin.storages.noStorages',
  'admin.storages.colTitle',
  'admin.storages.colMode',
  'admin.storages.colBucket',
  'admin.storages.colEndpoint',
  'admin.storages.colStatus',
  'admin.storages.colActions',
  'admin.storages.modePrivate',
  'admin.storages.modePublic',
  'admin.storages.statusActive',
  'admin.storages.statusInactive',
  'admin.storages.fieldTitle',
  'admin.storages.fieldMode',
  'admin.storages.fieldBucket',
  'admin.storages.fieldEndpoint',
  'admin.storages.fieldRegion',
  'admin.storages.fieldAccessKey',
  'admin.storages.fieldSecretKey',
  'admin.storages.fieldFilePath',
  'admin.storages.fieldCustomHost',
  'admin.storages.customHostPlaceholder',
]

const ADMIN_NAV_KEYS = ['admin.nav.management', 'admin.nav.storages', 'admin.nav.users']

const SHARED_KEYS = ['nav.adminPanel', 'admin.title', 'admin.backToFiles', 'common.edit']

const ALL_KEYS = [...ADMIN_STORAGES_KEYS, ...ADMIN_NAV_KEYS, ...SHARED_KEYS]

// Keys that contain interpolation placeholders and the expected placeholder tokens
const INTERPOLATED_KEYS: Record<string, string[]> = {
  'admin.storages.deleteConfirm': ['{{title}}'],
}

describe('admin.storages locale keys — presence', () => {
  for (const key of ALL_KEYS) {
    it(`en.json contains key "${key}"`, () => {
      expect(Object.hasOwn(enLocale, key)).toBe(true)
    })

    it(`zh.json contains key "${key}"`, () => {
      expect(Object.hasOwn(zhLocale, key)).toBe(true)
    })
  }
})

describe('admin.storages locale keys — non-empty values', () => {
  for (const key of ALL_KEYS) {
    it(`en.json value for "${key}" is not empty`, () => {
      expect(enLocale[key]).toBeTruthy()
    })

    it(`zh.json value for "${key}" is not empty`, () => {
      expect(zhLocale[key]).toBeTruthy()
    })
  }
})

describe('admin.storages locale keys — interpolation placeholder parity', () => {
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

describe('admin.storages locale keys — English values contract', () => {
  it('admin.storages.title is "Storages"', () => {
    expect(enLocale['admin.storages.title']).toBe('Storages')
  })

  it('admin.storages.add is "Add Storage"', () => {
    expect(enLocale['admin.storages.add']).toBe('Add Storage')
  })

  it('admin.storages.addTitle is "Add Storage"', () => {
    expect(enLocale['admin.storages.addTitle']).toBe('Add Storage')
  })

  it('admin.storages.editTitle is "Edit Storage"', () => {
    expect(enLocale['admin.storages.editTitle']).toBe('Edit Storage')
  })

  it('admin.storages.deleteTitle is "Delete Storage"', () => {
    expect(enLocale['admin.storages.deleteTitle']).toBe('Delete Storage')
  })

  it('admin.storages.created is "Storage created"', () => {
    expect(enLocale['admin.storages.created']).toBe('Storage created')
  })

  it('admin.storages.updated is "Storage updated"', () => {
    expect(enLocale['admin.storages.updated']).toBe('Storage updated')
  })

  it('admin.storages.deleted is "Storage deleted"', () => {
    expect(enLocale['admin.storages.deleted']).toBe('Storage deleted')
  })

  it('admin.storages.noStorages is "No storages configured"', () => {
    expect(enLocale['admin.storages.noStorages']).toBe('No storages configured')
  })

  it('admin.storages.modePrivate is "Private"', () => {
    expect(enLocale['admin.storages.modePrivate']).toBe('Private')
  })

  it('admin.storages.modePublic is "Public"', () => {
    expect(enLocale['admin.storages.modePublic']).toBe('Public')
  })

  it('admin.storages.statusActive is "Active"', () => {
    expect(enLocale['admin.storages.statusActive']).toBe('Active')
  })

  it('admin.storages.statusInactive is "Inactive"', () => {
    expect(enLocale['admin.storages.statusInactive']).toBe('Inactive')
  })

  it('admin.storages.deleteHasFiles is "Cannot delete storage that contains files."', () => {
    expect(enLocale['admin.storages.deleteHasFiles']).toBe('Cannot delete storage that contains files.')
  })

  it('nav.adminPanel is "Admin Panel"', () => {
    expect(enLocale['nav.adminPanel']).toBe('Admin Panel')
  })

  it('admin.title is "Admin"', () => {
    expect(enLocale['admin.title']).toBe('Admin')
  })

  it('admin.backToFiles is "Back to Files"', () => {
    expect(enLocale['admin.backToFiles']).toBe('Back to Files')
  })

  it('common.edit is "Edit"', () => {
    expect(enLocale['common.edit']).toBe('Edit')
  })

  it('admin.nav.management is "Management"', () => {
    expect(enLocale['admin.nav.management']).toBe('Management')
  })

  it('admin.nav.storages is "Storages"', () => {
    expect(enLocale['admin.nav.storages']).toBe('Storages')
  })

  it('admin.nav.users is "Users"', () => {
    expect(enLocale['admin.nav.users']).toBe('Users')
  })
})

describe('admin.storages locale keys — i18n runtime translation', () => {
  it('translates admin.storages.title to English', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('en')
    expect(i18n.t('admin.storages.title')).toBe('Storages')
  })

  it('translates admin.storages.title to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('admin.storages.title')).toBe('存储')
  })

  it('translates admin.storages.add to English', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('en')
    expect(i18n.t('admin.storages.add')).toBe('Add Storage')
  })

  it('translates admin.storages.add to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('admin.storages.add')).toBe('添加存储')
  })

  it('translates admin.storages.modePrivate to English', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('en')
    expect(i18n.t('admin.storages.modePrivate')).toBe('Private')
  })

  it('translates admin.storages.modePrivate to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('admin.storages.modePrivate')).toBe('私有')
  })

  it('translates admin.storages.modePublic to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('admin.storages.modePublic')).toBe('公开')
  })

  it('translates admin.storages.statusActive to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('admin.storages.statusActive')).toBe('正常')
  })

  it('translates admin.storages.statusInactive to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('admin.storages.statusInactive')).toBe('未启用')
  })

  it('translates admin.storages.created to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('admin.storages.created')).toBe('存储已创建')
  })

  it('translates admin.storages.updated to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('admin.storages.updated')).toBe('存储已更新')
  })

  it('translates admin.storages.deleted to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('admin.storages.deleted')).toBe('存储已删除')
  })

  it('translates admin.storages.deleteTitle to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('admin.storages.deleteTitle')).toBe('删除存储')
  })

  it('interpolates admin.storages.deleteConfirm with title in English', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('en')
    const result = i18n.t('admin.storages.deleteConfirm', { title: 'my-bucket' })
    expect(result).toContain('my-bucket')
    expect(result).toContain('cannot be undone')
  })

  it('interpolates admin.storages.deleteConfirm with title in Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    const result = i18n.t('admin.storages.deleteConfirm', { title: 'my-bucket' })
    expect(result).toContain('my-bucket')
  })

  it('translates nav.adminPanel to English', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('en')
    expect(i18n.t('nav.adminPanel')).toBe('Admin Panel')
  })

  it('translates nav.adminPanel to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('nav.adminPanel')).toBe('管理后台')
  })

  it('translates admin.title to English', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('en')
    expect(i18n.t('admin.title')).toBe('Admin')
  })

  it('translates admin.title to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('admin.title')).toBe('管理后台')
  })

  it('translates admin.backToFiles to English', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('en')
    expect(i18n.t('admin.backToFiles')).toBe('Back to Files')
  })

  it('translates admin.backToFiles to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('admin.backToFiles')).toBe('返回文件')
  })

  it('translates common.edit to English', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('en')
    expect(i18n.t('common.edit')).toBe('Edit')
  })

  it('translates common.edit to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('common.edit')).toBe('编辑')
  })

  it('translates admin.nav.storages to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('admin.nav.storages')).toBe('存储')
  })

  it('translates admin.nav.management to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('admin.nav.management')).toBe('管理')
  })
})
