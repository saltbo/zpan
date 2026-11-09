// <library>/library.json: the JSON Feed index, which also marks the folder as a
// media library. Creating a library writes it, removing one purges it, and a
// library whose index is gone is off; a scan only ever rewrites it in place.

import { DirType, ObjectStatus } from '@shared/constants'
import { isMediaLibraryIndex, MEDIA_LIBRARY_INDEX_FILE, MEDIA_LIBRARY_INDEX_MIME } from '../domain/media-library'
import { formatError } from '../lib/errors'
import { buildObjectKey } from '../lib/path-template'
import type { Deps } from './deps'
import { purgeRecursively } from './object'
import type { ActorIdentity, Matter, StorageRecord } from './ports'
import { withStorageUsageReservation } from './storage-usage'

type IndexOwner = { orgId: string; userId: string; createdBy: ActorIdentity }

export async function findMediaLibraryIndex(
  deps: Pick<Deps, 'matter'>,
  orgId: string,
  folderPath: string,
): Promise<Matter | null> {
  const entry = await deps.matter.findActiveConflict(orgId, folderPath, MEDIA_LIBRARY_INDEX_FILE)
  return entry && isMediaLibraryIndex(entry) ? entry : null
}

// Throws StorageQuotaExceededError when the index does not fit the quota.
export async function createMediaLibraryIndex(
  deps: Deps,
  owner: IndexOwner,
  folderPath: string,
  feed: AsyncIterable<string>,
): Promise<Matter> {
  const { orgId, createdBy } = owner
  const storage = await deps.storages.select()
  return putIndexObject(deps, owner, storage, feed, 0, (object, size) =>
    deps.matter.create({
      orgId,
      name: MEDIA_LIBRARY_INDEX_FILE,
      type: MEDIA_LIBRARY_INDEX_MIME,
      size,
      dirtype: DirType.FILE,
      parent: folderPath,
      object,
      storageId: storage.id,
      status: ObjectStatus.ACTIVE,
      createdByActorType: createdBy.type,
      createdByActorRef: createdBy.ref,
      createdByActorIssuer: createdBy.issuer,
    }),
  )
}

// Each write gets a fresh object key and the old object is deleted afterwards,
// so a reader holding a cached matter row never pairs new bytes with an old
// size. Throws StorageQuotaExceededError when the growth does not fit.
export async function rewriteMediaLibraryIndex(
  deps: Deps,
  owner: IndexOwner,
  storage: StorageRecord,
  existing: Matter,
  feed: AsyncIterable<string>,
): Promise<Matter> {
  const { orgId } = owner
  const previousSize = existing.size ?? 0
  const index = await putIndexObject(deps, owner, storage, feed, previousSize, async (object, size) => {
    const fields = { type: MEDIA_LIBRARY_INDEX_MIME, size, object }
    await deps.matter.applyUpload(orgId, existing, fields)
    return { ...existing, ...fields }
  })
  // The new index is already live, so a leftover old object is only garbage.
  await deps.s3.deleteObject(storage, existing.object).catch((error: unknown) => {
    console.error(
      `media_library.scan.old_index_delete_error org=${orgId} storage=${storage.id} object=${existing.object} code=${formatError(error)}`,
    )
  })
  if ((index.size ?? 0) < previousSize) await deps.storageUsage.reconcile(orgId, [storage.id])
  return index
}

export async function purgeMediaLibraryIndex(deps: Deps, orgId: string, folderPath: string): Promise<void> {
  const index = await findMediaLibraryIndex(deps, orgId, folderPath)
  if (index) await purgeRecursively(deps, orgId, [index])
}

// The feed streams into a multipart upload with no length, so its size is
// known only after the write: quota for the growth over `replacedBytes` is
// reserved then, and the new object is deleted if it does not fit.
async function putIndexObject(
  deps: Deps,
  owner: IndexOwner,
  storage: StorageRecord,
  feed: AsyncIterable<string>,
  replacedBytes: number,
  commit: (object: string, size: number) => Promise<Matter>,
): Promise<Matter> {
  const { orgId, userId } = owner
  const key = buildObjectKey({ uid: userId, orgId, rawExt: '.json' })
  const size = await deps.s3.putObject(storage, key, encodeText(feed), MEDIA_LIBRARY_INDEX_MIME)
  try {
    return await withStorageUsageReservation(deps, { orgId, storageId: storage.id, bytes: size - replacedBytes }, () =>
      commit(key, size),
    )
  } catch (error) {
    await deps.s3.deleteObject(storage, key)
    throw error
  }
}

// Pull-based, so the feed advances only as fast as the upload reads it.
function encodeText(chunks: AsyncIterable<string>): ReadableStream<Uint8Array> {
  const iterator = chunks[Symbol.asyncIterator]()
  const encoder = new TextEncoder()
  return new ReadableStream({
    async pull(controller) {
      const { done, value } = await iterator.next()
      if (done) controller.close()
      else controller.enqueue(encoder.encode(value))
    },
    async cancel() {
      await iterator.return?.()
    },
  })
}
