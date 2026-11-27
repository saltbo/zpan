// Torrent eviction (docs/design/torrents.md §11). Drive files are paid for with
// quota and list entries are not, so the two hold a torrent differently: a drive
// file, in any status including trash, holds it until it is purged, and a
// stremthru list entry holds it until it expires. Each sweep first expires
// stremthru entries not played within the retention period, then deletes
// torrents nobody holds once their last access is older than the retention
// period, or oldest first while the torrents exceed the optional capacity. A
// downloading torrent whose download was abandoned (canceled once its last
// holder went, or failed with nobody left to take it over) goes at once: a later
// download uploads every file anew, so its partial objects are of no use. When
// evicting every unheld torrent is not enough, torrents held only by stremthru
// entries go next, least recently played first, with their entries. Objects go
// first and rows second, so a failed sweep leaves rows that the next sweep
// retries.

import { selectTorrentsToEvict, torrentInfoObjectKey, torrentObjectPrefix } from '../../domain/torrents'
import type { Deps } from '../deps'
import type { EvictionCandidate } from '../ports'
import { loadTorrentPolicy } from './policy'
import { expireStremThruEntries } from './workspace-list'

export { loadTorrentPolicy, TORRENT_OPTION_KEYS } from './policy'

const SWEEP_BATCH = 100
// An abandoned fill is swept once its tasks have been still for this long, well
// past the 15-minute upload presigns, so no upload lands after its objects go.
export const ABANDONED_FILL_GRACE_MS = 60 * 60 * 1000

export type TorrentEvictionDeps = Deps

export async function evictTorrents(deps: TorrentEvictionDeps, now = new Date()): Promise<number> {
  await expireStremThruEntries(deps, now)
  const policy = await loadTorrentPolicy(deps)
  let total = await deps.torrents.totalSize()
  let evicted = 0
  const touchedStorages = new Set<string>()

  const stillSince = new Date(now.getTime() - ABANDONED_FILL_GRACE_MS)
  for (const candidate of await deps.torrents.listAbandonedFills(stillSince, SWEEP_BATCH)) {
    if (!(await deps.torrents.claimAbandonedFill(candidate, stillSince))) continue
    await deleteClaimedTorrent(deps, candidate)
    touchedStorages.add(candidate.storageId)
    total -= candidate.size
    evicted++
  }

  const candidates = await deps.torrents.listEvictionCandidates(SWEEP_BATCH)
  const selected = selectTorrentsToEvict(candidates, {
    now,
    retentionDays: policy.retentionDays,
    capacityBytes: policy.capacityBytes,
    totalBytes: total,
  })
  for (const candidate of selected) {
    if (!(await deps.torrents.claimForEviction(candidate))) continue
    await deleteClaimedTorrent(deps, candidate)
    touchedStorages.add(candidate.storageId)
    total -= candidate.size
    evicted++
  }

  // Still over capacity with every unheld torrent gone: torrents only stremthru
  // entries hold go next, least recently played first, with their entries.
  const unheldLeft = candidates.length === SWEEP_BATCH || selected.length < candidates.length
  if (policy.capacityBytes !== null && total > policy.capacityBytes && !unheldLeft) {
    for (const candidate of await deps.workspaceTorrents.listStremThruHeld(SWEEP_BATCH)) {
      if (total <= policy.capacityBytes) break
      if (!(await deps.workspaceTorrents.claimStremThruHeldForEviction(candidate))) continue
      await deleteClaimedTorrent(deps, candidate)
      touchedStorages.add(candidate.storageId)
      total -= candidate.size
      evicted++
    }
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
