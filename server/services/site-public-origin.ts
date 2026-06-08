import { eq } from 'drizzle-orm'
import { systemOptions } from '../db/schema'
import type { Database } from '../platform/interface'

export const SITE_PUBLIC_ORIGIN_KEY = 'site_public_origin'

const ensuredOrigins = new WeakMap<object, string>()
const ensurePromises = new WeakMap<object, Promise<EnsureSitePublicOriginResult>>()

export interface EnsureSitePublicOriginResult {
  origin: string | null
  created: boolean
}

export async function getSitePublicOrigin(db: Database): Promise<string | null> {
  const rows = await db
    .select({ value: systemOptions.value })
    .from(systemOptions)
    .where(eq(systemOptions.key, SITE_PUBLIC_ORIGIN_KEY))
    .limit(1)

  return normalizePublicOrigin(rows[0]?.value)
}

export async function ensureSitePublicOrigin(db: Database, requestUrl: string): Promise<EnsureSitePublicOriginResult> {
  const cached = ensuredOrigins.get(db)
  if (cached) return { origin: cached, created: false }
  const pending = ensurePromises.get(db)
  if (pending) return pending

  const promise = ensureSitePublicOriginUncached(db, requestUrl).finally(() => {
    ensurePromises.delete(db)
  })
  ensurePromises.set(db, promise)

  return promise
}

async function ensureSitePublicOriginUncached(db: Database, requestUrl: string): Promise<EnsureSitePublicOriginResult> {
  const existing = await getSitePublicOrigin(db)
  if (existing) {
    ensuredOrigins.set(db, existing)
    return { origin: existing, created: false }
  }

  const origin = originFromRequestUrl(requestUrl)
  if (!origin) return { origin: null, created: false }

  await db
    .insert(systemOptions)
    .values({ key: SITE_PUBLIC_ORIGIN_KEY, value: origin, public: false })
    .onConflictDoNothing({ target: systemOptions.key })

  const saved = await getSitePublicOrigin(db)
  if (saved) ensuredOrigins.set(db, saved)
  return { origin: saved, created: saved === origin }
}

export function originFromRequestUrl(requestUrl: string): string | null {
  try {
    const url = new URL(requestUrl)
    return normalizePublicOrigin(url.origin)
  } catch {
    return null
  }
}

export function normalizePublicOrigin(value: string | undefined | null): string | null {
  const input = value?.trim()
  if (!input) return null

  try {
    const url = new URL(input)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.origin
  } catch {
    return null
  }
}
