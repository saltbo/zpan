import { z } from '@hono/zod-openapi'

// A workspace's Torrents list (docs/design/torrents.md §3 workspace_torrents, §9).

const int64 = () => z.number().int().min(0).openapi({ type: 'integer', format: 'int64' })

export const WORKSPACE_TORRENT_STATUSES = ['resolving', 'downloading', 'verifying', 'ready', 'failed'] as const
export type WorkspaceTorrentStatus = (typeof WORKSPACE_TORRENT_STATUSES)[number]

export const WORKSPACE_TORRENT_SOURCES = ['download', 'stremthru'] as const
export type WorkspaceTorrentSource = (typeof WORKSPACE_TORRENT_SOURCES)[number]

export const workspaceTorrentSchema = z
  .object({
    id: z.string(),
    infoHash: z.string().nullable().describe('Lowercase hex v1 infoHash; null until a torrent URL is resolved'),
    name: z.string().describe("The torrent's name, or the link's suggested name before its metadata arrives"),
    size: int64().nullable().describe('Total size; null before the torrent is known'),
    fileCount: z.number().int().min(0).nullable(),
    status: z.enum(WORKSPACE_TORRENT_STATUSES),
    error: z.string().nullable().describe('Why the entry failed'),
    source: z
      .enum(WORKSPACE_TORRENT_SOURCES)
      .describe('`download` for a remote download, `stremthru` for an add from a Stremio addon'),
    sourceUri: z.string().describe('The submitted magnet link or torrent URL'),
    playable: z.boolean().describe('Whether its files can be played and downloaded'),
    taskId: z.string().nullable().describe('The download task the entry started, if any'),
    lastPlayedAt: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi('WorkspaceTorrent')

export type WorkspaceTorrent = z.infer<typeof workspaceTorrentSchema>

export const workspaceTorrentFileSchema = z
  .object({
    id: z.string(),
    index: z.number().int().min(0).describe("The file's position in the info dictionary"),
    path: z.string().describe('Path inside the torrent'),
    size: int64(),
    mime: z.string(),
  })
  .openapi('WorkspaceTorrentFile')

export type WorkspaceTorrentFile = z.infer<typeof workspaceTorrentFileSchema>

export const workspaceTorrentDetailSchema = workspaceTorrentSchema
  .extend({
    files: z.array(workspaceTorrentFileSchema).describe("The torrent's own file tree, by index"),
  })
  .openapi('WorkspaceTorrentDetail')

export type WorkspaceTorrentDetail = z.infer<typeof workspaceTorrentDetailSchema>

export const workspaceTorrentFileLinkSchema = z
  .object({
    url: z.string().describe('Presigned URL of the file, valid for 12 hours'),
    expiresAt: z.string(),
  })
  .openapi('WorkspaceTorrentFileLink')

export type WorkspaceTorrentFileLink = z.infer<typeof workspaceTorrentFileLinkSchema>

const folderPathSchema = z
  .string()
  .max(1024)
  .transform((value) =>
    value
      .replace(/\\/g, '/')
      .split('/')
      .map((part) => part.trim())
      .filter((part) => part.length > 0 && part !== '.')
      .join('/'),
  )
  .refine((value) => !value.split('/').includes('..'), { message: 'Folder cannot contain ..' })

export const createWorkspaceTorrentTransferSchema = z
  .object({
    folder: folderPathSchema.describe('Drive folder path to save into; empty for the workspace root'),
  })
  .openapi('CreateWorkspaceTorrentTransfer')

export type CreateWorkspaceTorrentTransferInput = z.infer<typeof createWorkspaceTorrentTransferSchema>

export const workspaceTorrentTransferSchema = z
  .object({
    files: z
      .array(z.object({ id: z.string(), name: z.string(), parent: z.string() }))
      .describe('The drive files written for the torrent’s files (sidecars not included)'),
  })
  .openapi('WorkspaceTorrentTransfer')

export type WorkspaceTorrentTransfer = z.infer<typeof workspaceTorrentTransferSchema>
