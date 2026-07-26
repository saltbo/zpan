import { AsyncLocalStorage } from 'node:async_hooks'
import type { CacheTier } from '../usecases/ports/cache'

export interface CacheEvent {
  namespace: string
  tier: CacheTier
  durationMs: number
}

const cacheEvents = new AsyncLocalStorage<CacheEvent[]>()

export function runWithCacheEvents<T>(callback: () => T): T {
  return cacheEvents.run([], callback)
}

export function recordCacheEvent(event: CacheEvent): void {
  cacheEvents.getStore()?.push(event)
}

export function currentCacheEvents(): readonly CacheEvent[] {
  return cacheEvents.getStore() ?? []
}

export function cacheServerTiming(): string | null {
  const events = currentCacheEvents()
  if (events.length === 0) return null
  return events
    .map(({ namespace, tier, durationMs }) => `zpan-cache;dur=${durationMs.toFixed(1)};desc="${namespace}:${tier}"`)
    .join(', ')
}

export function cacheLogSummary(): string {
  const events = currentCacheEvents()
  if (events.length === 0) return '-'
  return events.map(({ namespace, tier }) => `${namespace}:${tier}`).join(',')
}
