import { z } from '@hono/zod-openapi'
import { isSafeHttpUrl } from '../url-safety'

export const downloaderStatusSchema = z.enum(['online', 'offline', 'disabled'])
export const downloaderEngineSchema = z.enum(['http', 'aria2', 'qbittorrent'])
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
  countryCode: z.string().min(2).max(2).optional(),
  regionCode: z.string().min(1).max(16).optional(),
})

const downloadTaskFileSchema = z.object({
  path: z.string().max(1024),
  size: int64Schema(),
  completedBytes: int64Schema().optional(),
  selected: z.boolean().optional(),
})

const downloadTaskTransferProgressSchema = z.object({
  bytes: int64Schema(),
  totalBytes: nullableInt64Schema().optional(),
  bytesPerSecond: int64Schema(),
})

const downloadTaskProgressSchema = z.object({
  download: downloadTaskTransferProgressSchema,
  upload: downloadTaskTransferProgressSchema,
})

const downloadTaskTorrentRuntimeSchema = z.object({
  infoHash: z.string().max(120).optional(),
  name: z.string().max(255).optional(),
  seeders: z.number().int().min(0).optional(),
  leechers: z.number().int().min(0).optional(),
  peers: z.number().int().min(0).optional(),
})

const downloadTaskSeedingRuntimeSchema = z.object({
  enabled: z.boolean().optional(),
  active: z.boolean().optional(),
  uploadedBytes: int64Schema().optional(),
  uploadBytesPerSecond: int64Schema().optional(),
  ratio: z.number().min(0).optional(),
  startedAt: z.string().nullable().optional(),
  expiresAt: z.string().nullable().optional(),
})

export const downloadTaskRuntimeSchema = z.object({
  engine: downloaderEngineSchema.optional(),
  state: z.string().max(80).optional(),
  phase: downloadTaskPhaseSchema.optional(),
  message: z.string().max(500).optional(),
  updatedAt: z.string().optional(),
  progress: downloadTaskProgressSchema.optional(),
  torrent: downloadTaskTorrentRuntimeSchema.optional(),
  seeding: downloadTaskSeedingRuntimeSchema.optional(),
  connections: z.number().int().min(0).optional(),
  etaSeconds: z.number().int().min(0).nullable().optional(),
  trackers: z.array(downloadTaskTrackerSchema).max(20).optional(),
  peers: z.array(downloadTaskPeerSchema).max(20).optional(),
  files: z.array(downloadTaskFileSchema).max(50).optional(),
})

export const downloadTaskSchema = z
  .object({
    id: z.string(),
    orgId: z.string().optional(),
    createdBy: z.string().optional(),
    spec: z.object({
      source: z.object({
        type: downloadSourceTypeSchema,
        uri: z.string(),
      }),
      destination: z.object({
        folder: z.string(),
        name: z.string().nullable(),
      }),
      labels: z.object({
        category: z.string().nullable(),
        tags: z.array(z.string()),
      }),
    }),
    status: z.object({
      state: downloadTaskStatusSchema,
      attempt: z.number().int().min(1),
      assignment: z
        .object({
          downloaderId: z.string(),
          assignedAt: z.string().nullable().optional(),
          uploadToken: z.string().optional(),
        })
        .nullable(),
      progress: downloadTaskProgressSchema,
      billing: z.object({
        state: z.enum(['none', 'ok', 'insufficient_credits']),
        authorizedBytes: int64Schema(),
        chargedBytes: int64Schema(),
        chargedCredits: int64Schema(),
      }),
      output: z.object({ objectId: z.string() }).nullable(),
      runtime: downloadTaskRuntimeSchema.nullable(),
      error: z
        .object({
          code: z.string().max(80).nullable().optional(),
          message: z.string().max(1000).nullable(),
        })
        .nullable(),
      resolveStartedAt: z.string().nullable(),
      resolveCompletedAt: z.string().nullable(),
      downloadCompletedAt: z.string().nullable(),
      ingestStartedAt: z.string().nullable(),
      ingestCompletedAt: z.string().nullable(),
      seedingStartedAt: z.string().nullable(),
      seedingStoppedAt: z.string().nullable(),
      startedAt: z.string().nullable(),
      finishedAt: z.string().nullable(),
      updatedAt: z.string(),
    }),
    createdAt: z.string(),
  })
  .openapi('DownloadTask')

export type DownloadTask = z.infer<typeof downloadTaskSchema>

export const downloadTaskTimelineItemSchema = z
  .object({
    id: z.string(),
    taskId: z.string(),
    time: z.string(),
    source: z.enum(['task', 'activity']),
    action: z.string(),
    title: z.string(),
    detail: z.string().nullable(),
    severity: z.enum(['info', 'success', 'warning', 'error']),
    metadata: z.record(z.string(), z.unknown()).nullable(),
  })
  .openapi('DownloadTaskTimelineItem')

export type DownloadTaskTimelineItem = z.infer<typeof downloadTaskTimelineItemSchema>

export const downloadTaskTimelineSchema = z
  .object({
    items: z.array(downloadTaskTimelineItemSchema),
  })
  .openapi('DownloadTaskTimeline')

export type DownloadTaskTimeline = z.infer<typeof downloadTaskTimelineSchema>

export const downloadTaskPageSchema = z
  .object({
    items: z.array(downloadTaskSchema),
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
  })
  .openapi('DownloadTaskPage')

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

// The wire shape of a downloader, flat — exactly what the API returns. This is
// the single source of truth: the `Downloader` type below is inferred from it,
// the OpenAPI document names it `Downloader`, and the generated SDKs derive from
// it. Heartbeat metrics live at the top level (the repo returns them flat), so
// the schema mirrors that instead of nesting them.
export const downloaderSchema = downloaderHeartbeatResponseSchema
  .extend({
    id: z.string(),
    name: z.string(),
    status: downloaderStatusSchema,
    enabled: z.boolean(),
    remoteDownloadCreditBillingEnabled: z.boolean(),
    remoteDownloadCreditUnitBytes: z.number().int(),
    remoteDownloadCreditPerUnit: z.number().int(),
    lastHeartbeatAt: z.string().nullable(),
    createdBy: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('Downloader')

export type Downloader = z.infer<typeof downloaderSchema>

export const downloaderHeartbeatResultSchema = downloaderSchema
  .extend({
    assignments: z.array(downloadTaskSchema),
    controls: z.array(downloadTaskSchema),
    nextPollAfterSeconds: z.number().int().min(1),
  })
  .openapi('DownloaderHeartbeatResult')

export type DownloaderHeartbeatResult = z.infer<typeof downloaderHeartbeatResultSchema>

export const downloaderListSchema = z.object({
  items: z.array(downloaderSchema),
  total: z.number().int(),
})

export const createDownloaderResponseSchema = z.object({
  downloader: downloaderSchema,
  token: z.string(),
})

export const updateDownloaderSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  enabled: z.boolean().optional(),
  remoteDownloadCreditBillingEnabled: z.boolean().optional(),
  remoteDownloadCreditUnitBytes: z.number().int().positive().optional(),
  remoteDownloadCreditPerUnit: z.number().int().positive().optional(),
})

export const updateDownloaderCreditBillingSchema = z.object({
  enabled: z.boolean(),
  unitBytes: z.number().int().positive(),
  creditsPerUnit: z.number().int().positive(),
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
  source: z
    .object({
      type: downloadSourceTypeSchema,
      uri: downloadUriSchema,
    })
    .superRefine((source, ctx) => {
      if (source.type === 'magnet') {
        if (!/^magnet:\?/i.test(source.uri)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['uri'], message: 'Magnet source must be a magnet: URI' })
        }
        return
      }
      // http and torrent_url both fetch over http(s); block internal/metadata targets (SSRF).
      if (!isSafeHttpUrl(source.uri)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['uri'],
          message: 'URL must be a public http(s) address',
        })
      }
    }),
  targetFolder: targetFolderSchema,
  name: z.string().min(1).max(255).optional(),
  category: downloadTaskCategorySchema.optional(),
  tags: downloadTaskTagsSchema.optional(),
})

export const updateDownloadTaskSchema = z.object({
  status: downloadTaskStatusSchema.optional(),
  progress: downloadTaskProgressSchema.partial().optional(),
  errorMessage: z.string().max(1000).nullable().optional(),
  resultObjectId: z.string().min(1).nullable().optional(),
  runtime: downloadTaskRuntimeSchema.nullable().optional(),
})

export const downloadTaskActionInputSchema = z.object({
  action: downloadTaskActionSchema,
})

// PUT /api/download-tasks/:id/status — pause/resume/cancel a task.
//   paused   → pause      queued → resume      canceled → cancel
export const downloadTaskStatusUpdateSchema = z.object({
  status: z.enum(['paused', 'queued', 'canceled']),
})

// POST /api/download-tasks/:id/attempts — start a new run.
//   fresh:false (default) = retry a failed task; fresh:true = restart from scratch.
export const downloadTaskAttemptSchema = z.object({
  fresh: z.boolean().optional(),
})

export const downloadTaskSortBySchema = z.enum(['createdAt', 'source', 'category', 'tags', 'status', 'progress', 'eta'])

export const listDownloadTasksQuerySchema = z.object({
  status: z.string().optional(),
  assignedTo: z.enum(['me']).optional(),
  category: z.string().trim().min(1).max(120).optional(),
  tag: z.string().trim().min(1).max(80).optional(),
  sortBy: downloadTaskSortBySchema.default('createdAt'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

// Re-presign expired part URLs mid-upload (multipart sessions only). The happy
// path uses the URLs returned by POST /objects; this is the fallback.
export const presignObjectUploadPartsSchema = z.object({
  partNumbers: z.array(z.number().int().min(1).max(10_000)).min(1).max(100),
})

// POST /api/objects/:id/uploads/:sid/completions — finalize the upload.
// Uniform for every file: one entry for a ≤5 GiB single PutObject, N entries for
// a >5 GiB multipart. Each etag comes from the S3 PUT response header.
export const completeObjectUploadSchema = z.object({
  parts: z
    .array(
      z.object({
        partNumber: z.number().int().min(1).max(10_000),
        etag: z.string().min(1),
      }),
    )
    .min(1),
})

export type DownloaderHeartbeatInput = z.infer<typeof downloaderHeartbeatSchema>
export type UpdateDownloaderInput = z.infer<typeof updateDownloaderSchema>
export type UpdateDownloaderCreditBillingInput = z.infer<typeof updateDownloaderCreditBillingSchema>
export type CreateDownloaderInput = z.infer<typeof createDownloaderSchema>
export type CreateDownloadTaskInput = z.infer<typeof createDownloadTaskSchema>
export type UpdateDownloadTaskInput = z.infer<typeof updateDownloadTaskSchema>
export type DownloadTaskActionInput = z.infer<typeof downloadTaskActionInputSchema>
export type ListDownloadTasksQuery = z.infer<typeof listDownloadTasksQuerySchema>
export type DownloadTaskRuntime = z.infer<typeof downloadTaskRuntimeSchema>
export type DownloadTaskSchema = z.infer<typeof downloadTaskSchema>
export type PresignObjectUploadPartsInput = z.infer<typeof presignObjectUploadPartsSchema>
export type CompleteObjectUploadInput = z.infer<typeof completeObjectUploadSchema>
