// Kodi/Jellyfin .nfo files: rendering the ones a scrape writes, and reading the
// TMDB id out of one a user already has. Reading is a tolerant regex over the
// text rather than an XML parse, so a malformed file still yields its id.

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

export function readNfoIdentity(text: string): NfoIdentity {
  const body = text.replace(/<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>]*>/gi, '')
  const root = /<([A-Za-z][\w.-]*)/.exec(body)?.[1].toLowerCase()
  const kind = root === 'movie' || root === 'tvshow' || root === 'episodedetails' ? root : null
  const id =
    /<uniqueid\b(?=[^>]*\btype\s*=\s*["']tmdb["'])[^>]*>\s*(\d+)\s*<\/uniqueid>/i.exec(body)?.[1] ??
    /<tmdbid>\s*(\d+)\s*<\/tmdbid>/i.exec(body)?.[1]
  return { kind, tmdbId: id === undefined ? null : Number(id) }
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
