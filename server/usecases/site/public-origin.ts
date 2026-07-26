import { originFromRequestUrl, SITE_PUBLIC_ORIGIN_KEY } from '../../domain/site-public-origin'
import type { CacheService, SystemOptionsRepo } from '../ports'
import { getSiteRoutingConfig, refreshSiteRoutingConfig } from './routing-config'

export function resetSitePublicOriginCache() {
  // Kept for test compatibility. Cache lifetime now belongs to each runtime.
}

export type SitePublicOriginDeps = { systemOptions: SystemOptionsRepo; cache?: CacheService }

export interface EnsureSitePublicOriginResult {
  origin: string | null
  created: boolean
}

export async function getSitePublicOrigin(deps: SitePublicOriginDeps): Promise<string | null> {
  return (await getSiteRoutingConfig(deps)).publicOrigin
}

export async function ensureSitePublicOrigin(
  deps: SitePublicOriginDeps,
  requestUrl: string,
): Promise<EnsureSitePublicOriginResult> {
  const existing = await getSitePublicOrigin(deps)
  if (existing) {
    return { origin: existing, created: false }
  }

  const origin = originFromRequestUrl(requestUrl)
  if (!origin) return { origin: null, created: false }

  // Concurrent first requests may race here; both write the same resolved origin,
  // so the re-read below settles on the persisted value either way.
  await deps.systemOptions.set(SITE_PUBLIC_ORIGIN_KEY, origin)

  const saved = (await refreshSiteRoutingConfig(deps)).publicOrigin
  return { origin: saved, created: saved === origin }
}
