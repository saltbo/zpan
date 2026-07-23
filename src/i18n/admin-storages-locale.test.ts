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
  'admin.storages.colBucket',
  'admin.storages.colAccessKey',
  'admin.storages.colEndpoint',
  'admin.storages.colEgressBilling',
  'admin.storages.colStatus',
  'admin.storages.colHealth',
  'admin.storages.colActions',
  'admin.storages.healthUntested',
  'admin.storages.healthTesting',
  'admin.storages.healthSaveFailed',
  'admin.storages.enableAction',
  'admin.storages.disableAction',
  'admin.storages.enableSuccess',
  'admin.storages.disableSuccess',
  'admin.storages.cardActions',
  'admin.storages.manageAction',
  'admin.storages.available',
  'admin.storages.unbounded',
  'admin.storages.usedLabel',
  'admin.storages.capacityUnbounded',
  'admin.storages.capacityAria',
  'admin.storages.lastChecked',
  'admin.storages.neverChecked',
  'admin.storages.statusReason.cors',
  'admin.storages.statusReason.authentication_failed',
  'admin.storages.statusReason.permission_denied',
  'admin.storages.statusReason.bucket_not_found',
  'admin.storages.statusReason.network_error',
  'admin.storages.statusReason.unknown',
  'admin.storages.noMatches',
  'admin.storages.searchPlaceholder',
  'admin.storages.filter.all',
  'admin.storages.filter.healthy',
  'admin.storages.filter.attention',
  'admin.storages.filter.failed',
  'admin.storages.filter.disabled',
  'admin.storages.sort.default',
  'admin.storages.sort.usage',
  'admin.storages.sort.used',
  'admin.storages.sort.bucket',
  'admin.storages.cardStatus.healthy',
  'admin.storages.cardStatus.attention',
  'admin.storages.cardStatus.failed',
  'admin.storages.cardStatus.disabled',
  'admin.storages.cardStatus.testing',
  'admin.storages.overview.backends',
  'admin.storages.overview.enabled',
  'admin.storages.overview.capacity',
  'admin.storages.overview.bounded',
  'admin.storages.overview.used',
  'admin.storages.overview.usage',
  'admin.storages.overview.health',
  'admin.storages.overview.healthy',
  'admin.storages.testAction',
  'admin.storages.testDialogTitle',
  'admin.storages.testStepCreate',
  'admin.storages.testStepUpload',
  'admin.storages.testStepCleanup',
  'admin.storages.testStepDone',
  'admin.storages.testStepFailed',
  'admin.storages.testStepRunning',
  'admin.storages.testStepPending',
  'admin.storages.testSuccess',
  'admin.storages.testNoUploadUrl',
  'admin.storages.testUploadFailed',
  'admin.storages.testCleanupFailed',
  'admin.storages.testCorsFailure',
  'admin.storages.testCorsConfig',
  'admin.storages.testCorsCaveat',
  'admin.storages.fieldBucket',
  'admin.storages.bucketPlaceholder',
  'admin.storages.fieldEndpoint',
  'admin.storages.endpointPlaceholder',
  'admin.storages.fieldRegion',
  'admin.storages.regionPlaceholder',
  'admin.storages.fieldAccessKey',
  'admin.storages.accessKeyPlaceholder',
  'admin.storages.fieldSecretKey',
  'admin.storages.secretKeyPlaceholder',
  'admin.storages.showSecretKey',
  'admin.storages.hideSecretKey',
  'admin.storages.fieldCustomHost',
  'admin.storages.customHostHint',
  'admin.storages.fieldForcePathStyle',
  'admin.storages.forcePathStyleHint',
  'admin.storages.customHostPlaceholder',
  'admin.storages.fieldCapacity',
  'admin.storages.capacityPlaceholder',
  'admin.storages.capacityHint',
  'admin.storages.egressBilling',
  'admin.storages.capacityBilling',
  'admin.storages.billingTitle',
  'admin.storages.billingDescription',
  'admin.storages.egressBillingHint',
  'admin.storages.egressBillingBusinessOnly',
  'admin.storages.egressBillingUnit',
  'admin.storages.egressBillingUnitPlaceholder',
  'admin.storages.egressBillingCredits',
  'admin.storages.egressBillingCreditsPlaceholder',
  'admin.storages.egressBillingRate',
  'admin.storages.egressBillingOff',
  'admin.storages.billingSaveSuccess',
]

const ADMIN_NAV_KEYS = ['admin.nav.management', 'admin.nav.storages', 'admin.nav.users']

const SHARED_KEYS = ['nav.adminPanel', 'admin.title', 'admin.backToFiles', 'common.edit']

const ALL_KEYS = [...ADMIN_STORAGES_KEYS, ...ADMIN_NAV_KEYS, ...SHARED_KEYS]

// Keys that contain interpolation placeholders and the expected placeholder tokens
const INTERPOLATED_KEYS: Record<string, string[]> = {
  'admin.storages.deleteConfirm': ['{{bucket}}'],
  'admin.storages.testUploadFailed': ['{{detail}}'],
  'admin.storages.testCleanupFailed': ['{{detail}}'],
  'admin.storages.billingDescription': ['{{bucket}}'],
  'admin.storages.egressBillingRate': ['{{credits}}', '{{unit}}'],
  'admin.storages.enableSuccess': ['{{bucket}}'],
  'admin.storages.disableSuccess': ['{{bucket}}'],
  'admin.storages.cardActions': ['{{bucket}}'],
  'admin.storages.capacityAria': ['{{percent}}', '{{used}}'],
  'admin.storages.lastChecked': ['{{value}}'],
  'admin.storages.overview.enabled': ['{{count}}'],
  'admin.storages.overview.bounded': ['{{count}}'],
  'admin.storages.overview.usage': ['{{percent}}'],
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

  it('admin.storages.enableAction is "Enable and test"', () => {
    expect(enLocale['admin.storages.enableAction']).toBe('Enable and test')
  })

  it('admin.storages.cardStatus.healthy is "Running normally"', () => {
    expect(enLocale['admin.storages.cardStatus.healthy']).toBe('Running normally')
  })

  it('admin.storages.colHealth is "Connection health"', () => {
    expect(enLocale['admin.storages.colHealth']).toBe('Connection health')
  })

  it('admin.storages.testAction is "Test connection"', () => {
    expect(enLocale['admin.storages.testAction']).toBe('Test connection')
  })

  it('admin.storages.deleteHasFiles is "Cannot delete storage that contains files."', () => {
    expect(enLocale['admin.storages.deleteHasFiles']).toBe('Cannot delete storage that contains files.')
  })

  it('nav.adminPanel is "Admin Panel"', () => {
    expect(enLocale['nav.adminPanel']).toBe('Admin Panel')
  })

  it('admin.title is "Admin Console"', () => {
    expect(enLocale['admin.title']).toBe('Admin Console')
  })

  it('admin.backToFiles is "Back to App"', () => {
    expect(enLocale['admin.backToFiles']).toBe('Back to App')
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

  it('admin.storages.fieldCapacity is "Capacity"', () => {
    expect(enLocale['admin.storages.fieldCapacity']).toBe('Capacity')
  })

  it('admin.storages.capacityHint describes an unreported zero capacity', () => {
    expect(enLocale['admin.storages.capacityHint']).toBe(
      'Maximum reported storage space. 0 means capacity is not reported.',
    )
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

  it('translates admin.storages.enableAction to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('admin.storages.enableAction')).toBe('启用并检查')
  })

  it('translates admin.storages.cardStatus.healthy to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('admin.storages.cardStatus.healthy')).toBe('运行正常')
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

  it('interpolates admin.storages.deleteConfirm with bucket in English', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('en')
    const result = i18n.t('admin.storages.deleteConfirm', { bucket: 'my-bucket' })
    expect(result).toContain('my-bucket')
    expect(result).toContain('cannot be undone')
  })

  it('interpolates admin.storages.deleteConfirm with bucket in Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    const result = i18n.t('admin.storages.deleteConfirm', { bucket: 'my-bucket' })
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
    expect(i18n.t('admin.title')).toBe('Admin Console')
  })

  it('translates admin.title to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('admin.title')).toBe('管理控制台')
  })

  it('translates admin.backToFiles to English', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('en')
    expect(i18n.t('admin.backToFiles')).toBe('Back to App')
  })

  it('translates admin.backToFiles to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('admin.backToFiles')).toBe('返回前台')
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

  it('translates admin.storages.fieldCapacity to English', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('en')
    expect(i18n.t('admin.storages.fieldCapacity')).toBe('Capacity')
  })

  it('translates admin.storages.fieldCapacity to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('admin.storages.fieldCapacity')).toBe('可用空间')
  })

  it('translates admin.storages.capacityHint to English', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('en')
    expect(i18n.t('admin.storages.capacityHint')).toBe(
      'Maximum reported storage space. 0 means capacity is not reported.',
    )
  })

  it('translates admin.storages.capacityHint to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('admin.storages.capacityHint')).toBe('存储后端报告的最大空间，0 表示未报告容量。')
  })
})
