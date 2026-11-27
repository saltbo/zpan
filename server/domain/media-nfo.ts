// Kodi/Jellyfin .nfo files: rendering the ones a scrape writes, and reading the
// TMDB id out of one a user already has. Reading scans the tags rather than
// parsing XML, so a malformed file still yields its id.

import type { TmdbEpisode, TmdbMovie, TmdbShow } from './tmdb'

export type NfoKind = 'movie' | 'tvshow' | 'episodedetails'

export interface NfoIdentity {
  // The root element, or null when it is none of the known kinds.
  kind: NfoKind | null
  tmdbId: number | null
}

type Field = [name: string, value: string | number | null | undefined, attributes?: string]

const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
// Characters XML 1.0 cannot carry, even escaped.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching these control characters is the point.
const INVALID_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g

// Markup that is not an element, and the text that ends it.
const MARKUP_ENDS: ReadonlyArray<[start: string, end: string]> = [
  ['<?', '?>'],
  ['<!--', '-->'],
  ['<!', '>'],
]
const TAG_NAME = /<([A-Za-z][\w.-]{0,63})(?=[\s/>])/y
const TMDB_TYPE = /\btype\s*=\s*["']tmdb["']/i
const ELEMENT_NUMBER = /^\s*(\d{1,10})\s*$/

export function movieNfo(movie: TmdbMovie): string {
  return document('movie', [
    ['title', movie.title],
    ['originaltitle', movie.originalTitle],
    ['year', yearOf(movie.date)],
    ['plot', movie.overview],
    ['premiered', movie.date],
    ...movie.genres.map((genre): Field => ['genre', genre]),
    ['runtime', movie.runtime],
    ['uniqueid', movie.id, ' type="tmdb" default="true"'],
  ])
}

export function tvShowNfo(show: TmdbShow): string {
  return document('tvshow', [
    ['title', show.title],
    ['originaltitle', show.originalTitle],
    ['year', yearOf(show.date)],
    ['plot', show.overview],
    ['premiered', show.date],
    ...show.genres.map((genre): Field => ['genre', genre]),
    ['uniqueid', show.id, ' type="tmdb" default="true"'],
  ])
}

export function episodeNfo(episode: TmdbEpisode): string {
  return document('episodedetails', [
    ['title', episode.title],
    ['season', episode.season],
    ['episode', episode.episode],
    ['plot', episode.overview],
    ['aired', episode.airDate],
    ['uniqueid', episode.id, ' type="tmdb"'],
  ])
}

// One left-to-right pass over the tags, so the cost stays linear in the text
// whatever it holds: every lookup starts where the previous one ended, and an
// unclosed comment, declaration, or tag ends the pass.
export function readNfoIdentity(text: string): NfoIdentity {
  let root: string | undefined
  let uniqueId: number | undefined
  let tmdbId: number | undefined
  let position = 0
  while (uniqueId === undefined) {
    const open = text.indexOf('<', position)
    if (open === -1) break
    const close = text.indexOf(MARKUP_ENDS.find(([start]) => text.startsWith(start, open))?.[1] ?? '>', open + 1)
    if (close === -1) break
    position = close + 1
    TAG_NAME.lastIndex = open
    const name = TAG_NAME.exec(text)?.[1].toLowerCase()
    if (name === undefined) continue
    root ??= name
    if (name === 'uniqueid' && TMDB_TYPE.test(text.slice(TAG_NAME.lastIndex, close))) {
      uniqueId = elementNumber(text, position, name)
    } else if (name === 'tmdbid') {
      tmdbId ??= elementNumber(text, position, name)
    }
  }
  const kind = root === 'movie' || root === 'tvshow' || root === 'episodedetails' ? root : null
  return { kind, tmdbId: uniqueId ?? tmdbId ?? null }
}

// The number an element holds, read up to the next tag, which must close it.
function elementNumber(text: string, start: number, name: string): number | undefined {
  const end = text.indexOf('<', start)
  if (end === -1 || text.slice(end, end + name.length + 3).toLowerCase() !== `</${name}>`) return undefined
  const digits = ELEMENT_NUMBER.exec(text.slice(start, end))?.[1]
  return digits === undefined ? undefined : Number(digits)
}

function document(root: NfoKind, fields: readonly Field[]): string {
  const lines = fields.flatMap(([name, value, attributes = '']) =>
    value === null || value === undefined || value === ''
      ? []
      : [`  <${name}${attributes}>${escapeXml(value)}</${name}>`],
  )
  return `${XML_DECLARATION}\n<${root}>\n${lines.join('\n')}\n</${root}>\n`
}

function escapeXml(value: string | number): string {
  return String(value)
    .replace(INVALID_XML_CHARS, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function yearOf(date: string | null): number | null {
  const year = date ? Number(date.slice(0, 4)) : Number.NaN
  return Number.isInteger(year) && year > 0 ? year : null
}
