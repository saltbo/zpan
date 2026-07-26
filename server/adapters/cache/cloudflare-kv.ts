import type { DistributedCacheBackend } from '../../usecases/ports/cache'

export interface CloudflareKvNamespaceLike {
  get(key: string, options: { cacheTtl: number }): Promise<string | null>
  put(key: string, value: string, options: { expirationTtl: number }): Promise<void>
  delete(key: string): Promise<void>
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
