import type { CachePolicy, CacheService, ImageHostingRepo } from '../ports'

export const IMAGE_DOMAIN_CACHE_POLICY: CachePolicy<string | null> = {
  namespace: 'image-domain',
  // v2 isolates post-normalization host -> organization values from legacy KV entries.
  version: 2,
  ttlMs: 60_000,
  negativeTtlMs: 30_000,
  maxEntries: 512,
  validate(value): value is string | null {
    return typeof value === 'string' || value === null
  },
}

export type ImageDomainCacheDeps = {
  cache?: CacheService
  imageHosting: ImageHostingRepo
}

export async function resolveCachedImageDomain(deps: ImageDomainCacheDeps, host: string): Promise<string | null> {
  if (!deps.cache) return deps.imageHosting.resolveCustomDomain(host)
  return (
    await deps.cache.getOrLoad(IMAGE_DOMAIN_CACHE_POLICY, host, () => deps.imageHosting.resolveCustomDomain(host))
  ).value
}

export async function invalidateImageDomain(
  deps: Pick<ImageDomainCacheDeps, 'cache'>,
  host: string | null,
): Promise<void> {
  if (!host) return
  await deps.cache?.invalidate(IMAGE_DOMAIN_CACHE_POLICY, host)
}

export async function cacheVerifiedImageDomain(
  deps: Pick<ImageDomainCacheDeps, 'cache'>,
  host: string,
  orgId: string,
): Promise<void> {
  await deps.cache?.replace(IMAGE_DOMAIN_CACHE_POLICY, host, orgId)
}
