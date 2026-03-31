import { eq, and, sql, inArray } from 'drizzle-orm'
import { matters, storages, storageQuotas } from '../db/schema'
import { createS3Client, deleteObjects } from './s3'

export type Matter = typeof matters.$inferSelect

export async function collectDescendants(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: { select: () => any },
  parentIds: string[],
  uid: string,
): Promise<Matter[]> {
  const result: Matter[] = []
  let currentIds = parentIds

  while (currentIds.length > 0) {
    const children: Matter[] = await db
      .select()
      .from(matters)
      .where(and(eq(matters.uid, uid), inArray(matters.parent, currentIds)))

    result.push(...children)
    currentIds = children.filter((c) => c.dirtype && c.dirtype > 0).map((c) => c.id)
  }

  return result
}

function groupFilesByStorage(files: Matter[]): Map<string, { keys: string[]; size: number }> {
  const byStorage = new Map<string, { keys: string[]; size: number }>()
  for (const file of files) {
    const entry = byStorage.get(file.storageId) ?? { keys: [], size: 0 }
    entry.keys.push(file.object)
    entry.size += file.size ?? 0
    byStorage.set(file.storageId, entry)
  }
  return byStorage
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function permanentDeleteMatters(db: any, userId: string, items: Matter[]) {
  const files = items.filter((m) => m.dirtype === 0 && m.object)
  const totalSize = files.reduce((sum, m) => sum + (m.size ?? 0), 0)
  const allIds = items.map((m) => m.id)
  const byStorage = groupFilesByStorage(files)

  await db.transaction(async (tx: typeof db) => {
    await tx.delete(matters).where(inArray(matters.id, allIds))

    for (const [storageId, { size }] of byStorage) {
      if (size > 0) {
        await tx
          .update(storages)
          .set({ usedBytes: sql`${storages.usedBytes} - ${size}` })
          .where(eq(storages.id, storageId))
      }
    }

    if (totalSize > 0) {
      await tx
        .update(storageQuotas)
        .set({ used: sql`${storageQuotas.used} - ${totalSize}` })
        .where(eq(storageQuotas.uid, userId))
    }
  })

  for (const [storageId, { keys }] of byStorage) {
    const [storage] = await db.select().from(storages).where(eq(storages.id, storageId))
    if (storage) {
      const client = createS3Client(storage)
      await deleteObjects(client, storage.bucket, keys)
    }
  }

  return allIds.length
}
