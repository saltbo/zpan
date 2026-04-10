import { Hono } from 'hono'
import type { Storage as S3Storage } from '../../shared/types'
import { requireAuth } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import type { Database } from '../platform/interface'
import { collectForPurge, decrementUsage, listTrashedRoots, type Matter, purgeMatters } from '../services/matter'
import { S3Service } from '../services/s3'
import { getStorage } from '../services/storage'

const s3 = new S3Service()

async function purgeRecursively(db: Database, orgId: string, matters: Matter[]): Promise<number> {
  const keysByStorage = new Map<string, { storage: S3Storage | null; keys: string[] }>()
  const bytesByStorage = new Map<string, number>()
  let totalBytes = 0

  for (const m of matters) {
    if (m.dirtype === 0 && m.size > 0) {
      bytesByStorage.set(m.storageId, (bytesByStorage.get(m.storageId) ?? 0) + m.size)
      totalBytes += m.size
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

const app = new Hono<Env>().use(requireAuth).post('/empty', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'No active organization' }, 400)
  const db = c.get('platform').db
  const roots = await listTrashedRoots(db, orgId)
  let purgedCount = 0
  for (const root of roots) {
    const ms = await collectForPurge(db, orgId, root.id)
    if (!ms) continue
    purgedCount += await purgeRecursively(db, orgId, ms)
  }
  return c.json({ purged: purgedCount })
})

export default app
