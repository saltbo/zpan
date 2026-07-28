import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getImageDomainProvider, saveImageDomainProvider, testImageDomainProvider } from '@/lib/api'
import { ImageDomainProviderSection } from './image-domain-provider-section'

const locale = vi.hoisted(() => ({ value: 'en' as 'en' | 'zh' }))
const labels = {
  en: {
    'admin.imageDomains.title': 'Image custom-domain provider',
    'admin.imageDomains.description': 'Choose how workspace image domains are provisioned and verified.',
    'admin.imageDomains.manual': 'Self-managed',
    'admin.imageDomains.domainCount': '1 bound domain',
    'admin.imageDomains.test': 'Test configuration',
    'admin.imageDomains.drawerDescription': 'Provider settings',
    'admin.imageDomains.enabledHelp': 'Enabled help',
    'admin.imageDomains.enabled': 'Enable custom domains',
    'admin.imageDomains.provider': 'Provider',
    'admin.imageDomains.cloudflare': 'Cloudflare for SaaS',
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
    'admin.imageDomains.drawerDescription': 'Provider 配置',
    'admin.imageDomains.enabledHelp': '启用说明',
    'admin.imageDomains.enabled': '启用自定义域名',
    'admin.imageDomains.provider': 'Provider',
    'admin.imageDomains.cloudflare': 'Cloudflare for SaaS',
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
      <ImageDomainProviderSection />
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
})
