import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import * as authSchema from '../db/auth-schema'
import * as schema from '../db/schema'
import type { Platform } from './interface'

export function createNodePlatform(): Platform {
  const dbPath = process.env.DATABASE_URL || './zpan.db'
  const migrationsFolder = process.env.MIGRATIONS_DIR || './migrations'

  const sqlite = new Database(dbPath)
  sqlite.pragma('journal_mode = WAL')
  const db = drizzle(sqlite, { schema: { ...schema, ...authSchema } })

  migrate(db, { migrationsFolder })

  return {
    db,
    getEnv(key: string) {
      return process.env[key]
    },
    // Node has no platform-native bindings — callers always fall back to
    // whatever the non-binding path does (e.g. DB-configured S3 storage).
    getBinding<T = unknown>(_key: string): T | undefined {
      return undefined
    },
  }
}
