// What ZPan reads from TMDB, and how a parsed filename is matched to a search
// result. Matching compares titles after normalization, so punctuation, case,
// accents, and a leading English article do not matter, and it rejects a result
// whose year is more than one off.

import type { TmdbRef } from '@shared/schemas'

export type TmdbMediaType = TmdbRef['type']

export interface TmdbSearchHit {
  id: number
  title: string
  originalTitle: string
  year: number | null
}

export interface TmdbImage {
  path: string
  // ISO 639-1, or null for an image without text.
  language: string | null
}

interface TmdbTitle {
  id: number
  title: string
  originalTitle: string
  overview: string
  // Release date of a movie or first air date of a show, `YYYY-MM-DD`.
  date: string | null
  genres: string[]
  posterPath: string | null
  backdropPath: string | null
  posters: TmdbImage[]
  backdrops: TmdbImage[]
}

export interface TmdbMovie extends TmdbTitle {
  runtime: number | null
}

export type TmdbShow = TmdbTitle

export interface TmdbEpisode {
  id: number
  season: number
  episode: number
  title: string
  overview: string
  airDate: string | null
  stillPath: string | null
}

export interface TmdbSeason {
  season: number
  posterPath: string | null
  episodes: TmdbEpisode[]
}

export const TMDB_FALLBACK_LANGUAGE = 'en-US'

// Dice similarity of normalized titles at or above which a search result can match.
export const TITLE_MATCH_THRESHOLD = 0.85

export function normalizeTitle(title: string): string {
  return titleWords(title)
    .replace(/^ ?(?:the|a|an) /, '')
    .replace(/ /g, '')
}

function titleWords(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
}

// The number a title ends with, in digits or as a roman numeral after a space:
// the sequel or part a title names. "Toy Story 2" and "Toy Story 3" are as
// similar as two titles get, so this has to agree before similarity counts.
// CJK titles run the number into the last word ("唐人街探案2").
function sequelNumber(title: string): number | null {
  const words = titleWords(title).trim()
  const digits = /(\d+)$/.exec(words)?.[1]
  if (digits !== undefined) return Number(digits)
  const roman = / (x{0,3}(?:ix|iv|v?i{0,3}))$/.exec(words)?.[1]
  return roman ? romanValue(roman) : null
}

const ROMAN_DIGITS: Readonly<Record<string, number>> = { i: 1, v: 5, x: 10 }

function romanValue(numeral: string): number {
  let value = 0
  for (let i = 0; i < numeral.length; i++) {
    const digit = ROMAN_DIGITS[numeral[i]]
    value += digit < (ROMAN_DIGITS[numeral[i + 1]] ?? 0) ? -digit : digit
  }
  return value
}

// Dice coefficient over character bigrams of the normalized titles: 1 when they
// are equal, 0 when either is empty or they share no bigram.
export function titleSimilarity(a: string, b: string): number {
  const left = Array.from(normalizeTitle(a))
  const right = Array.from(normalizeTitle(b))
  if (left.length === 0 || right.length === 0) return 0
  if (left.join('') === right.join('')) return 1
  if (left.length < 2 || right.length < 2) return 0
  const counts = new Map<string, number>()
  for (let i = 0; i < left.length - 1; i++) {
    const bigram = left[i] + left[i + 1]
    counts.set(bigram, (counts.get(bigram) ?? 0) + 1)
  }
  let shared = 0
  for (let i = 0; i < right.length - 1; i++) {
    const bigram = right[i] + right[i + 1]
    const count = counts.get(bigram) ?? 0
    if (count > 0) {
      shared++
      counts.set(bigram, count - 1)
    }
  }
  return (2 * shared) / (left.length - 1 + right.length - 1)
}

// The best result for a parsed title: the most similar title (localized or
// original) that ends in the same sequel number, then the closest year, then
// TMDB's own order. A result more than a year off the parsed year never
// matches; a missing year on either side is neutral.
export function chooseTmdbMatch(
  query: { title: string; year?: number },
  hits: readonly TmdbSearchHit[],
): TmdbSearchHit | null {
  const sequel = sequelNumber(query.title)
  let best: { hit: TmdbSearchHit; similarity: number; yearDistance: number } | null = null
  for (const hit of hits) {
    const similarity = Math.max(
      ...[hit.title, hit.originalTitle].map((title) =>
        sequelNumber(title) === sequel ? titleSimilarity(query.title, title) : 0,
      ),
    )
    if (similarity < TITLE_MATCH_THRESHOLD) continue
    const yearDistance = query.year !== undefined && hit.year !== null ? Math.abs(query.year - hit.year) : 1
    if (yearDistance > 1) continue
    if (!best || similarity > best.similarity || (similarity === best.similarity && yearDistance < best.yearDistance)) {
      best = { hit, similarity, yearDistance }
    }
  }
  return best?.hit ?? null
}

// `zh-CN` → `zh`: TMDB tags images with ISO 639-1 only.
export function imageLanguage(language: string): string {
  return language.split('-')[0].toLowerCase()
}

// The first image in TMDB's order whose language comes earliest in `preference`
// (null means an image without text).
export function chooseImage(images: readonly TmdbImage[], preference: readonly (string | null)[]): string | null {
  for (const language of preference) {
    const image = images.find((candidate) => candidate.language === language)
    if (image) return image.path
  }
  return null
}

// Posters carry the title, so the configured language comes first; fanart is
// a backdrop, best without text.
export function posterPreference(language: string): (string | null)[] {
  return [imageLanguage(language), null, 'en']
}

export function fanartPreference(language: string): (string | null)[] {
  return [null, imageLanguage(language), 'en']
}
