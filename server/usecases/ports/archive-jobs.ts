import type { CreateBackgroundJobRequest } from '@shared/schemas'

export interface ArchiveJobMessage {
  jobId: string
  orgId: string
  userId: string
  request: CreateBackgroundJobRequest
}

export interface ArchiveJobsGateway {
  // Hand a job off for asynchronous processing: a queue binding when present,
  // otherwise an in-process worker that drains on the next tick.
  dispatch(message: ArchiveJobMessage): Promise<void>
  // Process a single queued message synchronously (the queue consumer entrypoint).
  runMessage(message: ArchiveJobMessage): Promise<void>
}
