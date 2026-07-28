import { describe, expect, it, vi } from 'vitest'
import type {
  ImageDomainProviderConfig,
  ImageDomainProviderGateway,
  ImageHostingConfigRecord,
  ImageHostingConfigRepo,
} from '../ports'
import { deleteImageHostingConfig, getImageHostingConfig, putImageHostingConfig } from './config'

const now = new Date('2026-07-27T12:00:00.000Z')

function row(overrides: Partial<ImageHostingConfigRecord> = {}): ImageHostingConfigRecord {
  return {
    orgId: 'org-1',
    customDomain: null,
    domainProvider: null,
    providerHostnameId: null,
    domainStatus: null,
    domainError: null,
    verificationToken: null,
    domainLastCheckedAt: null,
    domainVerifiedAt: null,
    refererAllowlist: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

const readyManual: ImageDomainProviderConfig = {
  settings: {
    enabled: true,
    provider: 'manual',
    manual: { records: [{ type: 'CNAME', value: 'images.example.net' }] },
  },
  lastTestedAt: now,
  error: null,
}

const readyCloudflare: ImageDomainProviderConfig = {
  settings: {
    enabled: true,
    provider: 'cloudflare_saas',
    cloudflare: { apiToken: 'token', zoneId: 'zone', cnameTarget: 'ssl.example.net' },
  },
  lastTestedAt: now,
  error: null,
}

function deps(
  config: ImageDomainProviderConfig | null,
  overrides: {
    repo?: Partial<ImageHostingConfigRepo>
    gateway?: Partial<ImageDomainProviderGateway>
  } = {},
) {
  const repo: ImageHostingConfigRepo = {
    getByOrg: async () => null,
    getByDomain: async () => null,
    listWithDomains: async () => [],
    create: async () => {},
    update: async () => {},
    markAllDomainsPending: async () => {},
    delete: async () => {},
    ...overrides.repo,
  }
  const gateway: ImageDomainProviderGateway = {
    getConfig: async () => config,
    test: async () => {},
    provision: async () => ({
      externalId: config?.settings.provider === 'cloudflare_saas' ? 'cf-host-1' : null,
      status: 'pending_dns',
      dnsRecords: [],
      error: null,
    }),
    refresh: async () => ({ externalId: 'cf-host-1', status: 'pending_tls', dnsRecords: [], error: null }),
    deprovision: async () => {},
    ...overrides.gateway,
  }
  return { imageHostingConfigs: repo, imageDomains: gateway }
}

describe('image-hosting custom-domain config', () => {
  it('rejects a custom domain until the administrator tests the provider [spec: image-hosting-config/provider-not-ready]', async () => {
    const untested = { ...readyManual, lastTestedAt: null }
    const result = await putImageHostingConfig(
      deps(untested),
      'org-1',
      { enabled: true, customDomain: 'img.example.com' },
      'zpan.example.com',
    )
    expect(result).toMatchObject({ ok: false, error: { httpStatus: 400 } })
  })

  it('rejects the application host [spec: image-hosting-config/reject-app-host]', async () => {
    const result = await putImageHostingConfig(
      deps(readyManual),
      'org-1',
      { enabled: true, customDomain: 'zpan.example.com' },
      'zpan.example.com',
    )
    expect(result).toMatchObject({ ok: false, error: { httpStatus: 400 } })
  })

  it('creates a manual binding with a verification token', async () => {
    const create = vi.fn(async () => {})
    const result = await putImageHostingConfig(
      deps(readyManual, { repo: { create } }),
      'org-1',
      { enabled: true, customDomain: '图片.example.com', refererAllowlist: ['https://博客.example'] },
      'zpan.example.com',
    )
    expect(result.ok).toBe(true)
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        customDomain: '图片.example.com',
        domainProvider: 'manual',
        domainStatus: 'pending_dns',
        verificationToken: expect.any(String),
      }),
    )
  })

  it('stores the Cloudflare hostname id [spec: image-hosting-config/cloudflare-binding]', async () => {
    const create = vi.fn(async () => {})
    const provision = vi.fn(async () => ({
      externalId: 'host-123',
      status: 'pending_tls' as const,
      dnsRecords: [{ type: 'CNAME' as const, value: 'ssl.example.net' }],
      error: null,
    }))
    await putImageHostingConfig(
      deps(readyCloudflare, { repo: { create }, gateway: { provision } }),
      'org-1',
      { enabled: true, customDomain: 'img.example.com' },
      'zpan.example.com',
    )
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ providerHostnameId: 'host-123' }))
  })

  it('refreshes a pending Cloudflare binding to verified [spec: image-hosting-config/cloudflare-refresh]', async () => {
    const update = vi.fn(async () => {})
    const configRow = row({
      customDomain: 'img.example.com',
      domainProvider: 'cloudflare_saas',
      providerHostnameId: 'host-1',
      domainStatus: 'pending_tls',
    })
    const result = await getImageHostingConfig(
      deps(readyCloudflare, {
        repo: { getByOrg: async () => configRow, update },
        gateway: {
          refresh: async () => ({
            externalId: 'host-1',
            status: 'verified',
            dnsRecords: [],
            error: null,
          }),
        },
      }),
      'org-1',
    )
    expect(result?.domainStatus).toBe('verified')
    expect(update).toHaveBeenCalledWith('org-1', expect.objectContaining({ domainStatus: 'verified' }))
  })

  it('deprovisions the external hostname on delete [spec: image-hosting-config/deprovision]', async () => {
    const deprovision = vi.fn(async () => {})
    const del = vi.fn(async () => {})
    await deleteImageHostingConfig(
      deps(readyCloudflare, {
        repo: {
          getByOrg: async () =>
            row({
              customDomain: 'img.example.com',
              domainProvider: 'cloudflare_saas',
              providerHostnameId: 'host-1',
            }),
          delete: del,
        },
        gateway: { deprovision },
      }),
      'org-1',
    )
    expect(deprovision).toHaveBeenCalledWith(readyCloudflare, 'host-1')
    expect(del).toHaveBeenCalledWith('org-1')
  })
})
