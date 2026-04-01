import { eq, and, sql, inArray } from 'drizzle-orm'
import type { Database } from '../platform/interface'
import { matters, storages, storageQuotas } from '../db/schema'
import { createS3Client, deleteObjects } from './s3'

export type Matter = typeof matters.$inferSelect

export async function collectDescendants(
  db: Database,
  parentId: string,
  userId: string,
): Promise<Matter[]> {
  const children = await db
    .select()
    .from(matters)
    .where(and(eq(matters.parent, parentId), eq(matters.uid, userId)))
  const nested = await Promise.all(
    children.filter((c) => (c.dirtype ?? 0) > 0).map((c) => collectDescendants(db, c.id, userId)),
  )
  return [...children, ...nested.flat()]
}

export async function deleteMattersWithCleanup(
  db: Database,
  items: Matter[],
  userId: string,
): Promise<void> {
  if (items.length === 0) return

  const ids = items.map((m) => m.id)
  const totalSize = items.reduce((sum, m) => sum + (m.size ?? 0), 0)

  const sizeByStorage = new Map<string, number>()
  for (const m of items) {
    if (m.storageId && m.size && m.size > 0) {
      sizeByStorage.set(m.storageId, (sizeByStorage.get(m.storageId) ?? 0) + m.size)
    }
  }

  await db.delete(matters).where(inArray(matters.id, ids))

  for (const [storageId, size] of sizeByStorage) {
    await db
      .update(storages)
      .set({ usedBytes: sql`${storages.usedBytes} - ${size}` })
      .where(eq(storages.id, storageId))
  }

  if (totalSize > 0) {
    await db
      .update(storageQuotas)
      .set({ used: sql`${storageQuotas.used} - ${totalSize}` })
      .where(eq(storageQuotas.uid, userId))
  }
}

export async function deleteMattersFromS3(db: Database, items: Matter[]): Promise<void> {
  const files = items.filter((m) => m.dirtype === 0 && m.object && m.storageId)
  if (files.length === 0) return

  const keysByStorage = new Map<string, string[]>()
  for (const f of files) {
    const keys = keysByStorage.get(f.storageId) ?? []
    keys.push(f.object)
    keysByStorage.set(f.storageId, keys)
  }

  const storageIds = [...keysByStorage.keys()]
  const storageRows = await db.select().from(storages).where(inArray(storages.id, storageIds))
  const storageMap = new Map(storageRows.map((s) => [s.id, s]))

  for (const [storageId, keys] of keysByStorage) {
    const storage = storageMap.get(storageId)
    if (!storage) continue
    const client = createS3Client(storage)
    await deleteObjects(client, storage.bucket, keys)
  }
}
