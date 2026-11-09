import type { BackgroundJobRequest } from '@shared/schemas'
import type { ActorIdentity } from './audit'

export interface BackgroundJobMessage<R extends BackgroundJobRequest = BackgroundJobRequest> {
  jobId: string
  orgId: string
  userId: string
  createdBy: ActorIdentity
  request: R
}

export interface BackgroundJobQueue {
  // Hand a job off for asynchronous processing: a queue binding when present,
  // otherwise an in-process worker that drains on the next tick.
  dispatch(message: BackgroundJobMessage): Promise<void>
}
