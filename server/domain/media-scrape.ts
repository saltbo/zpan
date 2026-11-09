// What a TMDB scrape records per video and where it puts the metadata: Kodi and
// Jellyfin read sidecar files next to the videos, so a movie `X.mkv` gets
// `X.nfo`, `X-poster.jpg`, and `X-fanart.jpg`, and a show folder gets
// `tvshow.nfo`, `poster.jpg`, `fanart.jpg`, and `seasonNN-poster.jpg`, with
// `X.nfo` and `X-thumb.jpg` per episode.

import type { MediaInfo } from '@shared/schemas'
import { isSeasonFolder, titleAndYear } from './media-filename'
import { joinMatterPath } from './media-library'
import { normalizeTitle, TITLE_MATCH_THRESHOLD, type TmdbRef, titleSimilarity } from './tmdb'

// For an episode, the id is the series and season and episode locate it.
export type TmdbMatch = { type: 'movie'; id: number } | { type: 'tv'; id: number; season: number; episode: number }

export type MediaScrapeSource = 'nfo' | 'search'

export type MediaScrapeResult =
  | { status: 'matched'; source: MediaScrapeSource; match: TmdbMatch }
  | { status: 'unmatched'; source: MediaScrapeSource }

// The last scrape of a video, as a later scrape needs it.
export interface PreviousMediaScrape {
  result: MediaScrapeResult
  matchKey: string
  language: string
}

export interface SidecarPath {
  parent: string
  name: string
}

export const MOVIE_FOLDER_NFO = 'movie.nfo'
export const TV_SHOW_NFO = 'tvshow.nfo'

export function publishedRef(match: TmdbMatch): TmdbRef {
  return { id: match.id, type: match.type }
}

// What a match depends on: the kind and the parsed title and year. Season and
// episode are left out, so renumbering an episode keeps its series.
export function mediaMatchKey(media: MediaInfo): string {
  const year = media.type === 'unknown' ? undefined : media.year
  return `${media.type}:${normalizeTitle(media.title)}:${year ?? ''}`
}

// A video that changed without changing its parsed title (a move, or a library
// folder rename) keeps its match. An unmatched video is searched again only in
// a new language, which can match a localized title.
export function reusableScrape(
  previous: PreviousMediaScrape | null,
  current: { matchKey: string; language: string },
): MediaScrapeResult | null {
  if (!previous || previous.matchKey !== current.matchKey) return null
  if (previous.result.status === 'matched' || previous.language === current.language) return previous.result
  return null
}

export function movieSidecars(video: SidecarPath): Record<'nfo' | 'poster' | 'fanart', SidecarPath> {
  const base = baseName(video.name)
  return {
    nfo: { parent: video.parent, name: `${base}.nfo` },
    poster: { parent: video.parent, name: `${base}-poster.jpg` },
    fanart: { parent: video.parent, name: `${base}-fanart.jpg` },
  }
}

export function episodeSidecars(video: SidecarPath): Record<'nfo' | 'thumb', SidecarPath> {
  const base = baseName(video.name)
  return {
    nfo: { parent: video.parent, name: `${base}.nfo` },
    thumb: { parent: video.parent, name: `${base}-thumb.jpg` },
  }
}

// Specials are season 0, so their poster is season00-poster.jpg.
export function showSidecars(
  showFolder: string,
  season: number,
): Record<'nfo' | 'poster' | 'fanart' | 'seasonPoster', SidecarPath> {
  return {
    nfo: { parent: showFolder, name: TV_SHOW_NFO },
    poster: { parent: showFolder, name: 'poster.jpg' },
    fanart: { parent: showFolder, name: 'fanart.jpg' },
    seasonPoster: { parent: showFolder, name: `season${String(season).padStart(2, '0')}-poster.jpg` },
  }
}

// The folder that holds a show's tvshow.nfo and artwork: the episode's folder,
// or its parent when the episode sits in a season folder inside the library.
// It is the show's only when its name is the show's title, so episodes of
// several shows loose in one folder never share a tvshow.nfo; those get only
// their own sidecars.
export function showFolderOf(episodeFolder: string, libraryRoot: string, showTitle: string): string | null {
  const folder =
    episodeFolder !== libraryRoot && isSeasonFolder(lastSegment(episodeFolder))
      ? episodeFolder.slice(0, episodeFolder.lastIndexOf('/'))
      : episodeFolder
  return titleSimilarity(titleAndYear(lastSegment(folder)).title, showTitle) >= TITLE_MATCH_THRESHOLD ? folder : null
}

export function sidecarKey(path: SidecarPath): string {
  return joinMatterPath(path.parent, path.name).toLowerCase()
}

function baseName(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

function lastSegment(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}
