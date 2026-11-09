// The media-libraries resource usecase (/api/media-libraries): list, mark a
// folder as a library (writing its library.json and queueing the first scan),
// remove it (purging library.json), and request a rescan.

import { DirType, ObjectStatus } from '@shared/constants'
import type { BackgroundJob } from '@shared/types'
import {
  folderPathsOverlap,
  joinMatterPath,
  MEDIA_LIBRARY_INDEX_FILE,
  serializeMediaLibraryFeed,
} from '../domain/media-library'
import { formatError } from '../lib/errors'
import type { Deps } from './deps'
import { createMediaLibraryIndex, purgeMediaLibraryIndex } from './media-library-index'
import { enqueueMediaLibraryScan } from './media-library-scan'
import {
  type ActorIdentity,
  badRequest,
  conflict,
  type MediaLibraryView,
  notFound,
  quotaExceeded,
  StorageQuotaExceededError,
} from './ports'

type Requester = { orgId: string; userId: string; createdBy: ActorIdentity }

export function listMediaLibraries(
  deps: Pick<Deps, 'mediaLibraries'>,
  orgId: string,
  opts: { pageSize: number; after?: { createdAt: Date; id: string } },
) {
  return deps.mediaLibraries.list(orgId, opts)
}

export async function createMediaLibrary(
  deps: Deps,
  input: Requester & { folderId: string },
): Promise<MediaLibraryView> {
  const { orgId, userId, createdBy } = input
  const folder = await deps.matter.get(input.folderId, orgId)
  if (!folder || folder.status !== ObjectStatus.ACTIVE || folder.trashedAt !== null) throw notFound('Folder not found')
  if (folder.dirtype === DirType.FILE) {
    throw badRequest('Only folders can be media libraries', 'MEDIA_LIBRARY_NOT_A_FOLDER')
  }
  const folderPath = joinMatterPath(folder.parent, folder.name)

  // Trashed libraries count: restoring their folder would bring them back.
  const libraries = (await deps.mediaLibraries.listByOrg(orgId)).flatMap((library) =>
    library.folder ? [{ id: library.folderId, path: library.folder.path }] : [],
  )
  if (libraries.some((library) => library.id === folder.id)) {
    throw conflict('Folder is already a media library', 'MEDIA_LIBRARY_EXISTS')
  }
  const overlapping = libraries.find((library) => folderPathsOverlap(library.path, folderPath))
  if (overlapping) {
    throw conflict(`Media libraries cannot be nested: "${overlapping.path}" is a media library`, 'MEDIA_LIBRARY_NESTED')
  }

  const occupant = await deps.matter.findActiveConflict(orgId, folderPath, MEDIA_LIBRARY_INDEX_FILE)
  if (occupant) {
    throw conflict(
      `"${joinMatterPath(folderPath, occupant.name)}" already exists; rename or remove it to make this folder a media library`,
      'MEDIA_LIBRARY_INDEX_OCCUPIED',
    )
  }

  const record = await deps.mediaLibraries.create({ orgId, folderId: folder.id, createdByUserId: userId, createdBy })
  if (!record) throw conflict('Folder is already a media library', 'MEDIA_LIBRARY_EXISTS')
  // The index is the library's on switch, so it exists before the request
  // returns; the first scan fills it in.
  try {
    const feed = serializeMediaLibraryFeed(
      { libraryId: record.id, folderPath, folderName: folder.name, generatedAt: new Date() },
      [],
    )
    await createMediaLibraryIndex(deps, input, folderPath, feed)
  } catch (error) {
    await deps.mediaLibraries.delete(orgId, record.id)
    throw error instanceof StorageQuotaExceededError
      ? quotaExceeded('Quota exceeded for the media library index')
      : error
  }
  await deps.webdavPath.invalidateFolders(orgId, [folderPath])
  const library: MediaLibraryView = {
    ...record,
    folder: { path: folderPath, name: folder.name, trashed: false },
    scanning: true,
  }
  // The library exists either way, and the sweep scans a library that has no
  // fingerprint yet, so a failed enqueue only delays the first index.
  try {
    await enqueueMediaLibraryScan(deps, { library, userId, createdBy })
    return library
  } catch (error) {
    console.error(`media_library.create.enqueue_error library=${library.id} org=${orgId} code=${formatError(error)}`)
    return { ...library, scanning: false }
  }
}

// The index goes first: if deleting the row then fails, the library is already
// off and the next sweep drops the row.
export async function deleteMediaLibrary(deps: Deps, orgId: string, id: string) {
  const library = await deps.mediaLibraries.get(orgId, id)
  if (!library) throw notFound('Media library not found')
  if (library.folder) {
    await purgeMediaLibraryIndex(deps, orgId, library.folder.path)
    await deps.webdavPath.invalidateFolders(orgId, [library.folder.path])
  }
  if (!(await deps.mediaLibraries.delete(orgId, id))) throw notFound('Media library not found')
}

export async function scanMediaLibrary(
  deps: Pick<Deps, 'mediaLibraries' | 'backgroundJobs' | 'jobQueue'>,
  input: Requester & { libraryId: string },
): Promise<BackgroundJob> {
  const library = await deps.mediaLibraries.get(input.orgId, input.libraryId)
  if (!library) throw notFound('Media library not found')
  const { folder } = library
  if (!folder || folder.trashed) {
    throw conflict('The media library folder is in trash or no longer exists', 'MEDIA_LIBRARY_FOLDER_UNAVAILABLE')
  }
  if (library.scanning) {
    throw conflict('A scan of this media library is already queued or running', 'MEDIA_LIBRARY_SCAN_IN_PROGRESS')
  }
  return enqueueMediaLibraryScan(deps, {
    library: { ...library, folder },
    userId: input.userId,
    createdBy: input.createdBy,
  })
}
