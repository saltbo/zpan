import type { DistributedCacheBackend } from '../../usecases/ports/cache'

export interface CloudflareKvNamespaceLike {
  get(key: string, options?: { cacheTtl: number }): Promise<string | null>
  put(key: string, value: string, options?: { expirationTtl: number }): Promise<void>
  delete(key: string): Promise<void>
}

export function createBetterAuthApiKeyStorage(namespace: CloudflareKvNamespaceLike) {
  const storageKey = (key: string) => `better-auth:${key}`

  return {
    get(key: string) {
      return namespace.get(storageKey(key))
    },
    set(key: string, value: string, ttl?: number) {
      return namespace.put(
        storageKey(key),
        value,
        ttl === undefined ? undefined : { expirationTtl: Math.max(60, Math.ceil(ttl)) },
      )
    },
    delete(key: string) {
      return namespace.delete(storageKey(key))
    },
  }
}

export function createCloudflareKvBackend(namespace: CloudflareKvNamespaceLike): DistributedCacheBackend {
  return {
    get(key, cacheTtlSeconds) {
      return namespace.get(key, { cacheTtl: cacheTtlSeconds })
    },
    put(key, value, expirationTtlSeconds) {
      return namespace.put(key, value, { expirationTtl: expirationTtlSeconds })
    },
    delete(key) {
      return namespace.delete(key)
    },
  }
}
