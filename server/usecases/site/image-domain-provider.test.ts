import { describe, expect, it, vi } from 'vitest'
import type {
  ImageDomainProviderConfig,
  ImageDomainProviderGateway,
  ImageHostingConfigRecord,
  ImageHostingConfigRepo,
  SystemOptionsRepo,
} from '../ports'
import {
  getImageDomainProvider,
  reconcileImageDomains,
  saveImageDomainProvider,
  testImageDomainProvider,
} from './image-domain-provider'

function domain(overrides: Partial<ImageHostingConfigRecord> = {}): ImageHostingConfigRecord {
  return {
    orgId: 'org-1',
    customDomain: 'img.example.com',
    domainProvider: 'cloudflare_saas',
    providerHostnameId: 'host-1',
    domainStatus: 'verified',
    domainError: null,
    verificationToken: null,
    domainLastCheckedAt: new Date('2026-07-26T12:00:00.000Z'),
    domainVerifiedAt: new Date('2026-07-26T12:00:00.000Z'),
    refererAllowlist: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

function harness(config: ImageDomainProviderConfig | null, rows = [domain()]) {
  const values = new Map<string, string>()
  if (config?.settings.provider === 'cloudflare_saas') {
    values.set('image_domain_cloudflare_api_token', config.settings.cloudflare.apiToken)
  }
  const setMany = vi.fn(async (entries: Array<{ key: string; value: string }>) => {
    for (const entry of entries) values.set(entry.key, entry.value)
  })
  const systemOptions: SystemOptionsRepo = {
    get: async () => null,
    getValue: async (key) => values.get(key) ?? null,
    getMany: async () => [],
    listByPrefix: async () => [],
    set: async () => {},
    setMany,
    delete: async () => {},
  }
  const update = vi.fn(async () => {})
  const markAllDomainsPending = vi.fn(async () => {})
  const deprovision = vi.fn(async () => {})
  const teardown = vi.fn(async () => {})
  const imageHostingConfigs: ImageHostingConfigRepo = {
    getByOrg: async () => null,
    getByDomain: async () => null,
    listWithDomains: async () => rows,
    create: async () => {},
    update,
    markAllDomainsPending,
    delete: async () => {},
  }
  const imageDomains: ImageDomainProviderGateway = {
    getConfig: async () => config,
    test: async () => {},
    teardown,
    provision: async () => ({ externalId: null, status: 'pending_dns', dnsRecords: [], error: null }),
    refresh: async () => ({ externalId: null, status: 'pending_dns', dnsRecords: [], error: null }),
    deprovision,
  }
  return {
    systemOptions,
    imageHostingConfigs,
    imageDomains,
    setMany,
    update,
    markAllDomainsPending,
    deprovision,
    teardown,
  }
}

const workerCloudflare = {
  apiToken: 'very-secret-token',
  zoneId: 'zone-1',
  routingMode: 'worker',
  workerName: 'zpan',
  cnameTarget: 'ssl.example.com',
} as const

const cloudflareConfig: ImageDomainProviderConfig = {
  settings: {
    enabled: true,
    provider: 'cloudflare_saas',
    cloudflare: workerCloudflare,
  },
  lastTestedAt: new Date('2026-07-27T12:00:00.000Z'),
  error: null,
}

describe('image-domain provider settings', () => {
  it('returns the disabled empty state when no provider is configured', async () => {
    await expect(getImageDomainProvider(harness(null, []))).resolves.toEqual({
      settings: { enabled: false, provider: null },
      status: 'disabled',
      lastTestedAt: null,
      error: null,
      domains: [],
    })
  })

  it('masks the token and includes bound-domain health', async () => {
    const result = await getImageDomainProvider(harness(cloudflareConfig))
    expect(result.settings).toMatchObject({
      provider: 'cloudflare_saas',
      cloudflare: { apiToken: '****oken' },
    })
    expect(result.status).toBe('ready')
    expect(result.domains).toEqual([expect.objectContaining({ hostname: 'img.example.com', status: 'verified' })])
  })

  it('preserves a masked token and reprovisions domains when the Cloudflare zone changes', async () => {
    const deps = harness(cloudflareConfig)
    await saveImageDomainProvider(deps, {
      enabled: true,
      provider: 'cloudflare_saas',
      cloudflare: {
        apiToken: '****oken',
        zoneId: 'zone-2',
        routingMode: 'worker',
        workerName: 'zpan',
        cnameTarget: 'ssl2.example.com',
      },
    })
    expect(deps.setMany).toHaveBeenCalledWith(
      expect.arrayContaining([
        { key: 'image_domain_cloudflare_api_token', value: 'very-secret-token' },
        { key: 'image_domain_last_tested_at', value: '' },
      ]),
    )
    expect(deps.deprovision).toHaveBeenCalledWith(cloudflareConfig, 'host-1')
    expect(deps.teardown).toHaveBeenCalledWith(cloudflareConfig)
    expect(deps.markAllDomainsPending).toHaveBeenCalledWith('cloudflare_saas', false)
  })

  it('keeps Cloudflare hostname IDs when settings stay in the same zone', async () => {
    const deps = harness(cloudflareConfig)
    await saveImageDomainProvider(deps, {
      enabled: true,
      provider: 'cloudflare_saas',
      cloudflare: {
        apiToken: 'new-token',
        zoneId: 'zone-1',
        routingMode: 'worker',
        workerName: 'zpan',
        cnameTarget: 'ssl2.example.com',
      },
    })
    expect(deps.deprovision).not.toHaveBeenCalled()
    expect(deps.markAllDomainsPending).toHaveBeenCalledWith('cloudflare_saas', true)
  })

  it('deprovisions hostnames and Worker routing when the provider is disabled', async () => {
    const deps = harness(cloudflareConfig)
    await saveImageDomainProvider(deps, {
      enabled: false,
      provider: 'cloudflare_saas',
      cloudflare: workerCloudflare,
    })
    expect(deps.deprovision).toHaveBeenCalledWith(cloudflareConfig, 'host-1')
    expect(deps.teardown).toHaveBeenCalledWith(cloudflareConfig)
    expect(deps.markAllDomainsPending).toHaveBeenCalledWith('cloudflare_saas', false)
  })

  it('tests a manual provider and reprovisions all existing domains', async () => {
    const config: ImageDomainProviderConfig = {
      settings: {
        enabled: true,
        provider: 'manual',
        manual: { records: [{ type: 'A', value: '192.0.2.1' }] },
      },
      lastTestedAt: null,
      error: null,
    }
    const deps = harness(config, [
      domain({ domainProvider: null, providerHostnameId: null, domainStatus: 'pending_dns' }),
      domain({ orgId: 'org-2', customDomain: '图片.example.com', verificationToken: null }),
    ])
    const test = vi.fn(async () => {})
    const provision = vi.fn(async () => ({
      externalId: null,
      status: 'pending_dns' as const,
      dnsRecords: [{ type: 'A' as const, value: '192.0.2.1' }],
      error: null,
    }))
    deps.imageDomains.test = test
    deps.imageDomains.provision = provision

    await testImageDomainProvider(deps)

    expect(test).toHaveBeenCalledWith(config.settings)
    expect(provision).toHaveBeenCalledTimes(2)
    expect(deps.update).toHaveBeenCalledWith(
      'org-2',
      expect.objectContaining({
        domainProvider: 'manual',
        verificationToken: expect.any(String),
      }),
    )
  })

  it('persists a provider test error and returns a 400 business error', async () => {
    const deps = harness(cloudflareConfig)
    deps.imageDomains.test = async () => {
      throw new Error('fallback origin inactive')
    }
    await expect(testImageDomainProvider(deps)).rejects.toMatchObject({
      httpStatus: 400,
      message: 'fallback origin inactive',
    })
    expect(deps.setMany).toHaveBeenCalledWith(
      expect.arrayContaining([{ key: 'image_domain_error', value: 'fallback origin inactive' }]),
    )
  })

  it('rejects a provider test before configuration exists', async () => {
    await expect(testImageDomainProvider(harness(null))).rejects.toMatchObject({
      httpStatus: 400,
      message: 'Image custom-domain provider is not configured',
    })
  })

  it('skips domain provisioning while a tested provider is disabled', async () => {
    const disabled = {
      ...cloudflareConfig,
      settings: { ...cloudflareConfig.settings, enabled: false },
    } satisfies ImageDomainProviderConfig
    const deps = harness(disabled)
    deps.imageDomains.test = vi.fn(async () => {})
    deps.imageDomains.provision = vi.fn(async () => ({
      externalId: 'host-2',
      status: 'pending_dns' as const,
      dnsRecords: [],
      error: null,
    }))
    await testImageDomainProvider(deps)
    expect(deps.imageDomains.provision).not.toHaveBeenCalled()
  })

  it('reconciles pending Cloudflare domains and caches verified results', async () => {
    const deps = harness(cloudflareConfig, [
      domain({ domainStatus: 'pending_tls' }),
      domain({ orgId: 'org-2', customDomain: 'done.example.com', domainStatus: 'verified' }),
    ])
    const refresh = vi.fn(async () => ({
      externalId: 'host-1',
      status: 'verified' as const,
      dnsRecords: [],
      error: null,
    }))
    const replace = vi.fn(async () => {})
    deps.imageDomains.refresh = refresh
    Object.assign(deps, { cache: { getOrLoad: vi.fn(), replace, invalidate: vi.fn() } })

    await reconcileImageDomains(deps)

    expect(refresh).toHaveBeenCalledTimes(1)
    expect(deps.update).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({ domainStatus: 'verified', domainVerifiedAt: expect.any(Date) }),
    )
    expect(replace).toHaveBeenCalledWith(expect.anything(), 'img.example.com', 'org-1')
  })

  it('marks a domain failed when Cloudflare reconciliation throws', async () => {
    const deps = harness(cloudflareConfig, [domain({ domainStatus: 'pending_dns' })])
    deps.imageDomains.refresh = async () => {
      throw new Error('hostname lookup failed')
    }

    await reconcileImageDomains(deps)

    expect(deps.update).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({ domainStatus: 'failed', domainError: 'hostname lookup failed' }),
    )
  })

  it('does not reconcile manual, disabled, untested, or failed providers', async () => {
    const manual: ImageDomainProviderConfig = {
      settings: {
        enabled: true,
        provider: 'manual',
        manual: { records: [{ type: 'A', value: '192.0.2.1' }] },
      },
      lastTestedAt: new Date(),
      error: null,
    }
    for (const config of [
      null,
      { ...cloudflareConfig, lastTestedAt: null },
      { ...cloudflareConfig, error: 'bad token' },
      manual,
    ]) {
      const deps = harness(config)
      deps.imageDomains.refresh = vi.fn()
      await reconcileImageDomains(deps)
      expect(deps.imageDomains.refresh).not.toHaveBeenCalled()
    }
  })
})
