import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import type { DrizzleD1Database } from 'drizzle-orm/d1'
import type * as schema from '../db/schema'

export type Database = BetterSQLite3Database<typeof schema> | DrizzleD1Database<typeof schema>

export interface Platform {
  db: Database
  getEnv(key: string): string | undefined
}
