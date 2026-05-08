import type { QuotaStorePackage, StoreOrder } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ApiError,
  createQuotaCheckout,
  getUserQuota,
  listPurchasableQuotaPackages,
  listQuotaStoreTargets,
  listStoreOrders,
} from '@/lib/api'
import { StoragePage } from './storage'

const activeOrganization = vi.hoisted(() => ({
  value: null as { id: string } | null,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { amount?: string }) => (values?.amount ? `${key}:${values.amount}` : key),
  }),
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@/lib/auth-client', () => ({
  useActiveOrganization: () => ({ data: activeOrganization.value }),
}))

vi.mock('@/lib/api', () => {
  class MockApiError extends Error {
    readonly status: number
    readonly body: { error?: string }

    constructor(status: number, body: { error?: string }) {
      super(body.error ?? `HTTP ${status}`)
      this.name = 'ApiError'
      this.status = status
      this.body = body
    }
  }

  return {
    ApiError: MockApiError,
    createQuotaCheckout: vi.fn(),
    getUserQuota: vi.fn(),
    listPurchasableQuotaPackages: vi.fn(),
    listQuotaStoreTargets: vi.fn(),
    listStoreOrders: vi.fn(),
  }
})

function order(overrides: Partial<StoreOrder> = {}): StoreOrder {
  return {
    id: 'order-1',
    orgId: 'org-1',
    packageName: '100 GB',
    packageDescription: null,
    storageBytes: 1024,
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

function renderStoragePage(queryClient: QueryClient) {
  return render(
    <QueryClientProvider client={queryClient}>
      <StoragePage />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  activeOrganization.value = null
})

describe('StoragePage', () => {
  beforeEach(() => {
    vi.mocked(getUserQuota).mockResolvedValue({
      orgId: 'org-1',
      baseQuota: 1024,
      quota: 1536,
      used: 0,
      trafficQuota: 0,
      trafficUsed: 0,
      trafficPeriod: '2026-05',
    })
  })

  it('refreshes quota when a checkout order is delivered', async () => {
    vi.mocked(listPurchasableQuotaPackages).mockResolvedValue({ items: [], total: 0 })
    vi.mocked(listQuotaStoreTargets).mockResolvedValue({
      items: [{ orgId: 'org-1', name: 'Personal', role: 'owner', type: 'personal' }],
      total: 1,
    })
    vi.mocked(listStoreOrders).mockResolvedValue({
      items: [order()],
      total: 1,
    })

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    renderStoragePage(queryClient)

    await waitFor(() => expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['user', 'quota'] }))
  })

  it('hides self-service forms when storage purchases are disabled', async () => {
    vi.mocked(listPurchasableQuotaPackages).mockRejectedValue(new ApiError(403, { error: 'quota_store_disabled' }))
    vi.mocked(listQuotaStoreTargets).mockResolvedValue({
      items: [{ orgId: 'org-1', name: 'Personal', role: 'owner', type: 'personal' }],
      total: 1,
    })
    vi.mocked(listStoreOrders).mockResolvedValue({ items: [], total: 0 })

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const view = renderStoragePage(queryClient)

    await waitFor(() => expect(view.getByText('storage.disabledTitle')).toBeTruthy())
    expect(view.getByText('storage.disabledSubtitle')).toBeTruthy()
    expect(view.getByText('storage.disabledBuying')).toBeTruthy()
    expect(view.getByText('storage.disabledRedeeming')).toBeTruthy()
    expect(view.getByText('storage.disabledExistingStorage')).toBeTruthy()
    expect(view.queryByLabelText('storage.giftCardCode')).toBeNull()
    expect(view.queryByText('storage.historyTitle')).toBeNull()
    expect(listQuotaStoreTargets).not.toHaveBeenCalled()
    expect(listStoreOrders).not.toHaveBeenCalled()
  })

  it('starts checkout from the packages dialog', async () => {
    vi.mocked(listPurchasableQuotaPackages).mockResolvedValue({ items: [quotaPackage()], total: 1 })
    vi.mocked(listQuotaStoreTargets).mockResolvedValue({
      items: [{ orgId: 'org-1', name: 'Personal', role: 'owner', type: 'personal' }],
      total: 1,
    })
    vi.mocked(listStoreOrders).mockResolvedValue({ items: [], total: 0 })
    vi.mocked(createQuotaCheckout).mockResolvedValue({ checkoutUrl: 'https://cloud.example.test/checkout' })
    const checkoutWindow = { close: vi.fn(), opener: null, location: { href: '' } }
    vi.spyOn(window, 'open').mockReturnValue(checkoutWindow as unknown as Window)

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const view = renderStoragePage(queryClient)

    await waitFor(() => expect(view.getByRole('button', { name: 'storage.packagesTitle' })).toBeTruthy())
    fireEvent.click(view.getByRole('button', { name: 'storage.packagesTitle' }))
    await waitFor(() => expect(view.queryByLabelText('storage.giftCardCode')).toBeNull())
    fireEvent.click(view.getByRole('button', { name: /storage.checkout/ }))

    await waitFor(() => expect(createQuotaCheckout).toHaveBeenCalledWith('pkg-1', 'org-1', 'usd'))
    expect(toast.info).not.toHaveBeenCalled()
  })

  it('closes the checkout window when checkout fails', async () => {
    vi.mocked(listPurchasableQuotaPackages).mockResolvedValue({ items: [quotaPackage()], total: 1 })
    vi.mocked(listQuotaStoreTargets).mockResolvedValue({
      items: [{ orgId: 'org-1', name: 'Personal', role: 'owner', type: 'personal' }],
      total: 1,
    })
    vi.mocked(listStoreOrders).mockResolvedValue({ items: [], total: 0 })
    vi.mocked(createQuotaCheckout).mockRejectedValue(new Error('checkout failed'))
    const checkoutWindow = { close: vi.fn(), opener: null, location: { href: '' } }
    vi.spyOn(window, 'open').mockReturnValue(checkoutWindow as unknown as Window)

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const view = renderStoragePage(queryClient)

    await waitFor(() => expect(view.getByRole('button', { name: 'storage.packagesTitle' })).toBeTruthy())
    fireEvent.click(view.getByRole('button', { name: 'storage.packagesTitle' }))
    await waitFor(() => expect(view.getByRole('button', { name: /storage.checkout/ })).toBeTruthy())
    fireEvent.click(view.getByRole('button', { name: /storage.checkout/ }))

    await waitFor(() => expect(createQuotaCheckout).toHaveBeenCalledWith('pkg-1', 'org-1', 'usd'))
    expect(checkoutWindow.close).toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('checkout failed')
  })

  it('refreshes quota and orders after checkout starts', async () => {
    vi.mocked(listPurchasableQuotaPackages).mockResolvedValue({ items: [quotaPackage()], total: 1 })
    vi.mocked(listQuotaStoreTargets).mockResolvedValue({
      items: [{ orgId: 'org-1', name: 'Personal', role: 'owner', type: 'personal' }],
      total: 1,
    })
    vi.mocked(listStoreOrders).mockResolvedValue({ items: [], total: 0 })
    vi.mocked(createQuotaCheckout).mockResolvedValue({
      checkoutUrl: 'https://cloud.example.test/checkout',
    })
    const checkoutWindow = { close: vi.fn(), opener: null, location: { href: '' } }
    vi.spyOn(window, 'open').mockReturnValue(checkoutWindow as unknown as Window)

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    const view = renderStoragePage(queryClient)

    await waitFor(() => expect(view.getByRole('button', { name: 'storage.packagesTitle' })).toBeTruthy())
    fireEvent.click(view.getByRole('button', { name: 'storage.packagesTitle' }))
    await waitFor(() => expect(view.getByRole('button', { name: /storage.checkout/ })).toBeTruthy())
    fireEvent.click(view.getByRole('button', { name: /storage.checkout/ }))

    await waitFor(() => expect(checkoutWindow.location.href).toBe('https://cloud.example.test/checkout'))
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['user', 'quota'] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['storage-plans', 'orders'] })
  })

  it('uses the active workspace for orders and checkout', async () => {
    activeOrganization.value = { id: 'org-2' }
    vi.mocked(listPurchasableQuotaPackages).mockResolvedValue({ items: [quotaPackage()], total: 1 })
    vi.mocked(listQuotaStoreTargets).mockResolvedValue({
      items: [
        { orgId: 'org-1', name: 'Personal', role: 'owner', type: 'personal' },
        { orgId: 'org-2', name: 'Team', role: 'owner', type: 'organization' },
      ],
      total: 2,
    })
    vi.mocked(listStoreOrders).mockResolvedValue({
      items: [order({ orgId: 'org-1' }), order({ id: 'order-2', orgId: 'org-2' })],
      total: 2,
    })
    vi.mocked(createQuotaCheckout).mockResolvedValue({
      checkoutUrl: 'https://cloud.example.test/checkout',
    })
    const checkoutWindow = { close: vi.fn(), opener: null, location: { href: '' } }
    vi.spyOn(window, 'open').mockReturnValue(checkoutWindow as unknown as Window)

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const view = renderStoragePage(queryClient)

    await waitFor(() => expect(view.getByText('org-2')).toBeTruthy())
    expect(view.queryByText('org-1')).toBeNull()
    fireEvent.click(view.getByRole('button', { name: 'storage.packagesTitle' }))
    fireEvent.click(await view.findByRole('button', { name: /storage.checkout/ }))

    await waitFor(() => expect(createQuotaCheckout).toHaveBeenCalledWith('pkg-1', 'org-2', 'usd'))
  })

  it('uses dedicated dialog layouts instead of nesting cards in dialogs', async () => {
    vi.mocked(listPurchasableQuotaPackages).mockResolvedValue({ items: [quotaPackage()], total: 1 })
    vi.mocked(listQuotaStoreTargets).mockResolvedValue({
      items: [{ orgId: 'org-1', name: 'Personal', role: 'owner', type: 'personal' }],
      total: 1,
    })
    vi.mocked(listStoreOrders).mockResolvedValue({ items: [], total: 0 })

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const view = renderStoragePage(queryClient)

    await waitFor(() => expect(view.getByRole('button', { name: 'storage.packagesTitle' })).toBeTruthy())
    fireEvent.click(view.getByRole('button', { name: 'storage.packagesTitle' }))
    await waitFor(() => expect(view.getByText('100 GB')).toBeTruthy())
    expect(document.body.querySelector('[data-slot="dialog-content"] [data-slot="card"]')).toBeNull()
    expect(view.queryByRole('button', { name: 'storage.redeemTitle' })).toBeNull()
  })
})
