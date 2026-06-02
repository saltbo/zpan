import type { CloudOrder, CloudProduct } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ApiError,
  cancelCloudOrder,
  getCloudCredits,
  getUserQuota,
  listCloudCreditLedgerEntries,
  listCloudCreditProducts,
  listCloudOrders,
  listCloudProducts,
  redeemCloudGiftCard,
} from '@/lib/api'
import { openNewTab } from '@/lib/browser-navigation'
import { StoragePage } from './storage'

const activeOrganization = vi.hoisted(() => ({
  value: null as { id: string } | null,
}))
const i18nState = vi.hoisted(() => ({
  language: 'en',
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      key: string,
      values?: {
        amount?: string
        base?: string
        cloud?: string
        currency?: string
        days?: number
        period?: string
        size?: string
        total?: string
        used?: string
      },
    ) => {
      if (values?.amount) return `${key}:${values.amount}`
      if (values?.size) return `${key}:${values.size}`
      if (values?.total) return `${key}:${values.total}`
      if (values?.used && values?.base && values?.cloud) return `${key}:${values.used}/${values.base}/${values.cloud}`
      if (values?.base && values?.cloud) return `${key}:${values.base}/${values.cloud}`
      if (values?.period) return `${key}:${values.period}`
      if (values?.days) return `${key}:${values.days}`
      return key
    },
    i18n: { resolvedLanguage: i18nState.language },
  }),
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => options,
}))

vi.mock('@/lib/auth-client', () => ({
  useActiveOrganization: () => ({ data: activeOrganization.value }),
}))

vi.mock('@/lib/browser-navigation', () => ({
  openNewTab: vi.fn(),
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
    cancelCloudOrder: vi.fn(),
    getUserQuota: vi.fn(),
    getCloudCredits: vi.fn(),
    redeemCloudGiftCard: vi.fn(),
    listCloudCreditProducts: vi.fn(),
    listCloudProducts: vi.fn(),
    listCloudOrders: vi.fn(),
    listCloudCreditLedgerEntries: vi.fn(),
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
        productType: 'store_item',
        name: '100 GB',
        description: null,
        quantity: 1,
        unitAmount: 999,
        totalAmount: 999,
        fulfillmentPayload: {
          deliverable: { type: 'zpan.plan', storageBytes: 1024, trafficBytes: 0, includedCredits: 0 },
        },
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
    storeId: 'store-1',
    type: 'store_item',
    name: '100 GB',
    description: 'Extra storage',
    metadata: {
      deliverable: { type: 'zpan.plan', storageBytes: 107374182400, includedCredits: 1000 },
    },
    prices: [
      {
        id: 'price-usd',
        currency: 'usd',
        amount: 999,
        recurring: { interval: 'month', intervalCount: 1 },
        metadata: { creditGrantType: 'subscription_grant', creditAmount: '1000' },
      },
    ],
    active: true,
    sortOrder: 1,
    createdAt: '2026-05-05T00:00:00.000Z',
    updatedAt: '2026-05-05T00:00:00.000Z',
  }
}

function subscriptionPackage(): CloudProduct {
  return {
    ...quotaPackage(),
    id: 'pkg-subscription',
    name: 'Team Plan',
    metadata: {
      deliverable: { type: 'zpan.plan', storageBytes: 107374182400, includedCredits: 1000 },
    },
    prices: [
      {
        id: 'price-subscription-usd',
        currency: 'usd',
        amount: 999,
        recurring: { interval: 'month', intervalCount: 1 },
        metadata: { creditGrantType: 'subscription_grant', creditAmount: '1000' },
      },
      {
        id: 'price-subscription-yearly-usd',
        currency: 'usd',
        amount: 9999,
        recurring: { interval: 'year', intervalCount: 1 },
        metadata: { creditGrantType: 'subscription_grant', creditAmount: '1000' },
      },
    ],
  }
}

function creditPackage(): CloudProduct {
  return {
    id: 'pkg-credits',
    storeId: 'store-1',
    type: 'store_item',
    name: '5,000 Credits',
    description: 'Credit top-up',
    metadata: {
      deliverable: { type: 'zpan.credits', includedCredits: 5000 },
    },
    prices: [
      {
        id: 'price-credits-usd',
        currency: 'usd',
        amount: 2999,
        metadata: { creditGrantType: 'top_up', creditAmount: '5000' },
      },
    ],
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
  i18nState.language = 'en'
})

describe('StoragePage', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/storage')
    activeOrganization.value = { id: 'org-1' }
    vi.mocked(getUserQuota).mockResolvedValue({
      orgId: 'org-1',
      baseQuota: 1024,
      entitlementQuota: 512,
      quota: 1536,
      used: 0,
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
    vi.mocked(getCloudCredits).mockResolvedValue({ balance: 0 })
    vi.mocked(listCloudCreditProducts).mockResolvedValue({ items: [], total: 0 })
    vi.mocked(listCloudCreditLedgerEntries).mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 })
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

  it('shows effective quota and metered traffic status', async () => {
    vi.mocked(getUserQuota).mockResolvedValue({
      orgId: 'org-1',
      baseQuota: 1024,
      entitlementQuota: 512,
      quota: 1536,
      used: 1536,
      baseTrafficQuota: 1024,
      entitlementTrafficQuota: 512,
      trafficQuota: 1536,
      trafficUsed: 1536,
      trafficPeriod: '2026-05',
      storagePlanName: 'Team Plan',
      storageExtraNames: ['Storage Pack'],
      trafficPlanName: 'Team Plan',
      trafficExtraNames: ['Traffic Boost'],
      currentPlan: {
        sourceId: 'stripe_subscription:sub_1:org-1',
        packageId: 'pkg-subscription',
        name: 'Team Plan',
        storageBytes: 1024,
        trafficBytes: 1024,
        trafficOveragePriceCents: null,
        expiresAt: null,
        subscription: true,
      },
    })
    vi.mocked(listCloudProducts).mockResolvedValue({ items: [], total: 0 })
    vi.mocked(listCloudOrders).mockResolvedValue({ items: [], total: 0 })

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const view = renderStoragePage(queryClient)

    await waitFor(() => expect(view.getByText('Team Plan')).toBeTruthy())
    expect(view.getByText('storage.planActive')).toBeTruthy()
    expect(view.getByText('storage.currentPlanDescription')).toBeTruthy()
    expect(view.getByText('storage.effectiveStorageQuota')).toBeTruthy()
    expect(view.getByText('storage.baseStorageQuota')).toBeTruthy()
    expect(view.getByText('storage.cloudStorageEntitlement')).toBeTruthy()
    expect(view.getByText('storage.creditBalance')).toBeTruthy()
    expect(view.getByText('storage.trafficPolicy')).toBeTruthy()
    expect(view.getByText('storage.usageBilledWithCredits')).toBeTruthy()
    expect(view.getByText('storage.currentPeriodTraffic')).toBeTruthy()
    await waitFor(() => expect(view.getByText('storage.storageQuotaDetail:1.5 KB/1.0 KB/512 B')).toBeTruthy())
    expect(view.getByText('storage.trafficPeriodDetail:2026-05')).toBeTruthy()
    expect(view.getByText('Team Plan · 1.0 KB')).toBeTruthy()
    expect(view.getByText('Storage Pack · 512 B')).toBeTruthy()
    await waitFor(() => expect(view.getAllByText('storage.overCap')).toHaveLength(2))
  })

  it('does not mark unlimited quota usage as over cap', async () => {
    vi.mocked(getUserQuota).mockResolvedValue({
      orgId: 'org-1',
      baseQuota: 0,
      entitlementQuota: 0,
      quota: 0,
      used: 1536,
      baseTrafficQuota: 0,
      entitlementTrafficQuota: 0,
      trafficQuota: 0,
      trafficUsed: 2048,
      trafficPeriod: '2026-05',
      storagePlanName: null,
      storageExtraNames: [],
      trafficPlanName: null,
      trafficExtraNames: [],
    })
    vi.mocked(listCloudProducts).mockResolvedValue({ items: [], total: 0 })
    vi.mocked(listCloudOrders).mockResolvedValue({ items: [], total: 0 })

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const view = renderStoragePage(queryClient)

    await waitFor(() => expect(view.getByText('storage.storageQuotaDetail:1.5 KB/0 B/0 B')).toBeTruthy())
    expect(view.queryByText('storage.overCap')).toBeNull()
    expect(view.getAllByText('storage.usageNoLimit')).toHaveLength(2)
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

  it('starts checkout from the product catalog', async () => {
    vi.mocked(listCloudProducts).mockResolvedValue({ items: [quotaPackage()], total: 1 })
    vi.mocked(listCloudOrders).mockResolvedValue({ items: [], total: 0 })

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const view = renderStoragePage(queryClient)

    await waitFor(() => expect(view.getByRole('button', { name: /storage.checkoutMonthly/ })).toBeTruthy())
    fireEvent.click(view.getByRole('button', { name: /storage.checkoutMonthly/ }))

    expect(openNewTab).toHaveBeenCalledWith('/store/checkout?action=checkout&packageId=pkg-1&priceId=price-usd')
    expect(toast.info).not.toHaveBeenCalled()
  })

  it('shows expanded pricing card details', async () => {
    vi.mocked(listCloudProducts).mockResolvedValue({ items: [subscriptionPackage()], total: 1 })
    vi.mocked(listCloudOrders).mockResolvedValue({ items: [], total: 0 })

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const view = renderStoragePage(queryClient)

    await waitFor(() => expect(view.getByText('storage.planBadge')).toBeTruthy())
    expect(view.getByText('storage.trafficPolicy')).toBeTruthy()
    expect(view.getByText('storage.includedCredits')).toBeTruthy()
    expect(view.getByText('storage.usageBilledWithCredits')).toBeTruthy()
  })

  it('uses the USD product price for checkout regardless of locale', async () => {
    i18nState.language = 'zh-CN'
    vi.mocked(listCloudProducts).mockResolvedValue({ items: [quotaPackage()], total: 1 })
    vi.mocked(listCloudOrders).mockResolvedValue({ items: [], total: 0 })

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const view = renderStoragePage(queryClient)

    await waitFor(() => expect(view.getByRole('button', { name: /storage.checkoutMonthly/ })).toBeTruthy())
    fireEvent.click(view.getByRole('button', { name: /storage.checkoutMonthly/ }))

    expect(openNewTab).toHaveBeenCalledWith('/store/checkout?action=checkout&packageId=pkg-1&priceId=price-usd')
  })

  it('opens the checkout redirect page instead of creating a blank tab', async () => {
    vi.mocked(listCloudProducts).mockResolvedValue({ items: [quotaPackage()], total: 1 })
    vi.mocked(listCloudOrders).mockResolvedValue({ items: [], total: 0 })

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const view = renderStoragePage(queryClient)

    await waitFor(() => expect(view.getByRole('button', { name: /storage.checkoutMonthly/ })).toBeTruthy())
    fireEvent.click(view.getByRole('button', { name: /storage.checkoutMonthly/ }))

    expect(openNewTab).toHaveBeenCalledWith('/store/checkout?action=checkout&packageId=pkg-1&priceId=price-usd')
  })

  it('refreshes quota and orders after checkout starts', async () => {
    vi.mocked(listCloudProducts).mockResolvedValue({ items: [quotaPackage()], total: 1 })
    vi.mocked(listCloudOrders).mockResolvedValue({ items: [], total: 0 })
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    const view = renderStoragePage(queryClient)

    await waitFor(() => expect(view.getByRole('button', { name: /storage.checkoutMonthly/ })).toBeTruthy())
    fireEvent.click(view.getByRole('button', { name: /storage.checkoutMonthly/ }))

    expect(openNewTab).toHaveBeenCalledWith('/store/checkout?action=checkout&packageId=pkg-1&priceId=price-usd')
    expect(view.getByText('storage.checkoutPending')).toBeTruthy()
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['user', 'quota'] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['cloud-store', 'orders'] })
  })

  it('opens the Stripe portal for an active workspace plan', async () => {
    vi.mocked(getUserQuota).mockResolvedValue({
      orgId: 'org-1',
      baseQuota: 1024,
      entitlementQuota: 512,
      quota: 1536,
      used: 0,
      baseTrafficQuota: 0,
      entitlementTrafficQuota: 0,
      trafficQuota: 0,
      trafficUsed: 0,
      trafficPeriod: '2026-05',
      storagePlanName: 'Team Plan',
      storageExtraNames: [],
      trafficPlanName: null,
      trafficExtraNames: [],
    })
    vi.mocked(listCloudProducts).mockResolvedValue({ items: [subscriptionPackage()], total: 1 })
    vi.mocked(listCloudOrders).mockResolvedValue({ items: [], total: 0 })
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const view = renderStoragePage(queryClient)

    await waitFor(() => expect(view.getByRole('button', { name: 'storage.managePlan' })).toBeTruthy())
    fireEvent.click(view.getByRole('button', { name: 'storage.managePlan' }))

    expect(openNewTab).toHaveBeenCalledWith('/store/checkout?action=portal')
  })

  it('shows only the active workspace plan when a subscription is active', async () => {
    vi.mocked(getUserQuota).mockResolvedValue({
      orgId: 'org-1',
      baseQuota: 1024,
      entitlementQuota: 512,
      quota: 1536,
      used: 0,
      baseTrafficQuota: 0,
      entitlementTrafficQuota: 0,
      trafficQuota: 0,
      trafficUsed: 0,
      trafficPeriod: '2026-05',
      storagePlanName: 'Team Plan',
      storageExtraNames: [],
      trafficPlanName: null,
      trafficExtraNames: [],
      currentPlan: {
        sourceId: 'stripe_subscription:sub_1:org-1',
        packageId: 'pkg-subscription',
        name: 'Team Plan',
        storageBytes: 1024,
        trafficBytes: 0,
        trafficOveragePriceCents: null,
        expiresAt: null,
        subscription: true,
      },
    })
    vi.mocked(listCloudProducts).mockResolvedValue({ items: [subscriptionPackage()], total: 1 })
    vi.mocked(listCloudOrders).mockResolvedValue({ items: [], total: 0 })

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const view = renderStoragePage(queryClient)

    await waitFor(() => expect(view.getByRole('button', { name: 'storage.managePlan' })).toBeTruthy())
    expect(view.getByText('Team Plan')).toBeTruthy()
    expect(view.getByRole('button', { name: 'storage.managePlan' })).toBeTruthy()
    expect(view.queryByRole('button', { name: /storage.checkoutMonthly|storage.checkoutYearly/ })).toBeNull()
    expect(openNewTab).not.toHaveBeenCalled()
  })

  it('uses the active workspace for orders and checkout', async () => {
    activeOrganization.value = { id: 'org-2' }
    vi.mocked(listCloudProducts).mockResolvedValue({ items: [quotaPackage()], total: 1 })
    vi.mocked(listCloudOrders).mockResolvedValue({
      items: [order({ id: 'order-2', target: { orgId: 'org-2' } })],
      total: 1,
    })

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const view = renderStoragePage(queryClient)

    await waitFor(() => expect(view.getByRole('button', { name: 'storage.historyTitle' })).toBeTruthy())
    fireEvent.click(view.getByRole('button', { name: 'storage.historyTitle' }))
    await waitFor(() => expect(view.getByText('org-2')).toBeTruthy())
    expect(vi.mocked(listCloudOrders)).toHaveBeenCalledWith()
    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' })
    await waitFor(() => expect(view.queryByText('org-2')).toBeNull())
    fireEvent.click(await view.findByRole('button', { name: /storage.checkoutMonthly/ }))

    expect(openNewTab).toHaveBeenCalledWith('/store/checkout?action=checkout&packageId=pkg-1&priceId=price-usd')
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

    await waitFor(() => expect(view.queryByLabelText('storage.giftCardCode')).toBeNull())
    await waitFor(() => expect(view.getByRole('button', { name: /storage.checkoutMonthly/ })).toBeTruthy())
    const checkoutButton = view.getByRole('button', { name: /storage.checkoutMonthly/ }) as HTMLButtonElement
    expect(checkoutButton.disabled).toBe(true)
    fireEvent.click(checkoutButton)

    expect(listCloudOrders).not.toHaveBeenCalled()
    expect(openNewTab).not.toHaveBeenCalled()
  })

  it('shows product cards on the page instead of inside a dialog', async () => {
    vi.mocked(listCloudProducts).mockResolvedValue({ items: [quotaPackage()], total: 1 })
    vi.mocked(listCloudOrders).mockResolvedValue({ items: [], total: 0 })

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const view = renderStoragePage(queryClient)

    await waitFor(() => expect(view.queryByText('common.loading')).toBeNull())
    await waitFor(() => expect(view.getByText('100 GB')).toBeTruthy())
    expect(view.getByText('storage.availableProductsTitle')).toBeTruthy()
    expect(view.getByText('storage.baseStorageQuota')).toBeTruthy()
    expect(view.getByRole('button', { name: /storage.checkoutMonthly/ })).toBeTruthy()
    expect(view.queryByRole('button', { name: 'storage.redeemTitle' })).toBeNull()
  })

  it('shows credit balance inside the credits dialog', async () => {
    vi.mocked(listCloudProducts).mockResolvedValue({ items: [], total: 0 })
    vi.mocked(listCloudOrders).mockResolvedValue({ items: [], total: 0 })
    vi.mocked(getCloudCredits).mockResolvedValue({ balance: 1250 })

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const view = renderStoragePage(queryClient)

    await waitFor(() => expect(view.queryByText('common.loading')).toBeNull())
    const creditsButton = view.getByLabelText('storage.viewCreditActivity')
    expect(creditsButton).toBeTruthy()
    expect(creditsButton.textContent).toContain('storage.creditsButton')
    expect(creditsButton.textContent).not.toContain('1,250')
    expect(view.getByText('storage.currentPeriodTraffic')).toBeTruthy()
    fireEvent.click(creditsButton)
    expect(await view.findByText('storage.creditBalance')).toBeTruthy()
    expect(view.getByRole('button', { name: 'storage.redeemTitle' })).toBeTruthy()
    await waitFor(() => expect(view.getByText('1,250')).toBeTruthy())
  })

  it('starts checkout from a credits top-up product', async () => {
    vi.mocked(listCloudProducts).mockResolvedValue({ items: [], total: 0 })
    vi.mocked(listCloudCreditProducts).mockResolvedValue({ items: [creditPackage()], total: 1 })
    vi.mocked(listCloudOrders).mockResolvedValue({ items: [], total: 0 })

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const view = renderStoragePage(queryClient)

    await waitFor(() => expect(view.getByLabelText('storage.viewCreditActivity')).toBeTruthy())
    fireEvent.click(view.getByLabelText('storage.viewCreditActivity'))
    expect(await view.findByText('storage.creditTopUpTitle')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'storage.buyCredits' }))

    expect(openNewTab).toHaveBeenCalledWith(
      '/store/checkout?action=checkout&packageId=pkg-credits&priceId=price-credits-usd',
    )
  })

  it('opens credit activity dialog', async () => {
    vi.mocked(listCloudProducts).mockResolvedValue({ items: [], total: 0 })
    vi.mocked(listCloudOrders).mockResolvedValue({ items: [], total: 0 })
    vi.mocked(getCloudCredits).mockResolvedValue({ balance: 1250 })
    vi.mocked(listCloudCreditLedgerEntries).mockResolvedValue({
      items: [
        {
          id: 'ledger-1',
          creditAccountId: 'credit-account-1',
          creditBucketId: 'credit-bucket-1',
          storeId: 'store-1',
          customerId: 'org-1',
          amount: 500,
          direction: 'credit',
          status: 'posted',
          sourceType: 'gift_card_redemption',
          sourceId: 'gift-1',
          orderId: null,
          paymentId: null,
          createdAt: '2026-05-08T00:00:00.000Z',
        },
      ],
      total: 1,
      limit: 50,
      offset: 0,
    })

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const view = renderStoragePage(queryClient)

    await waitFor(() => expect(view.getByLabelText('storage.viewCreditActivity')).toBeTruthy())
    fireEvent.click(view.getByLabelText('storage.viewCreditActivity'))

    expect(await view.findByText('storage.creditActivityTitle')).toBeTruthy()
    expect(view.getByText('1,250')).toBeTruthy()
    expect(view.getByText('storage.creditSourceGiftCard')).toBeTruthy()
  })

  it('redeems a gift card successfully', async () => {
    vi.mocked(listCloudProducts).mockResolvedValue({ items: [], total: 0 })
    vi.mocked(listCloudOrders).mockResolvedValue({ items: [], total: 0 })
    vi.mocked(redeemCloudGiftCard).mockResolvedValue({
      redeemedCredits: 5000,
      entries: [],
      failures: [],
    })

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    const view = renderStoragePage(queryClient)

    await waitFor(() => expect(view.queryByText('common.loading')).toBeNull())
    fireEvent.click(view.getByLabelText('storage.viewCreditActivity'))
    await waitFor(() => expect(view.getByRole('button', { name: 'storage.redeemTitle' })).toBeTruthy())
    fireEvent.click(view.getByRole('button', { name: 'storage.redeemTitle' }))
    fireEvent.change(view.getByLabelText('storage.giftCardCode'), { target: { value: 'ZS-1234-5678' } })
    fireEvent.click(view.getByRole('button', { name: 'storage.redeemAction' }))

    await waitFor(() => expect(redeemCloudGiftCard).toHaveBeenCalledWith('ZS-1234-5678'))
    expect(toast.success).toHaveBeenCalledWith('storage.redeemSuccess:5000')
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['cloud-store', 'credits'] })
  })

  it('continues payment for an unpaid order', async () => {
    vi.mocked(listCloudProducts).mockResolvedValue({ items: [], total: 0 })
    vi.mocked(listCloudOrders).mockResolvedValue({
      items: [order({ id: 'order-unpaid', paymentStatus: 'unpaid', status: 'pending' })],
      total: 1,
    })

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    const view = renderStoragePage(queryClient)

    await waitFor(() => expect(view.getByRole('button', { name: 'storage.historyTitle' })).toBeTruthy())
    fireEvent.click(view.getByRole('button', { name: 'storage.historyTitle' }))
    await waitFor(() => expect(view.getByLabelText('storage.continuePayment')).toBeTruthy())
    fireEvent.click(view.getByLabelText('storage.continuePayment'))

    expect(openNewTab).toHaveBeenCalledWith('/store/checkout?action=payment&orderId=order-unpaid')
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['cloud-store', 'orders'] })
  })

  it('cancels an unpaid order', async () => {
    vi.mocked(listCloudProducts).mockResolvedValue({ items: [], total: 0 })
    vi.mocked(listCloudOrders).mockResolvedValue({
      items: [order({ id: 'order-unpaid', paymentStatus: 'unpaid', status: 'pending' })],
      total: 1,
    })
    vi.mocked(cancelCloudOrder).mockResolvedValue(
      order({ id: 'order-unpaid', status: 'canceled', paymentStatus: 'canceled' }),
    )

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    const view = renderStoragePage(queryClient)

    await waitFor(() => expect(view.getByRole('button', { name: 'storage.historyTitle' })).toBeTruthy())
    fireEvent.click(view.getByRole('button', { name: 'storage.historyTitle' }))
    await waitFor(() => expect(view.getByLabelText('storage.cancelOrder')).toBeTruthy())
    fireEvent.click(view.getByLabelText('storage.cancelOrder'))
    expect(await view.findByText('storage.cancelConfirm')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'common.confirm' }))

    await waitFor(() => expect(cancelCloudOrder).toHaveBeenCalledWith('order-unpaid'))
    expect(toast.success).toHaveBeenCalledWith('storage.cancelSuccess')
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['cloud-store', 'orders'] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['cloud-store', 'credits'] })
  })
})
