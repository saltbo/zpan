import { eq, like } from 'drizzle-orm'
import { systemOptions } from '../../db/schema'
import type { Database } from '../../platform/interface'
import type { SystemOption, SystemOptionsRepo } from '../../usecases/ports'

function toOption(row: { key: string; value: string; public: boolean | null }): SystemOption {
  return { key: row.key, value: row.value, public: !!row.public }
}

export function createSystemOptionsRepo(db: Database): SystemOptionsRepo {
  return {
    async list() {
      const rows = await db.select().from(systemOptions)
      return rows.map(toOption)
    },

    async listPublic() {
      const rows = await db.select().from(systemOptions).where(eq(systemOptions.public, true))
      return rows.map(toOption)
    },

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

    async listByKeyLike(pattern) {
      return db
        .select({ key: systemOptions.key, value: systemOptions.value })
        .from(systemOptions)
        .where(like(systemOptions.key, pattern))
    },

    async set(key, value, isPublic) {
      await db
        .insert(systemOptions)
        .values({ key, value, public: isPublic })
        .onConflictDoUpdate({ target: systemOptions.key, set: { value, public: isPublic } })
    },

    async delete(key) {
      await db.delete(systemOptions).where(eq(systemOptions.key, key))
    },
  }
}
