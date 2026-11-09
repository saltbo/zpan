// The background-jobs resource usecase (/api/background-jobs). Owns every
// port call behind the routes: enqueue + dispatch on create, the list/get/cancel
// reads, and the retry-then-redispatch flow that re-parses a job's stored request
// so a fresh attempt rides the same pipeline. runBackgroundJob is the consumer
// side: it routes a dequeued message to the processor for its job type.
//
// BackgroundJobError is thrown by the repo (not_found / not_cancelable /
// not_retryable) and propagates through these functions untouched; the http
// handler catches it and maps the code to a status. Org/user resolution stays in
// the handler as input parsing.

import type { BackgroundJobRequest, CreateBackgroundJobRequest } from '@shared/schemas'
import { backgroundJobRequestSchema } from '@shared/schemas'
import type { BackgroundJob } from '@shared/types'
import { enqueueArchiveJob, processArchiveJob } from './archive-processing'
// create dispatches on top of enqueueArchiveJob, which reaches across the archive
// ports, so it forwards the whole Deps; the reads need only the narrow ports.
import type { Deps } from './deps'
import type { ActorIdentity, BackgroundJobMessage, ListBackgroundJobsOptions } from './ports'

type JobType = BackgroundJobRequest['type']
type JobProcessor<T extends JobType> = (
  deps: Deps,
  message: BackgroundJobMessage<Extract<BackgroundJobRequest, { type: T }>>,
) => Promise<unknown>

const JOB_PROCESSORS: { [T in JobType]: JobProcessor<T> } = {
  archive_compress: processArchiveJob,
  archive_extract: processArchiveJob,
}

export async function runBackgroundJob(deps: Deps, message: BackgroundJobMessage): Promise<void> {
  const process = JOB_PROCESSORS[message.request.type] as JobProcessor<JobType>
  await process(deps, message)
}

export function listBackgroundJobs(deps: Pick<Deps, 'backgroundJobs'>, orgId: string, opts: ListBackgroundJobsOptions) {
  return deps.backgroundJobs.list(orgId, opts)
}

export async function getActiveBackgroundJobCount(deps: Pick<Deps, 'backgroundJobs'>, orgId: string): Promise<number> {
  return (await deps.backgroundJobs.activeSummary(orgId)).count
}

export function getBackgroundJob(
  deps: Pick<Deps, 'backgroundJobs'>,
  orgId: string,
  id: string,
): Promise<BackgroundJob> {
  return deps.backgroundJobs.get(orgId, id)
}

export function cancelBackgroundJob(
  deps: Pick<Deps, 'backgroundJobs'>,
  orgId: string,
  id: string,
): Promise<BackgroundJob> {
  return deps.backgroundJobs.cancel(orgId, id)
}

export async function createBackgroundJob(
  deps: Deps,
  params: { orgId: string; userId: string; createdBy: ActorIdentity; request: CreateBackgroundJobRequest },
): Promise<BackgroundJob> {
  const { orgId, userId, createdBy, request } = params
  const job = await enqueueArchiveJob(deps, { orgId, userId, request })
  await deps.jobQueue.dispatch({ orgId, userId, createdBy, request, jobId: job.id })
  return job
}

export async function retryBackgroundJob(
  deps: Pick<Deps, 'backgroundJobs' | 'jobQueue'>,
  orgId: string,
  id: string,
  createdBy: ActorIdentity,
): Promise<BackgroundJob> {
  const job = await deps.backgroundJobs.retry(orgId, id)
  const request = backgroundJobRequestSchema.safeParse(job.metadata)
  if (request.success) {
    await deps.jobQueue.dispatch({ orgId, userId: job.userId, createdBy, request: request.data, jobId: job.id })
  }
  return job
}
