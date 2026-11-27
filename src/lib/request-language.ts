// The i18next singleton that src/i18n initializes; importing it directly keeps
// react-i18next out of the API client.
import i18n from 'i18next'
import { languageCode } from '@/i18n/languages'

/**
 * The header that asks the API for error messages in the UI's current language.
 * The server writes every error message once, per language (UX.md, Feedback), so
 * the UI only has to say which language it shows.
 */
export function requestLanguageHeaders(): Record<string, string> {
  return { 'Accept-Language': languageCode(i18n.resolvedLanguage ?? i18n.language) }
}
