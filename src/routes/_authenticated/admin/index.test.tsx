import type { AdminDashboardOperationsStats, AdminDashboardOverviewStats } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useEntitlement } from '@/hooks/useEntitlement'
import {
  getAdminDashboardGrowthStats,
  getAdminDashboardOperationsStats,
  getAdminDashboardOverviewStats,
  getAdminDashboardSharingStats,
  getAdminDashboardStorageStats,
  getAdminDashboardTrafficStats,
} from '@/lib/api'
import { OverviewPage } from './index'

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => options,
  Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}))

vi.mock('@/components/UpgradeHint', () => ({
  UpgradeHint: ({ title }: { title: string }) => <div data-testid="upgrade-hint">{title}</div>,
}))

vi.mock('@/hooks/useEntitlement', () => ({
  useEntitlement: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  getAdminDashboardOverviewStats: vi.fn(),
  getAdminDashboardOperationsStats: vi.fn(),
  getAdminDashboardGrowthStats: vi.fn(),
  getAdminDashboardStorageStats: vi.fn(),
  getAdminDashboardTrafficStats: vi.fn(),
  getAdminDashboardSharingStats: vi.fn(),
}))

const overviewStats: AdminDashboardOverviewStats = {
  generatedAt: '2026-07-09T00:00:00.000Z',
  from: '2026-07-01T00:00:00.000Z',
  to: '2026-07-09T00:00:00.000Z',
  timeZone: 'UTC',
  coverage: {
    status: 'complete',
    expectedBuckets: 192,
    completedBuckets: 192,
    dataThrough: '2026-07-09T00:00:00.000Z',
  },
  dataQuality: {
    missingUploadBytesEvents: 0,
    previousMissingUploadBytesEvents: 0,
    missingDownloadBytesEvents: 0,
    previousMissingDownloadBytesEvents: 0,
    missingBytesEvents: 0,
    previousMissingBytesEvents: 0,
  },
  totals: {
    users: 42,
    newUsers: { value: 5, previousValue: 3, change: 2, changePercent: 66.7 },
    activeUsers: { value: 18, previousValue: 12, change: 6, changePercent: 50 },
    activeUserRate: 42.9,
    storageUsedBytes: 1024,
    storageQuotaBytes: 4096,
    storageUtilization: 25,
    trafficBytes: { value: 512, previousValue: 256, change: 256, changePercent: 100 },
    uploadBytes: { value: 128, previousValue: 64, change: 64, changePercent: 100 },
    downloadBytes: { value: 384, previousValue: 192, change: 192, changePercent: 100 },
    activeShares: 4,
    shareViews: { value: 120, previousValue: 60, change: 60, changePercent: 100 },
    shareDownloads: { value: 30, previousValue: 15, change: 15, changePercent: 100 },
  },
  trends: [
    {
      date: '2026-07-09',
      newUsers: 5,
      activeUsers: 18,
      storageUsedBytes: 1024,
      uploadBytes: 128,
      downloadBytes: 384,
    },
  ],
}

const operationsStats: AdminDashboardOperationsStats = {
  generatedAt: '2026-07-09T00:00:00.000Z',
  from: '2026-07-01T00:00:00.000Z',
  to: '2026-07-09T00:00:00.000Z',
  timeZone: 'UTC',
  coverage: {
    status: 'complete',
    expectedBuckets: 192,
    completedBuckets: 192,
    dataThrough: '2026-07-09T00:00:00.000Z',
  },
  summary: {
    activeBackgroundJobs: 2,
    activeRemoteDownloads: 3,
    onlineDownloaders: 4,
    offlineDownloaders: 1,
    backgroundJobFailureRate: 5,
    remoteDownloadSuccessRate: 95,
    cloudReportBacklog: 6,
    webhookFailures: 7,
    alertCount: 13,
  },
  trend: [],
  backgroundJobOutcomes: [],
  remoteDownloadOutcomes: [],
  downloaderStatus: [],
  cloudReportStatus: [],
}

function renderOverviewPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <OverviewPage />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Admin overview dashboard', () => {
  it('renders overview stats without querying Pro sections when analytics is locked', async () => {
    vi.mocked(useEntitlement).mockReturnValue({
      bound: false,
      active: false,
      edition: null,
      licenseId: null,
      cloudDashboardUrl: null,
      hasFeature: () => false,
      isLoading: false,
      isError: false,
    })
    vi.mocked(getAdminDashboardOverviewStats).mockResolvedValue(overviewStats)

    renderOverviewPage()

    expect(await screen.findByText('42')).toBeTruthy()
    expect(screen.getByText('所选范围的离线结果完整。')).toBeTruthy()
    expect(screen.getByText('用户与增长')).toBeTruthy()
    expect(getAdminDashboardGrowthStats).not.toHaveBeenCalled()
    expect(getAdminDashboardStorageStats).not.toHaveBeenCalled()
    expect(getAdminDashboardTrafficStats).not.toHaveBeenCalled()
    expect(getAdminDashboardSharingStats).not.toHaveBeenCalled()
    expect(getAdminDashboardOperationsStats).not.toHaveBeenCalled()
  })

  it('warns when historical transfer bytes are incomplete', async () => {
    vi.mocked(useEntitlement).mockReturnValue({
      bound: false,
      active: false,
      edition: null,
      licenseId: null,
      cloudDashboardUrl: null,
      hasFeature: () => false,
      isLoading: false,
      isError: false,
    })
    vi.mocked(getAdminDashboardOverviewStats).mockResolvedValue({
      ...overviewStats,
      dataQuality: { ...overviewStats.dataQuality, missingUploadBytesEvents: 3, missingBytesEvents: 3 },
    })

    renderOverviewPage()

    expect(await screen.findByText('历史数据不完整')).toBeTruthy()
    expect(screen.getByText(/当前区间有 3 条/)).toBeTruthy()
  })

  it('warns when the comparison range is missing offline result buckets', async () => {
    vi.mocked(useEntitlement).mockReturnValue({
      bound: false,
      active: false,
      edition: null,
      licenseId: null,
      cloudDashboardUrl: null,
      hasFeature: () => false,
      isLoading: false,
      isError: false,
    })
    vi.mocked(getAdminDashboardOverviewStats).mockResolvedValue({
      ...overviewStats,
      comparisonCoverage: {
        status: 'partial',
        expectedBuckets: 192,
        completedBuckets: 144,
        dataThrough: '2026-06-30T00:00:00.000Z',
      },
    })

    renderOverviewPage()

    expect(await screen.findByText('对比区间存在缺失的小时结果，环比数据不完整。')).toBeTruthy()
    expect(screen.getByText(/对比 144\/192 小时/)).toBeTruthy()
  })

  it('loads the operations dashboard only when an entitled admin expands it', async () => {
    const user = userEvent.setup()
    vi.mocked(useEntitlement).mockReturnValue({
      bound: true,
      active: true,
      edition: 'pro',
      licenseId: 'license-1',
      cloudDashboardUrl: null,
      hasFeature: (feature) => feature === 'analytics',
      isLoading: false,
      isError: false,
    })
    vi.mocked(getAdminDashboardOverviewStats).mockResolvedValue(overviewStats)
    vi.mocked(getAdminDashboardOperationsStats).mockResolvedValue(operationsStats)

    renderOverviewPage()
    expect(getAdminDashboardOperationsStats).not.toHaveBeenCalled()

    await user.click(screen.getByText('运行状态'))

    expect(await screen.findByText('后台任务')).toBeTruthy()
    expect(getAdminDashboardOperationsStats).toHaveBeenCalledTimes(1)
  })
})
