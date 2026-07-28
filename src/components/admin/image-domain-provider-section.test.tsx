import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { getImageDomainProvider, saveImageDomainProvider, testImageDomainProvider } from '@/lib/api'
import { ImageDomainProviderSection } from './image-domain-provider-section'

const locale = vi.hoisted(() => ({ value: 'en' as 'en' | 'zh' }))
const entitlement = vi.hoisted(() => ({ enabled: true }))
const labels = {
  en: {
    'admin.imageDomains.title': 'Image custom-domain provider',
    'admin.imageDomains.description': 'Choose how workspace image domains are provisioned and verified.',
    'admin.imageDomains.manual': 'Self-managed',
    'admin.imageDomains.domainCount': '1 bound domain',
    'admin.imageDomains.test': 'Test configuration',
    'admin.imageDomains.upgradeTitle': 'Unlock image custom domains',
    'admin.imageDomains.upgradeDescription': 'Upgrade to Pro.',
    'admin.imageDomains.drawerDescription': 'Provider settings',
    'admin.imageDomains.enabledHelp': 'Enabled help',
    'admin.imageDomains.enabled': 'Enable custom domains',
    'admin.imageDomains.provider': 'Provider',
    'admin.imageDomains.cloudflare': 'Cloudflare for SaaS',
    'admin.imageDomains.cloudflareGuide': 'Create a scoped token',
    'admin.imageDomains.createToken': 'Create preconfigured Cloudflare token',
    'admin.imageDomains.tokenScopeHelp': 'Restrict the zone',
    'admin.imageDomains.apiToken': 'Cloudflare API token',
    'admin.imageDomains.apiTokenHelp': 'Token help',
    'admin.imageDomains.zoneId': 'Cloudflare zone ID',
    'admin.imageDomains.routingMode': 'Routing target',
    'admin.imageDomains.routingModeWorker': 'Cloudflare Worker',
    'admin.imageDomains.routingModeOrigin': 'External origin',
    'admin.imageDomains.workerName': 'Worker script name',
    'admin.imageDomains.workerNameHelp': 'Worker help',
    'admin.imageDomains.originHostname': 'Origin hostname',
    'admin.imageDomains.originHostnameHelp': 'Origin help',
    'admin.imageDomains.cnameTarget': 'CNAME target',
    'admin.imageDomains.records': 'DNS records',
    'admin.imageDomains.recordsHelp': 'One record per line',
    'admin.imageDomains.boundDomains': 'Bound domains',
    'admin.imageDomains.saved': 'Saved',
    'admin.imageDomains.testSucceeded': 'Ready',
    'admin.imageDomains.status.ready': 'Ready',
    'common.edit': 'Edit',
    'common.cancel': 'Cancel',
    'common.save': 'Save',
    'common.loading': 'Loading',
  },
  zh: {
    'admin.imageDomains.title': '图床自定义域名 Provider',
    'admin.imageDomains.description': '选择工作区图床域名的开通与验证方式。',
    'admin.imageDomains.manual': '站长手动管理',
    'admin.imageDomains.domainCount': '已绑定 1 个域名',
    'admin.imageDomains.test': '测试配置',
    'admin.imageDomains.upgradeTitle': '解锁图床自定义域名',
    'admin.imageDomains.upgradeDescription': '升级到 Pro。',
    'admin.imageDomains.drawerDescription': 'Provider 配置',
    'admin.imageDomains.enabledHelp': '启用说明',
    'admin.imageDomains.enabled': '启用自定义域名',
    'admin.imageDomains.provider': 'Provider',
    'admin.imageDomains.cloudflare': 'Cloudflare for SaaS',
    'admin.imageDomains.cloudflareGuide': '创建权限受限的 Token',
    'admin.imageDomains.createToken': '创建预配置的 Cloudflare Token',
    'admin.imageDomains.tokenScopeHelp': '限制 Zone',
    'admin.imageDomains.apiToken': 'Cloudflare API Token',
    'admin.imageDomains.apiTokenHelp': 'Token 说明',
    'admin.imageDomains.zoneId': 'Cloudflare Zone ID',
    'admin.imageDomains.routingMode': '回源方式',
    'admin.imageDomains.routingModeWorker': 'Cloudflare Worker',
    'admin.imageDomains.routingModeOrigin': '外部源站',
    'admin.imageDomains.workerName': 'Worker 脚本名称',
    'admin.imageDomains.workerNameHelp': 'Worker 说明',
    'admin.imageDomains.originHostname': '源站域名',
    'admin.imageDomains.originHostnameHelp': '源站说明',
    'admin.imageDomains.cnameTarget': 'CNAME 目标',
    'admin.imageDomains.records': 'DNS 记录',
    'admin.imageDomains.recordsHelp': '每行一条',
    'admin.imageDomains.boundDomains': '已绑定域名',
    'admin.imageDomains.saved': '已保存',
    'admin.imageDomains.testSucceeded': '已就绪',
    'admin.imageDomains.status.ready': '已就绪',
    'common.edit': '编辑',
    'common.cancel': '取消',
    'common.save': '保存',
    'common.loading': '加载中',
  },
} as const

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) => {
      if (key === 'admin.imageDomains.domainCount') {
        return locale.value === 'zh' ? `已绑定 ${options?.count} 个域名` : `${options?.count} bound domain`
      }
      return labels[locale.value][key as keyof (typeof labels)['en']] ?? key
    },
  }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/api', () => ({
  getImageDomainProvider: vi.fn(),
  saveImageDomainProvider: vi.fn(),
  testImageDomainProvider: vi.fn(),
}))
vi.mock('@/hooks/useEntitlement', () => ({
  useEntitlement: () => ({ hasFeature: () => entitlement.enabled, isLoading: false }),
}))

const response = {
  settings: {
    enabled: true,
    provider: 'manual' as const,
    manual: { records: [{ type: 'A' as const, value: '192.0.2.10' }] },
  },
  status: 'ready' as const,
  lastTestedAt: '2026-07-27T12:00:00.000Z',
  error: null,
  domains: [
    {
      orgId: 'org-1',
      hostname: 'img.example.com',
      provider: 'manual' as const,
      status: 'verified' as const,
      error: null,
      lastCheckedAt: '2026-07-27T12:00:00.000Z',
    },
  ],
}

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <ImageDomainProviderSection />
      </TooltipProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(getImageDomainProvider).mockResolvedValue(response)
  vi.mocked(saveImageDomainProvider).mockResolvedValue({ success: true })
  vi.mocked(testImageDomainProvider).mockResolvedValue({ success: true })
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  locale.value = 'en'
  entitlement.enabled = true
})

describe('ImageDomainProviderSection', () => {
  it.each([
    ['en', 'Image custom-domain provider', 'Self-managed', '1 bound domain'],
    ['zh', '图床自定义域名 Provider', '站长手动管理', '已绑定 1 个域名'],
  ] as const)('renders the saved provider in %s', async (language, title, provider, count) => {
    locale.value = language
    const view = renderSection()
    expect(await view.findByText(title)).toBeTruthy()
    expect(view.getByText(new RegExp(provider))).toBeTruthy()
    expect(view.getByText(new RegExp(count))).toBeTruthy()
  })

  it('saves manual A and AAAA records as structured values', async () => {
    const view = renderSection()
    fireEvent.click(await view.findByRole('button', { name: 'Edit' }))
    const records = view.getByLabelText('DNS records')
    fireEvent.change(records, { target: { value: 'A 192.0.2.20\nAAAA 2001:db8::20' } })
    fireEvent.click(view.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(saveImageDomainProvider).toHaveBeenCalledWith({
        enabled: true,
        provider: 'manual',
        manual: {
          records: [
            { type: 'A', value: '192.0.2.20' },
            { type: 'AAAA', value: '2001:db8::20' },
          ],
        },
      }),
    )
  })

  it('runs the provider test action', async () => {
    const view = renderSection()
    fireEvent.click(await view.findByRole('button', { name: 'Test configuration' }))
    await waitFor(() => expect(testImageDomainProvider).toHaveBeenCalledOnce())
  })

  it('shows the Pro badge and disables provider changes for Community', async () => {
    entitlement.enabled = false
    const view = renderSection()
    expect(await view.findByText('Pro')).toBeTruthy()
    expect(view.getByText('Unlock image custom domains')).toBeTruthy()
    expect(view.getByRole('button', { name: 'Edit' }).hasAttribute('disabled')).toBe(true)
    expect(view.getByRole('button', { name: 'Test configuration' }).hasAttribute('disabled')).toBe(true)
  })

  it.each([
    ['en', 'Create preconfigured Cloudflare token'],
    ['zh', '创建预配置的 Cloudflare Token'],
  ] as const)('provides a preconfigured Cloudflare token link in %s', async (language, linkName) => {
    locale.value = language
    vi.mocked(getImageDomainProvider).mockResolvedValue({
      ...response,
      settings: {
        enabled: true,
        provider: 'cloudflare_saas',
        cloudflare: {
          apiToken: '****oken',
          zoneId: '0123456789abcdef0123456789abcdef',
          routingMode: 'worker',
          workerName: 'zpan',
          cnameTarget: 'images.example.com',
        },
      },
    })
    const view = renderSection()
    fireEvent.click(await view.findByRole('button', { name: language === 'zh' ? '编辑' : 'Edit' }))
    const link = view.getByRole('link', { name: linkName }) as HTMLAnchorElement
    const url = new URL(link.href)
    expect(url.origin).toBe('https://dash.cloudflare.com')
    expect(url.searchParams.get('zoneId')).toBe('0123456789abcdef0123456789abcdef')
    expect(JSON.parse(url.searchParams.get('permissionGroupKeys') ?? '[]')).toEqual(
      expect.arrayContaining([
        { key: 'zone', type: 'read' },
        { key: 'dns', type: 'edit' },
        { key: 'ssl_and_certificates', type: 'edit' },
        { key: 'zone_transform_rules', type: 'edit' },
        { key: 'workers_routes', type: 'edit' },
      ]),
    )
  })

  it('saves an external Cloudflare origin without a Worker name', async () => {
    vi.mocked(getImageDomainProvider).mockResolvedValue({
      ...response,
      settings: {
        enabled: true,
        provider: 'cloudflare_saas',
        cloudflare: {
          apiToken: '****oken',
          zoneId: '0123456789abcdef0123456789abcdef',
          routingMode: 'origin',
          originHostname: 'origin.example.com',
          cnameTarget: 'images.example.com',
        },
      },
    })
    const view = renderSection()
    fireEvent.click(await view.findByRole('button', { name: 'Edit' }))
    expect(view.queryByLabelText('Worker script name')).toBeNull()
    fireEvent.change(view.getByLabelText('Origin hostname'), { target: { value: 'node.example.com' } })
    fireEvent.click(view.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(saveImageDomainProvider).toHaveBeenCalledWith({
        enabled: true,
        provider: 'cloudflare_saas',
        cloudflare: {
          apiToken: '****oken',
          zoneId: '0123456789abcdef0123456789abcdef',
          routingMode: 'origin',
          originHostname: 'node.example.com',
          cnameTarget: 'images.example.com',
        },
      }),
    )
  })
})
