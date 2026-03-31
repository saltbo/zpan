import { drizzle } from 'drizzle-orm/d1'
import * as schema from '../db/schema'
import type { Platform } from './interface'

interface CloudflareEnv {
  DB: D1Database
  [key: string]: unknown
}

export function createCloudflarePlatform(env: CloudflareEnv): Platform {
  const db = drizzle(env.DB, { schema })

  return {
    db,
    getEnv(key: string) {
      return env[key] as string | undefined
    },
  }
}
