// Media library scans: the change-detection sweep and the job processor that
// rewrites <library>/library.json. Scans never hook into
// write paths; the sweep compares a cheap subtree fingerprint instead, so
// uploads, WebDAV writes, and downloads into a library are all covered. A
// library whose index is gone is off: the sweep and the scan delete it and
// never recreate the index.

import type { MediaLibraryFeedItem, MediaLibraryScanJobRequest } from '@shared/schemas'
import type { BackgroundJob } from '@shared/types'
import { hasFeature } from '../domain/licensing'
import {
  decideMediaLibrarySweep,
  type MediaLibraryDeleteReason,
  type MediaLibraryFeedSource,
  type MediaLibraryRoot,
  mediaLibraryFeedItems,
  olderOverlappingLibrary,
  serializeMediaLibraryFeed,
  VIDEO_EXTENSIONS,
} from '../domain/media-library'
import { chunk } from '../lib/chunk'
import { formatError } from '../lib/errors'
import type { Deps } from './deps'
import { findMediaLibraryIndex, rewriteMediaLibraryIndex } from './media-library-index'
import { mediaLibraryJobInput, mediaLibraryJobMessage, scanRequest } from './media-library-jobs'
import { enqueueScrapeAfterScan } from './media-library-scrape'
import {
  type ActorIdentity,
  BACKGROUND_JOB_DISPATCH_BATCH_LIMIT,
  type BackgroundJobMessage,
  type BackgroundJobRuntime,
  type Matter,
  type MediaLibraryFileCursor,
  type MediaLibraryState,
  type MediaLibraryView,
  StorageQuotaExceededError,
} from './ports'
import { loadBindingState } from './site/licensing'

const SWEEP_ACTOR: ActorIdentity = { type: 'system', ref: null, issuer: null }

// Files listed per query while the index streams out. Each page binds the same
// parameters and is the most the scan holds in memory.
const SCAN_PAGE_SIZE = 1000
// The scan renews its lease after the first page and then every this many.
const LEASE_RENEWAL_PAGES = 10

// A failure that repeats until the library's files or the workspace change.
// Only these record the attempted fingerprint; any other failure leaves it, so
// the next sweep retries.
class MediaLibraryScanBlockedError extends Error {}

// Runs on the 10-minute cron. Libraries stay in place when the license lapses;
// they just stop being scanned until the instance is entitled again. The cloud
// URL decides which certificate issuer is trusted, as in the licensing refresh.
//
// The sweep's database and queue calls do not grow with the library count, so a
// Workers invocation stays under its subrequest cap: one read for every library,
// one write for all dead ones, and per chunk of changed libraries one job write
// and one queue send. A failed chunk is logged and the others still go out.
export async function sweepMediaLibraries(
  deps: Pick<Deps, 'licenseBinding' | 'licenseCloudBaseUrl' | 'mediaLibraries' | 'backgroundJobs' | 'jobQueue'>,
  options: { cloudBaseUrl: string },
): Promise<void> {
  if (!hasFeature('media_library', await loadBindingState(deps, options))) return

  const dead: Array<{ library: MediaLibraryState; reason: MediaLibraryDeleteReason }> = []
  const changed: MediaLibraryView[] = []
  for (const library of await deps.mediaLibraries.listForSweep()) {
    const decision = decideMediaLibrarySweep(library)
    if (decision.action === 'delete') dead.push({ library, reason: decision.reason })
    if (decision.action === 'scan') changed.push({ ...library, folder: decision.folder })
  }

  if (dead.length > 0) await deleteDeadLibraries(deps, dead)
  for (const libraries of chunk(changed, BACKGROUND_JOB_DISPATCH_BATCH_LIMIT)) {
    await enqueueSweepScans(deps, libraries).catch((error: unknown) => {
      console.error(`media_library.sweep.enqueue_error libraries=${idList(libraries)} code=${formatError(error)}`)
    })
  }
}

async function deleteDeadLibraries(
  deps: Pick<Deps, 'mediaLibraries'>,
  dead: ReadonlyArray<{ library: MediaLibraryState; reason: MediaLibraryDeleteReason }>,
): Promise<void> {
  const libraries = dead.map(({ library }) => library)
  try {
    await deps.mediaLibraries.deleteMany(libraries.map((library) => library.id))
  } catch (error) {
    console.error(`media_library.sweep.delete_error libraries=${idList(libraries)} code=${formatError(error)}`)
    return
  }
  for (const { library, reason } of dead) {
    console.log(`media_library.sweep.deleted library=${library.id} org=${library.orgId} reason=${reason}`)
  }
}

async function enqueueSweepScans(
  deps: Pick<Deps, 'backgroundJobs' | 'jobQueue'>,
  libraries: readonly MediaLibraryView[],
): Promise<void> {
  const jobs = await deps.backgroundJobs.createMany(
    libraries.map((library) => mediaLibraryJobInput(library, library.createdByUserId, scanRequest(library))),
  )
  await deps.jobQueue.dispatchBatch(
    jobs.map((job, i) => mediaLibraryJobMessage(job, SWEEP_ACTOR, scanRequest(libraries[i]))),
  )
}

function idList(libraries: ReadonlyArray<{ id: string }>): string {
  return libraries.map((library) => library.id).join(',')
}

// A completed scan queues a TMDB scrape when the library has videos that need
// one; failing to queue it is logged and leaves the scan completed.
export async function processMediaLibraryScan(
  deps: Deps,
  message: BackgroundJobMessage<MediaLibraryScanJobRequest>,
  runtime: BackgroundJobRuntime,
): Promise<BackgroundJob> {
  const { orgId, jobId } = message
  await deps.backgroundJobs.update(orgId, jobId, { status: 'running', startedAt: new Date() })
  try {
    const { library, index, itemCount } = await scanLibrary(deps, message)
    const job = await deps.backgroundJobs.update(orgId, jobId, {
      status: 'completed',
      progress: { fileCount: itemCount, currentFilename: null },
      resultMetadata: { matterId: index.id, itemCount },
      cancelable: false,
    })
    await enqueueScrapeAfterScan(deps, message, library, runtime).catch((error: unknown) => {
      console.error(
        `media_library.scan.scrape_enqueue_error library=${library.id} org=${orgId} code=${formatError(error)}`,
      )
    })
    return job
  } catch (error) {
    return deps.backgroundJobs.update(orgId, jobId, {
      status: 'failed',
      errorMessage: (error as Error).message,
      retryable: false,
      cancelable: false,
    })
  }
}

async function scanLibrary(
  deps: Deps,
  message: BackgroundJobMessage<MediaLibraryScanJobRequest>,
): Promise<{ library: MediaLibraryView; index: Matter; itemCount: number }> {
  const { orgId } = message
  const library = await deps.mediaLibraries.get(orgId, message.request.libraryId)
  if (!library) throw new Error('Media library not found')
  if (!library.folder) {
    await deps.mediaLibraries.delete(orgId, library.id)
    throw new Error('Media library folder no longer exists')
  }
  if (library.folder.trashed) throw new Error('Media library folder is in trash')
  const { path, name } = library.folder
  const existing = await findMediaLibraryIndex(deps, orgId, path)
  if (!existing) {
    await deps.mediaLibraries.delete(orgId, library.id)
    throw new Error('Media library index was removed, so the library was turned off')
  }

  // Taken before listing: a change that races the listing then shows up as a
  // fingerprint mismatch and triggers one more scan instead of being lost.
  const fingerprint = await deps.mediaLibraries.fingerprint(orgId, library.id, path)
  try {
    await assertNoOlderOverlap(deps, orgId, { id: library.id, createdAt: library.createdAt, path })
    const source = { libraryId: library.id, folderPath: path, folderName: name, generatedAt: new Date() }
    const listed = { items: 0 }
    const feed = serializeMediaLibraryFeed(source, feedItemPages(deps, message, source, listed))
    const index = await writeIndex(deps, message, existing, feed)
    await deps.mediaLibraries.recordScan(orgId, library.id, { fingerprint, scannedAt: new Date() })
    await deps.webdavPath.invalidateFolders(orgId, [path])
    return { library: { ...library, folder: library.folder }, index, itemCount: listed.items }
  } catch (error) {
    if (error instanceof MediaLibraryScanBlockedError) {
      await deps.mediaLibraries.recordScan(orgId, library.id, { fingerprint })
    }
    throw error
  }
}

// Pages the library's videos into feed items as the upload pulls them, and
// renews the scan lease on the way: writing a large library can outlast it.
async function* feedItemPages(
  deps: Pick<Deps, 'mediaLibraries' | 'backgroundJobs'>,
  message: BackgroundJobMessage,
  source: MediaLibraryFeedSource,
  listed: { items: number },
): AsyncGenerator<MediaLibraryFeedItem[]> {
  const { orgId, jobId } = message
  let after: MediaLibraryFileCursor | null = null
  for (let page = 0; ; page++) {
    const files = await deps.mediaLibraries.listVideoFilesPage(orgId, source.folderPath, VIDEO_EXTENSIONS, {
      after,
      limit: SCAN_PAGE_SIZE,
    })
    const items = mediaLibraryFeedItems(source, files)
    listed.items += items.length
    if (page % LEASE_RENEWAL_PAGES === 0) {
      await deps.backgroundJobs.update(orgId, jobId, { progress: { fileCount: listed.items, currentFilename: null } })
    }
    yield items
    if (files.length < SCAN_PAGE_SIZE) return
    after = files[files.length - 1]
  }
}

async function assertNoOlderOverlap(
  deps: Pick<Deps, 'mediaLibraries'>,
  orgId: string,
  library: MediaLibraryRoot,
): Promise<void> {
  const liveLibraries = (await deps.mediaLibraries.listByOrg(orgId)).flatMap((other) =>
    other.folder && !other.folder.trashed
      ? [{ id: other.id, createdAt: other.createdAt, path: other.folder.path }]
      : [],
  )
  const older = olderOverlappingLibrary(library, liveLibraries)
  if (older) {
    throw new MediaLibraryScanBlockedError(`Media library overlaps the older media library at "${older.path}"`)
  }
}

async function writeIndex(
  deps: Deps,
  message: BackgroundJobMessage,
  existing: Matter,
  feed: AsyncIterable<string>,
): Promise<Matter> {
  const storage = await deps.storages.get(existing.storageId)
  if (!storage) throw new MediaLibraryScanBlockedError('Storage for the media library index not found')
  return rewriteMediaLibraryIndex(deps, message, storage, existing, feed).catch((error: unknown) => {
    throw error instanceof StorageQuotaExceededError
      ? new MediaLibraryScanBlockedError('Quota exceeded for the media library index')
      : error
  })
}
