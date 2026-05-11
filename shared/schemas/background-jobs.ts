import { z } from 'zod'

export const backgroundJobStatusSchema = z.enum(['queued', 'running', 'completed', 'failed', 'canceled'])
export type BackgroundJobStatusInput = z.infer<typeof backgroundJobStatusSchema>

export const backgroundJobTypeSchema = z.string().min(1).max(80)
export type BackgroundJobTypeInput = z.infer<typeof backgroundJobTypeSchema>

export const listBackgroundJobsQuerySchema = z.object({
  status: backgroundJobStatusSchema.optional(),
  type: backgroundJobTypeSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export type ListBackgroundJobsQuery = z.infer<typeof listBackgroundJobsQuerySchema>
