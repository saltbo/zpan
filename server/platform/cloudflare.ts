import { drizzle } from 'drizzle-orm/d1'
import * as authSchema from '../db/auth-schema'
import * as schema from '../db/schema'
import { registerEnvPublicKeys } from '../domain/license-keys'
import type { Platform } from './interface'

interface CloudflareEnv {
  DB: D1Database
  [key: string]: unknown
}

export function createCloudflarePlatform(env: CloudflareEnv): Platform {
  const db = drizzle(env.DB, { schema: { ...schema, ...authSchema } })

  registerEnvPublicKeys(typeof env.ZPAN_LICENSE_PUBLIC_KEYS === 'string' ? env.ZPAN_LICENSE_PUBLIC_KEYS : undefined)

  return {
    db,
    getEnv(key: string) {
      const v = env[key]
      return typeof v === 'string' ? v : undefined
    },
    getBinding<T = unknown>(key: string): T | undefined {
      const v = env[key]
      return typeof v === 'object' && v !== null ? (v as T) : undefined
    },
  }
}
