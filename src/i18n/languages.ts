export type LanguageCode = 'en' | 'zh'

/**
 * The languages the UI ships. Labels are endonyms (a language's own name), so
 * they need no translation key and read correctly in every locale.
 */
export const LANGUAGE_OPTIONS: Array<{ code: LanguageCode; label: string }> = [
  { code: 'en', label: 'English' },
  { code: 'zh', label: '中文' },
]

/** Maps a detected locale (`zh-CN`, `en-US`) to the closest supported code. */
export function languageCode(resolvedLanguage?: string): LanguageCode {
  if (resolvedLanguage?.startsWith('zh')) return 'zh'
  return 'en'
}

/** The endonym of the active language, for labels that show what is selected. */
export function languageLabel(resolvedLanguage?: string): string {
  const code = languageCode(resolvedLanguage)
  return LANGUAGE_OPTIONS.find(({ code: supported }) => supported === code)?.label ?? LANGUAGE_OPTIONS[0].label
}
