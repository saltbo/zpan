import { z } from '@hono/zod-openapi'

// Admin view of the instance's torrents (docs/design/torrents.md §9, §11).

const int64 = () => z.number().int().min(0).openapi({ type: 'integer', format: 'int64' })

export const ADMIN_TORRENT_STATUSES = ['downloading', 'verifying', 'ready', 'invalid', 'evicting'] as const

export const adminTorrentSchema = z
  .object({
    id: z.string(),
    infoHash: z.string().describe('Lowercase hex v1 infoHash'),
    name: z.string(),
    totalSize: int64(),
    fileCount: z.number().int().min(0),
    status: z.enum(ADMIN_TORRENT_STATUSES),
    verified: z.enum(['full', 'sampled']).nullable().describe('How verification passed; null until it has'),
    holders: z
      .number()
      .int()
      .min(0)
      .describe('Drive files, live or in trash, that reference the torrent. A held torrent cannot be evicted.'),
    lastAccessedAt: z.string(),
    createdAt: z.string(),
    sourceDownloader: z
      .object({ id: z.string(), name: z.string().nullable() })
      .nullable()
      .describe('The downloader that filled the cache; name is null when it was deleted'),
  })
  .openapi('AdminTorrent')

export type AdminTorrent = z.infer<typeof adminTorrentSchema>

export const torrentSettingsSchema = z
  .object({
    retentionDays: z
      .number()
      .int()
      .min(0)
      .describe('Days an unheld torrent stays cached after its last access. Defaults to 30.'),
    capacityBytes: int64()
      .nullable()
      .describe('Total cache size above which unheld torrents are evicted oldest first; null for no limit'),
  })
  .openapi('TorrentSettings')

export type TorrentSettings = z.infer<typeof torrentSettingsSchema>

export const replaceTorrentSettingsSchema = z.object({
  retentionDays: z.number().int().min(1).max(3650),
  capacityBytes: z
    .number()
    .int()
    .min(1)
    .max(Number.MAX_SAFE_INTEGER)
    .nullable()
    .openapi({ type: 'integer', format: 'int64' }),
})

export type ReplaceTorrentSettingsInput = z.infer<typeof replaceTorrentSettingsSchema>
