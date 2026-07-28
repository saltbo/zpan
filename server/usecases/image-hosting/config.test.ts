import type { BindingState } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ImageDomainProviderConfig,
  ImageDomainProviderGateway,
  ImageHostingConfigRecord,
  ImageHostingConfigRepo,
  LicenseBindingRepo,
} from '../ports'
import { loadBindingState } from '../site/licensing'
import { deleteImageHostingConfig, getImageHostingConfig, putImageHostingConfig } from './config'

vi.mock('../site/licensing', () => ({ loadBindingState: vi.fn() }))

const now = new Date('2026-07-27T12:00:00.000Z')
const COMMUNITY: BindingState = { bound: false }
const PRO: BindingState = { bound: true, active: true, edition: 'pro' }

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
    cloudflare: {
      apiToken: 'token',
      zoneId: 'zone',
      routingMode: 'worker',
      workerName: 'zpan',
      cnameTarget: 'ssl.example.net',
    },
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
    teardown: async () => {},
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
  return {
    imageHostingConfigs: repo,
    imageDomains: gateway,
    licenseBinding: {} as LicenseBindingRepo,
  }
}

describe('image-hosting custom-domain config', () => {
  beforeEach(() => {
    vi.mocked(loadBindingState).mockResolvedValue(PRO)
  })

  it('returns null when the workspace has no image-hosting config', async () => {
    await expect(getImageHostingConfig(deps(readyManual), 'org-1')).resolves.toBeNull()
  })

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

  it('requires Pro before configuring a custom domain', async () => {
    vi.mocked(loadBindingState).mockResolvedValue(COMMUNITY)
    const result = await putImageHostingConfig(
      deps(readyManual),
      'org-1',
      { enabled: true, customDomain: 'img.example.com' },
      'zpan.example.com',
    )
    expect(result).toMatchObject({
      ok: false,
      error: {
        httpStatus: 402,
        meta: {
          reason: 'FEATURE_NOT_AVAILABLE',
          metadata: { feature: 'image_custom_domains' },
        },
      },
    })
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

  it('returns a conflict when Cloudflare says the hostname is already taken', async () => {
    const result = await putImageHostingConfig(
      deps(readyCloudflare, {
        gateway: {
          provision: async () => {
            throw new Error('hostname already exists')
          },
        },
      }),
      'org-1',
      { enabled: true, customDomain: 'img.example.com' },
      'zpan.example.com',
    )
    expect(result).toMatchObject({ ok: false, error: { httpStatus: 409 } })
  })

  it('does not swallow unrelated provider failures', async () => {
    await expect(
      putImageHostingConfig(
        deps(readyCloudflare, {
          gateway: {
            provision: async () => {
              throw new Error('network unavailable')
            },
          },
        }),
        'org-1',
        { enabled: true, customDomain: 'img.example.com' },
        'zpan.example.com',
      ),
    ).rejects.toThrow('network unavailable')
  })

  it('updates an existing domain while preserving its binding and allowlist', async () => {
    const update = vi.fn(async () => {})
    const existing = row({
      customDomain: 'img.example.com',
      domainProvider: 'manual',
      domainStatus: 'verified',
      verificationToken: 'challenge-token',
      domainVerifiedAt: now,
      refererAllowlist: JSON.stringify(['https://blog.example.com']),
    })
    const result = await putImageHostingConfig(
      deps(readyManual, { repo: { getByOrg: async () => existing, update } }),
      'org-1',
      { enabled: true, customDomain: 'IMG.EXAMPLE.COM' },
      'zpan.example.com',
    )
    expect(result.ok).toBe(true)
    expect(update).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({
        customDomain: 'img.example.com',
        verificationToken: 'challenge-token',
        refererAllowlist: JSON.stringify(['https://blog.example.com']),
      }),
    )
  })

  it('deprovisions the old hostname when replacing a domain', async () => {
    const deprovision = vi.fn(async () => {})
    const update = vi.fn(async () => {})
    await putImageHostingConfig(
      deps(readyCloudflare, {
        repo: {
          getByOrg: async () =>
            row({
              customDomain: 'old.example.com',
              domainProvider: 'cloudflare_saas',
              providerHostnameId: 'old-host',
            }),
          update,
        },
        gateway: { deprovision },
      }),
      'org-1',
      { enabled: true, customDomain: 'new.example.com', refererAllowlist: null },
      'zpan.example.com',
    )
    expect(deprovision).toHaveBeenCalledWith(readyCloudflare, 'old-host')
    expect(update).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({ customDomain: 'new.example.com', refererAllowlist: null }),
    )
  })

  it('maps a database domain uniqueness failure to a conflict', async () => {
    const result = await putImageHostingConfig(
      deps(readyManual, {
        repo: {
          create: async () => {
            throw new Error('UNIQUE constraint failed: image_hosting_configs.custom_domain')
          },
        },
      }),
      'org-1',
      { enabled: true, customDomain: 'img.example.com' },
      'zpan.example.com',
    )
    expect(result).toMatchObject({ ok: false, error: { httpStatus: 409 } })
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

  it('treats deleting an absent config as idempotent', async () => {
    const del = vi.fn(async () => {})
    await deleteImageHostingConfig(deps(readyManual, { repo: { delete: del } }), 'org-1')
    expect(del).not.toHaveBeenCalled()
  })
})
