import type { QuotaStorePackage, StoreOrder } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getUserQuota, listPurchasableQuotaPackages, listStoreOrders } from '@/lib/api'
import { QuotaPanel } from './quota-panel'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string>) => (values?.amount ? `${key}:${values.amount}` : key),
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
  listPurchasableQuotaPackages: vi.fn(),
  listStoreOrders: vi.fn(),
}))

function quotaPackage(): QuotaStorePackage {
  return {
    id: 'pkg-1',
    name: '100 GB',
    description: 'Extra storage',
    storageBytes: 107374182400,
    trafficBytes: 0,
    prices: [{ currency: 'usd', amount: 999 }],
    active: true,
    sortOrder: 1,
    createdAt: '2026-05-05T00:00:00.000Z',
    updatedAt: '2026-05-05T00:00:00.000Z',
  }
}

function order(overrides: Partial<StoreOrder> = {}): StoreOrder {
  return {
    id: 'order-1',
    orgId: 'org-1',
    packageName: '100 GB',
    packageDescription: null,
    storageBytes: 107374182400,
    trafficBytes: 0,
    subtotalAmount: 999,
    giftCardAmount: 0,
    stripeAmount: 999,
    paidAmount: 999,
    currency: 'usd',
    giftCardId: null,
    stripeSessionId: null,
    stripePaymentIntentId: null,
    paymentStatus: 'paid',
    fulfillmentStatus: 'delivered',
    terminalUserId: null,
    terminalUserEmail: null,
    createdAt: '2026-05-05T00:00:00.000Z',
    paidAt: '2026-05-05T00:00:00.000Z',
    fulfilledAt: '2026-05-05T00:00:00.000Z',
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
  it('keeps the storage area clickable when the store is unavailable', async () => {
    vi.mocked(getUserQuota).mockResolvedValue({
      orgId: 'org-1',
      baseQuota: 100,
      quota: 100,
      used: 25,
      trafficQuota: 0,
      trafficUsed: 0,
      trafficPeriod: '2026-05',
    })
    vi.mocked(listPurchasableQuotaPackages).mockRejectedValue(new Error('quota_store_disabled'))
    vi.mocked(listStoreOrders).mockResolvedValue({ items: [], total: 0 })

    const view = renderQuotaPanel()

    await waitFor(() => expect(view.getByText('quota.storage')).toBeTruthy())
    expect(view.getByRole('link', { name: 'quota.storage' }).getAttribute('href')).toBe('/storage')
    expect(listStoreOrders).not.toHaveBeenCalled()
  })

  it('loads orders when store is available without packages', async () => {
    vi.mocked(getUserQuota).mockResolvedValue({
      orgId: 'org-1',
      baseQuota: 100,
      quota: 100,
      used: 25,
      trafficQuota: 0,
      trafficUsed: 0,
      trafficPeriod: '2026-05',
    })
    vi.mocked(listPurchasableQuotaPackages).mockResolvedValue({ items: [], total: 0 })
    vi.mocked(listStoreOrders).mockResolvedValue({ items: [], total: 0 })

    const view = renderQuotaPanel()

    await waitFor(() => expect(view.getByRole('link', { name: 'quota.storage' })).toBeTruthy())
    expect(listStoreOrders).toHaveBeenCalled()
  })

  it('shows the store entry and matching purchased storage', async () => {
    vi.mocked(getUserQuota).mockResolvedValue({
      orgId: 'org-1',
      baseQuota: 100,
      quota: 200,
      used: 25,
      trafficQuota: 0,
      trafficUsed: 0,
      trafficPeriod: '2026-05',
    })
    vi.mocked(listPurchasableQuotaPackages).mockResolvedValue({ items: [quotaPackage()], total: 1 })
    vi.mocked(listStoreOrders).mockResolvedValue({
      items: [order(), order({ id: 'order-2', orgId: 'org-2' }), order({ id: 'order-3', paymentStatus: 'pending' })],
      total: 3,
    })

    const view = renderQuotaPanel()

    await waitFor(() => expect(view.getByRole('link', { name: 'quota.storage' })).toBeTruthy())
    await waitFor(() => expect(view.getByText('quota.purchased:100 GB')).toBeTruthy())
  })
})
