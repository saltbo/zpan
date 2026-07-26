import { normalizePublicOrigin } from '../../domain/site-public-origin'
import type { CachePolicy, CacheService, SystemOptionsRepo } from '../ports'
import { SITE_SETTING_KEYS } from './setting-keys'

export interface SiteRoutingConfig {
  publicOrigin: string | null
  webDavEnabled: boolean
  webDavDomain: string
}

export const SITE_ROUTING_CACHE_KEY = 'site'

export const SITE_ROUTING_CACHE_POLICY: CachePolicy<SiteRoutingConfig> = {
  namespace: 'site-routing',
  version: 1,
  ttlMs: 60_000,
  maxEntries: 1,
  validate(value): value is SiteRoutingConfig {
    if (typeof value !== 'object' || value === null) return false
    const config = value as Partial<SiteRoutingConfig>
    return (
      (typeof config.publicOrigin === 'string' || config.publicOrigin === null) &&
      typeof config.webDavEnabled === 'boolean' &&
      typeof config.webDavDomain === 'string'
    )
  },
}

export type SiteRoutingDeps = {
  systemOptions: SystemOptionsRepo
  cache?: CacheService
}

async function loadSiteRoutingConfig(deps: Pick<SiteRoutingDeps, 'systemOptions'>): Promise<SiteRoutingConfig> {
  const rows = await deps.systemOptions.getMany([
    SITE_SETTING_KEYS.publicOrigin,
    SITE_SETTING_KEYS.webdavEnabled,
    SITE_SETTING_KEYS.webdavDomain,
  ])
  const values = new Map(rows.map((row) => [row.key, row.value]))
  return {
    publicOrigin: normalizePublicOrigin(values.get(SITE_SETTING_KEYS.publicOrigin)),
    webDavEnabled: values.get(SITE_SETTING_KEYS.webdavEnabled) !== 'false',
    webDavDomain: values.get(SITE_SETTING_KEYS.webdavDomain)?.trim() ?? '',
  }
}

export async function getSiteRoutingConfig(deps: SiteRoutingDeps): Promise<SiteRoutingConfig> {
  if (!deps.cache) return loadSiteRoutingConfig(deps)
  return (
    await deps.cache.getOrLoad(SITE_ROUTING_CACHE_POLICY, SITE_ROUTING_CACHE_KEY, () => loadSiteRoutingConfig(deps))
  ).value
}

export async function refreshSiteRoutingConfig(deps: SiteRoutingDeps): Promise<SiteRoutingConfig> {
  const config = await loadSiteRoutingConfig(deps)
  await deps.cache?.replace(SITE_ROUTING_CACHE_POLICY, SITE_ROUTING_CACHE_KEY, config)
  return config
}
