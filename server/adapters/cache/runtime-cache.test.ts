import { describe, expect, it, vi } from 'vitest'
import type { CachePolicy, DistributedCacheBackend } from '../../usecases/ports'
import { createRuntimeCache, resolveCacheMode } from './runtime-cache'

const stringPolicy: CachePolicy<string | null> = {
  namespace: 'test',
  version: 2,
  ttlMs: 1_000,
  negativeTtlMs: 100,
  maxEntries: 2,
  validate(value): value is string | null {
    return typeof value === 'string' || value === null
  },
}

function fakeBackend() {
  const values = new Map<string, string>()
  const backend: DistributedCacheBackend = {
    get: vi.fn(async (key) => values.get(key) ?? null),
    put: vi.fn(async (key, value) => {
      values.set(key, value)
    }),
    delete: vi.fn(async (key) => {
      values.delete(key)
    }),
  }
  return { backend, values }
}

describe('runtime cache', () => {
  it('bypasses every tier when disabled', async () => {
    const loader = vi.fn(async () => 'source')
    const cache = createRuntimeCache({ mode: 'off' })

    expect(await cache.getOrLoad(stringPolicy, 'a', loader)).toMatchObject({ value: 'source', tier: 'bypass' })
    expect(await cache.getOrLoad(stringPolicy, 'a', loader)).toMatchObject({ value: 'source', tier: 'bypass' })
    expect(loader).toHaveBeenCalledTimes(2)
  })

  it('serves fresh values from memory and reloads expired values', async () => {
    let now = 1_000
    const loader = vi.fn(async () => `value-${loader.mock.calls.length}`)
    const cache = createRuntimeCache({ mode: 'memory', now: () => now })

    expect((await cache.getOrLoad(stringPolicy, 'a', loader)).tier).toBe('source')
    expect(await cache.getOrLoad(stringPolicy, 'a', loader)).toMatchObject({ value: 'value-1', tier: 'memory' })
    now = 2_001
    expect(await cache.getOrLoad(stringPolicy, 'a', loader)).toMatchObject({ value: 'value-2', tier: 'source' })
  })

  it('uses the shorter negative-cache TTL', async () => {
    let now = 1_000
    const loader = vi.fn(async () => null)
    const cache = createRuntimeCache({ mode: 'memory', now: () => now })

    await cache.getOrLoad(stringPolicy, 'missing', loader)
    now = 1_099
    expect((await cache.getOrLoad(stringPolicy, 'missing', loader)).tier).toBe('memory')
    now = 1_101
    expect((await cache.getOrLoad(stringPolicy, 'missing', loader)).tier).toBe('source')
  })

  it('evicts the least recently used entry at the policy capacity', async () => {
    const cache = createRuntimeCache({ mode: 'memory' })
    await cache.replace(stringPolicy, 'a', 'a')
    await cache.replace(stringPolicy, 'b', 'b')
    await cache.getOrLoad(stringPolicy, 'a', async () => 'unexpected')
    await cache.replace(stringPolicy, 'c', 'c')

    expect((await cache.getOrLoad(stringPolicy, 'a', async () => 'unexpected')).tier).toBe('memory')
    expect((await cache.getOrLoad(stringPolicy, 'b', async () => 'reloaded')).tier).toBe('source')
  })

  it('reads through distributed cache and populates memory', async () => {
    let now = 1_000
    const { backend, values } = fakeBackend()
    values.set('zpan:v2:test:a', JSON.stringify({ freshUntil: 1_500, value: 'kv' }))
    const cache = createRuntimeCache({ mode: 'distributed', distributed: backend, now: () => now })
    const loader = vi.fn(async () => 'source')

    expect(await cache.getOrLoad(stringPolicy, 'a', loader)).toMatchObject({ value: 'kv', tier: 'distributed' })
    now = 1_100
    expect((await cache.getOrLoad(stringPolicy, 'a', loader)).tier).toBe('memory')
    expect(loader).not.toHaveBeenCalled()
  })

  it('keeps memory-only policies out of the distributed backend', async () => {
    const { backend } = fakeBackend()
    const cache = createRuntimeCache({ mode: 'distributed', distributed: backend })
    const memoryOnlyPolicy = { ...stringPolicy, namespace: 'sensitive', distributed: false }

    expect(await cache.getOrLoad(memoryOnlyPolicy, 'a', async () => 'source')).toMatchObject({
      value: 'source',
      tier: 'source',
    })
    expect(await cache.getOrLoad(memoryOnlyPolicy, 'a', async () => 'unexpected')).toMatchObject({
      value: 'source',
      tier: 'memory',
    })
    await cache.replace(memoryOnlyPolicy, 'b', 'replacement')
    await cache.invalidate(memoryOnlyPolicy, 'a')

    expect(backend.get).not.toHaveBeenCalled()
    expect(backend.put).not.toHaveBeenCalled()
    expect(backend.delete).not.toHaveBeenCalled()
  })

  it('rejects expired or invalid distributed envelopes and refreshes them from source', async () => {
    const { backend, values } = fakeBackend()
    values.set('zpan:v2:test:expired', JSON.stringify({ freshUntil: 999, value: 'old' }))
    values.set('zpan:v2:test:invalid', JSON.stringify({ freshUntil: 2_000, value: 123 }))
    const cache = createRuntimeCache({ mode: 'distributed', distributed: backend, now: () => 1_000 })

    expect(await cache.getOrLoad(stringPolicy, 'expired', async () => 'fresh')).toMatchObject({
      value: 'fresh',
      tier: 'source',
    })
    expect(await cache.getOrLoad(stringPolicy, 'invalid', async () => 'valid')).toMatchObject({
      value: 'valid',
      tier: 'source',
    })
  })

  it('falls back to source when distributed reads fail', async () => {
    const backend: DistributedCacheBackend = {
      get: vi.fn(async () => {
        throw new Error('unavailable')
      }),
      put: vi.fn(async () => {
        throw new Error('unavailable')
      }),
      delete: vi.fn(async () => {
        throw new Error('unavailable')
      }),
    }
    const cache = createRuntimeCache({ mode: 'distributed', distributed: backend })

    expect(await cache.getOrLoad(stringPolicy, 'a', async () => 'source')).toMatchObject({
      value: 'source',
      tier: 'source',
    })
    await expect(cache.invalidate(stringPolicy, 'a')).resolves.toBeUndefined()
  })

  it('replace updates both tiers and invalidate removes both tiers', async () => {
    const { backend, values } = fakeBackend()
    const cache = createRuntimeCache({ mode: 'distributed', distributed: backend })

    await cache.replace(stringPolicy, 'a', 'new')
    expect((await cache.getOrLoad(stringPolicy, 'a', async () => 'source')).value).toBe('new')
    expect(values.has('zpan:v2:test:a')).toBe(true)

    await cache.invalidate(stringPolicy, 'a')
    expect(values.has('zpan:v2:test:a')).toBe(false)
    expect(await cache.getOrLoad(stringPolicy, 'a', async () => 'source')).toMatchObject({
      value: 'source',
      tier: 'source',
    })
  })
})

describe('resolveCacheMode', () => {
  it('uses the runtime-appropriate default', () => {
    expect(resolveCacheMode(undefined, false)).toBe('memory')
    expect(resolveCacheMode(undefined, true)).toBe('distributed')
  })

  it('validates explicit values and distributed availability', () => {
    expect(resolveCacheMode('off', false)).toBe('off')
    expect(resolveCacheMode('memory', true)).toBe('memory')
    expect(() => resolveCacheMode('invalid', false)).toThrow('Invalid ZPAN_CACHE_MODE')
    expect(() => resolveCacheMode('distributed', false)).toThrow('requires a distributed cache binding')
    expect(() => createRuntimeCache({ mode: 'distributed' })).toThrow('requires a backend')
  })
})
