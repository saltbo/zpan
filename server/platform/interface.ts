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
  // Access platform-native bindings (e.g. CF R2 bucket, D1 database).
  // Returns `undefined` on platforms without that binding, so callers branch
  // on the return value to pick a runtime-appropriate code path.
  getBinding<T = unknown>(key: string): T | undefined
}

// R2 bucket binding for self-hosted avatar storage. Present on Cloudflare when the
// `PUBLIC_IMAGES` binding is configured; absent on Node/Docker (callers then fall back to the
// Cloud avatar service).
export const PUBLIC_IMAGES_BINDING = 'PUBLIC_IMAGES'

// Minimal R2 surface we use — typed locally so non-CF builds don't need workers-types.
export interface R2ObjectBodyLike {
  arrayBuffer(): Promise<ArrayBuffer>
  httpMetadata?: { contentType?: string }
}
export interface R2BucketLike {
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | ReadableStream | Blob,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>
  get(key: string): Promise<R2ObjectBodyLike | null>
  delete(key: string): Promise<void>
}
