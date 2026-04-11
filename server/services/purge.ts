import { DirType } from '../../shared/constants'
import type { Storage as S3Storage } from '../../shared/types'
import type { Database } from '../platform/interface'
import { decrementUsage, type Matter, purgeMatters } from './matter'
import { S3Service } from './s3'
import { getStorage } from './storage'

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
      const storage = (await getStorage(db, m.storageId)) as unknown as S3Storage | null
      entry = { storage, keys: [] }
      keysByStorage.set(m.storageId, entry)
    }
    entry.keys.push(m.object)
  }

  for (const { storage, keys } of keysByStorage.values()) {
    if (storage && keys.length > 0) await s3.deleteObjects(storage, keys)
  }

  await purgeMatters(
    db,
    orgId,
    matters.map((m) => m.id),
  )
  await decrementUsage(db, orgId, bytesByStorage, totalBytes)
  return matters.length
}
