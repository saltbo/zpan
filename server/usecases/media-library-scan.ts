// Media library scans: enqueueing, the change-detection sweep, and the job
// processor that rewrites <library>/library.json. Scans never hook into
// write paths; the sweep compares a cheap subtree fingerprint instead, so
// uploads, WebDAV writes, and downloads into a library are all covered. A
// library whose index is gone is off: the sweep and the scan delete it and
// never recreate the index.

import type { MediaLibraryFeed, MediaLibraryScanJobRequest } from '@shared/schemas'
import type { BackgroundJob } from '@shared/types'
import { hasFeature } from '../domain/licensing'
import {
  buildMediaLibraryFeed,
  type MediaLibraryRoot,
  olderOverlappingLibrary,
  VIDEO_EXTENSIONS,
} from '../domain/media-library'
import { formatError } from '../lib/errors'
import type { Deps } from './deps'
import { findMediaLibraryIndex, rewriteMediaLibraryIndex } from './media-library-index'
import {
  type ActorIdentity,
  type BackgroundJobMessage,
  type Matter,
  type MediaLibraryState,
  type MediaLibraryView,
  StorageQuotaExceededError,
} from './ports'
import { loadBindingState } from './site/licensing'

const SWEEP_ACTOR: ActorIdentity = { type: 'system', ref: null, issuer: null }

// A failure that repeats until the library's files or the workspace change.
// Only these record the attempted fingerprint; any other failure leaves it, so
// the next sweep retries.
class MediaLibraryScanBlockedError extends Error {}

export async function enqueueMediaLibraryScan(
  deps: Pick<Deps, 'backgroundJobs' | 'jobQueue'>,
  input: { library: MediaLibraryView; userId: string; createdBy: ActorIdentity },
): Promise<BackgroundJob> {
  const { library, userId, createdBy } = input
  const request: MediaLibraryScanJobRequest = { type: 'media_library_scan', libraryId: library.id }
  const job = await deps.backgroundJobs.create({
    orgId: library.orgId,
    userId,
    type: request.type,
    targetFolder: library.folder.path,
    metadata: request,
    cancelable: false,
  })
  await deps.jobQueue.dispatch({ jobId: job.id, orgId: library.orgId, userId, createdBy, request })
  return job
}

// Runs on the 10-minute cron. Libraries stay in place when the license lapses;
// they just stop being scanned until the instance is entitled again. The cloud
// URL decides which certificate issuer is trusted, as in the licensing refresh.
export async function sweepMediaLibraries(
  deps: Pick<Deps, 'licenseBinding' | 'mediaLibraries' | 'matter' | 'backgroundJobs' | 'jobQueue'>,
  options: { cloudBaseUrl: string },
): Promise<void> {
  if (!hasFeature('media_library', await loadBindingState(deps, options))) return

  for (const library of await deps.mediaLibraries.listAll()) {
    // One library's failure must not stop the sweep for the rest.
    await sweepLibrary(deps, library).catch((error: unknown) => {
      console.error(
        `media_library.sweep.library_error library=${library.id} org=${library.orgId} code=${formatError(error)}`,
      )
    })
  }
}

async function sweepLibrary(
  deps: Pick<Deps, 'mediaLibraries' | 'matter' | 'backgroundJobs' | 'jobQueue'>,
  library: MediaLibraryState,
): Promise<void> {
  const { folder } = library
  if (!folder) {
    await deps.mediaLibraries.delete(library.orgId, library.id)
    console.log(`media_library.sweep.deleted library=${library.id} org=${library.orgId} reason=folder_purged`)
    return
  }
  if (folder.trashed) return
  if (!(await findMediaLibraryIndex(deps, library.orgId, folder.path))) {
    await deps.mediaLibraries.delete(library.orgId, library.id)
    console.log(`media_library.sweep.deleted library=${library.id} org=${library.orgId} reason=index_removed`)
    return
  }
  if (library.scanning) return
  const fingerprint = await deps.mediaLibraries.fingerprint(library.orgId, folder.path)
  if (fingerprint === library.fingerprint) return
  await enqueueMediaLibraryScan(deps, {
    library: { ...library, folder },
    userId: library.createdByUserId,
    createdBy: SWEEP_ACTOR,
  })
}

export async function processMediaLibraryScan(
  deps: Deps,
  message: BackgroundJobMessage<MediaLibraryScanJobRequest>,
): Promise<BackgroundJob> {
  const { orgId, jobId } = message
  await deps.backgroundJobs.update(orgId, jobId, { status: 'running', startedAt: new Date() })
  try {
    const { index, itemCount } = await scanLibrary(deps, message)
    return await deps.backgroundJobs.update(orgId, jobId, {
      status: 'completed',
      progress: { fileCount: itemCount, currentFilename: null },
      resultMetadata: { matterId: index.id, itemCount },
      cancelable: false,
    })
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
): Promise<{ index: Matter; itemCount: number }> {
  const { orgId, jobId } = message
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
  const fingerprint = await deps.mediaLibraries.fingerprint(orgId, path)
  try {
    await assertNoOlderOverlap(deps, orgId, { id: library.id, createdAt: library.createdAt, path })
    const files = await deps.mediaLibraries.listVideoFiles(orgId, path, VIDEO_EXTENSIONS)
    // Renews the scan lease: a listing of a large library can outlast it.
    await deps.backgroundJobs.update(orgId, jobId, { progress: { fileCount: files.length, currentFilename: null } })
    const feed = buildMediaLibraryFeed({
      libraryId: library.id,
      folderPath: path,
      folderName: name,
      files,
      generatedAt: new Date(),
    })
    const index = await writeIndex(deps, message, existing, feed)
    await deps.mediaLibraries.recordScan(orgId, library.id, { fingerprint, scannedAt: new Date() })
    await deps.webdavPath.invalidateFolders(orgId, [path])
    return { index, itemCount: feed.items.length }
  } catch (error) {
    if (error instanceof MediaLibraryScanBlockedError) {
      await deps.mediaLibraries.recordScan(orgId, library.id, { fingerprint })
    }
    throw error
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
  feed: MediaLibraryFeed,
): Promise<Matter> {
  const storage = await deps.storages.get(existing.storageId)
  if (!storage) throw new MediaLibraryScanBlockedError('Storage for the media library index not found')
  return rewriteMediaLibraryIndex(deps, message, storage, existing, feed).catch((error: unknown) => {
    throw error instanceof StorageQuotaExceededError
      ? new MediaLibraryScanBlockedError('Quota exceeded for the media library index')
      : error
  })
}
