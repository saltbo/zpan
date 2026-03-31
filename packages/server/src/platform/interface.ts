import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core'
import type * as schema from '../db/schema'
import type * as authSchema from '../db/auth-schema'

type FullSchema = typeof schema & typeof authSchema

export type Database = BaseSQLiteDatabase<'sync' | 'async', unknown, FullSchema>

export interface Platform {
  db: Database
  getEnv(key: string): string | undefined
}
