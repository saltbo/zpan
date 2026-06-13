import { DirType } from '@shared/constants'
import type { Database } from '../platform/interface'
import { type Matter, purgeMatters } from '../services/matter'
import { cascadeDeleteByMatter } from '../services/share'
import type { S3Gateway, StorageRecord, StorageRepo, StorageUsageRepo } from './ports'

export type PurgeDeps = { s3: S3Gateway; storages: StorageRepo; storageUsage: StorageUsageRepo }

export async function purgeRecursively(
  deps: PurgeDeps,
  db: Database,
  orgId: string,
  matters: Matter[],
): Promise<number> {
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
    await cascadeDeleteByMatter(db, m.id)
  }

  await purgeMatters(
    db,
    orgId,
    matters.map((m) => m.id),
  )
  if (totalBytes > 0) await deps.storageUsage.reconcile(orgId, bytesByStorage.keys())
  return matters.length
}
