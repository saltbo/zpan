import { sql } from 'drizzle-orm'
import type { Database } from '../platform/interface'

type SystemOption = { key: string; value: string; public: boolean }

export async function getOption(db: Database, key: string): Promise<SystemOption | null> {
  const rows = await db.all<{ key: string; value: string; public: number }>(sql`
    SELECT key, value, public FROM system_options WHERE key = ${key} LIMIT 1
  `)
  if (!rows[0]) return null
  return { key: rows[0].key, value: rows[0].value, public: !!rows[0].public }
}

export async function listPublicOptions(db: Database): Promise<Pick<SystemOption, 'key' | 'value'>[]> {
  return db.all<{ key: string; value: string }>(sql`
    SELECT key, value FROM system_options WHERE public = 1
  `)
}

export async function upsertOption(db: Database, key: string, value: string, isPublic?: boolean): Promise<void> {
  if (isPublic !== undefined) {
    await db.run(sql`
      INSERT INTO system_options (key, value, public) VALUES (${key}, ${value}, ${isPublic ? 1 : 0})
        ON CONFLICT(key) DO UPDATE SET value = ${value}, public = ${isPublic ? 1 : 0}
    `)
  } else {
    await db.run(sql`
      INSERT INTO system_options (key, value) VALUES (${key}, ${value})
        ON CONFLICT(key) DO UPDATE SET value = ${value}
    `)
  }
}
