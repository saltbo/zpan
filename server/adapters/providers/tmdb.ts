import { DEFAULT_MEDIA_SCRAPER_LANGUAGE } from '@shared/media-scraper'
import { z } from 'zod'
import { imageLanguage, type TmdbImage, type TmdbSearchHit, type TmdbSeason, type TmdbShow } from '../../domain/tmdb'
import {
  MEDIA_SCRAPER_OPTION_KEYS,
  type SystemOptionsRepo,
  TmdbAuthError,
  type TmdbGateway,
  TmdbRateLimitError,
  TmdbUnavailableError,
} from '../../usecases/ports'

const API_BASE = 'https://api.themoviedb.org/3'
const IMAGE_BASE = 'https://image.tmdb.org/t/p/'
const REQUEST_TIMEOUT_MS = 15_000
// Used when a 429 carries no usable Retry-After.
const DEFAULT_RETRY_AFTER_SECONDS = 10

const optionalText = z
  .string()
  .nullish()
  .transform((value) => value ?? '')
// TMDB sends '' for an unknown date.
const optionalDate = z
  .string()
  .nullish()
  .transform((value) => value || null)
const optionalPath = z
  .string()
  .nullish()
  .transform((value) => value ?? null)

const searchSchema = z.object({
  results: z.array(
    z.object({
      id: z.number().int(),
      title: optionalText,
      name: optionalText,
      original_title: optionalText,
      original_name: optionalText,
      release_date: optionalDate,
      first_air_date: optionalDate,
    }),
  ),
})

const imageListSchema = z
  .array(z.object({ file_path: z.string(), iso_639_1: z.string().nullish() }))
  .default([])
  .transform((images): TmdbImage[] =>
    images.map((image) => ({ path: image.file_path, language: image.iso_639_1 ?? null })),
  )

const detailsSchema = z.object({
  id: z.number().int(),
  title: optionalText,
  name: optionalText,
  original_title: optionalText,
  original_name: optionalText,
  overview: optionalText,
  release_date: optionalDate,
  first_air_date: optionalDate,
  runtime: z.number().int().nullish(),
  genres: z
    .array(z.object({ name: z.string() }))
    .nullish()
    .transform((genres) => (genres ?? []).map((genre) => genre.name)),
  poster_path: optionalPath,
  backdrop_path: optionalPath,
  images: z.object({ posters: imageListSchema, backdrops: imageListSchema }).optional(),
})

const seasonSchema = z.object({
  season_number: z.number().int(),
  poster_path: optionalPath,
  episodes: z
    .array(
      z.object({
        id: z.number().int(),
        season_number: z.number().int(),
        episode_number: z.number().int(),
        name: optionalText,
        overview: optionalText,
        air_date: optionalDate,
        still_path: optionalPath,
      }),
    )
    .default([]),
})

type Details = z.infer<typeof detailsSchema>
type Params = Record<string, string | number | undefined>

// The gateway reads its access token and language from system options, the
// way the image-domain provider reads its credentials, so every caller sees
// what the administrator saved last.
export function createTmdbGateway(systemOptions: SystemOptionsRepo): TmdbGateway {
  return {
    async getConfig() {
      const rows = await systemOptions.getMany(Object.values(MEDIA_SCRAPER_OPTION_KEYS))
      const values = new Map(rows.map((row) => [row.key, row.value]))
      const accessToken = values.get(MEDIA_SCRAPER_OPTION_KEYS.tmdbAccessToken)?.trim()
      if (!accessToken) return null
      return { accessToken, language: values.get(MEDIA_SCRAPER_OPTION_KEYS.language) || DEFAULT_MEDIA_SCRAPER_LANGUAGE }
    },

    async searchMovies(accessToken, query, language) {
      const body = await getJson(accessToken, '/search/movie', searchSchema, {
        query: query.title,
        year: query.year,
        language,
        include_adult: 'false',
      })
      return (body?.results ?? []).map(
        (result): TmdbSearchHit => ({
          id: result.id,
          title: result.title,
          originalTitle: result.original_title,
          year: yearOf(result.release_date),
        }),
      )
    },

    async searchShows(accessToken, query, language) {
      const body = await getJson(accessToken, '/search/tv', searchSchema, {
        query: query.title,
        first_air_date_year: query.year,
        language,
        include_adult: 'false',
      })
      return (body?.results ?? []).map(
        (result): TmdbSearchHit => ({
          id: result.id,
          title: result.name,
          originalTitle: result.original_name,
          year: yearOf(result.first_air_date),
        }),
      )
    },

    async getMovie(accessToken, id, language, options) {
      const body = await getJson(accessToken, `/movie/${id}`, detailsSchema, detailsParams(language, options))
      return (
        body && { ...toTitle(body, body.title, body.original_title, body.release_date), runtime: body.runtime ?? null }
      )
    },

    async getShow(accessToken, id, language, options) {
      const body = await getJson(accessToken, `/tv/${id}`, detailsSchema, detailsParams(language, options))
      return body && toTitle(body, body.name, body.original_name, body.first_air_date)
    },

    async getSeason(accessToken, showId, season, language) {
      const body = await getJson(accessToken, `/tv/${showId}/season/${season}`, seasonSchema, { language })
      if (!body) return null
      return {
        season: body.season_number,
        posterPath: body.poster_path,
        episodes: body.episodes.map((episode) => ({
          id: episode.id,
          season: episode.season_number,
          episode: episode.episode_number,
          title: episode.name,
          overview: episode.overview,
          airDate: episode.air_date,
          stillPath: episode.still_path,
        })),
      } satisfies TmdbSeason
    },

    async getImage(path, size) {
      const response = await send(`${IMAGE_BASE}${size}${path}`, {})
      if (response.status === 404) return null
      if (!response.ok) throw new TmdbUnavailableError(`TMDB image request failed (HTTP ${response.status})`)
      return {
        bytes: new Uint8Array(await response.arrayBuffer()),
        contentType: response.headers.get('Content-Type') ?? 'image/jpeg',
      }
    },
  }
}

function detailsParams(language: string, options: { images: boolean }): Params {
  return options.images
    ? { language, append_to_response: 'images', include_image_language: `${imageLanguage(language)},null,en` }
    : { language }
}

function toTitle(body: Details, title: string, originalTitle: string, date: string | null): TmdbShow {
  return {
    id: body.id,
    title,
    originalTitle,
    overview: body.overview,
    date,
    genres: body.genres,
    posterPath: body.poster_path,
    backdropPath: body.backdrop_path,
    posters: body.images?.posters ?? [],
    backdrops: body.images?.backdrops ?? [],
  }
}

// null for a 404.
async function getJson<T extends z.ZodType>(
  accessToken: string,
  path: string,
  schema: T,
  params: Params,
): Promise<z.infer<T> | null> {
  const url = new URL(`${API_BASE}${path}`)
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value))
  }
  const response = await send(url.toString(), { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' })
  if (response.status === 404) return null
  if (response.status === 401) throw new TmdbAuthError()
  if (response.status === 429) throw new TmdbRateLimitError(retryAfterSeconds(response.headers.get('Retry-After')))
  if (response.status >= 500) throw new TmdbUnavailableError(`TMDB request failed (HTTP ${response.status})`)
  if (!response.ok) throw new Error(`TMDB rejected ${path} (HTTP ${response.status})`)
  return schema.parse(await response.json())
}

async function send(url: string, headers: Record<string, string>): Promise<Response> {
  try {
    return await fetch(url, { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  } catch (error) {
    throw new TmdbUnavailableError(`TMDB request failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

// Retry-After is either delay-seconds or an HTTP date.
function retryAfterSeconds(header: string | null): number {
  if (!header) return DEFAULT_RETRY_AFTER_SECONDS
  const seconds = Number(header)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds)
  const date = Date.parse(header)
  return Number.isNaN(date) ? DEFAULT_RETRY_AFTER_SECONDS : Math.max(0, Math.ceil((date - Date.now()) / 1000))
}

function yearOf(date: string | null): number | null {
  const year = date ? Number(date.slice(0, 4)) : Number.NaN
  return Number.isInteger(year) ? year : null
}
