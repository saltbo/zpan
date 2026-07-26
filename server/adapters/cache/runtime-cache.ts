import { recordCacheEvent } from '../../cache/context'
import type {
  CacheMode,
  CachePolicy,
  CacheResult,
  CacheService,
  CacheTier,
  DistributedCacheBackend,
} from '../../usecases/ports/cache'

interface CacheEnvelope {
  freshUntil: number
  value: unknown
}

interface MemoryEntry {
  freshUntil: number
  value: unknown
}

const KV_CACHE_TTL_SECONDS = 60
const KV_EXPIRATION_TTL_SECONDS = 600

export interface RuntimeCacheOptions {
  mode: CacheMode
  distributed?: DistributedCacheBackend
  now?: () => number
}

export function resolveCacheMode(value: string | undefined, distributedAvailable: boolean): CacheMode {
  const mode = value?.trim() || (distributedAvailable ? 'distributed' : 'memory')
  if (mode !== 'off' && mode !== 'memory' && mode !== 'distributed') {
    throw new Error(`Invalid ZPAN_CACHE_MODE: ${mode}`)
  }
  if (mode === 'distributed' && !distributedAvailable) {
    throw new Error('ZPAN_CACHE_MODE=distributed requires a distributed cache binding')
  }
  return mode
}

export function createRuntimeCache(options: RuntimeCacheOptions): CacheService {
  if (options.mode === 'distributed' && !options.distributed) {
    throw new Error('Distributed cache mode requires a backend')
  }

  const stores = new Map<string, Map<string, MemoryEntry>>()
  const loads = new Map<string, Promise<CacheResult<unknown>>>()
  const now = options.now ?? Date.now

  function memoryStore(namespace: string): Map<string, MemoryEntry> {
    let store = stores.get(namespace)
    if (!store) {
      store = new Map()
      stores.set(namespace, store)
    }
    return store
  }

  function memoryGet<T>(policy: CachePolicy<T>, key: string): T | undefined {
    const store = memoryStore(policy.namespace)
    const entry = store.get(key)
    if (!entry) return undefined
    if (entry.freshUntil <= now() || !policy.validate(entry.value)) {
      store.delete(key)
      return undefined
    }
    store.delete(key)
    store.set(key, entry)
    return entry.value
  }

  function ttlFor<T>(policy: CachePolicy<T>, value: T): number {
    return value === null ? (policy.negativeTtlMs ?? policy.ttlMs) : policy.ttlMs
  }

  function memoryPut<T>(policy: CachePolicy<T>, key: string, value: T, freshUntil = now() + ttlFor(policy, value)) {
    const store = memoryStore(policy.namespace)
    store.delete(key)
    store.set(key, { freshUntil, value })
    while (store.size > policy.maxEntries) {
      const oldest = store.keys().next().value
      if (oldest === undefined) break
      store.delete(oldest)
    }
  }

  function cacheKey<T>(policy: CachePolicy<T>, key: string): string {
    return `zpan:v${policy.version}:${policy.namespace}:${key}`
  }

  function usesDistributed<T>(policy: CachePolicy<T>): boolean {
    return options.mode === 'distributed' && policy.distributed !== false
  }

  async function distributedGet<T>(policy: CachePolicy<T>, key: string): Promise<T | undefined> {
    if (!options.distributed) return undefined
    try {
      const raw = await options.distributed.get(cacheKey(policy, key), KV_CACHE_TTL_SECONDS)
      if (!raw) return undefined
      const envelope = JSON.parse(raw) as CacheEnvelope
      if (
        typeof envelope !== 'object' ||
        envelope === null ||
        typeof envelope.freshUntil !== 'number' ||
        envelope.freshUntil <= now() ||
        !policy.validate(envelope.value)
      ) {
        return undefined
      }
      memoryPut(policy, key, envelope.value, envelope.freshUntil)
      return envelope.value
    } catch (error) {
      console.error(
        JSON.stringify({
          message: 'cache.distributed.get.error',
          namespace: policy.namespace,
          error: error instanceof Error ? error.message : String(error),
        }),
      )
      return undefined
    }
  }

  async function distributedPut<T>(policy: CachePolicy<T>, key: string, value: T, freshUntil: number): Promise<void> {
    if (!options.distributed) return
    const envelope: CacheEnvelope = { freshUntil, value }
    try {
      await options.distributed.put(cacheKey(policy, key), JSON.stringify(envelope), KV_EXPIRATION_TTL_SECONDS)
    } catch (error) {
      console.error(
        JSON.stringify({
          message: 'cache.distributed.put.error',
          namespace: policy.namespace,
          error: error instanceof Error ? error.message : String(error),
        }),
      )
    }
  }

  function observed<T>(namespace: string, tier: CacheTier, startedAt: number, value: T): CacheResult<T> {
    recordCacheEvent({ namespace, tier, durationMs: performance.now() - startedAt })
    return { value, tier }
  }

  return {
    mode: options.mode,

    async get<T>(policy: CachePolicy<T>, key: string): Promise<CacheResult<T> | undefined> {
      if (options.mode === 'off') return undefined
      const startedAt = performance.now()
      const inMemory = memoryGet(policy, key)
      if (inMemory !== undefined) return observed(policy.namespace, 'memory', startedAt, inMemory)
      if (!usesDistributed(policy)) return undefined
      const distributed = await distributedGet(policy, key)
      return distributed === undefined ? undefined : observed(policy.namespace, 'distributed', startedAt, distributed)
    },

    async getOrLoad<T>(policy: CachePolicy<T>, key: string, loader: () => Promise<T>): Promise<CacheResult<T>> {
      const startedAt = performance.now()
      if (options.mode === 'off') return observed(policy.namespace, 'bypass', startedAt, await loader())

      const inMemory = memoryGet(policy, key)
      if (inMemory !== undefined) return observed(policy.namespace, 'memory', startedAt, inMemory)

      const loadKey = cacheKey(policy, key)
      const existing = loads.get(loadKey) as Promise<CacheResult<T>> | undefined
      if (existing) {
        const result = await existing
        return observed(policy.namespace, 'coalesced', startedAt, result.value)
      }

      const load = (async (): Promise<CacheResult<T>> => {
        if (usesDistributed(policy)) {
          const distributed = await distributedGet(policy, key)
          if (distributed !== undefined) return { value: distributed, tier: 'distributed' }
        }

        const value = await loader()
        const freshUntil = now() + ttlFor(policy, value)
        memoryPut(policy, key, value, freshUntil)
        if (usesDistributed(policy)) await distributedPut(policy, key, value, freshUntil)
        return { value, tier: 'source' }
      })()
      loads.set(loadKey, load as Promise<CacheResult<unknown>>)
      try {
        const result = await load
        return observed(policy.namespace, result.tier, startedAt, result.value)
      } finally {
        if (loads.get(loadKey) === load) loads.delete(loadKey)
      }
    },

    async replace<T>(policy: CachePolicy<T>, key: string, value: T): Promise<void> {
      if (options.mode === 'off') return
      const freshUntil = now() + ttlFor(policy, value)
      memoryPut(policy, key, value, freshUntil)
      if (usesDistributed(policy)) await distributedPut(policy, key, value, freshUntil)
    },

    async invalidate<T>(policy: CachePolicy<T>, key: string): Promise<void> {
      memoryStore(policy.namespace).delete(key)
      if (!usesDistributed(policy) || !options.distributed) return
      try {
        await options.distributed.delete(cacheKey(policy, key))
      } catch (error) {
        console.error(
          JSON.stringify({
            message: 'cache.distributed.delete.error',
            namespace: policy.namespace,
            error: error instanceof Error ? error.message : String(error),
          }),
        )
      }
    },
  }
}
