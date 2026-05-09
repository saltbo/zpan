import type { CloudOrder, CloudProduct } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getUserQuota, listCloudOrders, listCloudProducts } from '@/lib/api'
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
  listCloudProducts: vi.fn(),
  listCloudOrders: vi.fn(),
}))

function quotaPackage(): CloudProduct {
  return {
    id: 'pkg-1',
    type: 'zpan_quota',
    name: '100 GB',
    description: 'Extra storage',
    metadata: { storageBytes: 107374182400, trafficBytes: 0 },
    prices: [{ currency: 'usd', amount: 999 }],
    active: true,
    sortOrder: 1,
    createdAt: '2026-05-05T00:00:00.000Z',
    updatedAt: '2026-05-05T00:00:00.000Z',
  }
}

function order(overrides: Partial<CloudOrder> = {}): CloudOrder {
  return {
    id: 'order-1',
    storeId: 'store-1',
    buyerAccountId: 'buyer-1',
    target: { orgId: 'org-1' },
    status: 'paid',
    subtotalAmount: 999,
    discountAmount: 0,
    totalAmount: 999,
    currency: 'usd',
    items: [
      {
        id: 'item-1',
        orderId: 'order-1',
        productId: 'pkg-1',
        productType: 'zpan_quota',
        name: '100 GB',
        description: null,
        quantity: 1,
        unitAmount: 999,
        totalAmount: 999,
        fulfillmentPayload: { storageBytes: 107374182400, trafficBytes: 0 },
      },
    ],
    payments: [],
    paymentStatus: 'paid',
    fulfillmentStatus: 'fulfilled',
    createdAt: '2026-05-05T00:00:00.000Z',
    paidAt: '2026-05-05T00:00:00.000Z',
    fulfilledAt: '2026-05-05T00:00:00.000Z',
    canceledAt: null,
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
      entitlementQuota: 0,
      quota: 100,
      used: 25,
      baseTrafficQuota: 0,
      entitlementTrafficQuota: 0,
      trafficQuota: 0,
      trafficUsed: 0,
      trafficPeriod: '2026-05',
    })
    vi.mocked(listCloudProducts).mockRejectedValue(new Error('quota_store_disabled'))
    vi.mocked(listCloudOrders).mockResolvedValue({ items: [], total: 0 })

    const view = renderQuotaPanel()

    await waitFor(() => expect(view.getByText('quota.storage')).toBeTruthy())
    expect(view.getByRole('link', { name: 'quota.storage' }).getAttribute('href')).toBe('/storage')
    expect(listCloudOrders).not.toHaveBeenCalled()
  })

  it('loads orders when store is available without packages', async () => {
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
    })
    vi.mocked(listCloudProducts).mockResolvedValue({ items: [], total: 0 })
    vi.mocked(listCloudOrders).mockResolvedValue({ items: [], total: 0 })

    const view = renderQuotaPanel()

    await waitFor(() => expect(view.getByRole('link', { name: 'quota.storage' })).toBeTruthy())
    expect(listCloudOrders).toHaveBeenCalledWith()
  })

  it('shows the store entry and matching purchased storage', async () => {
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
    })
    vi.mocked(listCloudProducts).mockResolvedValue({ items: [quotaPackage()], total: 1 })
    vi.mocked(listCloudOrders).mockResolvedValue({
      items: [order(), order({ id: 'order-3', paymentStatus: 'pending' })],
      total: 2,
    })

    const view = renderQuotaPanel()

    await waitFor(() => expect(view.getByRole('link', { name: 'quota.storage' })).toBeTruthy())
    expect(listCloudOrders).toHaveBeenCalledWith()
    expect(view.getByText('quota.cloudStorageEntitlement:100 B')).toBeTruthy()
    await waitFor(() => expect(view.getByText('quota.purchased:100.0 GB')).toBeTruthy())
  })

  it('shows current traffic usage and purchased traffic grants', async () => {
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
    })
    vi.mocked(listCloudProducts).mockResolvedValue({ items: [quotaPackage()], total: 1 })
    vi.mocked(listCloudOrders).mockResolvedValue({
      items: [
        order({
          items: [
            {
              id: 'item-1',
              orderId: 'order-1',
              productId: 'pkg-1',
              productType: 'zpan_quota',
              name: 'Traffic',
              description: null,
              quantity: 1,
              unitAmount: 999,
              totalAmount: 999,
              fulfillmentPayload: { storageBytes: 0, trafficBytes: 107374182400 },
            },
          ],
        }),
      ],
      total: 1,
    })

    const view = renderQuotaPanel()

    await waitFor(() => expect(view.getByText('quota.traffic')).toBeTruthy())
    expect(view.getByText('quota.trafficUsage:200 B/200 B/2026-05')).toBeTruthy()
    await waitFor(() => expect(view.getByText('quota.purchasedTraffic:100.0 GB')).toBeTruthy())
  })
})
