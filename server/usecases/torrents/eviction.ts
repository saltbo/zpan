// Torrent eviction (docs/design/torrents.md §11). A torrent no drive
// file references, in any status including trash, is deleted once its last
// access is older than the retention period, or oldest first while the torrents
// exceed the optional capacity. Objects go first and rows second, so a failed
// sweep leaves rows that the next sweep retries.

import {
  DEFAULT_TORRENT_RETENTION_DAYS,
  selectTorrentsToEvict,
  torrentInfoObjectKey,
  torrentObjectPrefix,
} from '../../domain/torrents'
import type { Deps } from '../deps'
import type { EvictionCandidate } from '../ports'

export const TORRENT_OPTION_KEYS = {
  retentionDays: 'torrent_retention_days',
  capacityBytes: 'torrent_capacity_bytes',
} as const

const SWEEP_BATCH = 100

export type TorrentEvictionDeps = Pick<Deps, 'torrents' | 'storages' | 's3' | 'storageUsage' | 'systemOptions'>

function parseNonNegative(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') return null
  const value = Number(raw)
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : null
}

export async function loadTorrentPolicy(
  deps: Pick<Deps, 'systemOptions'>,
): Promise<{ retentionDays: number; capacityBytes: number | null }> {
  const options = await deps.systemOptions.getMany(Object.values(TORRENT_OPTION_KEYS))
  const value = (key: string) => options.find((option) => option.key === key)?.value ?? null
  return {
    retentionDays: parseNonNegative(value(TORRENT_OPTION_KEYS.retentionDays)) ?? DEFAULT_TORRENT_RETENTION_DAYS,
    capacityBytes: parseNonNegative(value(TORRENT_OPTION_KEYS.capacityBytes)),
  }
}

export async function evictTorrents(deps: TorrentEvictionDeps, now = new Date()): Promise<number> {
  const policy = await loadTorrentPolicy(deps)
  const candidates = await deps.torrents.listEvictionCandidates(SWEEP_BATCH)
  if (candidates.length === 0) return 0
  const selected = selectTorrentsToEvict(candidates, {
    now,
    retentionDays: policy.retentionDays,
    capacityBytes: policy.capacityBytes,
    totalBytes: await deps.torrents.totalSize(),
  })

  let evicted = 0
  const touchedStorages = new Set<string>()
  for (const candidate of selected) {
    if (!(await deps.torrents.claimForEviction(candidate))) continue
    await deleteClaimedTorrent(deps, candidate)
    touchedStorages.add(candidate.storageId)
    evicted++
  }
  if (touchedStorages.size > 0) await deps.storageUsage.reconcileStorages(touchedStorages)
  return evicted
}

// Deletes a torrent already claimed for eviction: its objects first, then its
// rows. The caller reconciles the storage's usage afterwards.
export async function deleteClaimedTorrent(
  deps: Pick<Deps, 'torrents' | 'storages' | 's3'>,
  candidate: Pick<EvictionCandidate, 'id' | 'infoHash' | 'storageId'>,
): Promise<void> {
  const storage = await deps.storages.get(candidate.storageId)
  if (storage) {
    const entries = await deps.torrents.listEntries(candidate.id)
    // Listing the prefix also finds what no row records, such as an upload
    // that landed after its download stopped.
    const listed = await deps.s3.listTorrentKeys(storage, torrentObjectPrefix(candidate.infoHash))
    const keys = new Set([
      ...entries.flatMap((entry) => (entry.objectKey ? [entry.objectKey] : [])),
      ...listed,
      torrentInfoObjectKey(candidate.infoHash),
    ])
    await deps.s3.evictTorrentObjects(storage, [...keys])
  }
  await deps.torrents.delete(candidate.id)
}
