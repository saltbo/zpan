import type { BackgroundJobRequest } from '@shared/schemas'
import type { ActorIdentity } from './audit'

export interface BackgroundJobMessage<R extends BackgroundJobRequest = BackgroundJobRequest> {
  jobId: string
  orgId: string
  userId: string
  createdBy: ActorIdentity
  request: R
}

// Cloudflare Queues takes at most 100 messages per sendBatch call.
export const BACKGROUND_JOB_DISPATCH_BATCH_LIMIT = 100

export interface BackgroundJobQueue {
  // Hand a job off for asynchronous processing: a queue binding when present,
  // otherwise an in-process worker that drains on the next tick.
  dispatch(message: BackgroundJobMessage): Promise<void>
  // One queue call for up to BACKGROUND_JOB_DISPATCH_BATCH_LIMIT messages.
  dispatchBatch(messages: readonly BackgroundJobMessage[]): Promise<void>
}
