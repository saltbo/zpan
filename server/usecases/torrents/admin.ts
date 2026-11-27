// The admin Torrents page (docs/design/torrents.md §9, §11): every cached
// torrent with its holders, evicting one by hand, and the eviction policy.

import type { Deps } from '../deps'
import { type AdminTorrentRecord, conflict, type KeysetPage, type KeysetPageOpts, msg, notFound } from '../ports'
import { deleteClaimedTorrent, loadTorrentPolicy, TORRENT_OPTION_KEYS } from './eviction'

export function listCachedTorrents(
  deps: Pick<Deps, 'torrents'>,
  opts: KeysetPageOpts,
): Promise<KeysetPage<AdminTorrentRecord>> {
  return deps.torrents.listForAdmin(opts)
}

function heldError(holders: number) {
  return conflict(
    msg('{count} drive files still hold this torrent; it can be evicted once they are deleted, including from trash', {
      count: String(holders),
    }),
    'TORRENT_HELD',
  )
}

// Evicts one torrent nobody holds. A held torrent, or one still downloading or
// verifying, is refused; only eviction deletes cached objects.
export async function evictCachedTorrent(
  deps: Pick<Deps, 'torrents' | 'storages' | 's3' | 'storageUsage'>,
  id: string,
): Promise<void> {
  const torrent = await deps.torrents.get(id)
  if (!torrent) throw notFound('Torrent not found')
  if (torrent.status === 'downloading' || torrent.status === 'verifying') {
    throw conflict('Torrent is still being downloaded or verified', 'TORRENT_IN_PROGRESS')
  }
  if (torrent.status === 'evicting') throw conflict('Torrent is already being evicted', 'TORRENT_EVICTING')
  const holders = await deps.torrents.countHolders(id)
  if (holders > 0) throw heldError(holders)

  const claimed = await deps.torrents.claimForEviction({
    id: torrent.id,
    infoHash: torrent.infoHash,
    storageId: torrent.storageId,
    size: torrent.totalSize,
    lastAccessedAt: torrent.lastAccessedAt,
  })
  if (!claimed) {
    // An instant transfer or access won the race: report what stops it now.
    const now = await deps.torrents.countHolders(id)
    if (now > 0) throw heldError(now)
    throw conflict('Torrent changed while it was being evicted; try again', 'TORRENT_CHANGED')
  }
  await deleteClaimedTorrent(deps, torrent)
  await deps.storageUsage.reconcileStorages([torrent.storageId])
}

export interface TorrentSettings {
  retentionDays: number
  capacityBytes: number | null
}

export function getTorrentSettings(deps: Pick<Deps, 'systemOptions'>): Promise<TorrentSettings> {
  return loadTorrentPolicy(deps)
}

export async function replaceTorrentSettings(
  deps: Pick<Deps, 'systemOptions'>,
  input: TorrentSettings,
): Promise<TorrentSettings> {
  await deps.systemOptions.set(TORRENT_OPTION_KEYS.retentionDays, String(input.retentionDays))
  if (input.capacityBytes === null) await deps.systemOptions.delete(TORRENT_OPTION_KEYS.capacityBytes)
  else await deps.systemOptions.set(TORRENT_OPTION_KEYS.capacityBytes, String(input.capacityBytes))
  return loadTorrentPolicy(deps)
}
