// Object-key rules for the instance-wide torrent cache (docs/design/torrent-cache.md).
// Cached bytes live under the reserved prefix `bt/`; a drive file whose object is
// under it is a reference to the cache, not an owner of the bytes.

export const TORRENT_CACHE_PREFIX = 'bt/'

export const TORRENT_STATUSES = ['downloading', 'verifying', 'ready', 'invalid', 'evicting'] as const
export type TorrentStatus = (typeof TORRENT_STATUSES)[number]

export const DEFAULT_TORRENT_FOLDER = 'Media'
export const DEFAULT_TORRENT_CACHE_RETENTION_DAYS = 30

export function isTorrentCacheKey(key: string): boolean {
  return key.startsWith(TORRENT_CACHE_PREFIX)
}

export function torrentFileObjectKey(infoHash: string, fileIdx: number): string {
  return `${TORRENT_CACHE_PREFIX}${infoHash}/${fileIdx}`
}

export function torrentInfoObjectKey(infoHash: string): string {
  return `${TORRENT_CACHE_PREFIX}${infoHash}/info`
}

export function torrentLayoutObjectKey(infoHash: string): string {
  return `${TORRENT_CACHE_PREFIX}${infoHash}/layout.json`
}

// The half-open key range [from, to) holding every object of one torrent, so
// references are counted through the (storage_id, object) index. '0' is the
// character right after '/'.
export function torrentKeyRange(infoHash: string): { from: string; to: string } {
  return { from: `${TORRENT_CACHE_PREFIX}${infoHash}/`, to: `${TORRENT_CACHE_PREFIX}${infoHash}0` }
}

// Where a torrent's own tree lands under a target folder: a folder named after
// the torrent holding its paths, or the lone file itself for a single-file
// torrent, whose only path is its name.
export function torrentTreeRoot(torrent: { name: string }, files: ReadonlyArray<{ path: string }>): string | null {
  return files.length === 1 && files[0].path === torrent.name ? null : torrent.name
}

// Torrents nobody holds, oldest access first, are evicted while either their
// last access is older than the retention or the cache is over capacity.
export function selectTorrentsToEvict<T extends { size: number; lastAccessedAt: Date }>(
  candidates: readonly T[],
  options: { now: Date; retentionDays: number; capacityBytes: number | null; totalBytes: number },
): T[] {
  const cutoff = options.now.getTime() - options.retentionDays * 24 * 60 * 60 * 1000
  const sorted = [...candidates].sort((a, b) => a.lastAccessedAt.getTime() - b.lastAccessedAt.getTime())
  const selected: T[] = []
  let total = options.totalBytes
  for (const candidate of sorted) {
    const expired = candidate.lastAccessedAt.getTime() < cutoff
    const overCapacity = options.capacityBytes !== null && total > options.capacityBytes
    if (!expired && !overCapacity) break
    selected.push(candidate)
    total -= candidate.size
  }
  return selected
}

export function normalizeTorrentFolder(folder: string): string {
  return folder
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean)
    .join('/')
}
