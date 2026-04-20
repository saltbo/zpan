// Integration-project tests for src/lib/api.ts share wrapper functions.
// These run in the integration vitest project so codecov picks them up for patch coverage.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, deleteShare, getShare, listShares } from './api'

function makeResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Forbidden',
    json: async () => body,
  } as unknown as Response
}

describe('shares API wrappers (integration)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('listShares', () => {
    it('calls /api/shares with default params and returns payload', async () => {
      const payload = { items: [], total: 0, page: 1, pageSize: 20 }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))

      const result = await listShares()

      expect(result).toEqual(payload)
      const [url] = vi.mocked(fetch).mock.calls[0] as [string]
      expect(url).toContain('/api/shares')
      expect(url).toContain('page=1')
      expect(url).toContain('pageSize=20')
    })

    it('forwards page, pageSize, and status query params', async () => {
      const payload = { items: [], total: 3, page: 2, pageSize: 10 }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))

      await listShares(2, 10, 'active')

      const [url] = vi.mocked(fetch).mock.calls[0] as [string]
      expect(url).toContain('page=2')
      expect(url).toContain('pageSize=10')
      expect(url).toContain('status=active')
    })

    it('throws ApiError on non-ok response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'unauthorized' }, false, 401))

      await expect(listShares()).rejects.toThrow('unauthorized')
    })
  })

  describe('getShare', () => {
    it('calls /api/shares/:id and returns share detail', async () => {
      const payload = { id: 'share-1', token: 'abc', kind: 'landing' }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))

      const result = await getShare('share-1')

      expect(result).toEqual(payload)
      const [url] = vi.mocked(fetch).mock.calls[0] as [string]
      expect(url).toContain('/api/shares/share-1')
    })

    it('throws ApiError on 404 response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'Not found' }, false, 404))

      await expect(getShare('missing')).rejects.toThrow('Not found')
    })
  })

  describe('deleteShare', () => {
    it('calls DELETE /api/shares/:id and resolves on 204', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({ ok: true, status: 204 } as Response)

      await expect(deleteShare('share-1')).resolves.toBeUndefined()
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/shares/share-1')
      expect(init.method).toBe('DELETE')
    })

    it('throws ApiError on non-ok response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 403, statusText: 'Forbidden' } as Response)

      await expect(deleteShare('share-1')).rejects.toBeInstanceOf(ApiError)
    })
  })
})
