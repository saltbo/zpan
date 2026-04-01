import { drizzle } from 'drizzle-orm/d1'
import * as authSchema from '../db/auth-schema'
import * as schema from '../db/schema'
import type { Platform } from './interface'

interface CloudflareEnv {
  DB: D1Database
  [key: string]: unknown
}

export function createCloudflarePlatform(env: CloudflareEnv): Platform {
  const db = drizzle(env.DB, { schema: { ...schema, ...authSchema } })

  return {
    db,
    getEnv(key: string) {
      return env[key] as string | undefined
    },
  }
}
