import { z } from 'zod'

export const downloaderStatusSchema = z.enum(['online', 'offline', 'disabled'])
export const downloaderEngineSchema = z.enum(['builtin', 'aria2', 'qbittorrent'])
export const downloadTaskStatusSchema = z.enum([
  'queued',
  'assigned',
  'running',
  'billing_paused',
  'uploading',
  'completed',
  'failed',
  'canceled',
])
export const downloadSourceTypeSchema = z.enum(['http', 'magnet', 'torrent_url'])

export const downloaderHeartbeatSchema = z.object({
  version: z.string().min(1).max(80),
  hostname: z.string().min(1).max(160),
  platform: z.string().min(1).max(80),
  arch: z.string().min(1).max(40),
  engine: downloaderEngineSchema,
  capabilities: z.array(z.string().min(1).max(80)).max(32),
  maxConcurrentTasks: z.number().int().min(1).max(100),
  currentTasks: z.number().int().min(0).max(100),
  downloadBps: z.number().int().min(0).default(0),
  uploadBps: z.number().int().min(0).default(0),
  freeDiskBytes: z.number().int().min(0).default(0),
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

export const createDownloadTaskSchema = z.object({
  source: z.object({
    type: downloadSourceTypeSchema,
    uri: downloadUriSchema,
  }),
  targetFolder: z.string(),
  name: z.string().min(1).max(255).optional(),
})

export const updateDownloadTaskSchema = z.object({
  status: downloadTaskStatusSchema.optional(),
  downloadedBytes: z.number().int().min(0).optional(),
  totalBytes: z.number().int().min(0).nullable().optional(),
  downloadBps: z.number().int().min(0).optional(),
  uploadBps: z.number().int().min(0).optional(),
  errorMessage: z.string().max(1000).nullable().optional(),
  resultObjectId: z.string().min(1).nullable().optional(),
})

export const listDownloadTasksQuerySchema = z.object({
  status: downloadTaskStatusSchema.optional(),
  assignedTo: z.enum(['me']).optional(),
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
export type ListDownloadTasksQuery = z.infer<typeof listDownloadTasksQuerySchema>
export type CreateObjectUploadSessionInput = z.infer<typeof createObjectUploadSessionSchema>
export type PresignObjectUploadPartsInput = z.infer<typeof presignObjectUploadPartsSchema>
export type PatchObjectUploadSessionInput = z.infer<typeof patchObjectUploadSessionSchema>
