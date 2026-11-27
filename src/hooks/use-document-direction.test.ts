import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useDocumentDirection } from './use-document-direction'

const mocks = vi.hoisted(() => ({ resolvedLanguage: 'en' }))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: {
      language: mocks.resolvedLanguage,
      resolvedLanguage: mocks.resolvedLanguage,
      // i18next's own direction lookup: Intl.Locale text info with a built-in RTL list.
      dir: (lng: string) => (lng.startsWith('ar') ? 'rtl' : 'ltr'),
    },
  }),
}))

afterEach(() => {
  document.documentElement.dir = 'ltr'
  document.documentElement.lang = 'en'
  vi.clearAllMocks()
  mocks.resolvedLanguage = 'en'
})

describe('useDocumentDirection', () => {
  it('writes the supported code and ltr for a latin language', () => {
    mocks.resolvedLanguage = 'en-US'
    renderHook(() => useDocumentDirection())

    expect(document.documentElement.lang).toBe('en')
    expect(document.documentElement.dir).toBe('ltr')
  })

  it('narrows a locale variant to the supported code', () => {
    mocks.resolvedLanguage = 'zh-CN'
    renderHook(() => useDocumentDirection())

    expect(document.documentElement.lang).toBe('zh')
    expect(document.documentElement.dir).toBe('ltr')
  })

  it('flips the document for a right-to-left language, which is how a new RTL locale activates', () => {
    mocks.resolvedLanguage = 'ar'
    renderHook(() => useDocumentDirection())

    expect(document.documentElement.dir).toBe('rtl')
    // Canon ships no RTL locale, so the language attribute stays on the supported code.
    expect(document.documentElement.lang).toBe('en')
  })
})
