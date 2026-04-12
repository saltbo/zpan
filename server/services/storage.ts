import { and, asc, count, eq, lt, or } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import type { CreateStorageInput, UpdateStorageInput } from '../../shared/schemas'
import { matters, storages } from '../db/schema'
import type { Database } from '../platform/interface'

export type Storage = typeof storages.$inferSelect

export async function listStorages(db: Database): Promise<{ items: Storage[]; total: number }> {
  const items = await db.select().from(storages).orderBy(asc(storages.createdAt))
  return { items, total: items.length }
}

export async function getStorage(db: Database, id: string): Promise<Storage | null> {
  const rows = await db.select().from(storages).where(eq(storages.id, id))
  return rows[0] ?? null
}

export async function createStorage(db: Database, input: CreateStorageInput): Promise<Storage> {
  const now = new Date()
  const row: Storage = {
    id: nanoid(),
    title: input.title,
    mode: input.mode,
    bucket: input.bucket,
    endpoint: input.endpoint,
    region: input.region,
    accessKey: input.accessKey,
    secretKey: input.secretKey,
    filePath: '',
    customHost: input.customHost ?? '',
    capacity: input.capacity ?? 0,
    used: 0,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  }

  await db.insert(storages).values(row)
  return row
}

export async function updateStorage(db: Database, id: string, input: UpdateStorageInput): Promise<Storage | null> {
  const existing = await getStorage(db, id)
  if (!existing) return null

  const now = new Date()
  const updated = {
    title: input.title ?? existing.title,
    mode: input.mode ?? existing.mode,
    bucket: input.bucket ?? existing.bucket,
    endpoint: input.endpoint ?? existing.endpoint,
    region: input.region ?? existing.region,
    accessKey: input.accessKey ?? existing.accessKey,
    secretKey: input.secretKey ?? existing.secretKey,
    customHost: input.customHost ?? existing.customHost,
    capacity: input.capacity ?? existing.capacity,
    status: input.status ?? existing.status,
    updatedAt: now,
  }

  await db.update(storages).set(updated).where(eq(storages.id, id))
  return { ...existing, ...updated }
}

export async function deleteStorage(db: Database, id: string): Promise<'ok' | 'not_found' | 'in_use'> {
  const existing = await getStorage(db, id)
  if (!existing) return 'not_found'

  const refs = await db.select({ count: count() }).from(matters).where(eq(matters.storageId, id))
  if ((refs[0]?.count ?? 0) > 0) return 'in_use'

  await db.delete(storages).where(eq(storages.id, id))
  return 'ok'
}

export async function selectStorage(db: Database, mode: 'private' | 'public'): Promise<Storage> {
  const rows = await db
    .select()
    .from(storages)
    .where(
      and(
        eq(storages.mode, mode),
        eq(storages.status, 'active'),
        or(eq(storages.capacity, 0), lt(storages.used, storages.capacity)),
      ),
    )
    .orderBy(asc(storages.createdAt))
    .limit(1)

  if (rows.length === 0) throw new Error('No available storage')
  return rows[0]
}
