import type { AdminCoreStats } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useEntitlement } from '@/hooks/useEntitlement'
import { getAdminCoreStats, getAdminDetailedStats } from '@/lib/api'
import { OverviewPage } from './index'

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => options,
  Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string | number>) => {
      if (!values) return key
      return Object.entries(values).reduce(
        (message, [name, value]) => message.replace(`{{${name}}}`, String(value)),
        key,
      )
    },
  }),
}))

vi.mock('@/components/UpgradeHint', () => ({
  UpgradeHint: ({ title }: { title: string }) => <div data-testid="upgrade-hint">{title}</div>,
}))

vi.mock('@/hooks/useEntitlement', () => ({
  useEntitlement: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  getAdminCoreStats: vi.fn(),
  getAdminDetailedStats: vi.fn(),
}))

const coreStats: AdminCoreStats = {
  generatedAt: '2026-07-09T00:00:00.000Z',
  users: { total: 42, admins: 2, activeLast30Days: 18, newLast7Days: 5 },
  spaces: { total: 10, personal: 8, team: 2, newLast30Days: 1 },
  storage: {
    usedBytes: 1024,
    quotaBytes: 4096,
    quotaUtilization: 25,
    capacityBytes: 8192,
    backendCount: 1,
    activeBackendCount: 1,
  },
  traffic: { usedBytes: 512, quotaBytes: 2048, utilization: 25, period: '2026-07' },
  sharing: { totalShares: 7, activeShares: 4, views: 120, downloads: 30 },
  operations: { pendingInvitations: 0, failedBackgroundJobs: 0, offlineDownloaders: 0, runningDownloadTasks: 1 },
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
  it('renders core stats without calling detailed stats when analytics is locked', async () => {
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
    vi.mocked(getAdminCoreStats).mockResolvedValue(coreStats)

    renderOverviewPage()

    expect(await screen.findByText('42')).toBeTruthy()
    expect(screen.getByTestId('upgrade-hint').textContent).toBe('admin.overview.analyticsLockedTitle')
    expect(getAdminDetailedStats).not.toHaveBeenCalled()
  })
})
