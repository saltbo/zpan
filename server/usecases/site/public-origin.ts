import { normalizePublicOrigin, originFromRequestUrl, SITE_PUBLIC_ORIGIN_KEY } from '../../domain/site-public-origin'
import type { SystemOptionsRepo } from '../ports'

// Resolved origin, cached for the lifetime of the isolate/process. Only the
// settled value is cached — never a pending promise, which on Cloudflare
// Workers would hang any request that awaited it after its creating request
// ended. One worker serves one site, so a single slot is enough; staleness is
// harmless because the middleware only acts when the row is first created.
let cachedOrigin: string | null = null

export function resetSitePublicOriginCache() {
  cachedOrigin = null
}

export type SitePublicOriginDeps = { systemOptions: SystemOptionsRepo }

export interface EnsureSitePublicOriginResult {
  origin: string | null
  created: boolean
}

export async function getSitePublicOrigin(deps: SitePublicOriginDeps): Promise<string | null> {
  return normalizePublicOrigin(await deps.systemOptions.getValue(SITE_PUBLIC_ORIGIN_KEY))
}

export async function ensureSitePublicOrigin(
  deps: SitePublicOriginDeps,
  requestUrl: string,
): Promise<EnsureSitePublicOriginResult> {
  if (cachedOrigin) return { origin: cachedOrigin, created: false }

  const existing = await getSitePublicOrigin(deps)
  if (existing) {
    cachedOrigin = existing
    return { origin: existing, created: false }
  }

  const origin = originFromRequestUrl(requestUrl)
  if (!origin) return { origin: null, created: false }

  // Concurrent first requests may race here; both write the same resolved origin,
  // so the re-read below settles on the persisted value either way.
  await deps.systemOptions.set(SITE_PUBLIC_ORIGIN_KEY, origin)

  const saved = await getSitePublicOrigin(deps)
  if (saved) cachedOrigin = saved
  return { origin: saved, created: saved === origin }
}
