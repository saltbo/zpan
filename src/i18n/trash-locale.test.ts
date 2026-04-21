import { describe, expect, it } from 'vitest'
import en from './locales/en.json'
import zh from './locales/zh.json'

const enLocale = en as Record<string, string>
const zhLocale = zh as Record<string, string>

const RECYCLE_BIN_KEYS = [
  'trash.title',
  'trash.placeholder',
  'trash.empty',
  'trash.emptyTitle',
  'trash.confirmEmpty',
  'trash.emptySuccess',
  'trash.restore',
  'trash.restoreSuccess',
  'trash.deletePermanently',
  'trash.deleteTitle',
  'trash.confirmDelete',
  'trash.deleteSuccess',
  'trash.noItems',
  'trash.colName',
  'trash.colOriginalLocation',
  'trash.colTrashedDate',
  'trash.colSize',
  'trash.colActions',
  'trash.prevPage',
  'trash.nextPage',
  'trash.pageInfo',
  'nav.trash',
]

const INTERPOLATED_KEYS: Record<string, string[]> = {
  'trash.confirmDelete': ['{{count}}'],
  'trash.pageInfo': ['{{page}}', '{{total}}'],
}

describe('trash locale keys — presence', () => {
  for (const key of RECYCLE_BIN_KEYS) {
    it(`en.json contains key "${key}"`, () => {
      expect(Object.hasOwn(enLocale, key)).toBe(true)
    })

    it(`zh.json contains key "${key}"`, () => {
      expect(Object.hasOwn(zhLocale, key)).toBe(true)
    })
  }
})

describe('trash locale keys — non-empty values', () => {
  for (const key of RECYCLE_BIN_KEYS) {
    it(`en.json value for "${key}" is not empty`, () => {
      expect(enLocale[key]).toBeTruthy()
    })

    it(`zh.json value for "${key}" is not empty`, () => {
      expect(zhLocale[key]).toBeTruthy()
    })
  }
})

describe('trash locale keys — interpolation placeholder parity', () => {
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

describe('trash locale keys — English values contract', () => {
  it('trash.title is "Trash"', () => {
    expect(enLocale['trash.title']).toBe('Trash')
  })

  it('trash.empty is "Empty Trash"', () => {
    expect(enLocale['trash.empty']).toBe('Empty Trash')
  })

  it('trash.emptyTitle is "Empty Trash"', () => {
    expect(enLocale['trash.emptyTitle']).toBe('Empty Trash')
  })

  it('trash.emptySuccess is "Trash emptied"', () => {
    expect(enLocale['trash.emptySuccess']).toBe('Trash emptied')
  })

  it('trash.restore is "Restore"', () => {
    expect(enLocale['trash.restore']).toBe('Restore')
  })

  it('trash.restoreSuccess is "Items restored"', () => {
    expect(enLocale['trash.restoreSuccess']).toBe('Items restored')
  })

  it('trash.deletePermanently is "Delete Permanently"', () => {
    expect(enLocale['trash.deletePermanently']).toBe('Delete Permanently')
  })

  it('trash.deleteTitle is "Delete Permanently"', () => {
    expect(enLocale['trash.deleteTitle']).toBe('Delete Permanently')
  })

  it('trash.deleteSuccess is "Items permanently deleted"', () => {
    expect(enLocale['trash.deleteSuccess']).toBe('Items permanently deleted')
  })

  it('trash.noItems is "No items in trash"', () => {
    expect(enLocale['trash.noItems']).toBe('No items in trash')
  })

  it('trash.colName is "Name"', () => {
    expect(enLocale['trash.colName']).toBe('Name')
  })

  it('trash.colOriginalLocation is "Original Location"', () => {
    expect(enLocale['trash.colOriginalLocation']).toBe('Original Location')
  })

  it('trash.colTrashedDate is "Trashed Date"', () => {
    expect(enLocale['trash.colTrashedDate']).toBe('Trashed Date')
  })

  it('trash.colSize is "Size"', () => {
    expect(enLocale['trash.colSize']).toBe('Size')
  })

  it('trash.colActions is "Actions"', () => {
    expect(enLocale['trash.colActions']).toBe('Actions')
  })

  it('nav.trash is "Trash"', () => {
    expect(enLocale['nav.trash']).toBe('Trash')
  })
})

describe('trash locale keys — i18n runtime translation', () => {
  it('translates trash.title to English', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('en')
    expect(i18n.t('trash.title')).toBe('Trash')
  })

  it('translates trash.title to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('trash.title')).toBe('回收站')
  })

  it('translates trash.empty to English', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('en')
    expect(i18n.t('trash.empty')).toBe('Empty Trash')
  })

  it('translates trash.empty to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('trash.empty')).toBe('清空回收站')
  })

  it('translates trash.restore to English', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('en')
    expect(i18n.t('trash.restore')).toBe('Restore')
  })

  it('translates trash.restore to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('trash.restore')).toBe('还原')
  })

  it('translates trash.noItems to English', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('en')
    expect(i18n.t('trash.noItems')).toBe('No items in trash')
  })

  it('translates trash.noItems to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('trash.noItems')).toBe('回收站中没有项目')
  })

  it('translates trash.deletePermanently to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('trash.deletePermanently')).toBe('永久删除')
  })

  it('interpolates trash.confirmDelete with count in English', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('en')
    const result = i18n.t('trash.confirmDelete', { count: 3 })
    expect(result).toContain('3')
    expect(result).toContain('cannot be undone')
  })

  it('interpolates trash.confirmDelete with count in Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    const result = i18n.t('trash.confirmDelete', { count: 5 })
    expect(result).toContain('5')
  })

  it('interpolates trash.pageInfo with page and total in English', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('en')
    const result = i18n.t('trash.pageInfo', { page: 2, total: 10 })
    expect(result).toContain('2')
    expect(result).toContain('10')
  })

  it('translates nav.trash to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('nav.trash')).toBe('回收站')
  })

  it('translates trash.emptySuccess to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('trash.emptySuccess')).toBe('回收站已清空')
  })

  it('translates trash.restoreSuccess to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('trash.restoreSuccess')).toBe('项目已还原')
  })

  it('translates trash.deleteSuccess to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('trash.deleteSuccess')).toBe('项目已永久删除')
  })
})
