// Queueing the two media library jobs. A scan rewrites library.json; a scrape
// matches the library's videos to TMDB and writes sidecars next to them. A scan
// that finds videos to scrape queues a scrape, and a scrape that changes a
// published TMDB id queues a scan, so both processors queue through here. Each
// job holds a per-library lease while queued or running (`scanning` and
// `scraping` on MediaLibraryState).

import type { MediaLibraryScanJobRequest, MediaLibraryScrapeJobRequest } from '@shared/schemas'
import type { BackgroundJob } from '@shared/types'
import type { Deps } from './deps'
import type { ActorIdentity, BackgroundJobMessage, CreateBackgroundJobInput, MediaLibraryView } from './ports'

type MediaLibraryJobRequest = MediaLibraryScanJobRequest | MediaLibraryScrapeJobRequest

export interface MediaLibraryJobOrigin {
  library: MediaLibraryView
  userId: string
  createdBy: ActorIdentity
}

export function scanRequest(library: { id: string }): MediaLibraryScanJobRequest {
  return { type: 'media_library_scan', libraryId: library.id }
}

export function scrapeRequest(library: { id: string }): MediaLibraryScrapeJobRequest {
  return { type: 'media_library_scrape', libraryId: library.id }
}

export function mediaLibraryJobInput(
  library: MediaLibraryView,
  userId: string,
  request: MediaLibraryJobRequest,
): CreateBackgroundJobInput {
  return {
    orgId: library.orgId,
    userId,
    type: request.type,
    targetFolder: library.folder.path,
    metadata: request,
    cancelable: false,
  }
}

export function mediaLibraryJobMessage<R extends MediaLibraryJobRequest>(
  job: BackgroundJob,
  createdBy: ActorIdentity,
  request: R,
): BackgroundJobMessage<R> {
  return { jobId: job.id, orgId: job.orgId, userId: job.userId, createdBy, request }
}

export function enqueueMediaLibraryScan(
  deps: Pick<Deps, 'backgroundJobs' | 'jobQueue'>,
  origin: MediaLibraryJobOrigin,
): Promise<BackgroundJob> {
  return enqueue(deps, origin, scanRequest(origin.library))
}

export function enqueueMediaLibraryScrape(
  deps: Pick<Deps, 'backgroundJobs' | 'jobQueue'>,
  origin: MediaLibraryJobOrigin,
): Promise<BackgroundJob> {
  return enqueue(deps, origin, scrapeRequest(origin.library))
}

async function enqueue(
  deps: Pick<Deps, 'backgroundJobs' | 'jobQueue'>,
  { library, userId, createdBy }: MediaLibraryJobOrigin,
  request: MediaLibraryJobRequest,
): Promise<BackgroundJob> {
  const job = await deps.backgroundJobs.create(mediaLibraryJobInput(library, userId, request))
  await deps.jobQueue.dispatch(mediaLibraryJobMessage(job, createdBy, request))
  return job
}
