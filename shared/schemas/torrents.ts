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
