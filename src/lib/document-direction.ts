import { languageCode } from '@/i18n/languages'

interface DirectionSource {
  resolvedLanguage?: string
  language?: string
  dir(lng?: string): 'ltr' | 'rtl'
}

/**
 * Writes the active language on `<html>`: `lang` is the supported code, `dir` is
 * i18next's own direction reading (`Intl.Locale` text info with a built-in RTL
 * list). The RTL shapes are keyed to `[dir="rtl"]` in globals.css, and menus read
 * the same direction, so a locale whose script runs right-to-left flips the layout
 * without any component knowing about it.
 */
export function applyDocumentDirection(i18n: DirectionSource) {
  if (typeof document === 'undefined') return
  const resolved = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  document.documentElement.lang = languageCode(resolved)
  document.documentElement.dir = i18n.dir(resolved)
}

/**
 * The direction Radix menu roots should use. Radix places submenu panels from
 * `dir`, and it bakes the value in at mount, so the document must already carry
 * the direction when a page renders — which is why main.tsx applies it before the
 * first render. Guarded for the Workers build, which can render before the
 * document exists.
 */
export function menuDirection(): 'ltr' | 'rtl' {
  return typeof document !== 'undefined' && document.dir === 'rtl' ? 'rtl' : 'ltr'
}
