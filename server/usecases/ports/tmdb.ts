import type { TmdbMovie, TmdbSearchHit, TmdbSeason, TmdbShow } from '../../domain/tmdb'

export const MEDIA_SCRAPER_OPTION_KEYS = {
  tmdbAccessToken: 'media_scraper_tmdb_access_token',
  language: 'media_scraper_language',
} as const

export interface TmdbConfig {
  // TMDB API Read Access Token (v4), sent as a bearer token.
  accessToken: string
  language: string
}

export type TmdbImageSize = 'w300' | 'w780' | 'w1280'

export interface TmdbImageFile {
  bytes: Uint8Array
  contentType: string
}

// TMDB answered 401: the access token is wrong or revoked.
export class TmdbAuthError extends Error {
  constructor() {
    super('TMDB rejected the access token')
    this.name = 'TmdbAuthError'
  }
}

// TMDB answered 429.
export class TmdbRateLimitError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super('TMDB rate limit reached')
    this.name = 'TmdbRateLimitError'
  }
}

// A 5xx, a timeout, or a network failure: a later attempt may succeed.
export class TmdbUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TmdbUnavailableError'
  }
}

export interface TmdbGateway {
  // null until an administrator saves an access token.
  getConfig(): Promise<TmdbConfig | null>
  searchMovies(accessToken: string, query: { title: string; year?: number }, language: string): Promise<TmdbSearchHit[]>
  searchShows(accessToken: string, query: { title: string; year?: number }, language: string): Promise<TmdbSearchHit[]>
  // The details getters return null when TMDB has no such id. With `images`,
  // posters and backdrops in the language, without text, and in English are included.
  getMovie(accessToken: string, id: number, language: string, options: { images: boolean }): Promise<TmdbMovie | null>
  getShow(accessToken: string, id: number, language: string, options: { images: boolean }): Promise<TmdbShow | null>
  getSeason(accessToken: string, showId: number, season: number, language: string): Promise<TmdbSeason | null>
  // null when TMDB no longer has the image.
  getImage(path: string, size: TmdbImageSize): Promise<TmdbImageFile | null>
}
