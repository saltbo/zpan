import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SystemOptionsRepo } from '../../usecases/ports'
import { createImageDomainProviderGateway } from './image-domain-provider'

function options(values: Record<string, string>): SystemOptionsRepo {
  return {
    get: async () => null,
    getValue: async (key) => values[key] ?? null,
    getMany: async () => [],
    listByPrefix: async (prefix) =>
      Object.entries(values)
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, value]) => ({ key, value })),
    set: async () => {},
    setMany: async () => {},
    delete: async () => {},
  }
}

const cloudflareValues = {
  image_domain_enabled: 'true',
  image_domain_provider: 'cloudflare_saas',
  image_domain_cloudflare_api_token: 'secret-token',
  image_domain_cloudflare_zone_id: 'zone-1',
  image_domain_cloudflare_worker_name: 'zpan',
  image_domain_cloudflare_cname_target: 'ssl.example.com',
  image_domain_last_tested_at: '2026-07-27T12:00:00.000Z',
  image_domain_error: '',
}

describe('image domain provider gateway', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('returns null for absent or incomplete provider settings', async () => {
    await expect(createImageDomainProviderGateway(options({})).getConfig()).resolves.toBeNull()
    await expect(
      createImageDomainProviderGateway(
        options({
          image_domain_provider: 'cloudflare_saas',
          image_domain_cloudflare_api_token: 'token',
        }),
      ).getConfig(),
    ).resolves.toBeNull()
    await expect(
      createImageDomainProviderGateway(options({ image_domain_provider: 'manual' })).getConfig(),
    ).resolves.toBeNull()
  })

  it('loads manual records from system options', async () => {
    const gateway = createImageDomainProviderGateway(
      options({
        image_domain_enabled: 'false',
        image_domain_provider: 'manual',
        image_domain_manual_records: JSON.stringify([
          { type: 'A', value: '192.0.2.1' },
          { type: 'AAAA', value: '2001:db8::1' },
        ]),
      }),
    )
    await expect(gateway.getConfig()).resolves.toMatchObject({
      settings: {
        enabled: false,
        provider: 'manual',
        manual: {
          records: [
            { type: 'A', value: '192.0.2.1' },
            { type: 'AAAA', value: '2001:db8::1' },
          ],
        },
      },
    })
  })

  it('handles every self-managed operation without external requests', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const gateway = createImageDomainProviderGateway(
      options({
        image_domain_enabled: 'true',
        image_domain_provider: 'manual',
        image_domain_manual_records: JSON.stringify([{ type: 'A', value: '192.0.2.1' }]),
      }),
    )
    const config = await gateway.getConfig()
    expect(config).not.toBeNull()
    await expect(gateway.test(config!.settings)).resolves.toBeUndefined()
    await expect(gateway.provision(config!, 'img.example.com')).resolves.toMatchObject({
      externalId: null,
      status: 'pending_dns',
      dnsRecords: [{ type: 'A', value: '192.0.2.1' }],
    })
    await expect(gateway.refresh(config!, 'img.example.com', null)).resolves.toMatchObject({
      externalId: null,
      status: 'pending_dns',
    })
    await expect(gateway.deprovision(config!, null)).resolves.toBeUndefined()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('creates and maps an active Cloudflare custom hostname', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          result: { id: 'host-1', status: 'active', ssl: { status: 'active' } },
        }),
        { status: 200 },
      ),
    )
    const gateway = createImageDomainProviderGateway(options(cloudflareValues))
    const config = await gateway.getConfig()
    expect(config).not.toBeNull()
    await expect(gateway.provision(config!, 'img.example.com')).resolves.toEqual({
      externalId: 'host-1',
      status: 'verified',
      dnsRecords: [{ type: 'CNAME', value: 'ssl.example.com' }],
      error: null,
    })
    expect(fetch).toHaveBeenCalledWith(
      'https://api.cloudflare.com/client/v4/zones/zone-1/custom_hostnames',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"hostname":"img.example.com"'),
      }),
    )
  })

  it('reports Cloudflare API failures without swallowing them', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ success: false, errors: [{ code: 1000, message: 'token rejected' }] }), {
        status: 403,
      }),
    )
    const gateway = createImageDomainProviderGateway(options(cloudflareValues))
    const config = await gateway.getConfig()
    await expect(gateway.test(config!.settings)).rejects.toThrow('token rejected')
  })

  it('reuses an active Cloudflare setup without creating duplicate resources', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, result: { name: 'example.com' } }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, result: { status: 'active', origin: 'ssl.example.com' } }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            result: [
              {
                id: 'dns-1',
                type: 'AAAA',
                name: 'ssl.example.com',
                content: '100::',
                proxied: true,
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            result: {
              id: 'ruleset-1',
              rules: [
                {
                  id: 'rule-1',
                  ref: 'zpan_image_hosting_rewrite',
                  expression:
                    '(http.host ne "example.com" and not ends_with(http.host, ".example.com") and http.request.uri.path ne "/ih" and not starts_with(http.request.uri.path, "/ih/"))',
                  action_parameters: {
                    uri: { path: { expression: 'concat("/ih", http.request.uri.path)' } },
                  },
                },
              ],
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            result: [{ id: 'route-1', pattern: '*/ih/*', script: 'zpan' }],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, result: [] }), { status: 200 }))
    const gateway = createImageDomainProviderGateway(options(cloudflareValues))
    const config = await gateway.getConfig()
    await expect(gateway.test(config!.settings)).resolves.toBeUndefined()
    expect(fetch).toHaveBeenCalledTimes(6)
    expect(vi.mocked(fetch).mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true)
  })

  it('creates the Cloudflare DNS target, fallback origin, rewrite rule, and Worker route', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, result: { name: 'example.com' } }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: false, errors: [{ code: 1406, message: 'not found' }] }), {
          status: 404,
        }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, result: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, result: { id: 'dns-1' } }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            result: { status: 'active', origin: 'ssl.example.com' },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: false, errors: [{ code: 20012, message: 'does not exist' }] }), {
          status: 404,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, result: { id: 'ruleset-1' } }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, result: [] }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, result: { id: 'route-1' } }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, result: [] }), { status: 200 }))
    const gateway = createImageDomainProviderGateway(options(cloudflareValues))
    const config = await gateway.getConfig()
    await expect(gateway.test(config!.settings)).resolves.toBeUndefined()

    const calls = vi.mocked(fetch).mock.calls
    expect(calls).toEqual(
      expect.arrayContaining([
        [
          'https://api.cloudflare.com/client/v4/zones/zone-1/dns_records',
          expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({
              type: 'AAAA',
              name: 'ssl.example.com',
              content: '100::',
              proxied: true,
            }),
          }),
        ],
        [
          'https://api.cloudflare.com/client/v4/zones/zone-1/custom_hostnames/fallback_origin',
          expect.objectContaining({ method: 'PUT', body: JSON.stringify({ origin: 'ssl.example.com' }) }),
        ],
        [
          'https://api.cloudflare.com/client/v4/zones/zone-1/workers/routes',
          expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ pattern: '*/ih/*', script: 'zpan' }),
          }),
        ],
      ]),
    )
  })

  it('asks the administrator to retry while a new fallback origin activates', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, result: { name: 'example.com' } }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, result: { status: 'pending' } }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, result: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, result: { id: 'dns-1' } }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, result: { status: 'pending' } }), { status: 200 }),
      )
    const gateway = createImageDomainProviderGateway(options(cloudflareValues))
    const config = await gateway.getConfig()
    await expect(gateway.test(config!.settings)).rejects.toThrow(
      'Cloudflare fallback origin setup is pending; wait a moment and test again',
    )
  })

  it('maps missing, pending TLS, and failed Cloudflare hostnames', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const gateway = createImageDomainProviderGateway(options(cloudflareValues))
    const config = await gateway.getConfig()

    await expect(gateway.refresh(config!, 'img.example.com', null)).resolves.toMatchObject({
      externalId: null,
      status: 'pending_dns',
    })

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          result: { id: 'host-1', status: 'active', ssl: { status: 'initializing' } },
        }),
        { status: 200 },
      ),
    )
    await expect(gateway.refresh(config!, 'img.example.com', 'host-1')).resolves.toMatchObject({
      status: 'pending_tls',
      error: null,
    })

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          result: { id: 'host-2', status: 'blocked', verification_errors: ['DNS mismatch'] },
        }),
        { status: 200 },
      ),
    )
    await expect(gateway.refresh(config!, 'img.example.com', 'host-2')).resolves.toMatchObject({
      status: 'failed',
      error: 'DNS mismatch',
    })
  })

  it('treats a missing hostname during deletion as already removed', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 404 }))
    const gateway = createImageDomainProviderGateway(options(cloudflareValues))
    const config = await gateway.getConfig()
    await expect(gateway.deprovision(config!, 'host-1')).resolves.toBeUndefined()
  })

  it('reports Cloudflare deletion failures', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ success: false, errors: [{ code: 1000, message: 'delete denied' }] }), {
        status: 403,
      }),
    )
    const gateway = createImageDomainProviderGateway(options(cloudflareValues))
    const config = await gateway.getConfig()
    await expect(gateway.deprovision(config!, 'host-1')).rejects.toThrow('delete denied')
  })
})
