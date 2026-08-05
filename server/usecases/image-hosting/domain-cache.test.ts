import { describe, expect, it, vi } from 'vitest'
import { createRuntimeCache } from '../../adapters/cache/runtime-cache'
import type { DistributedCacheBackend, ImageHostingRepo } from '../ports'
import { resolveCachedImageDomain } from './domain-cache'

describe('image-domain cache normalization boundary', () => {
  it('does not read a legacy v1 host-to-organization entry after the ID migration', async () => {
    const get = vi.fn(async (key: string) =>
      key === 'zpan:v1:image-domain:images.example.com'
        ? JSON.stringify({ freshUntil: 60_000, value: 'LegacyOrgId' })
        : null,
    )
    const distributed: DistributedCacheBackend = {
      get,
      put: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
    }
    const resolveCustomDomain = vi.fn(async () => 'NormalizedOrg123')
    const cache = createRuntimeCache({ mode: 'distributed', distributed, now: () => 1_000 })

    await expect(
      resolveCachedImageDomain(
        {
          cache,
          imageHosting: { resolveCustomDomain } as unknown as ImageHostingRepo,
        },
        'images.example.com',
      ),
    ).resolves.toBe('NormalizedOrg123')
    expect(get).toHaveBeenCalledWith('zpan:v2:image-domain:images.example.com', 60)
    expect(resolveCustomDomain).toHaveBeenCalledWith('images.example.com')
  })
})
