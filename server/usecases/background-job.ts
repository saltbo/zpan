// The background-jobs resource usecase (/api/background-jobs). Owns every
// port call behind the routes: enqueue + dispatch on create, the list/get/cancel
// reads, and the retry-then-redispatch flow that re-parses a job's stored request
// so a fresh attempt rides the same archive pipeline.
//
// BackgroundJobError is thrown by the repo (not_found / not_cancelable /
// not_retryable) and propagates through these functions untouched; the http
// handler catches it and maps the code to a status. Org/user resolution stays in
// the handler as input parsing.

import type { CreateBackgroundJobRequest } from '@shared/schemas'
import { createBackgroundJobRequestSchema } from '@shared/schemas'
import type { BackgroundJob } from '@shared/types'
import { enqueueArchiveJob } from './archive-processing'
// create dispatches on top of enqueueArchiveJob, which reaches across the archive
// ports, so it forwards the whole Deps; the reads need only the narrow ports.
import type { Deps } from './deps'
import type { ListBackgroundJobsOptions } from './ports'

type ListResult = { items: BackgroundJob[]; total: number }

export function listBackgroundJobs(
  deps: Pick<Deps, 'backgroundJobs'>,
  orgId: string,
  opts: ListBackgroundJobsOptions,
): Promise<ListResult> {
  return deps.backgroundJobs.list(orgId, opts)
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
  params: { orgId: string; userId: string; request: CreateBackgroundJobRequest },
): Promise<BackgroundJob> {
  const { orgId, userId, request } = params
  const job = await enqueueArchiveJob(deps, { orgId, userId, request })
  await deps.archiveJobs.dispatch({ orgId, userId, request, jobId: job.id })
  return job
}

export async function retryBackgroundJob(
  deps: Pick<Deps, 'backgroundJobs' | 'archiveJobs'>,
  orgId: string,
  id: string,
): Promise<BackgroundJob> {
  const job = await deps.backgroundJobs.retry(orgId, id)
  const request = createBackgroundJobRequestSchema.safeParse(job.metadata)
  if (request.success) {
    await deps.archiveJobs.dispatch({ orgId, userId: job.userId, request: request.data, jobId: job.id })
  }
  return job
}
