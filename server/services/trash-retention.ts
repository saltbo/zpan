import { S3Service } from '../adapters/gateways/s3'
import { createStorageRepo } from '../adapters/repos/storage'
import { createStorageUsageRepo } from '../adapters/repos/storage-usage'
import type { Database } from '../platform/interface'
import { purgeRecursively } from '../usecases/purge'
import { collectForPurge, listOrgIdsWithExpiredTrash, listTrashedRoots } from './matter'

const DAY_MS = 24 * 60 * 60 * 1000
export const DEFAULT_TRASH_RETENTION_DAYS = 30

/** Parses ZPAN_TRASH_RETENTION_DAYS; falls back to the default, 0 disables purge. */
export function resolveTrashRetentionDays(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_TRASH_RETENTION_DAYS
  const days = Number(raw)
  if (!Number.isFinite(days) || days < 0) return DEFAULT_TRASH_RETENTION_DAYS
  return Math.floor(days)
}

/**
 * Permanently purges trashed items older than `retentionDays` across all orgs,
 * reclaiming their quota. Retention of 0 disables auto-purge. Runs subtree at a
 * time via the same purge path as emptying the trash manually.
 */
export async function purgeExpiredTrash(db: Database, retentionDays: number, now = Date.now()): Promise<number> {
  if (retentionDays <= 0) return 0
  const cutoff = now - retentionDays * DAY_MS
  const orgIds = await listOrgIdsWithExpiredTrash(db, cutoff)

  const purgeDeps = {
    s3: new S3Service(),
    storages: createStorageRepo(db),
    storageUsage: createStorageUsageRepo(db),
  }

  let purged = 0
  for (const orgId of orgIds) {
    const roots = await listTrashedRoots(db, orgId)
    for (const root of roots) {
      if ((root.trashedAt ?? 0) >= cutoff) continue
      const matters = await collectForPurge(db, orgId, root.id)
      if (!matters) continue
      purged += await purgeRecursively(purgeDeps, db, orgId, matters)
    }
  }
  return purged
}
