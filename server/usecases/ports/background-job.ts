import type { BackgroundJob, BackgroundJobProgress, BackgroundJobStatus, BackgroundJobType } from '@shared/types'

export type BackgroundJobMetadata = Record<string, unknown>

export type CreateBackgroundJobInput = {
  orgId: string
  userId: string
  type: BackgroundJobType
  targetFolder?: string | null
  targetPath?: string | null
  metadata?: BackgroundJobMetadata | null
  progress?: Partial<BackgroundJobProgress>
  retryable?: boolean
  cancelable?: boolean
}

export type ListBackgroundJobsOptions = {
  status?: BackgroundJobStatus
  type?: string
  page: number
  pageSize: number
}

export type UpdateBackgroundJobInput = {
  status?: BackgroundJobStatus
  progress?: Partial<BackgroundJobProgress>
  errorMessage?: string | null
  resultMetadata?: BackgroundJobMetadata | null
  retryable?: boolean
  cancelable?: boolean
  startedAt?: Date | null
  finishedAt?: Date | null
}

export class BackgroundJobError extends Error {
  constructor(
    readonly code: 'not_found' | 'not_cancelable' | 'not_retryable',
    message = code,
  ) {
    super(message)
    this.name = 'BackgroundJobError'
  }
}

export interface BackgroundJobRepo {
  create(input: CreateBackgroundJobInput): Promise<BackgroundJob>
  list(orgId: string, opts: ListBackgroundJobsOptions): Promise<{ items: BackgroundJob[]; total: number }>
  get(orgId: string, id: string): Promise<BackgroundJob>
  update(orgId: string, id: string, input: UpdateBackgroundJobInput): Promise<BackgroundJob>
  cancel(orgId: string, id: string): Promise<BackgroundJob>
  retry(orgId: string, id: string): Promise<BackgroundJob>
}
