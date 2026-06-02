import type { CloudGiftCard, CloudOrder, CloudProduct, CloudStoreSettings } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import {
  ApiError,
  createCloudGiftCards,
  createCloudProduct,
  deleteCloudGiftCard,
  deleteCloudProduct,
  disableCloudGiftCard,
  getCloudStoreSettings,
  listAdminCloudCreditProducts,
  listAdminCloudOrders,
  listAdminCloudProducts,
  listCloudGiftCards,
  updateCloudProduct,
  updateCloudStoreSettings,
} from '@/lib/api'
import { AdminCloudStorePage } from './cloud-store'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { size?: string }) => (values?.size ? `${key}:${values.size}` : key),
  }),
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@/components/ProBadge', () => ({
  ProBadge: () => <span>pro-badge</span>,
}))

vi.mock('@/components/UpgradeHint', () => ({
  UpgradeHint: ({ feature }: { feature: string }) => <div>upgrade:{feature}</div>,
}))

vi.mock('@/lib/api', () => {
  class MockApiError extends Error {
    readonly status: number
    readonly body: Record<string, unknown>

    constructor(status: number, body: Record<string, unknown>) {
      super(String(body.error ?? `HTTP ${status}`))
      this.name = 'ApiError'
      this.status = status
      this.body = body
    }
  }

  return {
    ApiError: MockApiError,
    createCloudProduct: vi.fn(),
    createCloudGiftCards: vi.fn(),
    deleteCloudProduct: vi.fn(),
    deleteCloudGiftCard: vi.fn(),
    disableCloudGiftCard: vi.fn(),
    getCloudStoreSettings: vi.fn(),
    listAdminCloudOrders: vi.fn(),
    listAdminCloudCreditProducts: vi.fn(),
    listAdminCloudProducts: vi.fn(),
    listCloudGiftCards: vi.fn(),
    updateCloudProduct: vi.fn(),
    updateCloudStoreSettings: vi.fn(),
  }
})

function settings(overrides: Partial<CloudStoreSettings> = {}): CloudStoreSettings {
  return {
    id: 'settings-1',
    enabled: true,
    status: 'ready',
    createdAt: '2026-05-05T00:00:00.000Z',
    updatedAt: '2026-05-05T00:00:00.000Z',
    ...overrides,
  }
}

function quotaPackage(overrides: Partial<CloudProduct> = {}): CloudProduct {
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
        id: 'price-monthly',
        currency: 'usd',
        amount: 999,
        recurring: { interval: 'month', intervalCount: 1 },
        metadata: { creditGrantType: 'subscription_grant', creditAmount: '1000' },
      },
      {
        id: 'price-yearly',
        currency: 'usd',
        amount: 9999,
        recurring: { interval: 'year', intervalCount: 1 },
        metadata: { creditGrantType: 'subscription_grant', creditAmount: '1000' },
      },
    ],
    active: true,
    sortOrder: 1,
    createdAt: '2026-05-05T00:00:00.000Z',
    updatedAt: '2026-05-05T00:00:00.000Z',
    ...overrides,
  }
}

function creditPackage(overrides: Partial<CloudProduct> = {}): CloudProduct {
  return {
    id: 'pkg-credits',
    storeId: 'store-1',
    type: 'store_item',
    name: '5,000 Credits',
    description: 'Credit top-up',
    metadata: { deliverable: { type: 'zpan.credits', includedCredits: 5000 } },
    prices: [
      {
        id: 'price-credits',
        currency: 'usd',
        amount: 2999,
        metadata: { creditGrantType: 'top_up', creditAmount: '5000' },
      },
    ],
    active: true,
    sortOrder: 1,
    createdAt: '2026-05-05T00:00:00.000Z',
    updatedAt: '2026-05-05T00:00:00.000Z',
    ...overrides,
  }
}

function giftCard(overrides: Partial<CloudGiftCard> = {}): CloudGiftCard {
  return {
    id: 'gift-card-1',
    storeId: 'store-1',
    campaignId: null,
    code: null,
    codeLast4: 'ODE1',
    credits: 10_000,
    status: 'active',
    expiresAt: null,
    disabledAt: null,
    revokedAt: null,
    createdAt: '2026-05-05T00:00:00.000Z',
    updatedAt: '2026-05-05T00:00:00.000Z',
    createdByAdmin: 'admin',
    ...overrides,
  }
}

function storeOrder(overrides: Partial<CloudOrder> = {}): CloudOrder {
  return {
    id: 'order-1',
    storeId: 'store-1',
    buyerAccountId: 'buyer-1',
    target: { orgId: 'org-1', customerId: 'user-1', customerLabel: 'user@example.com' },
    status: 'paid',
    subtotalAmount: 999,
    discountAmount: 999,
    totalAmount: 0,
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

function renderAdminPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  return render(
    <TooltipProvider>
      <QueryClientProvider client={queryClient}>
        <AdminCloudStorePage />
      </QueryClientProvider>
    </TooltipProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('AdminCloudStorePage', () => {
  beforeEach(() => {
    HTMLElement.prototype.scrollIntoView = vi.fn()
    vi.mocked(listAdminCloudOrders).mockResolvedValue({ items: [], total: 0 })
    vi.mocked(listAdminCloudCreditProducts).mockResolvedValue({ items: [], total: 0 })
  })

  it('shows the Pro gate when quota store settings are unavailable', async () => {
    vi.mocked(getCloudStoreSettings).mockRejectedValue(new ApiError(402, { error: 'feature_not_available' }))
    vi.mocked(listAdminCloudProducts).mockResolvedValue({ items: [], total: 0 })

    const view = renderAdminPage()

    await waitFor(() => expect(view.getByText('upgrade:quota_store')).toBeTruthy())
    expect(view.queryByRole('switch', { name: 'admin.cloudStore.enabled' })).toBeNull()
  })

  it('creates a package with the configured form values', async () => {
    vi.mocked(getCloudStoreSettings).mockResolvedValue(settings())
    vi.mocked(listAdminCloudProducts).mockResolvedValue({ items: [quotaPackage()], total: 1 })
    vi.mocked(createCloudProduct).mockResolvedValue(quotaPackage({ id: 'pkg-2' }))

    const view = renderAdminPage()

    await waitFor(() => expect(view.getByRole('button', { name: 'admin.cloudStore.newPackage' })).toBeTruthy())
    fireEvent.click(view.getByRole('button', { name: 'admin.cloudStore.newPackage' }))
    fireEvent.change(view.getByLabelText('admin.cloudStore.planName'), { target: { value: '250 GB' } })
    fireEvent.change(view.getByLabelText('admin.cloudStore.description'), { target: { value: 'Team storage' } })
    fireEvent.change(view.getByLabelText('admin.cloudStore.storageQuota'), { target: { value: '250' } })
    fireEvent.change(view.getByLabelText('admin.cloudStore.includedCredits'), { target: { value: '2500' } })
    fireEvent.change(view.getByLabelText('admin.cloudStore.usdMonthlyAmount'), { target: { value: '19.99' } })
    fireEvent.change(view.getByLabelText('admin.cloudStore.usdYearlyAmount'), { target: { value: '199.99' } })
    fireEvent.click(view.getByRole('button', { name: 'common.save' }))

    await waitFor(() =>
      expect(createCloudProduct).toHaveBeenCalledWith({
        type: 'store_item',
        name: '250 GB',
        description: 'Team storage',
        metadata: {
          deliverable: {
            type: 'zpan.plan',
            storageBytes: 268435456000,
            includedCredits: 2500,
          },
        },
        prices: [
          {
            currency: 'usd',
            amount: 1999,
            recurring: { interval: 'month', intervalCount: 1 },
            metadata: { creditGrantType: 'subscription_grant', creditAmount: '2500' },
          },
          {
            currency: 'usd',
            amount: 19999,
            recurring: { interval: 'year', intervalCount: 1 },
            metadata: { creditGrantType: 'subscription_grant', creditAmount: '2500' },
          },
        ],
        active: true,
        sortOrder: 0,
      }),
    )
    expect(toast.success).toHaveBeenCalledWith('admin.cloudStore.packageSaved')
  })

  it('creates a credits package with configured top-up values', async () => {
    vi.mocked(getCloudStoreSettings).mockResolvedValue(settings())
    vi.mocked(listAdminCloudProducts).mockResolvedValue({ items: [], total: 0 })
    vi.mocked(listAdminCloudCreditProducts).mockResolvedValue({ items: [creditPackage()], total: 1 })
    vi.mocked(createCloudProduct).mockResolvedValue(creditPackage({ id: 'pkg-credits-2' }))

    const view = renderAdminPage()

    await waitFor(() => expect(view.getByRole('button', { name: 'admin.cloudStore.newCreditPackage' })).toBeTruthy())
    fireEvent.click(view.getByRole('button', { name: 'admin.cloudStore.newCreditPackage' }))
    const dialog = await view.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('admin.cloudStore.planName'), {
      target: { value: '10,000 Credits' },
    })
    fireEvent.change(within(dialog).getByLabelText('admin.cloudStore.description'), {
      target: { value: 'Top-up bundle' },
    })
    fireEvent.change(within(dialog).getByLabelText('admin.cloudStore.creditAmount'), { target: { value: '10000' } })
    fireEvent.change(within(dialog).getByLabelText('admin.cloudStore.usdAmount'), { target: { value: '49.99' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'common.save' }))

    await waitFor(() =>
      expect(createCloudProduct).toHaveBeenCalledWith({
        type: 'store_item',
        name: '10,000 Credits',
        description: 'Top-up bundle',
        metadata: {
          deliverable: {
            type: 'zpan.credits',
            includedCredits: 10000,
          },
        },
        prices: [
          {
            currency: 'usd',
            amount: 4999,
            metadata: { creditGrantType: 'top_up', creditAmount: '10000' },
          },
        ],
        active: true,
        sortOrder: 0,
      }),
    )
  })

  it('creates a yearly-only plan with included credits', async () => {
    vi.mocked(getCloudStoreSettings).mockResolvedValue(settings())
    vi.mocked(listAdminCloudProducts).mockResolvedValue({ items: [], total: 0 })
    vi.mocked(createCloudProduct).mockResolvedValue(quotaPackage({ id: 'pkg-yearly' }))

    const view = renderAdminPage()

    await waitFor(() => expect(view.getByRole('button', { name: 'admin.cloudStore.newPackage' })).toBeTruthy())
    fireEvent.click(view.getByRole('button', { name: 'admin.cloudStore.newPackage' }))
    const dialog = await view.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('admin.cloudStore.planName'), {
      target: { value: 'Annual Plan' },
    })
    fireEvent.change(within(dialog).getByLabelText('admin.cloudStore.description'), {
      target: { value: 'Annual storage' },
    })
    fireEvent.change(within(dialog).getByLabelText('admin.cloudStore.storageQuota'), { target: { value: '1' } })
    fireEvent.click(within(dialog).getByLabelText('admin.cloudStore.storageQuota unit'))
    fireEvent.click(await view.findByRole('option', { name: 'TB' }))
    fireEvent.change(within(dialog).getByLabelText('admin.cloudStore.includedCredits'), { target: { value: '12000' } })
    fireEvent.change(within(dialog).getByLabelText('admin.cloudStore.usdMonthlyAmount'), { target: { value: '' } })
    fireEvent.change(within(dialog).getByLabelText('admin.cloudStore.usdYearlyAmount'), { target: { value: '499.99' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'common.save' }))

    await waitFor(() =>
      expect(createCloudProduct).toHaveBeenCalledWith({
        type: 'store_item',
        name: 'Annual Plan',
        description: 'Annual storage',
        metadata: {
          deliverable: {
            type: 'zpan.plan',
            storageBytes: 1099511627776,
            includedCredits: 12000,
          },
        },
        prices: [
          {
            currency: 'usd',
            amount: 49999,
            recurring: { interval: 'year', intervalCount: 1 },
            metadata: { creditGrantType: 'subscription_grant', creditAmount: '12000' },
          },
        ],
        active: true,
        sortOrder: 0,
      }),
    )
  })

  it('shows packages in a table and opens the package form in a dialog', async () => {
    vi.mocked(getCloudStoreSettings).mockResolvedValue(settings())
    vi.mocked(listAdminCloudProducts).mockResolvedValue({
      items: [
        quotaPackage({
          prices: [
            { currency: 'usd', amount: 999, recurring: { interval: 'month', intervalCount: 1 } },
            { currency: 'usd', amount: 9999, recurring: { interval: 'year', intervalCount: 1 } },
          ],
        }),
      ],
      total: 1,
    })

    const view = renderAdminPage()

    await waitFor(() => expect(view.getByText('admin.cloudStore.planProductsTitle')).toBeTruthy())
    expect(view.getAllByRole('table')).toHaveLength(2)
    expect(view.getByRole('columnheader', { name: 'admin.cloudStore.planName' })).toBeTruthy()
    expect(view.getAllByRole('columnheader', { name: 'admin.cloudStore.prices' })).toHaveLength(2)
    expect(view.getByText('$9.99/mo · $99.99/yr')).toBeTruthy()
    expect(view.queryByRole('button', { name: 'admin.cloudStore.sync' })).toBeNull()
    expect(view.queryByText('admin.cloudStore.lastSync')).toBeNull()
    expect(view.queryByText('admin.cloudStore.lastOrder')).toBeNull()
    expect(view.queryByLabelText('admin.cloudStore.planName')).toBeNull()

    fireEvent.click(view.getByRole('button', { name: 'admin.cloudStore.newPackage' }))

    const dialog = await view.findByRole('dialog')
    expect(within(dialog).getByText('admin.cloudStore.newPackage')).toBeTruthy()
    expect(within(dialog).getByLabelText('admin.cloudStore.planName')).toBeTruthy()
    expect(within(dialog).queryByLabelText('admin.cloudStore.cnyAmount')).toBeNull()
    expect(within(dialog).queryByLabelText('admin.cloudStore.sortOrder')).toBeNull()
    expect(within(dialog).queryByLabelText('admin.cloudStore.active')).toBeNull()
  })

  it('opens existing packages for editing in the package dialog', async () => {
    vi.mocked(getCloudStoreSettings).mockResolvedValue(settings())
    vi.mocked(listAdminCloudProducts).mockResolvedValue({ items: [quotaPackage({ name: '500 GB' })], total: 1 })

    const view = renderAdminPage()

    await waitFor(() => expect(view.getByRole('button', { name: 'common.edit' })).toBeTruthy())
    fireEvent.click(view.getByRole('button', { name: 'common.edit' }))

    const dialog = await view.findByRole('dialog')
    expect(within(dialog).getByText('admin.cloudStore.editPackage')).toBeTruthy()
    expect(within(dialog).getByLabelText('admin.cloudStore.planName')).toHaveProperty('value', '500 GB')
    expect(within(dialog).queryByLabelText('admin.cloudStore.active')).toBeNull()
  })

  it('edits package content without sending active from the form', async () => {
    vi.mocked(getCloudStoreSettings).mockResolvedValue(settings())
    vi.mocked(listAdminCloudProducts).mockResolvedValue({ items: [quotaPackage({ active: false })], total: 1 })
    vi.mocked(updateCloudProduct).mockResolvedValue(quotaPackage({ active: false, name: '200 GB' }))

    const view = renderAdminPage()

    await waitFor(() => expect(view.getByRole('button', { name: 'common.edit' })).toBeTruthy())
    fireEvent.click(view.getByRole('button', { name: 'common.edit' }))
    const dialog = await view.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('admin.cloudStore.planName'), { target: { value: '200 GB' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'common.save' }))

    await waitFor(() =>
      expect(updateCloudProduct).toHaveBeenCalledWith('pkg-1', {
        type: 'store_item',
        name: '200 GB',
        description: 'Extra storage',
        metadata: {
          deliverable: {
            type: 'zpan.plan',
            storageBytes: 107374182400,
            includedCredits: 1000,
          },
        },
        prices: [
          {
            currency: 'usd',
            amount: 999,
            recurring: { interval: 'month', intervalCount: 1 },
            metadata: { creditGrantType: 'subscription_grant', creditAmount: '1000' },
          },
          {
            currency: 'usd',
            amount: 9999,
            recurring: { interval: 'year', intervalCount: 1 },
            metadata: { creditGrantType: 'subscription_grant', creditAmount: '1000' },
          },
        ],
        sortOrder: 1,
      }),
    )
  })

  it('edits plan packages with USD-only form controls and payloads', async () => {
    vi.mocked(getCloudStoreSettings).mockResolvedValue(settings())
    vi.mocked(listAdminCloudProducts).mockResolvedValue({
      items: [
        quotaPackage({
          prices: [
            {
              currency: 'usd',
              amount: 1299,
              recurring: { interval: 'month', intervalCount: 1 },
              metadata: { creditGrantType: 'subscription_grant', creditAmount: '1500' },
            },
            {
              currency: 'usd',
              amount: 12999,
              recurring: { interval: 'year', intervalCount: 1 },
              metadata: { creditGrantType: 'subscription_grant', creditAmount: '1500' },
            },
          ],
          metadata: {
            deliverable: { type: 'zpan.plan', storageBytes: 107374182400, includedCredits: 1500 },
          },
        }),
      ],
      total: 1,
    })
    vi.mocked(updateCloudProduct).mockResolvedValue(quotaPackage({ name: 'USD only plan' }))

    const view = renderAdminPage()

    await waitFor(() => expect(view.getByRole('button', { name: 'common.edit' })).toBeTruthy())
    fireEvent.click(view.getByRole('button', { name: 'common.edit' }))

    const dialog = await view.findByRole('dialog')
    expect(within(dialog).getByLabelText('admin.cloudStore.usdMonthlyAmount')).toHaveProperty('value', '12.99')
    expect(within(dialog).getByLabelText('admin.cloudStore.usdYearlyAmount')).toHaveProperty('value', '129.99')
    expect(within(dialog).getByLabelText('admin.cloudStore.includedCredits')).toHaveProperty('value', '1500')
    expect(within(dialog).queryByLabelText('admin.cloudStore.cnyAmount')).toBeNull()

    fireEvent.change(within(dialog).getByLabelText('admin.cloudStore.planName'), { target: { value: 'USD only plan' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'common.save' }))

    await waitFor(() =>
      expect(updateCloudProduct).toHaveBeenCalledWith('pkg-1', {
        type: 'store_item',
        name: 'USD only plan',
        description: 'Extra storage',
        metadata: {
          deliverable: {
            type: 'zpan.plan',
            storageBytes: 107374182400,
            includedCredits: 1500,
          },
        },
        prices: [
          {
            currency: 'usd',
            amount: 1299,
            recurring: { interval: 'month', intervalCount: 1 },
            metadata: { creditGrantType: 'subscription_grant', creditAmount: '1500' },
          },
          {
            currency: 'usd',
            amount: 12999,
            recurring: { interval: 'year', intervalCount: 1 },
            metadata: { creditGrantType: 'subscription_grant', creditAmount: '1500' },
          },
        ],
        sortOrder: 1,
      }),
    )
  })

  it('publishes and unpublishes packages from table actions', async () => {
    vi.mocked(getCloudStoreSettings).mockResolvedValue(settings())
    vi.mocked(listAdminCloudProducts).mockResolvedValue({
      items: [
        quotaPackage({ id: 'pkg-active', name: 'Active plan', active: true }),
        quotaPackage({ id: 'pkg-disabled', name: 'Disabled plan', active: false }),
      ],
      total: 2,
    })
    vi.mocked(updateCloudProduct)
      .mockResolvedValueOnce(quotaPackage({ id: 'pkg-active', active: false }))
      .mockResolvedValueOnce(quotaPackage({ id: 'pkg-disabled', active: true }))

    const view = renderAdminPage()

    await waitFor(() => expect(view.getByRole('button', { name: 'admin.cloudStore.unpublish' })).toBeTruthy())
    fireEvent.click(view.getByRole('button', { name: 'admin.cloudStore.unpublish' }))
    await waitFor(() => expect(updateCloudProduct).toHaveBeenCalledWith('pkg-active', { active: false }))

    fireEvent.click(view.getByRole('button', { name: 'admin.cloudStore.publish' }))
    await waitFor(() => expect(updateCloudProduct).toHaveBeenCalledWith('pkg-disabled', { active: true }))
  })

  it('deletes packages only after confirmation', async () => {
    vi.mocked(getCloudStoreSettings).mockResolvedValue(settings())
    vi.mocked(listAdminCloudProducts).mockResolvedValue({ items: [quotaPackage({ name: 'Delete me' })], total: 1 })
    vi.mocked(deleteCloudProduct).mockResolvedValue({ id: 'pkg-1', deleted: true })

    const view = renderAdminPage()

    await waitFor(() => expect(view.getByRole('button', { name: 'common.delete' })).toBeTruthy())
    fireEvent.click(view.getByRole('button', { name: 'common.delete' }))
    expect(deleteCloudProduct).not.toHaveBeenCalled()

    const dialog = await view.findByRole('dialog')
    expect(within(dialog).getByText('admin.cloudStore.deleteTitle')).toBeTruthy()
    expect(within(dialog).getByText('admin.cloudStore.deleteConfirm')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'common.delete' }))

    await waitFor(() => expect(deleteCloudProduct).toHaveBeenCalledWith('pkg-1', expect.anything()))
  })

  it('filters packages from the packages toolbar', async () => {
    vi.mocked(getCloudStoreSettings).mockResolvedValue(settings())
    vi.mocked(listAdminCloudProducts).mockResolvedValue({
      items: [
        quotaPackage({ id: 'pkg-active', name: 'Active plan', active: true }),
        quotaPackage({ id: 'pkg-disabled', name: 'Disabled plan', active: false }),
      ],
      total: 2,
    })

    const view = renderAdminPage()

    await waitFor(() => expect(view.getByText('Active plan')).toBeTruthy())
    expect(view.getByText('Disabled plan')).toBeTruthy()

    fireEvent.click(view.getByRole('combobox'))
    fireEvent.click(await view.findByRole('option', { name: 'admin.cloudStore.packages.filterDisabled' }))

    expect(view.queryByText('Active plan')).toBeNull()
    expect(view.getByText('Disabled plan')).toBeTruthy()
  })

  it('shows operator-facing store status without technical Cloud fields', async () => {
    vi.mocked(getCloudStoreSettings).mockResolvedValue(settings())
    vi.mocked(listAdminCloudProducts).mockResolvedValue({ items: [], total: 0 })

    const view = renderAdminPage()

    await waitFor(() => expect(view.getByText('admin.cloudStore.storeStatus')).toBeTruthy())
    expect(view.getByText('admin.cloudStore.cloudConnection')).toBeTruthy()
    expect(view.queryByText('admin.cloudStore.storage.open')).toBeNull()
    expect(view.queryByText('admin.cloudStore.cloud.connected')).toBeNull()
    expect(view.queryByText('admin.cloudStore.cloudBaseUrl')).toBeNull()
    expect(view.queryByText('admin.cloudStore.callbackUrl')).toBeNull()
    expect(view.queryByText('admin.cloudStore.webhookSecret')).toBeNull()
  })

  it('keeps plan management available when front-end storage plans are disabled', async () => {
    vi.mocked(getCloudStoreSettings).mockResolvedValue(settings({ enabled: false, status: 'ready' }))
    vi.mocked(listAdminCloudProducts).mockResolvedValue({ items: [quotaPackage()], total: 1 })

    const view = renderAdminPage()

    await waitFor(() => expect(view.getByText('admin.cloudStore.storeStatus')).toBeTruthy())
    expect(view.queryByText('admin.cloudStore.storage.closed')).toBeNull()
    expect(view.queryByText('admin.cloudStore.cloud.notConnected')).toBeNull()
    expect(view.getByRole('tablist')).toBeTruthy()
    expect(view.getByText('100 GB')).toBeTruthy()
    expect(view.queryByRole('switch', { name: 'admin.cloudStore.enabled' })).toBeNull()
    expect(view.queryByRole('button', { name: 'common.save' })).toBeNull()
    expect(view.queryByRole('button', { name: 'admin.cloudStore.sync' })).toBeNull()
    expect(listAdminCloudProducts).toHaveBeenCalled()
    expect(listAdminCloudOrders).toHaveBeenCalled()
    expect(updateCloudStoreSettings).not.toHaveBeenCalled()
  })

  it('generates and disables gift cards from the gift cards tab', async () => {
    vi.mocked(getCloudStoreSettings).mockResolvedValue(settings())
    vi.mocked(listAdminCloudProducts).mockResolvedValue({ items: [], total: 0 })
    vi.mocked(listCloudGiftCards).mockResolvedValue({
      items: [giftCard()],
      total: 1,
    })
    vi.mocked(createCloudGiftCards).mockResolvedValue([])
    vi.mocked(disableCloudGiftCard).mockResolvedValue({ code: 'gift-card-1', disabled: true })

    const view = renderAdminPage()

    await waitFor(() => expect(view.getByRole('tab', { name: 'admin.cloudStore.tabs.codes' })).toBeTruthy())
    fireEvent.click(view.getByRole('tab', { name: 'admin.cloudStore.tabs.codes' }))
    await waitFor(() => expect(view.getByText('****-****-****-ODE1')).toBeTruthy())
    fireEvent.click(view.getByRole('button', { name: 'admin.cloudStore.codes.generateTitle' }))
    await view.findByRole('dialog')
    fireEvent.change(view.getByLabelText('admin.cloudStore.codes.credits'), { target: { value: '5000' } })
    fireEvent.change(view.getByLabelText('admin.cloudStore.codes.count'), { target: { value: '3' } })
    fireEvent.click(view.getByRole('button', { name: 'admin.cloudStore.codes.generate' }))

    await waitFor(() =>
      expect(createCloudGiftCards).toHaveBeenCalledWith({
        credits: 5000,
        count: 3,
      }),
    )
    fireEvent.click(view.getByRole('button', { name: 'admin.cloudStore.codes.disable' }))
    expect(disableCloudGiftCard).not.toHaveBeenCalled()

    const disableDialog = await view.findByRole('dialog')
    expect(within(disableDialog).getByText('admin.cloudStore.codes.disableTitle')).toBeTruthy()
    fireEvent.click(within(disableDialog).getByRole('button', { name: 'admin.cloudStore.codes.disable' }))

    await waitFor(() => expect(vi.mocked(disableCloudGiftCard).mock.calls[0][0]).toBe('gift-card-1'))
  })

  it('deletes an eligible gift card from the codes tab', async () => {
    vi.mocked(getCloudStoreSettings).mockResolvedValue(settings())
    vi.mocked(listAdminCloudProducts).mockResolvedValue({ items: [], total: 0 })
    vi.mocked(listCloudGiftCards).mockResolvedValue({
      items: [giftCard()],
      total: 1,
    })
    vi.mocked(deleteCloudGiftCard).mockResolvedValue({ code: 'gift-card-1', deleted: true })

    const view = renderAdminPage()

    await waitFor(() => expect(view.getByRole('tab', { name: 'admin.cloudStore.tabs.codes' })).toBeTruthy())
    fireEvent.click(view.getByRole('tab', { name: 'admin.cloudStore.tabs.codes' }))
    await waitFor(() => expect(view.getByText('****-****-****-ODE1')).toBeTruthy())

    fireEvent.click(view.getByRole('button', { name: 'admin.cloudStore.codes.delete' }))
    expect(deleteCloudGiftCard).not.toHaveBeenCalled()

    const deleteDialog = await view.findByRole('dialog')
    expect(within(deleteDialog).getByText('admin.cloudStore.codes.deleteTitle')).toBeTruthy()
    fireEvent.click(within(deleteDialog).getByRole('button', { name: 'admin.cloudStore.codes.delete' }))

    await waitFor(() => expect(vi.mocked(deleteCloudGiftCard).mock.calls[0][0]).toBe('gift-card-1'))
  })

  it('shows gift cards in a table and opens generation fields in a dialog', async () => {
    vi.mocked(getCloudStoreSettings).mockResolvedValue(settings())
    vi.mocked(listAdminCloudProducts).mockResolvedValue({ items: [], total: 0 })
    vi.mocked(listCloudGiftCards).mockResolvedValue({
      items: [giftCard({ id: 'gift-card-2', code: null, codeLast4: 'ODE2', credits: 5000, status: 'active' })],
      total: 1,
    })

    const view = renderAdminPage()

    await waitFor(() => expect(view.getByRole('tab', { name: 'admin.cloudStore.tabs.codes' })).toBeTruthy())
    fireEvent.click(view.getByRole('tab', { name: 'admin.cloudStore.tabs.codes' }))

    await waitFor(() => expect(view.getByText('****-****-****-ODE2')).toBeTruthy())
    expect(view.getByRole('table')).toBeTruthy()
    expect(view.getByRole('columnheader', { name: 'admin.cloudStore.codes.code' })).toBeTruthy()
    expect(view.queryByLabelText('admin.cloudStore.codes.count')).toBeNull()

    fireEvent.click(view.getByRole('button', { name: 'admin.cloudStore.codes.generateTitle' }))

    const dialog = await view.findByRole('dialog')
    expect(within(dialog).getByText('admin.cloudStore.codes.generateTitle')).toBeTruthy()
    expect(within(dialog).getByLabelText('admin.cloudStore.codes.count')).toBeTruthy()
  })

  it('loads orders from the orders tab', async () => {
    vi.mocked(getCloudStoreSettings).mockResolvedValue(settings())
    vi.mocked(listAdminCloudProducts).mockResolvedValue({ items: [], total: 0 })
    vi.mocked(listAdminCloudOrders).mockResolvedValue({
      items: [
        storeOrder({
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
                deliverable: { type: 'zpan.plan', storageBytes: 1024, trafficBytes: 2048, includedCredits: 0 },
              },
            },
          ],
        }),
      ],
      total: 1,
    })

    const view = renderAdminPage()

    await waitFor(() => expect(view.getByRole('tab', { name: 'admin.cloudStore.tabs.orders' })).toBeTruthy())
    fireEvent.click(view.getByRole('tab', { name: 'admin.cloudStore.tabs.orders' }))
    await waitFor(() => expect(view.getByRole('columnheader', { name: 'admin.cloudStore.orders.order' })).toBeTruthy())
    expect(view.getByRole('columnheader', { name: 'admin.cloudStore.orders.status' })).toBeTruthy()
    expect(view.getByRole('columnheader', { name: 'admin.cloudStore.orders.planQuota' })).toBeTruthy()
    expect(
      view.getByText('admin.cloudStore.orders.storageQuota:1.0 KB / admin.cloudStore.orders.trafficQuota:2.0 KB'),
    ).toBeTruthy()
    await waitFor(() => expect(view.getByText('user@example.com')).toBeTruthy())

    fireEvent.click(view.getByRole('button', { name: 'admin.cloudStore.orders.viewDetails' }))

    const drawer = await view.findByRole('dialog')
    expect(within(drawer).getByText('admin.cloudStore.orders.detailTitle')).toBeTruthy()
    expect(within(drawer).getByText('order-1')).toBeTruthy()
    expect(within(drawer).getByText('admin.cloudStore.orders.summary')).toBeTruthy()
    expect(within(drawer).getByText('admin.cloudStore.orders.noPayments')).toBeTruthy()
  })

  it('shows a disabled store status before settings are created', async () => {
    vi.mocked(getCloudStoreSettings).mockResolvedValue(null)
    vi.mocked(listAdminCloudProducts).mockResolvedValue({ items: [], total: 0 })

    const view = renderAdminPage()

    await waitFor(() => expect(view.getByText('admin.cloudStore.storeStatus')).toBeTruthy())
  })
})
