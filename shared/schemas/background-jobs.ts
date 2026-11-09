import { z } from 'zod'
import { opaqueIdSchema } from './id'

export const backgroundJobStatusSchema = z.enum(['queued', 'running', 'completed', 'failed', 'canceled'])
export type BackgroundJobStatusInput = z.infer<typeof backgroundJobStatusSchema>

export const backgroundJobTypeSchema = z.string().min(1).max(80)
export type BackgroundJobTypeInput = z.infer<typeof backgroundJobTypeSchema>

const matterIdSchema = opaqueIdSchema

export const archiveCompressJobRequestSchema = z.object({
  type: z.literal('archive_compress'),
  matterIds: z.array(matterIdSchema).min(1).max(200),
  targetFolder: z.string().optional(),
  outputName: z.string().min(1).max(255).optional(),
})

export const archiveExtractJobRequestSchema = z.object({
  type: z.literal('archive_extract'),
  matterId: matterIdSchema,
  targetFolder: z.string().optional(),
})

export const mediaLibraryScanJobRequestSchema = z.object({
  type: z.literal('media_library_scan'),
  libraryId: opaqueIdSchema,
})

export const mediaLibraryScrapeJobRequestSchema = z.object({
  type: z.literal('media_library_scrape'),
  libraryId: opaqueIdSchema,
  // Carried by the messages that continue a scrape after a batch: where the next
  // batch starts and what earlier batches did. A stored job never has it.
  resume: z
    .object({
      after: z.object({ parent: z.string(), name: z.string() }).nullable(),
      processed: z.number().int().nonnegative(),
      matched: z.number().int().nonnegative(),
      changed: z.number().int().nonnegative(),
    })
    .optional(),
})

// The job types a client may create through POST /api/background-jobs.
export const createBackgroundJobRequestSchema = z.discriminatedUnion('type', [
  archiveCompressJobRequestSchema,
  archiveExtractJobRequestSchema,
])

// Every request a queued job can carry. Media library scans and scrapes are
// created through /api/media-libraries and the media library jobs, never through
// the generic jobs endpoint.
export const backgroundJobRequestSchema = z.discriminatedUnion('type', [
  archiveCompressJobRequestSchema,
  archiveExtractJobRequestSchema,
  mediaLibraryScanJobRequestSchema,
  mediaLibraryScrapeJobRequestSchema,
])

export type ArchiveCompressJobRequest = z.infer<typeof archiveCompressJobRequestSchema>
export type ArchiveExtractJobRequest = z.infer<typeof archiveExtractJobRequestSchema>
export type CreateBackgroundJobRequest = z.infer<typeof createBackgroundJobRequestSchema>
export type MediaLibraryScanJobRequest = z.infer<typeof mediaLibraryScanJobRequestSchema>
export type MediaLibraryScrapeJobRequest = z.infer<typeof mediaLibraryScrapeJobRequestSchema>
export type BackgroundJobRequest = z.infer<typeof backgroundJobRequestSchema>

export const listBackgroundJobsQuerySchema = z.object({
  status: backgroundJobStatusSchema.optional(),
  type: backgroundJobTypeSchema.optional(),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  pageToken: z.string().min(1).optional(),
})

export type ListBackgroundJobsQuery = z.infer<typeof listBackgroundJobsQuerySchema>
