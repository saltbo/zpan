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
  listCloudStoreTargets,
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
    readonly body: {
      error: {
        code: number
        message: string
        status: string
        details?: Array<{ reason: string; domain: string; metadata?: Record<string, string> }>
      }
    }
    readonly reason: string | undefined
    readonly metadata: Record<string, string> | undefined
    readonly canonicalStatus: string | undefined

    constructor(status: number, body: MockApiError['body']) {
      super(body.error.message)
      this.name = 'ApiError'
      this.status = status
      this.body = body
      this.reason = body.error.details?.[0]?.reason
      this.metadata = body.error.details?.[0]?.metadata
      this.canonicalStatus = body.error.status
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
    listCloudStoreTargets: vi.fn(),
    createDiscountQuote: vi.fn(),
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

function higherSubscriptionPackage(): CloudProduct {
  return {
    ...subscriptionPackage(),
    id: 'pkg-business',
    name: 'Business Plan',
    metadata: {
      deliverable: { type: 'zpan.plan', storageBytes: 214748364800, includedCredits: 5000 },
    },
    prices: [
      {
        id: 'price-business-usd',
        currency: 'usd',
        amount: 2999,
        recurring: { interval: 'month', intervalCount: 1 },
        metadata: { creditGrantType: 'subscription_grant', creditAmount: '5000' },
      },
      {
        id: 'price-business-yearly-usd',
        currency: 'usd',
        amount: 29999,
        recurring: { interval: 'year', intervalCount: 1 },
        metadata: { creditGrantType: 'subscription_grant', creditAmount: '5000' },
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

beforeEach(() => {
  vi.mocked(listCloudStoreTargets).mockResolvedValue({
    items: [{ orgId: 'org-1', name: 'Personal Space', type: 'personal', role: 'owner' }],
    total: 1,
  })
})

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

  it('shows effective quota and plan credits status', async () => {
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
    expect(view.getByText('storage.storageUsage')).toBeTruthy()
    expect(view.getByText('storage.trafficUsage')).toBeTruthy()
    expect(view.queryByText('storage.storageQuotaEntitlement')).toBeNull()
    expect(view.getAllByRole('progressbar')).toHaveLength(2)
    expect(view.getByLabelText('storage.viewCreditActivity')).toBeTruthy()
    await waitFor(() => expect(view.getAllByText('1.5 KB').length).toBeGreaterThan(0))
    expect(view.getByText('storage.trafficPeriodDetail:2026-05')).toBeTruthy()
  })

  it('renders invalid storage quota separately from unlimited traffic', async () => {
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

    await waitFor(() => expect(view.getAllByText('1.5 KB').length).toBeGreaterThan(0))
    expect(view.queryByText('storage.overCap')).toBeNull()
    expect(view.getByText('storage.usageInvalid')).toBeTruthy()
    expect(view.getByText('storage.usageNoLimit')).toBeTruthy()
  })

  it('hides self-service forms when storage purchases are disabled', async () => {
    vi.mocked(listCloudProducts).mockRejectedValue(
      new ApiError(402, {
        error: {
          code: 402,
          message: 'Feature not available',
          status: 'PERMISSION_DENIED',
          details: [{ reason: 'FEATURE_NOT_AVAILABLE', domain: 'zpan.dev', metadata: { feature: 'quota_store' } }],
        },
      }),
    )
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
    fireEvent.click(await view.findByRole('button', { name: 'storage.proceedToCheckout' }))

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
    expect(view.getByText('storage.includedCredits')).toBeTruthy()
    expect(view.queryByText('storage.trafficPolicy')).toBeNull()
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
    fireEvent.click(await view.findByRole('button', { name: 'storage.proceedToCheckout' }))

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
    fireEvent.click(await view.findByRole('button', { name: 'storage.proceedToCheckout' }))

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
    fireEvent.click(await view.findByRole('button', { name: 'storage.proceedToCheckout' }))

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
      currentPlan: {
        sourceId: 'stripe_subscription:sub_1:org-1',
        packageId: 'pkg-subscription',
        name: 'Team Plan',
        storageBytes: 107374182400,
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

    await waitFor(() => expect(view.getAllByRole('button', { name: 'storage.managePlan' }).length).toBeGreaterThan(0))
    fireEvent.click(view.getAllByRole('button', { name: 'storage.managePlan' })[0])

    expect(openNewTab).toHaveBeenCalledWith('/store/checkout?action=portal')
  })

  it('does not show manage plan for the free plan entitlement', async () => {
    vi.mocked(getUserQuota).mockResolvedValue({
      orgId: 'org-1',
      baseQuota: 10485760,
      entitlementQuota: 0,
      quota: 10485760,
      used: 0,
      baseTrafficQuota: 0,
      entitlementTrafficQuota: 0,
      trafficQuota: 0,
      trafficUsed: 0,
      trafficPeriod: '2026-05',
      storagePlanName: 'Free',
      storageExtraNames: [],
      trafficPlanName: null,
      trafficExtraNames: [],
      currentPlan: {
        sourceId: 'free_plan:org-1',
        packageId: null,
        name: 'Free',
        storageBytes: 10485760,
        trafficBytes: 0,
        trafficOveragePriceCents: null,
        expiresAt: null,
        subscription: false,
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

    await waitFor(() => expect(view.getByText('storage.freePlanName')).toBeTruthy())
    expect(view.queryByRole('button', { name: 'storage.managePlan' })).toBeNull()
  })

  it('keeps available plans visible and marks the active plan card', async () => {
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
    vi.mocked(listCloudProducts).mockResolvedValue({
      items: [subscriptionPackage(), higherSubscriptionPackage()],
      total: 2,
    })
    vi.mocked(listCloudOrders).mockResolvedValue({ items: [], total: 0 })

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const view = renderStoragePage(queryClient)

    await waitFor(() => expect(view.getByText('storage.availablePlansTitle')).toBeTruthy())
    expect(view.getAllByText('Team Plan').length).toBeGreaterThan(0)
    expect(view.getByText('Business Plan')).toBeTruthy()
    await waitFor(() => expect(view.getByText('storage.currentPlanBadge')).toBeTruthy())
    await waitFor(() => expect(view.getAllByRole('button', { name: 'storage.managePlan' }).length).toBeGreaterThan(0))
    await waitFor(() => expect(view.getByRole('button', { name: 'storage.upgradeToPlan' })).toBeTruthy())
    expect(view.queryByRole('button', { name: /storage.checkoutMonthly|storage.checkoutYearly/ })).toBeNull()
    expect(openNewTab).not.toHaveBeenCalled()
  })

  it('opens the Stripe portal for higher plan changes while a plan is active', async () => {
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
        storageBytes: 107374182400,
        trafficBytes: 0,
        trafficOveragePriceCents: null,
        expiresAt: null,
        subscription: true,
      },
    })
    vi.mocked(listCloudProducts).mockResolvedValue({
      items: [subscriptionPackage(), higherSubscriptionPackage()],
      total: 2,
    })
    vi.mocked(listCloudOrders).mockResolvedValue({ items: [], total: 0 })

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const view = renderStoragePage(queryClient)

    await waitFor(() => expect(view.getByRole('button', { name: 'storage.upgradeToPlan' })).toBeTruthy())
    fireEvent.click(view.getByRole('button', { name: 'storage.upgradeToPlan' }))

    expect(openNewTab).toHaveBeenCalledWith('/store/checkout?action=portal')
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
    fireEvent.click(await view.findByRole('button', { name: 'storage.proceedToCheckout' }))

    expect(openNewTab).toHaveBeenCalledWith('/store/checkout?action=checkout&packageId=pkg-1&priceId=price-usd')
  })

  it('hides purchase surfaces for team members who are not the owner', async () => {
    activeOrganization.value = { id: 'team-1' }
    vi.mocked(listCloudStoreTargets).mockResolvedValue({
      items: [
        { orgId: 'org-1', name: 'Personal Space', type: 'personal', role: 'owner' },
        { orgId: 'team-1', name: 'Design Team', type: 'team', role: 'editor' },
      ],
      total: 2,
    })
    vi.mocked(listCloudProducts).mockResolvedValue({ items: [quotaPackage()], total: 1 })

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const view = renderStoragePage(queryClient)

    await waitFor(() => expect(view.getByText('storage.teamMemberNotice')).toBeTruthy())
    expect(view.queryByRole('button', { name: /storage.checkoutMonthly/ })).toBeNull()
    expect(view.queryByRole('button', { name: 'storage.historyTitle' })).toBeNull()
    expect(listCloudOrders).not.toHaveBeenCalled()
    expect(getCloudCredits).not.toHaveBeenCalled()
  })

  it('keeps purchase surfaces for the team owner', async () => {
    activeOrganization.value = { id: 'team-1' }
    vi.mocked(listCloudStoreTargets).mockResolvedValue({
      items: [{ orgId: 'team-1', name: 'Design Team', type: 'team', role: 'owner' }],
      total: 1,
    })
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
    expect(view.queryByText('storage.teamMemberNotice')).toBeNull()
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
    expect(view.getByText('storage.availablePlansTitle')).toBeTruthy()
    expect(view.getAllByText('storage.storageQuota').length).toBeGreaterThan(0)
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
    expect(view.getByText('storage.trafficUsage')).toBeTruthy()
    expect(view.queryByText('storage.storageQuotaEntitlement')).toBeNull()
    expect(view.queryByText('storage.creditBalance')).toBeNull()
    expect(view.queryByText('1,250')).toBeNull()
    fireEvent.click(creditsButton)
    await waitFor(() => expect(view.getAllByText('storage.creditBalance').length).toBeGreaterThan(0))
    expect(view.getByRole('button', { name: 'storage.redeemTitle' })).toBeTruthy()
    await waitFor(() => expect(view.getAllByText('1,250').length).toBeGreaterThan(0))
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
    fireEvent.click(await view.findByRole('button', { name: 'storage.proceedToCheckout' }))

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
    expect(view.getAllByText('1,250').length).toBeGreaterThan(0)
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
