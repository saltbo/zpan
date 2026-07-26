export type CacheMode = 'off' | 'memory' | 'distributed'

export type CacheTier = 'bypass' | 'memory' | 'distributed' | 'source'

export interface CachePolicy<T> {
  namespace: string
  version: number
  ttlMs: number
  negativeTtlMs?: number
  maxEntries: number
  validate(value: unknown): value is T
}

export interface CacheResult<T> {
  value: T
  tier: CacheTier
}

export interface DistributedCacheBackend {
  get(key: string, cacheTtlSeconds: number): Promise<string | null>
  put(key: string, value: string, expirationTtlSeconds: number): Promise<void>
  delete(key: string): Promise<void>
}

export interface CacheService {
  readonly mode: CacheMode
  getOrLoad<T>(policy: CachePolicy<T>, key: string, loader: () => Promise<T>): Promise<CacheResult<T>>
  replace<T>(policy: CachePolicy<T>, key: string, value: T): Promise<void>
  invalidate<T>(policy: CachePolicy<T>, key: string): Promise<void>
}
