import { z } from '@hono/zod-openapi'

export const downloaderStatusSchema = z.enum(['online', 'offline', 'disabled'])
export const downloaderEngineSchema = z.enum(['builtin', 'aria2', 'qbittorrent'])
export const downloadTaskStatusSchema = z.enum([
  'queued',
  'assigned',
  'downloading',
  'suspended',
  'pausing',
  'paused',
  'interrupted',
  'uploading',
  'canceling',
  'completed',
  'failed',
  'canceled',
])
export const downloadTaskActionSchema = z.enum(['pause', 'resume', 'cancel', 'retry', 'restart', 'delete'])
export const downloadSourceTypeSchema = z.enum(['http', 'magnet', 'torrent_url'])
export const downloadTaskPhaseSchema = z.enum(['metadata', 'downloading', 'uploading', 'seeding', 'completed', 'error'])

const int64Schema = () => z.number().int().min(0).openapi({ type: 'integer', format: 'int64' })
const nullableInt64Schema = () =>
  z
    .number()
    .int()
    .min(0)
    .nullable()
    .openapi({ type: 'integer', format: 'int64', nullable: true } as never)

const downloadTaskTrackerSchema = z.object({
  url: z.string().max(1024),
  status: z.string().max(80).optional(),
  peers: z.number().int().min(0).optional(),
  seeds: z.number().int().min(0).optional(),
  leechers: z.number().int().min(0).optional(),
  message: z.string().max(500).optional(),
})

const downloadTaskPeerSchema = z.object({
  address: z.string().max(160),
  client: z.string().max(160).optional(),
  progress: z.number().min(0).max(1).optional(),
  downloadBps: int64Schema().optional(),
  uploadBps: int64Schema().optional(),
})

const downloadTaskFileSchema = z.object({
  path: z.string().max(1024),
  size: int64Schema(),
  completedBytes: int64Schema().optional(),
  selected: z.boolean().optional(),
})

export const downloadTaskDetailSchema = z.object({
  engine: downloaderEngineSchema.optional(),
  phase: downloadTaskPhaseSchema.optional(),
  engineState: z.string().max(80).optional(),
  message: z.string().max(500).optional(),
  etaSeconds: z.number().int().min(0).nullable().optional(),
  connections: z.number().int().min(0).optional(),
  infoHash: z.string().max(120).optional(),
  torrentName: z.string().max(255).optional(),
  seeders: z.number().int().min(0).optional(),
  leechers: z.number().int().min(0).optional(),
  peers: z.number().int().min(0).optional(),
  peerUploadedBytes: int64Schema().optional(),
  peerUploadBps: int64Schema().optional(),
  trackers: z.array(downloadTaskTrackerSchema).max(20).optional(),
  peerSamples: z.array(downloadTaskPeerSchema).max(20).optional(),
  files: z.array(downloadTaskFileSchema).max(50).optional(),
})

export const downloadTaskSchema = z.object({
  id: z.string(),
  sourceType: downloadSourceTypeSchema,
  sourceUri: z.string(),
  name: z.string(),
  targetFolder: z.string(),
  category: z.string().nullable(),
  tags: z.array(z.string()),
  status: downloadTaskStatusSchema,
  downloadedBytes: int64Schema(),
  storageUploadedBytes: int64Schema(),
  totalBytes: nullableInt64Schema(),
  downloadBps: int64Schema(),
  storageUploadBps: int64Schema(),
  errorMessage: z.string().nullable().optional(),
  resultObjectId: z.string().nullable().optional(),
  detail: downloadTaskDetailSchema.nullable().optional(),
  uploadToken: z.string().optional(),
  assignedDownloaderId: z.string().nullable().optional(),
})

export const downloadTaskPageSchema = z.object({
  items: z.array(downloadTaskSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
})

export const downloaderHeartbeatSchema = z.object({
  version: z.string().min(1).max(80),
  hostname: z.string().min(1).max(160),
  platform: z.string().min(1).max(80),
  arch: z.string().min(1).max(40),
  engine: downloaderEngineSchema,
  capabilities: z.array(z.string().min(1).max(80)).max(32),
  maxConcurrentTasks: z.number().int().min(1).max(100),
  currentTasks: z.number().int().min(0).max(100),
  downloadBps: int64Schema().default(0),
  uploadBps: int64Schema().default(0),
  freeDiskBytes: int64Schema().default(0),
})

export const downloaderHeartbeatResponseSchema = z.object({
  version: z.string(),
  hostname: z.string(),
  platform: z.string(),
  arch: z.string(),
  engine: downloaderEngineSchema,
  capabilities: z.array(z.string()),
  maxConcurrentTasks: z.number().int(),
  currentTasks: z.number().int(),
  downloadBps: int64Schema(),
  uploadBps: int64Schema(),
  freeDiskBytes: int64Schema(),
})

export const downloaderSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  status: downloaderStatusSchema.optional(),
  enabled: z.boolean().optional(),
  heartbeat: downloaderHeartbeatResponseSchema.optional(),
})

export const downloaderListSchema = z.object({
  items: z.array(downloaderSchema),
  total: z.number().int(),
})

export const createDownloaderResponseSchema = z.object({
  downloader: downloaderSchema,
  token: z.string(),
})

export const deleteDownloaderResponseSchema = z.object({
  id: z.string(),
  deleted: z.boolean(),
})

export const updateDownloaderSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  enabled: z.boolean().optional(),
  remoteDownloadCreditBillingEnabled: z.boolean().optional(),
  remoteDownloadCreditUnitBytes: z.number().int().positive().optional(),
  remoteDownloadCreditPerUnit: z.number().int().positive().optional(),
})

export const createDownloaderSchema = z.object({
  name: z.string().min(1).max(120),
  heartbeat: downloaderHeartbeatSchema,
})

const downloadUriSchema = z.string().min(1).max(4096)
const downloadTaskCategorySchema = z.string().trim().min(1).max(120)
const downloadTaskTagsSchema = z.array(z.string().trim().min(1).max(80)).max(20)
const targetFolderSchema = z
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
  .refine((value) => !value.split('/').includes('..'), { message: 'Target folder cannot contain ..' })

export const createDownloadTaskSchema = z.object({
  source: z.object({
    type: downloadSourceTypeSchema,
    uri: downloadUriSchema,
  }),
  targetFolder: targetFolderSchema,
  name: z.string().min(1).max(255).optional(),
  category: downloadTaskCategorySchema.optional(),
  tags: downloadTaskTagsSchema.optional(),
})

export const updateDownloadTaskSchema = z.object({
  status: downloadTaskStatusSchema.optional(),
  downloadedBytes: int64Schema().optional(),
  storageUploadedBytes: int64Schema().optional(),
  totalBytes: nullableInt64Schema().optional(),
  downloadBps: int64Schema().optional(),
  storageUploadBps: int64Schema().optional(),
  errorMessage: z.string().max(1000).nullable().optional(),
  resultObjectId: z.string().min(1).nullable().optional(),
  detail: downloadTaskDetailSchema.nullable().optional(),
})

export const downloadTaskActionInputSchema = z.object({
  action: downloadTaskActionSchema,
})

export const downloadTaskSortBySchema = z.enum(['createdAt', 'source', 'category', 'tags', 'status', 'progress', 'eta'])

export const listDownloadTasksQuerySchema = z.object({
  status: downloadTaskStatusSchema.optional(),
  assignedTo: z.enum(['me']).optional(),
  category: z.string().trim().min(1).max(120).optional(),
  tag: z.string().trim().min(1).max(80).optional(),
  sortBy: downloadTaskSortBySchema.default('createdAt'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export const objectUploadActionSchema = z.enum(['complete', 'abort'])

export const createObjectUploadSessionSchema = z.object({
  partSize: z
    .number()
    .int()
    .min(5 * 1024 * 1024)
    .max(512 * 1024 * 1024)
    .optional(),
})

export const presignObjectUploadPartsSchema = z.object({
  partNumbers: z.array(z.number().int().min(1).max(10_000)).min(1).max(100),
})

export const patchObjectUploadSessionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('complete'),
    parts: z
      .array(
        z.object({
          partNumber: z.number().int().min(1).max(10_000),
          etag: z.string().min(1),
        }),
      )
      .min(1),
  }),
  z.object({
    action: z.literal('abort'),
  }),
])

export type DownloaderHeartbeatInput = z.infer<typeof downloaderHeartbeatSchema>
export type UpdateDownloaderInput = z.infer<typeof updateDownloaderSchema>
export type CreateDownloaderInput = z.infer<typeof createDownloaderSchema>
export type CreateDownloadTaskInput = z.infer<typeof createDownloadTaskSchema>
export type UpdateDownloadTaskInput = z.infer<typeof updateDownloadTaskSchema>
export type DownloadTaskActionInput = z.infer<typeof downloadTaskActionInputSchema>
export type ListDownloadTasksQuery = z.infer<typeof listDownloadTasksQuerySchema>
export type DownloadTaskDetail = z.infer<typeof downloadTaskDetailSchema>
export type DownloadTaskSchema = z.infer<typeof downloadTaskSchema>
export type CreateObjectUploadSessionInput = z.infer<typeof createObjectUploadSessionSchema>
export type PresignObjectUploadPartsInput = z.infer<typeof presignObjectUploadPartsSchema>
export type PatchObjectUploadSessionInput = z.infer<typeof patchObjectUploadSessionSchema>
