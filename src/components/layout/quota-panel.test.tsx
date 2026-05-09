import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getUserQuota } from '@/lib/api'
import { QuotaPanel } from './quota-panel'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string>) => {
      if (values?.amount) return `${key}:${values.amount}`
      if (values?.used && values?.total && values?.period)
        return `${key}:${values.used}/${values.total}/${values.period}`
      if (values?.used && values?.total) return `${key}:${values.used}/${values.total}`
      return key
    },
  }),
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}))

vi.mock('@/lib/auth-client', () => ({
  useActiveOrganization: () => ({ data: null }),
}))

vi.mock('@/lib/api', () => ({
  getUserQuota: vi.fn(),
}))

function renderQuotaPanel() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <QuotaPanel enabled />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('QuotaPanel', () => {
  it('keeps the storage area clickable when the store is unavailable', async () => {
    vi.mocked(getUserQuota).mockResolvedValue({
      orgId: 'org-1',
      baseQuota: 100,
      entitlementQuota: 0,
      quota: 100,
      used: 25,
      baseTrafficQuota: 0,
      entitlementTrafficQuota: 0,
      trafficQuota: 0,
      trafficUsed: 0,
      trafficPeriod: '2026-05',
      storagePlanName: null,
      storageExtraNames: [],
      trafficPlanName: null,
      trafficExtraNames: [],
    })

    const view = renderQuotaPanel()

    await waitFor(() => expect(view.getByText('quota.storage')).toBeTruthy())
    expect(view.getByRole('link', { name: 'quota.storage' }).getAttribute('href')).toBe('/storage')
  })

  it('shows storage usage without querying Cloud orders', async () => {
    vi.mocked(getUserQuota).mockResolvedValue({
      orgId: 'org-1',
      baseQuota: 100,
      entitlementQuota: 0,
      quota: 100,
      used: 25,
      baseTrafficQuota: 0,
      entitlementTrafficQuota: 0,
      trafficQuota: 0,
      trafficUsed: 0,
      trafficPeriod: '2026-05',
      storagePlanName: null,
      storageExtraNames: [],
      trafficPlanName: null,
      trafficExtraNames: [],
    })

    const view = renderQuotaPanel()

    await waitFor(() => expect(view.getByRole('link', { name: 'quota.storage' })).toBeTruthy())
    expect(view.getByText('quota.usage:25 B/100 B')).toBeTruthy()
  })

  it('shows active plan and extra storage names from quota data', async () => {
    vi.mocked(getUserQuota).mockResolvedValue({
      orgId: 'org-1',
      baseQuota: 100,
      entitlementQuota: 100,
      quota: 200,
      used: 25,
      baseTrafficQuota: 0,
      entitlementTrafficQuota: 0,
      trafficQuota: 0,
      trafficUsed: 0,
      trafficPeriod: '2026-05',
      storagePlanName: 'Team Plan',
      storageExtraNames: ['Storage Pack'],
      trafficPlanName: null,
      trafficExtraNames: [],
    })

    const view = renderQuotaPanel()

    await waitFor(() => expect(view.getByRole('link', { name: 'quota.storage' })).toBeTruthy())
    expect(view.getByText('Team Plan · 100 B')).toBeTruthy()
    expect(view.getByText('quota.cloudStorageEntitlement:Storage Pack · 100 B')).toBeTruthy()
  })

  it('does not show traffic usage in the sidebar quota panel', async () => {
    vi.mocked(getUserQuota).mockResolvedValue({
      orgId: 'org-1',
      baseQuota: 100,
      entitlementQuota: 0,
      quota: 100,
      used: 25,
      baseTrafficQuota: 100,
      entitlementTrafficQuota: 100,
      trafficQuota: 200,
      trafficUsed: 200,
      trafficPeriod: '2026-05',
      storagePlanName: null,
      storageExtraNames: [],
      trafficPlanName: null,
      trafficExtraNames: [],
    })

    const view = renderQuotaPanel()

    await waitFor(() => expect(view.getByRole('link', { name: 'quota.storage' })).toBeTruthy())
    expect(view.queryByText('quota.traffic')).toBeNull()
    expect(view.queryByText('quota.trafficUsage:200 B/200 B/2026-05')).toBeNull()
  })
})
