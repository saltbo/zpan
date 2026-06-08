import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CloudInvalidResponseError,
  CloudNetworkError,
  CloudUnboundError,
  createBoundCloudClient,
  createPairing,
  pollPairing,
  refreshEntitlement,
  requestCloudJson,
  unbindCloudLicense,
} from './licensing-cloud'

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

function headerValue(headers: HeadersInit | undefined, name: string): string | null {
  if (headers instanceof Headers) return headers.get(name)
  if (Array.isArray(headers)) return new Headers(headers).get(name)
  return headers?.[name] ?? null
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
        pairingUrl: 'https://cloud.zpan.space/pair',
        expiresAt: '2026-01-01T00:00:00Z',
      }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))

      const result = await createPairing(BASE_URL, {
        id: 'inst-1',
        name: 'My ZPan',
        url: 'https://zpan.example.com',
        version: '0.0.1',
      })

      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toBe('https://cloud.zpan.space/api/pairings')
      expect(init.method).toBe('POST')
      expect(headerValue(init.headers, 'content-type')).toBe('application/json')
      const body = JSON.parse(init.body as string)
      expect(body).toEqual({
        instance: {
          id: 'inst-1',
          name: 'My ZPan',
          url: 'https://zpan.example.com',
          version: '0.0.1',
        },
      })
      expect(result).toEqual(payload)
    })

    it('throws on non-OK response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'Bad Request' }, 400))

      await expect(
        createPairing(BASE_URL, { id: 'inst-1', name: 'ZPan', url: 'https://zpan.example.com', version: '0.0.1' }),
      ).rejects.toThrow('Cloud pairing failed')
    })

    it('throws CloudNetworkError on fetch failure', async () => {
      vi.mocked(fetch).mockRejectedValueOnce(new Error('Network error'))

      await expect(
        createPairing(BASE_URL, { id: 'inst-1', name: 'ZPan', url: 'https://zpan.example.com', version: '0.0.1' }),
      ).rejects.toThrow(CloudNetworkError)
    })
  })

  describe('pollPairing', () => {
    it('sends GET to /api/pairings/:code', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ status: 'pending' }))

      await pollPairing(BASE_URL, 'ABC-123')

      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toBe('https://cloud.zpan.space/api/pairings/ABC-123')
      expect(headerValue(init.headers, 'content-type')).toBe('application/json')
    })

    it('returns pending status', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ status: 'pending' }))

      const result = await pollPairing(BASE_URL, 'CODE-1')
      expect(result.status).toBe('pending')
    })

    it('returns approved status with refreshToken and entitlement', async () => {
      const payload = {
        status: 'approved',
        refreshToken: 'rt-token',
        certificate: 'v4.public.token',
      }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))

      const result = await pollPairing(BASE_URL, 'CODE-2')
      expect(result.status).toBe('approved')
      expect(result.refreshToken).toBe('rt-token')
      expect(result.certificate).toBe('v4.public.token')
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
    it('sends POST to /api/entitlements with Bearer token', async () => {
      const payload = { refreshToken: 'new-rt', certificate: 'v4.public.newtoken' }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))

      const result = await refreshEntitlement(BASE_URL, 'old-rt')

      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toBe('https://cloud.zpan.space/api/entitlements')
      expect(init.method).toBe('POST')
      expect(headerValue(init.headers, 'Authorization')).toBe('Bearer old-rt')
      expect(init.body).toBeUndefined()
      expect(result.refreshToken).toBe('new-rt')
      expect(result.certificate).toBe('v4.public.newtoken')
    })

    it('sends instance info when refreshing entitlement', async () => {
      const payload = { refreshToken: 'new-rt', certificate: 'v4.public.newtoken' }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))

      await refreshEntitlement(BASE_URL, 'old-rt', {
        id: 'inst-1',
        name: 'My ZPan',
        url: 'https://zpan.example.com',
        version: '0.0.1',
      })

      const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(JSON.parse(init.body as string)).toEqual({
        instance: {
          id: 'inst-1',
          name: 'My ZPan',
          url: 'https://zpan.example.com',
          version: '0.0.1',
        },
      })
    })

    it('throws CloudUnboundError on 401', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'Unbound' }, 401))

      await expect(refreshEntitlement(BASE_URL, 'old-rt')).rejects.toThrow(CloudUnboundError)
    })

    it('throws on other non-OK response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'Server Error' }, 500))

      await expect(refreshEntitlement(BASE_URL, 'old-rt')).rejects.toThrow('Cloud refresh failed')
    })

    it('throws on missing certificate', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ refreshToken: 'new-rt' }))

      await expect(refreshEntitlement(BASE_URL, 'old-rt')).rejects.toThrow(CloudInvalidResponseError)
    })

    it('throws CloudNetworkError on fetch failure', async () => {
      vi.mocked(fetch).mockRejectedValueOnce(new Error('Connection refused'))

      await expect(refreshEntitlement(BASE_URL, 'old-rt')).rejects.toThrow(CloudNetworkError)
    })

    it('throws CloudNetworkError for non-Error fetch failures', async () => {
      vi.mocked(fetch).mockRejectedValueOnce('offline')

      const result = refreshEntitlement(BASE_URL, 'old-rt')
      await expect(result).rejects.toThrow(CloudNetworkError)
      await expect(result).rejects.toThrow('Cloud network error')
    })
  })

  describe('unbindCloudLicense', () => {
    it('sends DELETE to the Cloud license route with Bearer token', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(null, 204))

      await unbindCloudLicense(BASE_URL, 'binding_1', 'rt-bound')

      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toBe('https://cloud.zpan.space/api/licenses/binding_1')
      expect(init.method).toBe('DELETE')
      expect(headerValue(init.headers, 'Authorization')).toBe('Bearer rt-bound')
      expect(init.body).toBeUndefined()
    })

    it('throws on non-OK response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'unbound' }, 401))

      await expect(unbindCloudLicense(BASE_URL, 'binding_1', 'rt-bound')).rejects.toThrow('Cloud unbind failed')
    })
  })

  describe('requestCloudJson', () => {
    it('unwraps SDK responses from bound clients', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ state: 'revoked' }))

      const client = createBoundCloudClient(BASE_URL, 'rt-bound')
      const result = await requestCloudJson(
        client.stores[':storeId']['gift-cards'][':code'].$patch({
          param: { storeId: 'store_1', code: 'ZS123' },
          json: { disabled: true },
        }),
      )

      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toBe('https://cloud.zpan.space/api/stores/store_1/gift-cards/ZS123')
      expect(init.method).toBe('PATCH')
      expect(headerValue(init.headers, 'Authorization')).toBe('Bearer rt-bound')
      expect(JSON.parse(init.body as string)).toEqual({ disabled: true })
      expect(result).toEqual({ state: 'revoked' })
    })
  })
})
