import { and, eq, gte, inArray, lt } from 'drizzle-orm'
import { systemOptions } from '../../db/schema'
import { executeWriteTransaction } from '../../db/transaction'
import type { Database } from '../../platform/interface'
import type { SystemOption, SystemOptionsRepo } from '../../usecases/ports'

function toOption(row: { key: string; value: string }): SystemOption {
  return { key: row.key, value: row.value }
}

export function createSystemOptionsRepo(db: Database): SystemOptionsRepo {
  return {
    async get(key) {
      const rows = await db.select().from(systemOptions).where(eq(systemOptions.key, key)).limit(1)
      return rows[0] ? toOption(rows[0]) : null
    },

    async getValue(key) {
      const rows = await db
        .select({ value: systemOptions.value })
        .from(systemOptions)
        .where(eq(systemOptions.key, key))
        .limit(1)
      return rows[0]?.value ?? null
    },

    async getMany(keys) {
      if (keys.length === 0) return []
      const rows = await db.select().from(systemOptions).where(inArray(systemOptions.key, keys))
      return rows.map(toOption)
    },

    async listByPrefix(prefix) {
      const rows = await db
        .select()
        .from(systemOptions)
        .where(and(gte(systemOptions.key, prefix), lt(systemOptions.key, `${prefix}\uffff`)))
      return rows.map(toOption)
    },

    async set(key, value) {
      await db
        .insert(systemOptions)
        .values({ key, value })
        .onConflictDoUpdate({ target: systemOptions.key, set: { value } })
    },

    async setMany(entries) {
      await executeWriteTransaction(
        db,
        entries.map(({ key, value }) =>
          db
            .insert(systemOptions)
            .values({ key, value })
            .onConflictDoUpdate({ target: systemOptions.key, set: { value } }),
        ),
      )
    },

    async delete(key) {
      await db.delete(systemOptions).where(eq(systemOptions.key, key))
    },
  }
}
