// Media library scans: enqueueing, the change-detection sweep, and the job
// processor that writes <library>/.zpan/library.json. Scans never hook into
// write paths; the sweep compares a cheap subtree fingerprint instead, so
// uploads, WebDAV writes, and downloads into a library are all covered.

import { DirType, ObjectStatus } from '@shared/constants'
import type { MediaLibraryScanJobRequest } from '@shared/schemas'
import type { BackgroundJob } from '@shared/types'
import { hasFeature } from '../domain/licensing'
import {
  buildMediaLibraryFeed,
  joinMatterPath,
  MEDIA_LIBRARY_INDEX_FILE,
  MEDIA_LIBRARY_INDEX_FOLDER,
  MEDIA_LIBRARY_INDEX_MIME,
  type MediaLibraryRoot,
  olderOverlappingLibrary,
  VIDEO_EXTENSIONS,
} from '../domain/media-library'
import { formatError } from '../lib/errors'
import { buildObjectKey } from '../lib/path-template'
import type { Deps } from './deps'
import {
  type ActorIdentity,
  type BackgroundJobMessage,
  type Matter,
  type MediaLibraryState,
  type MediaLibraryView,
  StorageQuotaExceededError,
} from './ports'
import { loadBindingState } from './site/licensing'
import { withStorageUsageReservation } from './storage-usage'

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
  deps: Pick<Deps, 'licenseBinding' | 'mediaLibraries' | 'backgroundJobs' | 'jobQueue'>,
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
  deps: Pick<Deps, 'mediaLibraries' | 'backgroundJobs' | 'jobQueue'>,
  library: MediaLibraryState,
): Promise<void> {
  const { folder } = library
  if (!folder) {
    await deps.mediaLibraries.delete(library.orgId, library.id)
    console.log(`media_library.sweep.deleted library=${library.id} org=${library.orgId} reason=folder_purged`)
    return
  }
  if (folder.trashed || library.scanning) return
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
    const index = await writeLibraryIndex(deps, message, path, new TextEncoder().encode(JSON.stringify(feed)))
    await deps.mediaLibraries.recordScan(orgId, library.id, { fingerprint, scannedAt: new Date() })
    await deps.webdavPath.invalidateFolders(orgId, [path, joinMatterPath(path, MEDIA_LIBRARY_INDEX_FOLDER)])
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

// Each write gets a fresh object key and the old object is deleted afterwards,
// so a reader holding a cached matter row never pairs new bytes with an old size.
async function writeLibraryIndex(
  deps: Deps,
  message: BackgroundJobMessage,
  folderPath: string,
  bytes: Uint8Array,
): Promise<Matter> {
  const { orgId, userId, createdBy } = message
  const indexFolder = joinMatterPath(folderPath, MEDIA_LIBRARY_INDEX_FOLDER)
  const existing = await findIndexEntry(deps, orgId, indexFolder, MEDIA_LIBRARY_INDEX_FILE, { file: true })
  const storage = existing ? await deps.storages.get(existing.storageId) : await deps.storages.select()
  if (!storage) throw new Error('Storage for the media library index not found')
  if (!existing) await ensureIndexFolder(deps, message, folderPath, storage.id)

  const key = buildObjectKey({ uid: userId, orgId, rawExt: '.json' })
  const sizeDelta = bytes.byteLength - (existing?.size ?? 0)
  const index = await withStorageUsageReservation(
    deps,
    { orgId, storageId: storage.id, bytes: Math.max(0, sizeDelta) },
    async (ctx): Promise<Matter> => {
      await deps.s3.putObject(storage, key, bytes, MEDIA_LIBRARY_INDEX_MIME, bytes.byteLength)
      ctx.onRollback(() => deps.s3.deleteObject(storage, key))
      if (!existing) {
        return deps.matter.create({
          orgId,
          name: MEDIA_LIBRARY_INDEX_FILE,
          type: MEDIA_LIBRARY_INDEX_MIME,
          size: bytes.byteLength,
          dirtype: DirType.FILE,
          parent: indexFolder,
          object: key,
          storageId: storage.id,
          status: ObjectStatus.ACTIVE,
          createdByActorType: createdBy.type,
          createdByActorRef: createdBy.ref,
          createdByActorIssuer: createdBy.issuer,
        })
      }
      const fields = { type: MEDIA_LIBRARY_INDEX_MIME, size: bytes.byteLength, object: key }
      await deps.matter.applyUpload(orgId, existing, fields)
      return { ...existing, ...fields }
    },
  ).catch((error: unknown) => {
    throw error instanceof StorageQuotaExceededError
      ? new MediaLibraryScanBlockedError('Quota exceeded for the media library index')
      : error
  })

  if (existing) {
    // The new index is already live, so a leftover old object is only garbage.
    await deps.s3.deleteObject(storage, existing.object).catch((error: unknown) => {
      console.error(
        `media_library.scan.old_index_delete_error org=${orgId} storage=${storage.id} object=${existing.object} code=${formatError(error)}`,
      )
    })
    if (sizeDelta < 0) await deps.storageUsage.reconcile(orgId, [storage.id])
  }
  return index
}

async function ensureIndexFolder(
  deps: Deps,
  message: BackgroundJobMessage,
  folderPath: string,
  storageId: string,
): Promise<void> {
  const { orgId, createdBy } = message
  const existing = await findIndexEntry(deps, orgId, folderPath, MEDIA_LIBRARY_INDEX_FOLDER, { file: false })
  if (existing) return
  await deps.matter.create({
    orgId,
    name: MEDIA_LIBRARY_INDEX_FOLDER,
    type: 'folder',
    size: 0,
    dirtype: DirType.USER_FOLDER,
    parent: folderPath,
    object: '',
    storageId,
    status: ObjectStatus.ACTIVE,
    createdByActorType: createdBy.type,
    createdByActorRef: createdBy.ref,
    createdByActorIssuer: createdBy.issuer,
  })
}

// Live sibling names are unique case-insensitively, so a ".ZPAN" folder or a
// "library.json" folder occupies the index name. WebDAV paths are
// case-sensitive, so writing there would not serve the contract path: fail.
async function findIndexEntry(
  deps: Deps,
  orgId: string,
  parent: string,
  name: string,
  expected: { file: boolean },
): Promise<Matter | null> {
  const entry = await deps.matter.findActiveConflict(orgId, parent, name)
  if (!entry) return null
  if (entry.name !== name || (entry.dirtype === DirType.FILE) !== expected.file) {
    throw new MediaLibraryScanBlockedError(`"${joinMatterPath(parent, entry.name)}" blocks the media library index`)
  }
  return entry
}
