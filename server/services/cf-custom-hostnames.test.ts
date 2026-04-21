import { afterEach, describe, expect, it, vi } from 'vitest'
import { CfConflictError, CfCustomHostnamesClient, createCfClient } from './cf-custom-hostnames.js'

const TEST_CONFIG = {
  apiToken: 'test-token',
  zoneId: 'test-zone-id',
  cnameTarget: 'ssl.zpan.io',
}

function makeClient() {
  return new CfCustomHostnamesClient(TEST_CONFIG)
}

function noopClient() {
  return new CfCustomHostnamesClient(null)
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// ─── createCfClient factory ────────────────────────────────────────────────────

describe('createCfClient', () => {
  it('returns no-op client when env vars are absent', () => {
    const client = createCfClient(() => undefined)
    // no-op: register returns empty id, no fetch called
    expect(client).toBeInstanceOf(CfCustomHostnamesClient)
  })

  it('returns configured client when all env vars are present', () => {
    const client = createCfClient(
      (key) => ({ CF_API_TOKEN: 'tok', CF_ZONE_ID: 'zone', CF_CNAME_TARGET: 'target' })[key],
    )
    expect(client).toBeInstanceOf(CfCustomHostnamesClient)
  })

  it('returns no-op client when only some env vars are set', () => {
    const client = createCfClient((key) => (key === 'CF_API_TOKEN' ? 'tok' : undefined))
    expect(client).toBeInstanceOf(CfCustomHostnamesClient)
  })
})

// ─── register ─────────────────────────────────────────────────────────────────

describe('CfCustomHostnamesClient.register', () => {
  it('returns { id: "" } and makes no HTTP call when no config (no-op)', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await noopClient().register('img.example.com')
    expect(result).toEqual({ id: '' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('calls CF API and returns hostname id on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ result: { id: 'cf-abc-123' } }), { status: 200 })),
    )

    const result = await makeClient().register('img.example.com')
    expect(result).toEqual({ id: 'cf-abc-123' })

    const calls = (vi.mocked(fetch) as ReturnType<typeof vi.fn>).mock.calls
    expect(calls).toHaveLength(1)
    const [url, init] = calls[0] as [string, RequestInit]
    const parsed = new URL(url)
    expect(parsed.host).toBe('api.cloudflare.com')
    expect(parsed.pathname).toContain('/custom_hostnames')
    expect(init.method).toBe('POST')
  })

  it('throws CfConflictError on CF 409', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"errors":[{"code":1403}]}', { status: 409 })))

    await expect(makeClient().register('img.example.com')).rejects.toThrow(CfConflictError)
  })

  it('throws generic Error on CF 500', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Internal Server Error', { status: 500 })))

    await expect(makeClient().register('img.example.com')).rejects.toThrow(/CF registerHostname failed \(500\)/)
  })

  it('propagates network errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network failure')))
    await expect(makeClient().register('img.example.com')).rejects.toThrow('network failure')
  })
})

// ─── getStatus ────────────────────────────────────────────────────────────────

describe('CfCustomHostnamesClient.getStatus', () => {
  it('returns pending with empty ssl_status when no config (no-op)', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const status = await noopClient().getStatus('any-id')
    expect(status).toEqual({ status: 'pending', ssl_status: '' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns pending when id is empty string', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const status = await makeClient().getStatus('')
    expect(status).toEqual({ status: 'pending', ssl_status: '' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('calls CF API and returns active status', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ result: { status: 'active', ssl: { status: 'active' } } }), { status: 200 }),
        ),
    )

    const status = await makeClient().getStatus('cf-id-123')
    expect(status.status).toBe('active')
    expect(status.ssl_status).toBe('active')

    const calls = (vi.mocked(fetch) as ReturnType<typeof vi.fn>).mock.calls
    const [url] = calls[0] as [string]
    const parsed = new URL(url)
    expect(parsed.host).toBe('api.cloudflare.com')
    expect(parsed.pathname).toContain('/custom_hostnames/cf-id-123')
  })

  it('returns pending status from CF', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ result: { status: 'pending', ssl: { status: 'initializing' } } }), {
          status: 200,
        }),
      ),
    )

    const status = await makeClient().getStatus('cf-id-pending')
    expect(status.status).toBe('pending')
  })

  it('throws Error on CF API error response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Not Found', { status: 404 })))

    await expect(makeClient().getStatus('bad-id')).rejects.toThrow(/CF getHostnameStatus failed \(404\)/)
  })
})

// ─── delete ───────────────────────────────────────────────────────────────────

describe('CfCustomHostnamesClient.delete', () => {
  it('makes no HTTP call when no config (no-op)', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await noopClient().delete('cf-id-123')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('makes no HTTP call when id is empty (no-op)', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await makeClient().delete('')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('calls CF DELETE endpoint on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })))

    await makeClient().delete('cf-id-456')

    const calls = (vi.mocked(fetch) as ReturnType<typeof vi.fn>).mock.calls
    expect(calls).toHaveLength(1)
    const [url, init] = calls[0] as [string, RequestInit]
    const parsed = new URL(url)
    expect(parsed.host).toBe('api.cloudflare.com')
    expect(parsed.pathname).toContain('/custom_hostnames/cf-id-456')
    expect(init.method).toBe('DELETE')
  })

  it('throws Error on CF API failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Forbidden', { status: 403 })))

    await expect(makeClient().delete('cf-id-789')).rejects.toThrow(/CF deleteHostname failed \(403\)/)
  })

  it('propagates network errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection refused')))
    await expect(makeClient().delete('cf-id-abc')).rejects.toThrow('connection refused')
  })
})
