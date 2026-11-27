// The single path through which a drive file's object is released or duplicated.
// A file whose object is a torrent key (`bt/…`) only references a torrent's
// bytes: releasing it leaves the bytes to eviction, and duplicating it writes
// another reference instead of copying (docs/design/torrents.md §6).

import { isTorrentKey } from '../domain/torrents'
import { buildObjectKey, fileExt } from '../lib/path-template'
import type { S3Gateway, StorageRecord } from './ports'

export async function releaseMatterObjects(s3: S3Gateway, storage: StorageRecord, keys: string[]): Promise<void> {
  const owned = keys.filter((key) => key && !isTorrentKey(key))
  if (owned.length > 0) await s3.deleteObjects(storage, owned)
}

export async function releaseMatterObject(s3: S3Gateway, storage: StorageRecord, key: string): Promise<void> {
  if (key && !isTorrentKey(key)) await s3.deleteObject(storage, key)
}

// The object for a copy of a drive file in `targetStorage`, and the storage its
// bytes are charged to (null when the copy is a torrent reference, whose bytes the
// storage already counts once).
export async function duplicateMatterObject(
  s3: S3Gateway,
  params: {
    sourceStorage: StorageRecord
    sourceKey: string
    targetStorage: StorageRecord
    uid: string
    orgId: string
    name: string
  },
): Promise<{ key: string; chargedStorageId: string | null }> {
  const { sourceStorage, sourceKey, targetStorage } = params
  if (isTorrentReference(sourceKey, sourceStorage.id, targetStorage.id)) {
    return { key: sourceKey, chargedStorageId: null }
  }
  const key = buildObjectKey({ uid: params.uid, orgId: params.orgId, rawExt: fileExt(params.name) })
  if (sourceStorage.id === targetStorage.id) {
    await s3.copyObject(sourceStorage, sourceKey, targetStorage, key)
  } else {
    await s3.streamCopy(sourceStorage, sourceKey, targetStorage, key)
  }
  return { key, chargedStorageId: targetStorage.id }
}

// A copy of a referencing file stays a reference only inside the torrent's storage;
// a copy into another storage gets its own bytes like any other file.
export function isTorrentReference(sourceKey: string, sourceStorageId: string, targetStorageId: string): boolean {
  return isTorrentKey(sourceKey) && sourceStorageId === targetStorageId
}

// The storage a file's bytes are charged to when another row holds its object.
export function chargedStorageId(matter: { object: string; storageId: string }): string | null {
  return isTorrentKey(matter.object) ? null : matter.storageId
}
