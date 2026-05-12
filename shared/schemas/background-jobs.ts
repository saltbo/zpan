import { z } from 'zod'

export const backgroundJobStatusSchema = z.enum(['queued', 'running', 'completed', 'failed', 'canceled'])
export type BackgroundJobStatusInput = z.infer<typeof backgroundJobStatusSchema>

export const backgroundJobTypeSchema = z.string().min(1).max(80)
export type BackgroundJobTypeInput = z.infer<typeof backgroundJobTypeSchema>

const matterIdSchema = z.string().min(1)

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

export const createBackgroundJobRequestSchema = z.discriminatedUnion('type', [
  archiveCompressJobRequestSchema,
  archiveExtractJobRequestSchema,
])

export type ArchiveCompressJobRequest = z.infer<typeof archiveCompressJobRequestSchema>
export type ArchiveExtractJobRequest = z.infer<typeof archiveExtractJobRequestSchema>
export type CreateBackgroundJobRequest = z.infer<typeof createBackgroundJobRequestSchema>

export const listBackgroundJobsQuerySchema = z.object({
  status: backgroundJobStatusSchema.optional(),
  type: backgroundJobTypeSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export type ListBackgroundJobsQuery = z.infer<typeof listBackgroundJobsQuerySchema>
