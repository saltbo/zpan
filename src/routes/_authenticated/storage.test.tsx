import type { QuotaGrant, QuotaStorePackage } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ApiError,
  createQuotaCheckout,
  getUserQuota,
  listPurchasableQuotaPackages,
  listQuotaGrants,
  listQuotaStoreTargets,
  redeemQuotaCode,
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
    listQuotaGrants: vi.fn(),
    listQuotaStoreTargets: vi.fn(),
    redeemQuotaCode: vi.fn(),
  }
})

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
      grantedQuota: 512,
      quota: 1536,
      used: 0,
      trafficQuota: 0,
      trafficUsed: 0,
      trafficPeriod: '2026-05',
    })
  })

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
    renderStoragePage(queryClient)

    await waitFor(() => expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['user', 'quota'] }))
  })

  it('hides self-service forms when storage purchases are disabled', async () => {
    vi.mocked(listPurchasableQuotaPackages).mockRejectedValue(new ApiError(403, { error: 'quota_store_disabled' }))
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
    const view = renderStoragePage(queryClient)

    await waitFor(() => expect(view.getByText('storage.disabledTitle')).toBeTruthy())
    expect(view.getByText('storage.disabledSubtitle')).toBeTruthy()
    expect(view.getByText('storage.disabledBuying')).toBeTruthy()
    expect(view.getByText('storage.disabledRedeeming')).toBeTruthy()
    expect(view.getByText('storage.disabledExistingStorage')).toBeTruthy()
    expect(view.queryByLabelText('storage.storageCode')).toBeNull()
    expect(view.queryByText('storage.historyTitle')).toBeNull()
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
    const view = renderStoragePage(queryClient)

    await waitFor(() => expect(view.getByRole('button', { name: 'storage.redeemTitle' })).toBeTruthy())
    fireEvent.click(view.getByRole('button', { name: 'storage.redeemTitle' }))
    fireEvent.change(view.getByLabelText('storage.storageCode'), { target: { value: 'STORE-CODE' } })
    fireEvent.click(view.getByRole('button', { name: 'storage.redeemButton' }))

    await waitFor(() => expect(redeemQuotaCode).toHaveBeenCalledWith('STORE-CODE', 'org-1'))
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['user', 'quota'] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['storage-plans', 'grants'] })
    expect(toast.success).toHaveBeenCalledWith('storage.redeemed')
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
    const view = renderStoragePage(queryClient)

    await waitFor(() => expect(view.getByRole('button', { name: 'storage.packagesTitle' })).toBeTruthy())
    fireEvent.click(view.getByRole('button', { name: 'storage.packagesTitle' }))
    await waitFor(() => expect(view.getByRole('button', { name: /storage.checkout/ })).toBeTruthy())
    fireEvent.click(view.getByRole('button', { name: /storage.checkout/ }))

    await waitFor(() => expect(createQuotaCheckout).toHaveBeenCalledWith('pkg-1', 'org-1', 'usd'))
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
    const view = renderStoragePage(queryClient)

    await waitFor(() => expect(view.getByRole('button', { name: 'storage.packagesTitle' })).toBeTruthy())
    fireEvent.click(view.getByRole('button', { name: 'storage.packagesTitle' }))
    await waitFor(() => expect(view.getByRole('button', { name: /storage.checkout/ })).toBeTruthy())
    fireEvent.click(view.getByRole('button', { name: /storage.checkout/ }))

    await waitFor(() => expect(checkoutWindow.location.href).toBe('https://cloud.example.test/checkout'))
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['user', 'quota'] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['storage-plans', 'grants'] })
  })

  it('uses the active workspace for grants and checkout', async () => {
    activeOrganization.value = { id: 'org-2' }
    vi.mocked(listPurchasableQuotaPackages).mockResolvedValue({ items: [quotaPackage()], total: 1 })
    vi.mocked(listQuotaStoreTargets).mockResolvedValue({
      items: [
        { orgId: 'org-1', name: 'Personal', role: 'owner', type: 'personal' },
        { orgId: 'org-2', name: 'Team', role: 'owner', type: 'organization' },
      ],
      total: 2,
    })
    vi.mocked(listQuotaGrants).mockResolvedValue({
      items: [grant({ orgId: 'org-1' }), grant({ id: 'grant-2', orgId: 'org-2' })],
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
    vi.mocked(listQuotaGrants).mockResolvedValue({ items: [], total: 0 })

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const view = renderStoragePage(queryClient)

    await waitFor(() => expect(view.getByRole('button', { name: 'storage.redeemTitle' })).toBeTruthy())
    fireEvent.click(view.getByRole('button', { name: 'storage.redeemTitle' }))
    expect(document.body.querySelector('[data-slot="dialog-content"] [data-slot="card"]')).toBeNull()
    fireEvent.click(view.getByRole('button', { name: 'common.close' }))

    fireEvent.click(view.getByRole('button', { name: 'storage.packagesTitle' }))
    await waitFor(() => expect(view.getByText('100 GB')).toBeTruthy())
    expect(document.body.querySelector('[data-slot="dialog-content"] [data-slot="card"]')).toBeNull()
  })
})
