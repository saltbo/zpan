// The single path through which a drive file's object is released or duplicated.
// A file whose object is a torrent cache key (`bt/…`) only references bytes the
// cache owns: releasing it leaves the bytes to eviction, and duplicating it
// writes another reference instead of copying (docs/design/torrent-cache.md §5).

import { isTorrentCacheKey } from '../domain/torrent-cache'
import { buildObjectKey, fileExt } from '../lib/path-template'
import { conflict, type S3Gateway, type StorageRecord } from './ports'

export async function releaseMatterObjects(s3: S3Gateway, storage: StorageRecord, keys: string[]): Promise<void> {
  const owned = keys.filter((key) => key && !isTorrentCacheKey(key))
  if (owned.length > 0) await s3.deleteObjects(storage, owned)
}

export async function releaseMatterObject(s3: S3Gateway, storage: StorageRecord, key: string): Promise<void> {
  if (key && !isTorrentCacheKey(key)) await s3.deleteObject(storage, key)
}

export function assertMatterContentWritable(object: string): void {
  if (isTorrentCacheKey(object)) throw conflict('Cached torrent files are read-only', 'TORRENT_CACHE_READ_ONLY')
}

// The object for a copy of a drive file in `targetStorage`, and the storage its
// bytes are charged to (null when the copy is a cache reference, whose bytes the
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
  if (isTorrentCacheKey(sourceKey)) {
    if (sourceStorage.id !== targetStorage.id) {
      throw conflict('Cached torrent files cannot leave their storage', 'TORRENT_CACHE_STORAGE_FIXED')
    }
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

// The storage a file's bytes are charged to when another row holds its object.
export function chargedStorageId(matter: { object: string; storageId: string }): string | null {
  return isTorrentCacheKey(matter.object) ? null : matter.storageId
}
