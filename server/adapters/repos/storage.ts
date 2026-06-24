import { and, asc, count, eq, lt, or } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { matters, storages } from '../../db/schema'
import type { Database } from '../../platform/interface'
import type { StorageRecord, StorageRepo } from '../../usecases/ports'

type StorageRow = typeof storages.$inferSelect

function toRecord(row: StorageRow): StorageRecord {
  return row as StorageRecord
}

export function createStorageRepo(db: Database): StorageRepo {
  async function getRow(id: string): Promise<StorageRow | null> {
    const rows = await db.select().from(storages).where(eq(storages.id, id))
    return rows[0] ?? null
  }

  return {
    async list() {
      const rows = await db.select().from(storages).orderBy(asc(storages.createdAt))
      return { items: rows.map(toRecord), total: rows.length }
    },

    async get(id) {
      const row = await getRow(id)
      return row ? toRecord(row) : null
    },

    async create(input) {
      const now = new Date()
      const row: StorageRow = {
        id: nanoid(),
        provider: input.provider ?? '',
        bucket: input.bucket,
        endpoint: input.endpoint,
        region: input.region ?? 'auto',
        accessKey: input.accessKey,
        secretKey: input.secretKey,
        filePath: '',
        customHost: input.customHost ?? '',
        capacity: input.capacity ?? 0,
        egressCreditBillingEnabled: input.egressCreditBillingEnabled ?? false,
        egressCreditUnitBytes: input.egressCreditUnitBytes ?? 104857600,
        egressCreditPerUnit: input.egressCreditPerUnit ?? 1,
        forcePathStyle: input.forcePathStyle ?? true,
        used: 0,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      }
      await db.insert(storages).values(row)
      return toRecord(row)
    },

    async count() {
      const rows = await db.select({ count: count() }).from(storages)
      return rows[0]?.count ?? 0
    },

    async update(id, input) {
      const existing = await getRow(id)
      if (!existing) return null

      const now = new Date()
      const updated = {
        provider: input.provider ?? existing.provider,
        bucket: input.bucket ?? existing.bucket,
        endpoint: input.endpoint ?? existing.endpoint,
        region: input.region ?? existing.region,
        accessKey: input.accessKey ?? existing.accessKey,
        secretKey: input.secretKey ?? existing.secretKey,
        customHost: input.customHost ?? existing.customHost,
        capacity: input.capacity ?? existing.capacity,
        egressCreditBillingEnabled: input.egressCreditBillingEnabled ?? existing.egressCreditBillingEnabled,
        egressCreditUnitBytes: input.egressCreditUnitBytes ?? existing.egressCreditUnitBytes,
        egressCreditPerUnit: input.egressCreditPerUnit ?? existing.egressCreditPerUnit,
        forcePathStyle: input.forcePathStyle ?? existing.forcePathStyle,
        status: input.status ?? existing.status,
        updatedAt: now,
      }

      await db.update(storages).set(updated).where(eq(storages.id, id))
      return toRecord({ ...existing, ...updated })
    },

    async delete(id) {
      const existing = await getRow(id)
      if (!existing) return 'not_found'

      const refs = await db.select({ count: count() }).from(matters).where(eq(matters.storageId, id))
      if ((refs[0]?.count ?? 0) > 0) return 'in_use'

      await db.delete(storages).where(eq(storages.id, id))
      return 'ok'
    },

    async select(id) {
      const rows = await db
        .select()
        .from(storages)
        .where(
          and(
            id ? eq(storages.id, id) : undefined,
            eq(storages.status, 'active'),
            or(eq(storages.capacity, 0), lt(storages.used, storages.capacity)),
          ),
        )
        .orderBy(asc(storages.createdAt))
        .limit(1)

      if (rows.length === 0) throw new Error('No available storage')
      return toRecord(rows[0])
    },
  }
}
