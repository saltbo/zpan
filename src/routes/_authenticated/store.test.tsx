import type { QuotaGrant, QuotaStorePackage } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { toast } from 'sonner'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createQuotaCheckout,
  listPurchasableQuotaPackages,
  listQuotaGrants,
  listQuotaStoreTargets,
  redeemQuotaCode,
} from '@/lib/api'
import { StorePage } from './store'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { amount?: string }) => (values?.amount ? `${key}:${values.amount}` : key),
  }),
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@/lib/api', () => ({
  createQuotaCheckout: vi.fn(),
  listPurchasableQuotaPackages: vi.fn(),
  listQuotaGrants: vi.fn(),
  listQuotaStoreTargets: vi.fn(),
  redeemQuotaCode: vi.fn(),
}))

function grant(overrides: Partial<QuotaGrant> = {}): QuotaGrant {
  return {
    id: 'grant-1',
    orgId: 'org-1',
    source: 'stripe' as const,
    externalEventId: null,
    cloudOrderId: null,
    cloudRedemptionId: null,
    code: null,
    bytes: 1024,
    packageSnapshot: null,
    grantedBy: null,
    terminalUserId: null,
    terminalUserEmail: null,
    active: true,
    createdAt: '2026-05-05T00:00:00.000Z',
    ...overrides,
  }
}

function quotaPackage(): QuotaStorePackage {
  return {
    id: 'pkg-1',
    name: '100 GB',
    description: 'Extra storage',
    bytes: 107374182400,
    amount: 999,
    currency: 'usd' as const,
    active: true,
    sortOrder: 1,
    cloudPackageId: 'cloud-pkg-1',
    syncStatus: 'synced' as const,
    syncError: null,
    createdAt: '2026-05-05T00:00:00.000Z',
    updatedAt: '2026-05-05T00:00:00.000Z',
  }
}

function renderStorePage(queryClient: QueryClient) {
  return render(
    <QueryClientProvider client={queryClient}>
      <StorePage />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('StorePage', () => {
  it('refreshes quota when a checkout grant is delivered', async () => {
    vi.mocked(listPurchasableQuotaPackages).mockResolvedValue({ items: [], total: 0 })
    vi.mocked(listQuotaStoreTargets).mockResolvedValue({
      items: [{ orgId: 'org-1', name: 'Personal', role: 'owner', type: 'personal' }],
      total: 1,
    })
    vi.mocked(listQuotaGrants).mockResolvedValue({
      items: [grant()],
      total: 1,
    })

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    renderStorePage(queryClient)

    await waitFor(() => expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['user', 'quota'] }))
  })

  it('hides self-service forms when the store is unavailable', async () => {
    vi.mocked(listPurchasableQuotaPackages).mockRejectedValue(new Error('quota_store_disabled'))
    vi.mocked(listQuotaStoreTargets).mockResolvedValue({
      items: [{ orgId: 'org-1', name: 'Personal', role: 'owner', type: 'personal' }],
      total: 1,
    })
    vi.mocked(listQuotaGrants).mockResolvedValue({ items: [], total: 0 })

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const view = renderStorePage(queryClient)

    await waitFor(() => expect(view.getByText('store.unavailable')).toBeTruthy())
    expect(view.queryByLabelText('store.storageCode')).toBeNull()
    expect(view.queryByText('store.historyTitle')).toBeNull()
    expect(listQuotaStoreTargets).not.toHaveBeenCalled()
    expect(listQuotaGrants).not.toHaveBeenCalled()
  })

  it('refreshes quota and grants after redemption', async () => {
    vi.mocked(listPurchasableQuotaPackages).mockResolvedValue({ items: [], total: 0 })
    vi.mocked(listQuotaStoreTargets).mockResolvedValue({
      items: [{ orgId: 'org-1', name: 'Personal', role: 'owner', type: 'personal' }],
      total: 1,
    })
    vi.mocked(listQuotaGrants).mockResolvedValue({ items: [], total: 0 })
    vi.mocked(redeemQuotaCode).mockResolvedValue({ ok: true })

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    const view = renderStorePage(queryClient)

    await waitFor(() => expect(view.getByLabelText('store.storageCode')).toBeTruthy())
    fireEvent.change(view.getByLabelText('store.storageCode'), { target: { value: 'STORE-CODE' } })
    fireEvent.click(view.getByRole('button', { name: 'store.redeemButton' }))

    await waitFor(() => expect(redeemQuotaCode).toHaveBeenCalledWith('STORE-CODE', 'org-1'))
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['user', 'quota'] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['quota-store', 'grants'] })
    expect(toast.success).toHaveBeenCalledWith('store.redeemed')
  })

  it('closes the checkout window when checkout fails', async () => {
    vi.mocked(listPurchasableQuotaPackages).mockResolvedValue({ items: [quotaPackage()], total: 1 })
    vi.mocked(listQuotaStoreTargets).mockResolvedValue({
      items: [{ orgId: 'org-1', name: 'Personal', role: 'owner', type: 'personal' }],
      total: 1,
    })
    vi.mocked(listQuotaGrants).mockResolvedValue({ items: [], total: 0 })
    vi.mocked(createQuotaCheckout).mockRejectedValue(new Error('checkout failed'))
    const checkoutWindow = { close: vi.fn(), opener: null, location: { href: '' } }
    vi.spyOn(window, 'open').mockReturnValue(checkoutWindow as unknown as Window)

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const view = renderStorePage(queryClient)

    await waitFor(() => expect(view.getByRole('button', { name: 'store.checkout' })).toBeTruthy())
    fireEvent.click(view.getByRole('button', { name: 'store.checkout' }))

    await waitFor(() => expect(createQuotaCheckout).toHaveBeenCalledWith('pkg-1', 'org-1'))
    expect(checkoutWindow.close).toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('checkout failed')
  })

  it('refreshes quota and grants after checkout starts', async () => {
    vi.mocked(listPurchasableQuotaPackages).mockResolvedValue({ items: [quotaPackage()], total: 1 })
    vi.mocked(listQuotaStoreTargets).mockResolvedValue({
      items: [{ orgId: 'org-1', name: 'Personal', role: 'owner', type: 'personal' }],
      total: 1,
    })
    vi.mocked(listQuotaGrants).mockResolvedValue({ items: [], total: 0 })
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
    const view = renderStorePage(queryClient)

    await waitFor(() => expect(view.getByRole('button', { name: 'store.checkout' })).toBeTruthy())
    fireEvent.click(view.getByRole('button', { name: 'store.checkout' }))

    await waitFor(() => expect(checkoutWindow.location.href).toBe('https://cloud.example.test/checkout'))
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['user', 'quota'] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['quota-store', 'grants'] })
  })
})
