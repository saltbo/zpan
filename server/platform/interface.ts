import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import type { DrizzleD1Database } from 'drizzle-orm/d1'
import type * as authSchema from '../db/auth-schema'
import type * as appSchema from '../db/schema'

type FullSchema = typeof appSchema & typeof authSchema

export type Database = BetterSQLite3Database<FullSchema> | DrizzleD1Database<FullSchema>

export interface Platform {
  db: Database
  getEnv(key: string): string | undefined
}
