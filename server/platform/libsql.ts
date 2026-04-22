import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import * as authSchema from '../db/auth-schema'
import * as schema from '../db/schema'
import type { Platform } from './interface'

interface LibsqlEnv {
  TURSO_DATABASE_URL: string
  TURSO_AUTH_TOKEN?: string
}

export async function createLibsqlPlatform(env: LibsqlEnv): Promise<Platform> {
  const migrationsFolder = process.env.MIGRATIONS_DIR || './migrations'
  const envRecord: Record<string, string | undefined> = { ...env }

  const client = createClient({
    url: env.TURSO_DATABASE_URL,
    authToken: env.TURSO_AUTH_TOKEN,
  })

  const db = drizzle(client, { schema: { ...schema, ...authSchema } })

  await migrate(db, { migrationsFolder })

  return {
    db,
    getEnv(key: string) {
      return envRecord[key] ?? process.env[key]
    },
  }
}
