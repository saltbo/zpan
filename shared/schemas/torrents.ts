import { z } from '@hono/zod-openapi'

// Base64 of a torrent's bencoded info dictionary, as a downloader reports it on
// its task (docs/design/torrents.md §4). 8 MiB covers the piece hashes of a
// torrent of several terabytes.
export const torrentInfoSchema = z
  .string()
  .min(4)
  .max(8 * 1024 * 1024)
  .regex(/^[A-Za-z0-9+/]+={0,2}$/, 'Base64 expected')

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

// What a downloader uploads for streaming a torrent its task fills
// (docs/design/torrents.md §14).
const streamChunkSchema = z.object({
  firstPiece: z.number().int().nonnegative(),
  pieceCount: z.number().int().positive(),
})

export const torrentStreamStateSchema = z
  .object({
    pieceLength: z.number().int().positive(),
    pieceCount: z.number().int().positive(),
    readaheadBytes: z.number().int().positive().describe('How far past each wanted piece to upload, in bytes.'),
    maxChunkBytes: z
      .number()
      .int()
      .positive()
      .describe('The largest chunk to upload, in bytes; a chunk always holds at least one whole piece.'),
    wants: z
      .array(z.number().int().nonnegative())
      .describe('Pieces players wait for or read from, ascending. Empty when nobody streams the torrent.'),
    chunks: z.array(streamChunkSchema).describe('Chunks already stored.'),
  })
  .openapi('TorrentStreamState')

export const torrentStreamChunkSchema = streamChunkSchema.openapi('TorrentStreamChunk')

export type TorrentStreamState = z.infer<typeof torrentStreamStateSchema>
