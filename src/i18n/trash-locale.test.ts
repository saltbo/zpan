import { describe, expect, it } from 'vitest'
import en from './locales/en.json'
import zh from './locales/zh.json'

const enLocale = en as Record<string, string>
const zhLocale = zh as Record<string, string>

const RECYCLE_BIN_KEYS = [
  'recycleBin.title',
  'recycleBin.placeholder',
  'recycleBin.empty',
  'recycleBin.emptyTitle',
  'recycleBin.confirmEmpty',
  'recycleBin.emptySuccess',
  'recycleBin.restore',
  'recycleBin.restoreSuccess',
  'recycleBin.deletePermanently',
  'recycleBin.deleteTitle',
  'recycleBin.confirmDelete',
  'recycleBin.deleteSuccess',
  'recycleBin.noItems',
  'recycleBin.colName',
  'recycleBin.colOriginalLocation',
  'recycleBin.colTrashedDate',
  'recycleBin.colSize',
  'recycleBin.colActions',
  'recycleBin.prevPage',
  'recycleBin.nextPage',
  'recycleBin.pageInfo',
  'nav.recycleBin',
]

const INTERPOLATED_KEYS: Record<string, string[]> = {
  'recycleBin.confirmDelete': ['{{count}}'],
  'recycleBin.pageInfo': ['{{page}}', '{{total}}'],
}

describe('recycleBin locale keys — presence', () => {
  for (const key of RECYCLE_BIN_KEYS) {
    it(`en.json contains key "${key}"`, () => {
      expect(Object.hasOwn(enLocale, key)).toBe(true)
    })

    it(`zh.json contains key "${key}"`, () => {
      expect(Object.hasOwn(zhLocale, key)).toBe(true)
    })
  }
})

describe('recycleBin locale keys — non-empty values', () => {
  for (const key of RECYCLE_BIN_KEYS) {
    it(`en.json value for "${key}" is not empty`, () => {
      expect(enLocale[key]).toBeTruthy()
    })

    it(`zh.json value for "${key}" is not empty`, () => {
      expect(zhLocale[key]).toBeTruthy()
    })
  }
})

describe('recycleBin locale keys — interpolation placeholder parity', () => {
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

describe('recycleBin locale keys — English values contract', () => {
  it('recycleBin.title is "Trash"', () => {
    expect(enLocale['recycleBin.title']).toBe('Trash')
  })

  it('recycleBin.empty is "Empty Trash"', () => {
    expect(enLocale['recycleBin.empty']).toBe('Empty Trash')
  })

  it('recycleBin.emptyTitle is "Empty Trash"', () => {
    expect(enLocale['recycleBin.emptyTitle']).toBe('Empty Trash')
  })

  it('recycleBin.emptySuccess is "Trash emptied"', () => {
    expect(enLocale['recycleBin.emptySuccess']).toBe('Trash emptied')
  })

  it('recycleBin.restore is "Restore"', () => {
    expect(enLocale['recycleBin.restore']).toBe('Restore')
  })

  it('recycleBin.restoreSuccess is "Items restored"', () => {
    expect(enLocale['recycleBin.restoreSuccess']).toBe('Items restored')
  })

  it('recycleBin.deletePermanently is "Delete Permanently"', () => {
    expect(enLocale['recycleBin.deletePermanently']).toBe('Delete Permanently')
  })

  it('recycleBin.deleteTitle is "Delete Permanently"', () => {
    expect(enLocale['recycleBin.deleteTitle']).toBe('Delete Permanently')
  })

  it('recycleBin.deleteSuccess is "Items permanently deleted"', () => {
    expect(enLocale['recycleBin.deleteSuccess']).toBe('Items permanently deleted')
  })

  it('recycleBin.noItems is "No items in trash"', () => {
    expect(enLocale['recycleBin.noItems']).toBe('No items in trash')
  })

  it('recycleBin.colName is "Name"', () => {
    expect(enLocale['recycleBin.colName']).toBe('Name')
  })

  it('recycleBin.colOriginalLocation is "Original Location"', () => {
    expect(enLocale['recycleBin.colOriginalLocation']).toBe('Original Location')
  })

  it('recycleBin.colTrashedDate is "Trashed Date"', () => {
    expect(enLocale['recycleBin.colTrashedDate']).toBe('Trashed Date')
  })

  it('recycleBin.colSize is "Size"', () => {
    expect(enLocale['recycleBin.colSize']).toBe('Size')
  })

  it('recycleBin.colActions is "Actions"', () => {
    expect(enLocale['recycleBin.colActions']).toBe('Actions')
  })

  it('nav.recycleBin is "Trash"', () => {
    expect(enLocale['nav.recycleBin']).toBe('Trash')
  })
})

describe('recycleBin locale keys — i18n runtime translation', () => {
  it('translates recycleBin.title to English', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('en')
    expect(i18n.t('recycleBin.title')).toBe('Trash')
  })

  it('translates recycleBin.title to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('recycleBin.title')).toBe('回收站')
  })

  it('translates recycleBin.empty to English', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('en')
    expect(i18n.t('recycleBin.empty')).toBe('Empty Trash')
  })

  it('translates recycleBin.empty to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('recycleBin.empty')).toBe('清空回收站')
  })

  it('translates recycleBin.restore to English', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('en')
    expect(i18n.t('recycleBin.restore')).toBe('Restore')
  })

  it('translates recycleBin.restore to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('recycleBin.restore')).toBe('还原')
  })

  it('translates recycleBin.noItems to English', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('en')
    expect(i18n.t('recycleBin.noItems')).toBe('No items in trash')
  })

  it('translates recycleBin.noItems to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('recycleBin.noItems')).toBe('回收站中没有项目')
  })

  it('translates recycleBin.deletePermanently to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('recycleBin.deletePermanently')).toBe('永久删除')
  })

  it('interpolates recycleBin.confirmDelete with count in English', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('en')
    const result = i18n.t('recycleBin.confirmDelete', { count: 3 })
    expect(result).toContain('3')
    expect(result).toContain('cannot be undone')
  })

  it('interpolates recycleBin.confirmDelete with count in Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    const result = i18n.t('recycleBin.confirmDelete', { count: 5 })
    expect(result).toContain('5')
  })

  it('interpolates recycleBin.pageInfo with page and total in English', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('en')
    const result = i18n.t('recycleBin.pageInfo', { page: 2, total: 10 })
    expect(result).toContain('2')
    expect(result).toContain('10')
  })

  it('translates nav.recycleBin to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('nav.recycleBin')).toBe('回收站')
  })

  it('translates recycleBin.emptySuccess to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('recycleBin.emptySuccess')).toBe('回收站已清空')
  })

  it('translates recycleBin.restoreSuccess to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('recycleBin.restoreSuccess')).toBe('项目已还原')
  })

  it('translates recycleBin.deleteSuccess to Chinese', async () => {
    const { default: i18n } = await import('./index')
    await i18n.changeLanguage('zh')
    expect(i18n.t('recycleBin.deleteSuccess')).toBe('项目已永久删除')
  })
})
