import { describe, expect, it } from 'vitest'
import type { Platform } from '../platform/interface'
import { decodePageToken, encodePageToken, pageQueryFingerprint } from './page-token'

function platform(secret = 'test-secret'): Platform {
  return {
    db: {} as Platform['db'],
    getBinding: () => undefined,
    getEnv: (key) => (key === 'BETTER_AUTH_SECRET' ? secret : undefined),
  }
}

describe('page tokens', () => {
  it('round-trips a signed boundary', async () => {
    const query = await pageQueryFingerprint({ status: 'active', sort: ['createdAt', 'desc'] })
    const token = await encodePageToken(platform(), {
      boundary: { createdAt: 123, id: 'item-1' },
      query,
      now: 1_000,
    })

    await expect(decodePageToken(platform(), token, { query, now: 2_000 })).resolves.toEqual({
      createdAt: 123,
      id: 'item-1',
    })
  })

  it('rejects tampering, query mismatches, and expired tokens', async () => {
    const query = await pageQueryFingerprint({ status: 'active' })
    const token = await encodePageToken(platform(), {
      boundary: { id: 'item-1' },
      query,
      now: 1_000,
    })

    await expect(decodePageToken(platform(), `${token}x`, { query, now: 2_000 })).rejects.toMatchObject({
      httpStatus: 400,
      meta: { reason: 'INVALID_PAGE_TOKEN' },
    })
    await expect(decodePageToken(platform(), token, { query: 'different', now: 2_000 })).rejects.toMatchObject({
      httpStatus: 400,
      meta: { reason: 'INVALID_PAGE_TOKEN' },
    })
    await expect(
      decodePageToken(platform(), token, { query, now: 1_000 + 72 * 60 * 60 * 1_000 }),
    ).rejects.toMatchObject({
      httpStatus: 400,
      meta: { reason: 'INVALID_PAGE_TOKEN' },
    })
  })
})
