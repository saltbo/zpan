import { eq } from 'drizzle-orm'
import { systemOptions } from '../db/schema'
import type { Database } from '../platform/interface'

export const SITE_PUBLIC_ORIGIN_KEY = 'site_public_origin'

// Resolved origin, cached for the lifetime of the isolate/process. Only the
// settled value is cached — never a pending promise, which on Cloudflare
// Workers would hang any request that awaited it after its creating request
// ended. One worker serves one site, so a single slot is enough; staleness is
// harmless because the middleware only acts when the row is first created.
let cachedOrigin: string | null = null

export function resetSitePublicOriginCache() {
  cachedOrigin = null
}

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
  if (cachedOrigin) return { origin: cachedOrigin, created: false }

  const existing = await getSitePublicOrigin(db)
  if (existing) {
    cachedOrigin = existing
    return { origin: existing, created: false }
  }

  const origin = originFromRequestUrl(requestUrl)
  if (!origin) return { origin: null, created: false }

  // Concurrent first requests may race here; onConflictDoNothing makes the
  // insert idempotent and the re-read below settles on the winning value.
  await db
    .insert(systemOptions)
    .values({ key: SITE_PUBLIC_ORIGIN_KEY, value: origin, public: false })
    .onConflictDoNothing({ target: systemOptions.key })

  const saved = await getSitePublicOrigin(db)
  if (saved) cachedOrigin = saved
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
