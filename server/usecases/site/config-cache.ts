import { type SiteConfig, siteConfigSchema } from '@shared/schemas'
import type { CachePolicy, CacheService } from '../ports'

export const SITE_CONFIG_CACHE_KEY = 'site'

export const SITE_CONFIG_CACHE_POLICY: CachePolicy<SiteConfig> = {
  namespace: 'site-config',
  version: 1,
  ttlMs: 60_000,
  maxEntries: 1,
  validate(value): value is SiteConfig {
    return siteConfigSchema.safeParse(value).success
  },
}

export async function invalidateSiteConfig(deps: { cache?: CacheService }): Promise<void> {
  await deps.cache?.invalidate(SITE_CONFIG_CACHE_POLICY, SITE_CONFIG_CACHE_KEY)
}

export function siteConfigCacheControl(deps: { cache?: CacheService }): string {
  return deps.cache?.mode === 'off' ? 'no-store' : 'public, max-age=0, s-maxage=60, must-revalidate'
}
