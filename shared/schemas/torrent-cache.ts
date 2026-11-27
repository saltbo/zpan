import { z } from '@hono/zod-openapi'

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
