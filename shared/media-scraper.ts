// The languages an administrator can scrape media library metadata in, as TMDB
// language tags. Titles and plots come back in this language; posters prefer it.
export const MEDIA_SCRAPER_LANGUAGES = [
  'en-US',
  'zh-CN',
  'zh-TW',
  'ja-JP',
  'ko-KR',
  'fr-FR',
  'de-DE',
  'es-ES',
  'it-IT',
  'pt-BR',
  'ru-RU',
] as const

export type MediaScraperLanguage = (typeof MEDIA_SCRAPER_LANGUAGES)[number]

export const DEFAULT_MEDIA_SCRAPER_LANGUAGE: MediaScraperLanguage = 'en-US'
