import { DirType } from '@shared/constants'
import type { Matter, MatterRepo, S3Gateway, ShareRepo, StorageRecord, StorageRepo, StorageUsageRepo } from './ports'

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
