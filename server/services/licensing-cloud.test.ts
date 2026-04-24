import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CloudNetworkError, CloudUnboundError, createPairing, pollPairing, refreshEntitlement } from './licensing-cloud'

const BASE_URL = 'https://cloud.zpan.space'

function makeResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

describe('licensing-cloud', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('createPairing', () => {
    it('sends POST to /api/pairings with instance info', async () => {
      const payload = {
        code: 'ABC-123',
        pairing_url: 'https://cloud.zpan.space/pair',
        expires_at: '2026-01-01T00:00:00Z',
      }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))

      const result = await createPairing(BASE_URL, 'inst-1', 'My ZPan', 'zpan.example.com')

      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toBe('https://cloud.zpan.space/api/pairings')
      expect(init.method).toBe('POST')
      const body = JSON.parse(init.body as string)
      expect(body.instance_id).toBe('inst-1')
      expect(body.instance_name).toBe('My ZPan')
      expect(body.instance_host).toBe('zpan.example.com')
      expect(result).toEqual(payload)
    })

    it('throws on non-OK response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'Bad Request' }, 400))

      await expect(createPairing(BASE_URL, 'inst-1', 'ZPan', 'host')).rejects.toThrow('Cloud pairing failed')
    })

    it('throws CloudNetworkError on fetch failure', async () => {
      vi.mocked(fetch).mockRejectedValueOnce(new Error('Network error'))

      await expect(createPairing(BASE_URL, 'inst-1', 'ZPan', 'host')).rejects.toThrow(CloudNetworkError)
    })
  })

  describe('pollPairing', () => {
    it('sends GET to /api/pairings/:code', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ status: 'pending' }))

      await pollPairing(BASE_URL, 'ABC-123')

      const [url] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toBe('https://cloud.zpan.space/api/pairings/ABC-123')
    })

    it('returns pending status', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ status: 'pending' }))

      const result = await pollPairing(BASE_URL, 'CODE-1')
      expect(result.status).toBe('pending')
    })

    it('returns approved status with refresh_token and entitlement', async () => {
      const payload = {
        status: 'approved',
        refresh_token: 'rt-token',
        entitlement: 'v4.public.token',
      }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))

      const result = await pollPairing(BASE_URL, 'CODE-2')
      expect(result.status).toBe('approved')
      expect(result.refresh_token).toBe('rt-token')
    })

    it('throws on non-OK response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'Not Found' }, 404))

      await expect(pollPairing(BASE_URL, 'BAD')).rejects.toThrow('Cloud poll failed')
    })

    it('throws CloudNetworkError on fetch failure', async () => {
      vi.mocked(fetch).mockRejectedValueOnce(new Error('Timeout'))

      await expect(pollPairing(BASE_URL, 'CODE')).rejects.toThrow(CloudNetworkError)
    })
  })

  describe('refreshEntitlement', () => {
    it('sends POST to /api/entitlements with refresh_token', async () => {
      const payload = { refresh_token: 'new-rt', entitlement: 'v4.public.newtoken' }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))

      const result = await refreshEntitlement(BASE_URL, 'old-rt')

      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toBe('https://cloud.zpan.space/api/entitlements')
      expect(init.method).toBe('POST')
      const body = JSON.parse(init.body as string)
      expect(body.refresh_token).toBe('old-rt')
      expect(result.refresh_token).toBe('new-rt')
    })

    it('throws CloudUnboundError on 401', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'Unbound' }, 401))

      await expect(refreshEntitlement(BASE_URL, 'old-rt')).rejects.toThrow(CloudUnboundError)
    })

    it('throws on other non-OK response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'Server Error' }, 500))

      await expect(refreshEntitlement(BASE_URL, 'old-rt')).rejects.toThrow('Cloud refresh failed')
    })

    it('throws CloudNetworkError on fetch failure', async () => {
      vi.mocked(fetch).mockRejectedValueOnce(new Error('Connection refused'))

      await expect(refreshEntitlement(BASE_URL, 'old-rt')).rejects.toThrow(CloudNetworkError)
    })
  })
})
