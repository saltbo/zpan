import { z } from '@hono/zod-openapi'
import { actorIdentitySchema } from './actors'
import { opaqueIdSchema } from './id'

export const createMediaLibraryRequestSchema = z.object({
  folderId: opaqueIdSchema.describe('ID of the folder to index as a media library.'),
})

export type CreateMediaLibraryRequest = z.infer<typeof createMediaLibraryRequestSchema>

export const mediaLibrarySchema = z
  .object({
    id: opaqueIdSchema,
    orgId: opaqueIdSchema,
    folderId: opaqueIdSchema,
    folderPath: z.string().describe('Current slash-delimited path of the library folder within the workspace.'),
    scanning: z.boolean().describe('Whether a scan is queued or running.'),
    scraping: z.boolean().describe('Whether a TMDB scrape is queued or running.'),
    lastScannedAt: z.string().nullable(),
    createdBy: actorIdentitySchema,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('MediaLibrary')

export type MediaLibrary = z.infer<typeof mediaLibrarySchema>

// ─── <library>/library.json — JSON Feed 1.1 ─────────────────────────────────

export const MEDIA_LIBRARY_FEED_VERSION = 'https://jsonfeed.org/version/1.1'

export const mediaInfoSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('movie'), title: z.string(), year: z.number().int() }),
  z.object({
    type: z.literal('episode'),
    title: z.string(),
    season: z.number().int(),
    episode: z.number().int(),
    year: z.number().int().optional(),
  }),
  z.object({ type: z.literal('unknown'), title: z.string() }),
])

export type MediaInfo = z.infer<typeof mediaInfoSchema>

// The TMDB match of a video; for an episode, the series.
export const tmdbRefSchema = z.object({ id: z.number().int(), type: z.enum(['movie', 'tv']) })

export type TmdbRef = z.infer<typeof tmdbRefSchema>

// What the filename says, plus the TMDB match once a scrape found one.
export const mediaLibraryFeedMediaSchema = mediaInfoSchema.and(z.object({ tmdb: tmdbRefSchema.optional() }))

export const mediaLibraryFeedItemSchema = z.object({
  // The video's matter id: stable across renames and moves, so clients diff by it.
  id: z.string(),
  title: z.string(),
  // JSON Feed requires content_text or content_html; this is the library-relative path.
  content_text: z.string(),
  date_modified: z.string(),
  attachments: z
    .array(
      z.object({
        // Relative to the library folder, each path segment percent-encoded.
        url: z.string(),
        mime_type: z.string(),
        size_in_bytes: z.number().int(),
      }),
    )
    .length(1),
  _media: mediaLibraryFeedMediaSchema,
})

export const mediaLibraryFeedSchema = z.object({
  version: z.literal(MEDIA_LIBRARY_FEED_VERSION),
  title: z.string(),
  _zpan: z.object({ generatedAt: z.string(), libraryId: z.string() }),
  items: z.array(mediaLibraryFeedItemSchema),
})

export type MediaLibraryFeedItem = z.infer<typeof mediaLibraryFeedItemSchema>
export type MediaLibraryFeed = z.infer<typeof mediaLibraryFeedSchema>
