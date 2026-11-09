// Matroska's Language element uses ISO 639-2, including the bibliographic codes (chi, fre, ger…).
const ISO_639_2: Record<string, string> = {
  ara: 'ar',
  chi: 'zh',
  zho: 'zh',
  cze: 'cs',
  ces: 'cs',
  dan: 'da',
  dut: 'nl',
  nld: 'nl',
  eng: 'en',
  fin: 'fi',
  fre: 'fr',
  fra: 'fr',
  ger: 'de',
  deu: 'de',
  gre: 'el',
  ell: 'el',
  heb: 'he',
  hin: 'hi',
  hun: 'hu',
  ind: 'id',
  ita: 'it',
  jpn: 'ja',
  kor: 'ko',
  may: 'ms',
  msa: 'ms',
  nor: 'no',
  pol: 'pl',
  por: 'pt',
  rum: 'ro',
  ron: 'ro',
  rus: 'ru',
  spa: 'es',
  swe: 'sv',
  tha: 'th',
  tur: 'tr',
  ukr: 'uk',
  vie: 'vi',
}

// Tags release groups put between the video name and the subtitle extension (movie.chs.srt).
const SIDECAR_TAGS: Record<string, string> = {
  chs: 'zh-Hans',
  sc: 'zh-Hans',
  gb: 'zh-Hans',
  简: 'zh-Hans',
  简体: 'zh-Hans',
  简中: 'zh-Hans',
  cht: 'zh-Hant',
  tc: 'zh-Hant',
  big5: 'zh-Hant',
  繁: 'zh-Hant',
  繁体: 'zh-Hant',
  繁體: 'zh-Hant',
  繁中: 'zh-Hant',
  中文: 'zh',
  chinese: 'zh',
  english: 'en',
  英文: 'en',
  japanese: 'ja',
  日文: 'ja',
  korean: 'ko',
  韩文: 'ko',
}

/** A canonical BCP 47 tag for a muxer- or filename-provided language code, or null when it isn't one. */
export function normalizeLanguage(code: string): string | null {
  const lower = code.trim().toLowerCase()
  if (lower === '' || lower === 'und') return null
  const mapped = SIDECAR_TAGS[lower] ?? ISO_639_2[lower] ?? lower
  let canonical: string
  try {
    ;[canonical] = Intl.getCanonicalLocales(mapped)
  } catch {
    return null
  }
  // Region-tagged Chinese is a script choice in practice: zh-CN/zh-SG are simplified, zh-TW/zh-HK traditional.
  if (/^zh-(cn|sg)$/i.test(canonical)) return 'zh-Hans'
  if (/^zh-(tw|hk|mo)$/i.test(canonical)) return 'zh-Hant'
  return canonical
}

/** Finds the language among the dot- or ampersand-separated parts of a sidecar tag (zh.forced, chs&eng). */
export function languageFromSidecarTag(tag: string): string | null {
  for (const part of tag.split(/[.&_\s]+/)) {
    const lower = part.toLowerCase()
    if (SIDECAR_TAGS[lower] || ISO_639_2[lower] || /^[a-z]{2}(-[a-z0-9]{2,8})*$/.test(lower)) {
      const language = normalizeLanguage(part)
      if (language) return language
    }
  }
  return null
}

export function languageLabel(language: string, displayLanguage: string): string | null {
  try {
    return new Intl.DisplayNames([displayLanguage], { type: 'language' }).of(language) ?? null
  } catch {
    return null
  }
}

interface Pickable {
  language: string | null
  isDefault: boolean
  isForced: boolean
}

/**
 * The track to show by default: one in the interface language (simplified before traditional Chinese),
 * otherwise the one the file marks as default.
 */
export function pickDefaultSubtitle<T extends Pickable>(tracks: readonly T[], uiLanguage: string): T | null {
  const uiBase = uiLanguage.split('-')[0].toLowerCase()
  const inUiLanguage = tracks.filter(
    (track) => !track.isForced && track.language?.split('-')[0].toLowerCase() === uiBase,
  )
  const preferred = inUiLanguage.find((track) => !/-Hant\b/i.test(track.language ?? '')) ?? inUiLanguage[0]
  return preferred ?? tracks.find((track) => track.isDefault && !track.isForced) ?? null
}
