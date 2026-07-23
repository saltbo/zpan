import type { CloudOrder, CloudProduct } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { toast } from 'sonner'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cancelCloudOrder,
  getCloudCredits,
  listCloudCreditLedgerEntries,
  listCloudCreditProducts,
  listCloudOrders,
  listCloudProducts,
  listCloudStoreTargets,
  redeemCloudGiftCard,
} from '@/lib/api'
import { openNewTab } from '@/lib/browser-navigation'
import { WorkspaceBillingPage } from './billing'

const activeOrganization = vi.hoisted(() => ({
  value: { id: 'org-1' },
}))

beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})

afterAll(() => {
  vi.unstubAllGlobals()
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { amount?: string | number }) =>
      values?.amount === undefined ? key : `${key}:${values.amount}`,
    i18n: { resolvedLanguage: 'en' },
  }),
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
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

vi.mock('@/lib/api', () => ({
  ApiError: class MockApiError extends Error {},
  cancelCloudOrder: vi.fn(),
  getCloudCredits: vi.fn(),
  listCloudCreditLedgerEntries: vi.fn(),
  listCloudCreditProducts: vi.fn(),
  listCloudOrders: vi.fn(),
  listCloudProducts: vi.fn(),
  listCloudStoreTargets: vi.fn(),
  redeemCloudGiftCard: vi.fn(),
  createDiscountQuote: vi.fn(),
}))

function creditProduct(): CloudProduct {
  return {
    id: 'credits-1',
    storeId: 'store-1',
    type: 'store_item',
    name: '5,000 Credits',
    description: null,
    metadata: { deliverable: { type: 'zpan.credits', credits: 5000 } },
    prices: [{ id: 'price-1', currency: 'usd', amount: 500, recurring: null }],
    active: true,
    sortOrder: 1,
    createdAt: '2026-05-05T00:00:00.000Z',
    updatedAt: '2026-05-05T00:00:00.000Z',
  }
}

function unpaidOrder(): CloudOrder {
  return {
    id: 'order-unpaid',
    storeId: 'store-1',
    buyerAccountId: 'buyer-1',
    target: { orgId: 'org-1' },
    status: 'pending',
    subtotalAmount: 500,
    discountAmount: 0,
    totalAmount: 500,
    currency: 'usd',
    items: [
      {
        id: 'item-1',
        orderId: 'order-unpaid',
        productId: 'credits-1',
        productType: 'store_item',
        name: '5,000 Credits',
        description: null,
        quantity: 1,
        unitAmount: 500,
        totalAmount: 500,
        fulfillmentPayload: { deliverable: { type: 'zpan.credits', includedCredits: 5000 } },
      },
    ],
    payments: [],
    paymentStatus: 'unpaid',
    fulfillmentStatus: 'pending',
    createdAt: '2026-05-05T00:00:00.000Z',
    paidAt: null,
    fulfilledAt: null,
    canceledAt: null,
  }
}

function renderPage(queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceBillingPage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  activeOrganization.value = { id: 'org-1' }
  vi.mocked(listCloudProducts).mockResolvedValue({ items: [], total: 0 })
  vi.mocked(listCloudStoreTargets).mockResolvedValue({
    items: [{ orgId: 'org-1', name: 'Personal Space', type: 'personal', role: 'owner' }],
    total: 1,
  })
  vi.mocked(getCloudCredits).mockResolvedValue({ balance: 1250 })
  vi.mocked(listCloudCreditProducts).mockResolvedValue({ items: [creditProduct()], total: 1 })
  vi.mocked(listCloudCreditLedgerEntries).mockResolvedValue({
    items: [
      {
        id: 'ledger-1',
        creditAccountId: 'account-1',
        creditBucketId: 'bucket-1',
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
  vi.mocked(listCloudOrders).mockResolvedValue({ items: [unpaidOrder()], total: 1 })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('WorkspaceBillingPage', () => {
  it('shows the Credits account and activity inline while keeping orders in a dialog', async () => {
    const view = renderPage()

    expect(await view.findByText('1,250')).toBeTruthy()
    expect(view.queryByText('storage.billingTitle')).toBeNull()
    expect(view.getByText('storage.creditSourceGiftCard')).toBeTruthy()
    expect(view.getByRole('button', { name: 'storage.historyTitle' })).toBeTruthy()
    expect(view.queryByText('5,000 Credits')).toBeNull()
    expect(view.queryByRole('dialog')).toBeNull()
    expect(view.queryByText('org-1')).toBeNull()

    fireEvent.click(view.getByRole('button', { name: 'storage.historyTitle' }))
    expect(await view.findByRole('dialog')).toBeTruthy()
    expect(view.getByText('5,000 Credits')).toBeTruthy()
  })

  it('starts a Credits checkout and keeps gift-card redemption in a dialog', async () => {
    vi.mocked(redeemCloudGiftCard).mockResolvedValue({ redeemedCredits: 5000, entries: [], failures: [] })
    const view = renderPage()

    fireEvent.click(await view.findByRole('button', { name: 'storage.creditTopUpTitle' }))
    expect(await view.findByRole('radio')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'storage.proceedToCheckout' }))
    fireEvent.click(await view.findByRole('button', { name: 'storage.proceedToCheckout' }))
    expect(openNewTab).toHaveBeenCalledWith('/store/checkout?action=checkout&packageId=credits-1&priceId=price-1')

    fireEvent.click(view.getByRole('button', { name: 'storage.redeemTitle' }))
    fireEvent.change(view.getByLabelText('storage.giftCardCode'), { target: { value: 'ZS-1234-5678' } })
    fireEvent.click(view.getByRole('button', { name: 'storage.redeemAction' }))

    await waitFor(() => expect(redeemCloudGiftCard).toHaveBeenCalledWith('ZS-1234-5678'))
    expect(toast.success).toHaveBeenCalledWith('storage.redeemSuccess:5000')
  })

  it('continues and cancels an unpaid order', async () => {
    vi.mocked(cancelCloudOrder).mockResolvedValue({
      ...unpaidOrder(),
      status: 'canceled',
      paymentStatus: 'canceled',
    })
    const view = renderPage()

    fireEvent.click(await view.findByRole('button', { name: 'storage.historyTitle' }))
    fireEvent.click(await view.findByLabelText('storage.continuePayment'))
    expect(openNewTab).toHaveBeenCalledWith('/store/checkout?action=payment&orderId=order-unpaid')

    fireEvent.click(view.getByLabelText('storage.cancelOrder'))
    fireEvent.click(await view.findByRole('button', { name: 'common.confirm' }))
    await waitFor(() => expect(cancelCloudOrder).toHaveBeenCalledWith('order-unpaid'))
  })

  it('shows a read-only notice to non-owner team members', async () => {
    activeOrganization.value = { id: 'team-1' }
    vi.mocked(listCloudStoreTargets).mockResolvedValue({
      items: [{ orgId: 'team-1', name: 'Design Team', type: 'team', role: 'editor' }],
      total: 1,
    })

    const view = renderPage()

    expect(await view.findByText('storage.teamMemberBillingNotice')).toBeTruthy()
    expect(view.queryByText('storage.creditBalance')).toBeNull()
    expect(getCloudCredits).not.toHaveBeenCalled()
    expect(listCloudOrders).not.toHaveBeenCalled()
  })
})
