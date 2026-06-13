import { type PurgeDeps, purgeRecursively } from './purge'

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
export async function purgeExpiredTrash(deps: PurgeDeps, retentionDays: number, now = Date.now()): Promise<number> {
  if (retentionDays <= 0) return 0
  const cutoff = now - retentionDays * DAY_MS
  const orgIds = await deps.matter.listOrgIdsWithExpiredTrash(cutoff)

  let purged = 0
  for (const orgId of orgIds) {
    const roots = await deps.matter.listTrashedRoots(orgId)
    for (const root of roots) {
      if ((root.trashedAt ?? 0) >= cutoff) continue
      const matters = await deps.matter.collectForPurge(orgId, root.id)
      if (!matters) continue
      purged += await purgeRecursively(deps, orgId, matters)
    }
  }
  return purged
}
