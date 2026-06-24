import type { Downloader } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { listDownloaders, updateDownloader, updateDownloaderCreditBilling } from '@/lib/api'
import { AdminDownloadersPage } from './downloaders'

const mockHasFeature = vi.hoisted(() => vi.fn((_feature: string) => true))

class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string>) => {
      if (!values) return key
      return Object.entries(values).reduce((message, [name, value]) => message.replace(`{{${name}}}`, value), key)
    },
  }),
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@/hooks/useEntitlement', () => ({
  useEntitlement: () => ({
    hasFeature: mockHasFeature,
  }),
}))

vi.mock('@/lib/api', () => ({
  deleteDownloader: vi.fn(),
  listDownloaders: vi.fn(),
  updateDownloader: vi.fn(),
  updateDownloaderCreditBilling: vi.fn(),
}))

const downloader: Downloader = {
  id: 'downloader-1',
  name: 'Edge downloader',
  status: 'online',
  enabled: true,
  version: '1.0.0',
  hostname: 'edge-1',
  platform: 'linux',
  arch: 'amd64',
  engine: 'aria2',
  capabilities: ['http'],
  maxConcurrentTasks: 2,
  currentTasks: 0,
  downloadBps: 0,
  uploadBps: 0,
  freeDiskBytes: 1024,
  remoteDownloadCreditBillingEnabled: true,
  remoteDownloadCreditUnitBytes: 100 * 1024 * 1024,
  remoteDownloadCreditPerUnit: 2,
  lastHeartbeatAt: null,
  createdBy: 'user-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

function renderDownloadersPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <AdminDownloadersPage />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

beforeEach(() => {
  mockHasFeature.mockReturnValue(true)
})

describe('AdminDownloadersPage billing drawer', () => {
  it('saves credit billing through the dedicated wrapper', async () => {
    vi.stubGlobal('ResizeObserver', TestResizeObserver)
    vi.mocked(listDownloaders).mockResolvedValue({ items: [downloader], total: 1, page: 1, pageSize: 1 })
    vi.mocked(updateDownloaderCreditBilling).mockResolvedValue(downloader)

    renderDownloadersPage()

    fireEvent.click(await screen.findByRole('button', { name: 'admin.downloaders.configureBilling' }))
    await screen.findByText('admin.downloaders.billingTitle')
    fireEvent.change(screen.getByLabelText('admin.downloaders.billingCredits'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }))

    await waitFor(() =>
      expect(updateDownloaderCreditBilling).toHaveBeenCalledWith('downloader-1', {
        enabled: true,
        unitBytes: 100 * 1024 * 1024,
        creditsPerUnit: 5,
      }),
    )
    expect(updateDownloader).not.toHaveBeenCalled()
  })

  it('shows credit billing as view-only without the quota store entitlement', async () => {
    vi.stubGlobal('ResizeObserver', TestResizeObserver)
    mockHasFeature.mockImplementation((feature) => feature !== 'quota_store')
    vi.mocked(listDownloaders).mockResolvedValue({ items: [downloader], total: 1, page: 1, pageSize: 1 })

    renderDownloadersPage()

    fireEvent.click(await screen.findByRole('button', { name: 'admin.downloaders.configureBilling' }))
    await screen.findByText('admin.downloaders.billingBusinessOnly')

    expect(screen.queryByRole('button', { name: 'common.save' })).toBeNull()
    expect(screen.getByLabelText('admin.downloaders.billingCredits')).toHaveProperty('disabled', true)
    expect(screen.getAllByRole('button', { name: 'common.close' })).toHaveLength(2)

    expect(updateDownloaderCreditBilling).not.toHaveBeenCalled()
    expect(updateDownloader).not.toHaveBeenCalled()
  })
})
