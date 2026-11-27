import { z } from '@hono/zod-openapi'
import { ADMIN_TORRENT_STATUSES } from './admin-torrents'
import { episodeMediaMetadataSchema, movieMediaMetadataSchema, tvShowMediaMetadataSchema } from './matter-metadata'

export const torrentCacheConfigSchema = z
  .object({
    folder: z
      .string()
      .describe('Workspace folder that cached torrents are transferred into, slash-delimited. Empty is the root.'),
  })
  .openapi('TorrentCacheConfig')

export type TorrentCacheConfig = z.infer<typeof torrentCacheConfigSchema>

export const replaceTorrentCacheConfigSchema = z.object({
  folder: z
    .string()
    .max(1024)
    .refine((folder) => folder.split('/').every((part) => part.trim() !== '.' && part.trim() !== '..'), {
      message: 'Folder must not contain . or .. segments',
    })
    .describe('Workspace folder that cached torrents are transferred into, slash-delimited. Empty is the root.'),
})

export type ReplaceTorrentCacheConfigInput = z.infer<typeof replaceTorrentCacheConfigSchema>

// ─── Cache upload API (a capable downloader filling the cache) ──────────────

const int64 = () => z.number().int().min(0).openapi({ type: 'integer', format: 'int64' })

// Base64 of the bencoded info dictionary; 8 MiB covers the piece hashes of a
// torrent of several terabytes.
export const registerTaskTorrentSchema = z.object({
  info: z
    .string()
    .min(4)
    .max(8 * 1024 * 1024)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/, 'Base64 expected')
    .describe("Base64 of the torrent's bencoded info dictionary. Its SHA-1 must equal the task's infoHash."),
})

export type RegisterTaskTorrentInput = z.infer<typeof registerTaskTorrentSchema>

export const torrentCacheFileSchema = z.object({
  fileIdx: z.number().int().min(0).describe('Position of the file in the info dictionary'),
  path: z.string().describe('Path inside the torrent'),
  size: int64(),
})

export const taskTorrentRegistrationSchema = z
  .object({
    outcome: z
      .enum(['fill', 'joined', 'completed', 'drive'])
      .describe(
        'fill: upload every file through the cache API. joined: another download of this torrent is in progress; drop the task. completed: the torrent was already cached and the task is done. drive: the cache cannot take this torrent; upload through the object API as before.',
      ),
    infoHash: z.string(),
    name: z.string(),
    files: z.array(torrentCacheFileSchema).describe('Files to upload; padding files are left out'),
  })
  .openapi('TaskTorrentRegistration')

export type TaskTorrentRegistration = z.infer<typeof taskTorrentRegistrationSchema>

export const torrentFileUploadSchema = z
  .object({
    uploadId: z.string().nullable().describe('S3 multipart upload id; null for a single PUT'),
    partSize: int64(),
    expiresAt: z.string(),
    parts: z.array(
      z.object({
        partNumber: z.number().int().min(1),
        url: z.string(),
        offset: int64(),
        length: int64(),
      }),
    ),
  })
  .openapi('TorrentFileUpload')

export type TorrentFileUpload = z.infer<typeof torrentFileUploadSchema>

export const completeTorrentFileUploadSchema = z.object({
  uploadId: z.string().min(1).nullable().optional(),
  parts: z
    .array(z.object({ partNumber: z.number().int().min(1).max(10_000), etag: z.string().min(1) }))
    .max(10_000)
    .optional()
    .describe('Part ETags of a multipart upload'),
})

export type CompleteTorrentFileUploadInput = z.infer<typeof completeTorrentFileUploadSchema>

export const completeTaskTorrentSchema = z.object({
  files: z
    .array(z.object({ path: z.string().min(1).max(4096), size: int64() }))
    .max(100_000)
    .describe('The files the downloader uploaded; they must match the info dictionary'),
})

export type CompleteTaskTorrentInput = z.infer<typeof completeTaskTorrentSchema>

export const torrentVerifyJobRequestSchema = z.object({
  type: z.literal('torrent_verify'),
  torrentId: z.string().min(1),
  // Verify a sample of pieces whatever the storage: set when no queue runs and
  // the job is processed within the completing request.
  sample: z.boolean().optional(),
  // Carried by the messages that continue a full verification: the next piece.
  resume: z.object({ nextPiece: z.number().int().nonnegative() }).optional(),
})

export type TorrentVerifyJobRequest = z.infer<typeof torrentVerifyJobRequestSchema>

// The cached torrent a drive file references (docs/design/torrent-cache.md §9).
export const objectTorrentSchema = z
  .object({
    infoHash: z.string().describe('Lowercase hex v1 infoHash'),
    name: z.string(),
    status: z.enum(ADMIN_TORRENT_STATUSES),
    verified: z.enum(['full', 'sampled']).nullable().describe('How verification passed; null until it has'),
  })
  .openapi('ObjectTorrent')

export type ObjectTorrent = z.infer<typeof objectTorrentSchema>

// ─── Sidecars and the upload layout (docs/design/torrent-cache.md §3, §6) ────

// Sidecars are .nfo documents and images; 32 MiB is far above either.
export const TORRENT_SIDECAR_MAX_BYTES = 32 * 1024 * 1024
export const TORRENT_SIDECAR_MAX_COUNT = 10_000

export const createTorrentSidecarUploadSchema = z.object({
  size: z.number().int().min(0).max(TORRENT_SIDECAR_MAX_BYTES).openapi({ type: 'integer', format: 'int64' }),
})

export type CreateTorrentSidecarUploadInput = z.infer<typeof createTorrentSidecarUploadSchema>

// A path relative to the transfer's target folder, slash-delimited, without
// empty, `.` or `..` segments.
const layoutPathSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine((value) => value.split('/').every((part) => part !== '' && part !== '.' && part !== '..'), {
    message: 'Path segments must not be empty, . or ..',
  })

const imageRef = () => layoutPathSchema.optional().describe('Layout path of the sidecar image')

// The `media` file metadata the upload would have set, with each image written
// as the layout path of its sidecar; instant transfer resolves them to matter ids.
export const torrentLayoutMovieMediaSchema = movieMediaMetadataSchema
  .extend({ poster: imageRef(), fanart: imageRef() })
  .openapi('TorrentLayoutMovieMedia')
export const torrentLayoutTvShowMediaSchema = tvShowMediaMetadataSchema.extend({
  poster: imageRef(),
  fanart: imageRef(),
})
export const torrentLayoutEpisodeMediaSchema = episodeMediaMetadataSchema
  .extend({ still: imageRef() })
  .openapi('TorrentLayoutEpisodeMedia')

export const torrentLayoutEntrySchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('folder'),
      path: layoutPathSchema,
      media: torrentLayoutTvShowMediaSchema.optional().describe("A show folder's media"),
    })
    .strict()
    .openapi('TorrentLayoutFolder'),
  z
    .object({
      kind: z.literal('torrent-file'),
      path: layoutPathSchema.describe('Where the file goes; a taken name is renamed, as `X (1).mkv`'),
      fileIdx: z.number().int().min(0).describe('Position of the file in the info dictionary'),
      media: z
        .discriminatedUnion('kind', [torrentLayoutMovieMediaSchema, torrentLayoutEpisodeMediaSchema])
        .optional()
        .describe("A movie's or an episode's media"),
    })
    .strict()
    .openapi('TorrentLayoutTorrentFile'),
  z
    .object({
      kind: z.literal('sidecar'),
      path: layoutPathSchema.describe('Where the sidecar goes; an entry already at its name wins'),
      sidecar: z
        .number()
        .int()
        .min(0)
        .max(TORRENT_SIDECAR_MAX_COUNT - 1)
        .describe('The uploaded sidecar, stored as bt/<infoHash>/x/<n>'),
      video: layoutPathSchema
        .optional()
        .describe('Layout path of the video it is named after: it takes the name that video was given'),
    })
    .strict()
    .openapi('TorrentLayoutSidecar'),
])

export type TorrentLayoutEntry = z.infer<typeof torrentLayoutEntrySchema>

export const torrentLayoutSchema = z
  .object({
    version: z.literal(1),
    entries: z.array(torrentLayoutEntrySchema).min(1).max(100_000),
  })
  .openapi('TorrentLayout')

export type TorrentLayout = z.infer<typeof torrentLayoutSchema>
