import { DirType } from '@shared/constants'
import type { Matter, MatterRepo, S3Gateway, ShareRepo, StorageRecord, StorageRepo, StorageUsageRepo } from './ports'

const DAY_MS = 24 * 60 * 60 * 1000
export const DEFAULT_TRASH_RETENTION_DAYS = 30

export type PurgeDeps = {
  s3: S3Gateway
  storages: StorageRepo
  storageUsage: StorageUsageRepo
  share: ShareRepo
  matter: MatterRepo
}

export async function purgeRecursively(deps: PurgeDeps, orgId: string, matters: Matter[]): Promise<number> {
  const keysByStorage = new Map<string, { storage: StorageRecord | null; keys: string[] }>()
  const bytesByStorage = new Map<string, number>()
  let totalBytes = 0

  for (const m of matters) {
    const size = m.size ?? 0
    if (m.dirtype === DirType.FILE && size > 0) {
      bytesByStorage.set(m.storageId, (bytesByStorage.get(m.storageId) ?? 0) + size)
      totalBytes += size
    }
    if (!m.object) continue
    let entry = keysByStorage.get(m.storageId)
    if (!entry) {
      const storage = await deps.storages.get(m.storageId)
      entry = { storage, keys: [] }
      keysByStorage.set(m.storageId, entry)
    }
    entry.keys.push(m.object)
  }

  for (const { storage, keys } of keysByStorage.values()) {
    if (storage && keys.length > 0) await deps.s3.deleteObjects(storage, keys)
  }

  for (const m of matters) {
    await deps.share.cascadeDeleteByMatter(m.id)
  }

  await deps.matter.purge(
    orgId,
    matters.map((m) => m.id),
  )
  if (totalBytes > 0) await deps.storageUsage.reconcile(orgId, bytesByStorage.keys())
  return matters.length
}

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
