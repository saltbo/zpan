// <library>/library.json: the JSON Feed index, which also marks the folder as a
// media library. Creating a library writes it, removing one purges it, and a
// library whose index is gone is off; a scan only ever rewrites it in place.

import { DirType, ObjectStatus } from '@shared/constants'
import type { MediaLibraryFeed } from '@shared/schemas'
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
  feed: MediaLibraryFeed,
): Promise<Matter> {
  const { orgId, createdBy } = owner
  const storage = await deps.storages.select()
  const bytes = encodeFeed(feed)
  return putIndexObject(deps, owner, storage, bytes, bytes.byteLength, (object) =>
    deps.matter.create({
      orgId,
      name: MEDIA_LIBRARY_INDEX_FILE,
      type: MEDIA_LIBRARY_INDEX_MIME,
      size: bytes.byteLength,
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
  feed: MediaLibraryFeed,
): Promise<Matter> {
  const { orgId } = owner
  const bytes = encodeFeed(feed)
  const sizeDelta = bytes.byteLength - (existing.size ?? 0)
  const index = await putIndexObject(deps, owner, storage, bytes, Math.max(0, sizeDelta), async (object) => {
    const fields = { type: MEDIA_LIBRARY_INDEX_MIME, size: bytes.byteLength, object }
    await deps.matter.applyUpload(orgId, existing, fields)
    return { ...existing, ...fields }
  })
  // The new index is already live, so a leftover old object is only garbage.
  await deps.s3.deleteObject(storage, existing.object).catch((error: unknown) => {
    console.error(
      `media_library.scan.old_index_delete_error org=${orgId} storage=${storage.id} object=${existing.object} code=${formatError(error)}`,
    )
  })
  if (sizeDelta < 0) await deps.storageUsage.reconcile(orgId, [storage.id])
  return index
}

export async function purgeMediaLibraryIndex(deps: Deps, orgId: string, folderPath: string): Promise<void> {
  const index = await findMediaLibraryIndex(deps, orgId, folderPath)
  if (index) await purgeRecursively(deps, orgId, [index])
}

async function putIndexObject(
  deps: Deps,
  owner: IndexOwner,
  storage: StorageRecord,
  bytes: Uint8Array,
  reserveBytes: number,
  commit: (object: string) => Promise<Matter>,
): Promise<Matter> {
  const { orgId, userId } = owner
  const key = buildObjectKey({ uid: userId, orgId, rawExt: '.json' })
  return withStorageUsageReservation(deps, { orgId, storageId: storage.id, bytes: reserveBytes }, async (ctx) => {
    await deps.s3.putObject(storage, key, bytes, MEDIA_LIBRARY_INDEX_MIME, bytes.byteLength)
    ctx.onRollback(() => deps.s3.deleteObject(storage, key))
    return commit(key)
  })
}

function encodeFeed(feed: MediaLibraryFeed): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(feed))
}
