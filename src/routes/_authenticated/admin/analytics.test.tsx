import type { AdminDashboardGrowthStats, AdminStatsCoverage } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useEntitlement } from '@/hooks/useEntitlement'
import {
  getAdminDashboardGrowthStats,
  getAdminDashboardSharingStats,
  getAdminDashboardStorageStats,
  getAdminDashboardTrafficStats,
} from '@/lib/api'
import { OverviewPage } from './analytics'

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
  getAdminDashboardGrowthStats: vi.fn(),
  getAdminDashboardStorageStats: vi.fn(),
  getAdminDashboardTrafficStats: vi.fn(),
  getAdminDashboardSharingStats: vi.fn(),
}))

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

function sectionToggle(title: string): HTMLButtonElement {
  const button = screen.getByText(title).closest('button')
  if (!(button instanceof HTMLButtonElement)) throw new Error(`section toggle not found: ${title}`)
  return button
}

function growthStats(coverage: AdminStatsCoverage): AdminDashboardGrowthStats {
  return {
    generatedAt: '2026-07-21T04:00:00.000Z',
    from: '2026-06-22T00:00:00.000Z',
    to: '2026-07-21T03:59:59.999Z',
    timeZone: 'UTC',
    coverage,
    summary: {
      totalUsers: 10,
      newUsers: { value: 2, previousValue: null, change: null, changePercent: null },
      activeUsers: { value: 4, previousValue: null, change: null, changePercent: null },
      verifiedUsers: 8,
      bannedUsers: 0,
      silentUsers: 6,
      activeUserRate: 40,
      silentUserRate: 60,
    },
    userScaleTrend: [],
    activeUserTrend: [],
    userStatus: [],
    registrationSources: [],
  }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Admin overview dashboard', () => {
  it('shows one page-level Pro badge and removes overview and operations sections', () => {
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

    renderOverviewPage()

    expect(screen.getByText('站点统计')).toBeTruthy()
    expect(screen.getAllByText('Pro')).toHaveLength(1)
    expect(screen.queryByText('站点概览')).toBeNull()
    expect(screen.queryByText('运行状态')).toBeNull()
    expect(screen.getByText('用户与增长')).toBeTruthy()
    expect(screen.getByText('存储与文件')).toBeTruthy()
    expect(screen.getByText('流量与传输')).toBeTruthy()
    expect(screen.getByText('分享与访问')).toBeTruthy()
    expect(screen.getByTestId('upgrade-hint')).toBeTruthy()
    expect(getAdminDashboardGrowthStats).not.toHaveBeenCalled()
    expect(getAdminDashboardStorageStats).not.toHaveBeenCalled()
    expect(getAdminDashboardTrafficStats).not.toHaveBeenCalled()
    expect(getAdminDashboardSharingStats).not.toHaveBeenCalled()
  })

  it('loads growth by default and keeps the other Pro sections lazy', async () => {
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
    vi.mocked(getAdminDashboardGrowthStats).mockReturnValue(new Promise(() => {}))
    vi.mocked(getAdminDashboardStorageStats).mockReturnValue(new Promise(() => {}))

    renderOverviewPage()

    await waitFor(() => expect(getAdminDashboardGrowthStats).toHaveBeenCalledTimes(1))
    expect(sectionToggle('用户与增长').getAttribute('aria-expanded')).toBe('true')
    expect(screen.getAllByRole('button', { expanded: true })).toHaveLength(1)
    expect(getAdminDashboardStorageStats).not.toHaveBeenCalled()
    await user.click(sectionToggle('存储与文件'))
    await waitFor(() => expect(getAdminDashboardStorageStats).toHaveBeenCalledTimes(1))
    expect(sectionToggle('用户与增长').getAttribute('aria-expanded')).toBe('false')
    expect(sectionToggle('存储与文件').getAttribute('aria-expanded')).toBe('true')
    expect(screen.getAllByRole('button', { expanded: true })).toHaveLength(1)
  })

  it('renders exact metrics without exposing coverage or lower-bound diagnostics', async () => {
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
    vi.mocked(getAdminDashboardGrowthStats).mockResolvedValue(
      growthStats({
        status: 'complete',
        expectedBuckets: 700,
        completedBuckets: 700,
        lowerBoundBuckets: 150,
        quality: 'lower_bound',
        dataThrough: '2026-07-21T04:00:00.000Z',
      }),
    )

    renderOverviewPage()

    expect(await screen.findByText('总用户数')).toBeTruthy()
    expect(screen.queryByText(/部分小时|数据下限|当前 700\/700|快照采样/)).toBeNull()
  })

  it('keeps long pie chart legends within the chart and makes them scrollable', async () => {
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
    const stats = growthStats({
      status: 'complete',
      expectedBuckets: 700,
      completedBuckets: 700,
      lowerBoundBuckets: 0,
      quality: 'exact',
      dataThrough: '2026-07-21T04:00:00.000Z',
    })
    stats.userStatus = Array.from({ length: 12 }, (_, index) => ({
      name: `status-${index + 1}`,
      value: index + 1,
      percent: ((index + 1) / 78) * 100,
    }))
    vi.mocked(getAdminDashboardGrowthStats).mockResolvedValue(stats)

    const { container } = renderOverviewPage()

    expect(await screen.findByText('用户状态分布')).toBeTruthy()
    const legend = container.querySelector('[data-slot="breakdown-legend"]')
    expect(legend?.classList.contains('min-h-0')).toBe(true)
    expect(legend?.classList.contains('overflow-y-auto')).toBe(true)
  })

  it('renders available metrics when the selected range is incomplete', async () => {
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
    vi.mocked(getAdminDashboardGrowthStats).mockResolvedValue(
      growthStats({
        status: 'partial',
        expectedBuckets: 700,
        completedBuckets: 699,
        lowerBoundBuckets: 0,
        quality: 'exact',
        dataThrough: '2026-07-21T03:00:00.000Z',
      }),
    )

    renderOverviewPage()

    expect(await screen.findByText('总用户数')).toBeTruthy()
    expect(screen.getAllByText('暂无统计数据').length).toBeGreaterThan(0)
    expect(screen.queryByText(/部分小时|数据下限|当前 699\/700|快照采样/)).toBeNull()
  })
})
