import type { CloudOrder, CloudProduct } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, createCloudCheckout, getUserQuota, listCloudOrders, listCloudProducts } from '@/lib/api'
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
    createCloudCheckout: vi.fn(),
    getUserQuota: vi.fn(),
    listCloudProducts: vi.fn(),
    listCloudOrders: vi.fn(),
  }
})

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
        fulfillmentPayload: { storageBytes: 1024, trafficBytes: 0 },
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
  activeOrganization.value = { id: 'org-1' }
})

describe('StoragePage', () => {
  beforeEach(() => {
    activeOrganization.value = { id: 'org-1' }
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
    vi.mocked(listCloudProducts).mockResolvedValue({ items: [], total: 0 })
    vi.mocked(listCloudOrders).mockResolvedValue({
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
    vi.mocked(listCloudProducts).mockRejectedValue(new ApiError(403, { error: 'quota_store_disabled' }))
    vi.mocked(listCloudOrders).mockResolvedValue({ items: [], total: 0 })

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
    expect(listCloudOrders).not.toHaveBeenCalled()
  })

  it('starts checkout from the packages dialog', async () => {
    vi.mocked(listCloudProducts).mockResolvedValue({ items: [quotaPackage()], total: 1 })
    vi.mocked(listCloudOrders).mockResolvedValue({ items: [], total: 0 })
    vi.mocked(createCloudCheckout).mockResolvedValue({ orderId: 'order-1', url: 'https://cloud.example.test/checkout' })
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

    await waitFor(() => expect(createCloudCheckout).toHaveBeenCalledWith('pkg-1', 'org-1', 'usd'))
    expect(toast.info).not.toHaveBeenCalled()
  })

  it('closes the checkout window when checkout fails', async () => {
    vi.mocked(listCloudProducts).mockResolvedValue({ items: [quotaPackage()], total: 1 })
    vi.mocked(listCloudOrders).mockResolvedValue({ items: [], total: 0 })
    vi.mocked(createCloudCheckout).mockRejectedValue(new Error('checkout failed'))
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

    await waitFor(() => expect(createCloudCheckout).toHaveBeenCalledWith('pkg-1', 'org-1', 'usd'))
    expect(checkoutWindow.close).toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('checkout failed')
  })

  it('refreshes quota and orders after checkout starts', async () => {
    vi.mocked(listCloudProducts).mockResolvedValue({ items: [quotaPackage()], total: 1 })
    vi.mocked(listCloudOrders).mockResolvedValue({ items: [], total: 0 })
    vi.mocked(createCloudCheckout).mockResolvedValue({
      orderId: 'order-1',
      url: 'https://cloud.example.test/checkout',
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
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['cloud-store', 'orders'] })
  })

  it('uses the active workspace for orders and checkout', async () => {
    activeOrganization.value = { id: 'org-2' }
    vi.mocked(listCloudProducts).mockResolvedValue({ items: [quotaPackage()], total: 1 })
    vi.mocked(listCloudOrders).mockResolvedValue({
      items: [order({ id: 'order-2', target: { orgId: 'org-2' } })],
      total: 1,
    })
    vi.mocked(createCloudCheckout).mockResolvedValue({
      orderId: 'order-1',
      url: 'https://cloud.example.test/checkout',
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
    expect(vi.mocked(listCloudOrders)).toHaveBeenCalledWith('org-2')
    fireEvent.click(view.getByRole('button', { name: 'storage.packagesTitle' }))
    fireEvent.click(await view.findByRole('button', { name: /storage.checkout/ }))

    await waitFor(() => expect(createCloudCheckout).toHaveBeenCalledWith('pkg-1', 'org-2', 'usd'))
  })

  it('requires an active organization to checkout', async () => {
    activeOrganization.value = null
    vi.mocked(listCloudProducts).mockResolvedValue({ items: [quotaPackage()], total: 1 })
    vi.mocked(listCloudOrders).mockResolvedValue({ items: [], total: 0 })

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
    await waitFor(() => expect(view.getByRole('button', { name: /storage.checkout/ })).toBeTruthy())
    const checkoutButton = view.getByRole('button', { name: /storage.checkout/ }) as HTMLButtonElement
    expect(checkoutButton.disabled).toBe(true)
    fireEvent.click(checkoutButton)

    expect(listCloudOrders).not.toHaveBeenCalled()
    expect(vi.mocked(createCloudCheckout)).not.toHaveBeenCalled()
  })

  it('uses dedicated dialog layouts instead of nesting cards in dialogs', async () => {
    vi.mocked(listCloudProducts).mockResolvedValue({ items: [quotaPackage()], total: 1 })
    vi.mocked(listCloudOrders).mockResolvedValue({ items: [], total: 0 })

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
