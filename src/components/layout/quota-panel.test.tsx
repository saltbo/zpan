import type { QuotaGrant, QuotaStorePackage } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getUserQuota, listPurchasableQuotaPackages, listQuotaGrants } from '@/lib/api'
import { QuotaPanel } from './quota-panel'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string>) => (values?.amount ? `${key}:${values.amount}` : key),
  }),
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}))

vi.mock('@/lib/api', () => ({
  getUserQuota: vi.fn(),
  listPurchasableQuotaPackages: vi.fn(),
  listQuotaGrants: vi.fn(),
}))

function quotaPackage(): QuotaStorePackage {
  return {
    id: 'pkg-1',
    name: '100 GB',
    description: 'Extra storage',
    bytes: 107374182400,
    amount: 999,
    currency: 'usd',
    active: true,
    sortOrder: 1,
    cloudPackageId: 'cloud-pkg-1',
    syncStatus: 'synced',
    syncError: null,
    createdAt: '2026-05-05T00:00:00.000Z',
    updatedAt: '2026-05-05T00:00:00.000Z',
  }
}

function grant(overrides: Partial<QuotaGrant> = {}): QuotaGrant {
  return {
    id: 'grant-1',
    orgId: 'org-1',
    source: 'stripe',
    externalEventId: null,
    cloudOrderId: null,
    cloudRedemptionId: null,
    code: null,
    bytes: 107374182400,
    packageSnapshot: null,
    grantedBy: null,
    terminalUserId: null,
    terminalUserEmail: null,
    active: true,
    createdAt: '2026-05-05T00:00:00.000Z',
    ...overrides,
  }
}

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
  it('hides the store entry when the store is unavailable', async () => {
    vi.mocked(getUserQuota).mockResolvedValue({ orgId: 'org-1', baseQuota: 100, grantedQuota: 0, quota: 100, used: 25 })
    vi.mocked(listPurchasableQuotaPackages).mockRejectedValue(new Error('quota_store_disabled'))
    vi.mocked(listQuotaGrants).mockResolvedValue({ items: [], total: 0 })

    const view = renderQuotaPanel()

    await waitFor(() => expect(view.getByText('quota.storage')).toBeTruthy())
    expect(view.queryByText('nav.store')).toBeNull()
    expect(listQuotaGrants).not.toHaveBeenCalled()
  })

  it('shows the store entry when redemption is available without packages', async () => {
    vi.mocked(getUserQuota).mockResolvedValue({ orgId: 'org-1', baseQuota: 100, grantedQuota: 0, quota: 100, used: 25 })
    vi.mocked(listPurchasableQuotaPackages).mockResolvedValue({ items: [], total: 0 })
    vi.mocked(listQuotaGrants).mockResolvedValue({ items: [], total: 0 })

    const view = renderQuotaPanel()

    await waitFor(() => expect(view.getByText('nav.store')).toBeTruthy())
    expect(listQuotaGrants).toHaveBeenCalled()
  })

  it('shows the store entry and matching purchased storage', async () => {
    vi.mocked(getUserQuota).mockResolvedValue({
      orgId: 'org-1',
      baseQuota: 100,
      grantedQuota: 100,
      quota: 200,
      used: 25,
    })
    vi.mocked(listPurchasableQuotaPackages).mockResolvedValue({ items: [quotaPackage()], total: 1 })
    vi.mocked(listQuotaGrants).mockResolvedValue({
      items: [grant(), grant({ id: 'grant-2', orgId: 'org-2' }), grant({ id: 'grant-3', active: false })],
      total: 3,
    })

    const view = renderQuotaPanel()

    await waitFor(() => expect(view.getByText('nav.store')).toBeTruthy())
    await waitFor(() => expect(view.getByText('quota.purchased:100 GB')).toBeTruthy())
  })
})
