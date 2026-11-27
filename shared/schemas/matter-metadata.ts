import { z } from '@hono/zod-openapi'
import { opaqueIdSchema } from './id'

// File metadata: a JSON object on a matter, keyed by namespace. `media` is the
// only namespace; a downloader that scraped a download writes it. Image fields
// hold the matter ids of the sidecar images, so a rename or move of either the
// image or the video keeps the reference.

export const MATTER_METADATA_MAX_BYTES = 16 * 1024

const tmdbMovieRefSchema = z.object({ id: z.number().int().positive(), type: z.literal('movie') })
const tmdbTvRefSchema = z.object({ id: z.number().int().positive(), type: z.literal('tv') })
const yearSchema = z.number().int().min(1800).max(9999)
const titleSchema = z.string().min(1).max(500)
const textSchema = z.string().max(8000)
const genresSchema = z.array(z.string().min(1).max(100)).max(30)
// `YYYY-MM-DD`, as TMDB dates are.
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export const movieMediaMetadataSchema = z
  .object({
    kind: z.literal('movie'),
    tmdb: tmdbMovieRefSchema,
    title: titleSchema,
    originalTitle: titleSchema.optional(),
    year: yearSchema.optional(),
    overview: textSchema.optional(),
    genres: genresSchema.optional(),
    runtime: z.number().int().positive().max(10_000).optional().describe('Minutes.'),
    poster: opaqueIdSchema.optional().describe('Matter id of the poster image.'),
    fanart: opaqueIdSchema.optional().describe('Matter id of the fanart image.'),
  })
  .strict()
  .openapi('MovieMediaMetadata')

export const tvShowMediaMetadataSchema = z
  .object({
    kind: z.literal('tvshow'),
    tmdb: tmdbTvRefSchema,
    title: titleSchema,
    originalTitle: titleSchema.optional(),
    year: yearSchema.optional(),
    overview: textSchema.optional(),
    genres: genresSchema.optional(),
    poster: opaqueIdSchema.optional().describe('Matter id of the poster image.'),
    fanart: opaqueIdSchema.optional().describe('Matter id of the fanart image.'),
  })
  .strict()
  .openapi('TvShowMediaMetadata')

export const episodeMediaMetadataSchema = z
  .object({
    kind: z.literal('episode'),
    tmdb: tmdbTvRefSchema.describe('The series.'),
    season: z.number().int().min(0).max(1000),
    episode: z.number().int().min(0).max(100_000),
    title: titleSchema.optional(),
    overview: textSchema.optional(),
    aired: dateSchema.optional(),
    still: opaqueIdSchema.optional().describe('Matter id of the episode still image.'),
  })
  .strict()
  .openapi('EpisodeMediaMetadata')

export const mediaMetadataSchema = z
  .discriminatedUnion('kind', [movieMediaMetadataSchema, tvShowMediaMetadataSchema, episodeMediaMetadataSchema])
  .superRefine((value, ctx) => {
    if (new TextEncoder().encode(JSON.stringify(value)).byteLength > MATTER_METADATA_MAX_BYTES) {
      ctx.addIssue({ code: 'custom', message: `must be at most ${MATTER_METADATA_MAX_BYTES} bytes` })
    }
  })
  .openapi('MediaMetadata')

export type MediaMetadata = z.infer<typeof mediaMetadataSchema>
export type MovieMediaMetadata = z.infer<typeof movieMediaMetadataSchema>
export type TvShowMediaMetadata = z.infer<typeof tvShowMediaMetadataSchema>
export type EpisodeMediaMetadata = z.infer<typeof episodeMediaMetadataSchema>

// What the `metadata` column holds.
export const matterMetadataSchema = z.object({ media: mediaMetadataSchema.optional() })

export type MatterMetadata = z.infer<typeof matterMetadataSchema>
