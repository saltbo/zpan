// The admin's eviction policy for torrents (docs/design/torrents.md §11): how
// long unplayed and unheld torrents stay, and the optional capacity.

import { DEFAULT_TORRENT_RETENTION_DAYS } from '../../domain/torrents'
import type { Deps } from '../deps'

export const TORRENT_OPTION_KEYS = {
  retentionDays: 'torrent_retention_days',
  capacityBytes: 'torrent_capacity_bytes',
} as const

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
