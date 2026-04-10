import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core'
import type * as authSchema from '../db/auth-schema'
import type * as appSchema from '../db/schema'

type FullSchema = typeof appSchema & typeof authSchema

// Use base type to unify BetterSQLite3 (sync) and D1 (async) drivers
// biome-ignore lint/suspicious/noExplicitAny: Drizzle drivers differ in result kind and run result types
export type Database = BaseSQLiteDatabase<any, any, FullSchema>

export interface Platform {
  db: Database
  getEnv(key: string): string | undefined
}
