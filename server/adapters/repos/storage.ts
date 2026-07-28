import { and, asc, count, eq, isNull, lt, or } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { matters, storages } from '../../db/schema'
import type { Database } from '../../platform/interface'
import type { CachePolicy, CacheService, StorageRecord, StorageRepo } from '../../usecases/ports'

type StorageRow = typeof storages.$inferSelect
const CONNECTION_FIELDS = [
  'provider',
  'bucket',
  'endpoint',
  'region',
  'accessKey',
  'secretKey',
  'forcePathStyle',
] as const

const STORAGE_CACHE_POLICY: CachePolicy<StorageRecord | null> = {
  namespace: 'storage-connection',
  version: 1,
  ttlMs: 30_000,
  negativeTtlMs: 1_000,
  maxEntries: 64,
  distributed: false,
  validate(value): value is StorageRecord | null {
    if (value === null) return true
    if (typeof value !== 'object') return false
    const storage = value as Partial<StorageRecord>
    return (
      typeof storage.id === 'string' &&
      typeof storage.bucket === 'string' &&
      typeof storage.accessKey === 'string' &&
      typeof storage.secretKey === 'string' &&
      storage.createdAt instanceof Date &&
      storage.updatedAt instanceof Date
    )
  },
}

function toRecord(row: StorageRow): StorageRecord {
  const { customHost: _legacyCustomHost, ...record } = row
  return record as StorageRecord
}

export function createStorageRepo(db: Database, cache?: CacheService): StorageRepo {
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
      if (!cache) {
        const row = await getRow(id)
        return row ? toRecord(row) : null
      }
      return (
        await cache.getOrLoad(STORAGE_CACHE_POLICY, id, async () => {
          const row = await getRow(id)
          return row ? toRecord(row) : null
        })
      ).value
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
        customHost: '',
        capacity: input.capacity ?? 0,
        egressCreditBillingEnabled: input.egressCreditBillingEnabled ?? false,
        egressCreditUnitBytes: input.egressCreditUnitBytes ?? 104857600,
        egressCreditPerUnit: input.egressCreditPerUnit ?? 1,
        forcePathStyle: input.forcePathStyle ?? true,
        used: 0,
        enabled: true,
        status: 'unknown',
        statusReason: null,
        statusCheckedAt: null,
        createdAt: now,
        updatedAt: now,
      }
      await db.insert(storages).values(row)
      const record = toRecord(row)
      await cache?.replace(STORAGE_CACHE_POLICY, record.id, record)
      return record
    },

    async count() {
      const rows = await db.select({ count: count() }).from(storages)
      return rows[0]?.count ?? 0
    },

    async replace(id, input) {
      const existing = await getRow(id)
      if (!existing) return null

      const now = new Date()
      const connectionChanged = CONNECTION_FIELDS.some((field) => input[field] !== existing[field])
      const updated = {
        ...input,
        ...(connectionChanged ? { status: 'unknown', statusReason: null, statusCheckedAt: null } : {}),
        updatedAt: now,
      }

      await db.update(storages).set(updated).where(eq(storages.id, id))
      const record = toRecord({ ...existing, ...updated })
      await cache?.replace(STORAGE_CACHE_POLICY, id, record)
      return record
    },

    async patch(id, input) {
      const existing = await getRow(id)
      if (!existing) return null

      const now = new Date()
      const connectionChanged = CONNECTION_FIELDS.some(
        (field) => input[field] !== undefined && input[field] !== existing[field],
      )
      const updated = {
        ...input,
        ...(connectionChanged ? { status: 'unknown', statusReason: null, statusCheckedAt: null } : {}),
        ...(input.status === undefined || connectionChanged
          ? {}
          : { statusReason: input.statusReason ?? null, statusCheckedAt: now }),
        updatedAt: now,
      }

      await db.update(storages).set(updated).where(eq(storages.id, id))
      const record = toRecord({ ...existing, ...updated })
      await cache?.replace(STORAGE_CACHE_POLICY, id, record)
      return record
    },

    async delete(id) {
      const existing = await getRow(id)
      if (!existing) return 'not_found'

      const refs = await db
        .select({ count: count() })
        .from(matters)
        .where(and(eq(matters.storageId, id), isNull(matters.purgedAt)))
      if ((refs[0]?.count ?? 0) > 0) return 'in_use'

      await db.delete(storages).where(eq(storages.id, id))
      await cache?.invalidate(STORAGE_CACHE_POLICY, id)
      return 'ok'
    },

    async select(id) {
      const rows = await db
        .select()
        .from(storages)
        .where(
          and(
            id ? eq(storages.id, id) : undefined,
            eq(storages.enabled, true),
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
