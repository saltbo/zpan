import { DirType } from '../../shared/constants'
import { createStorageRepo } from '../adapters/repos/storage'
import type { Database } from '../platform/interface'
import type { StorageRecord as S3Storage } from '../usecases/ports'
import { type Matter, purgeMatters } from './matter'
import { S3Service } from './s3'
import { cascadeDeleteByMatter } from './share'
import { reconcileStorageUsage } from './storage-usage'

const s3 = new S3Service()

export async function purgeRecursively(db: Database, orgId: string, matters: Matter[]): Promise<number> {
  const keysByStorage = new Map<string, { storage: S3Storage | null; keys: string[] }>()
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
      const storage = await createStorageRepo(db).get(m.storageId)
      entry = { storage, keys: [] }
      keysByStorage.set(m.storageId, entry)
    }
    entry.keys.push(m.object)
  }

  for (const { storage, keys } of keysByStorage.values()) {
    if (storage && keys.length > 0) await s3.deleteObjects(storage, keys)
  }

  for (const m of matters) {
    await cascadeDeleteByMatter(db, m.id)
  }

  await purgeMatters(
    db,
    orgId,
    matters.map((m) => m.id),
  )
  if (totalBytes > 0) await reconcileStorageUsage(db, orgId, bytesByStorage.keys())
  return matters.length
}
