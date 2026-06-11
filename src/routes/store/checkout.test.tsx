import type { CloudOrder } from '@shared/types'
import { cleanup, render, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ApiError,
  type ApiErrorBody,
  cancelCloudOrder,
  continueCloudOrderPayment,
  createCloudBillingPortalSession,
  createCloudCheckout,
  listCloudOrders,
} from '@/lib/api'
import { redirectExternal } from '@/lib/browser-navigation'
import { StorageCheckoutRedirect } from './checkout'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => options,
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
  redirect: (options: unknown) => options,
}))

vi.mock('@/lib/browser-navigation', () => ({
  redirectExternal: vi.fn(),
}))

vi.mock('@/lib/api', () => {
  class ApiError extends Error {
    readonly status: number
    readonly body: ApiErrorBody
    constructor(status: number, body: ApiErrorBody) {
      super((typeof body.error === 'string' ? body.error : undefined) ?? `HTTP ${status}`)
      this.name = 'ApiError'
      this.status = status
      this.body = body
    }
  }
  return {
    ApiError,
    continueCloudOrderPayment: vi.fn(),
    createCloudBillingPortalSession: vi.fn(),
    createCloudCheckout: vi.fn(),
    getSession: vi.fn(),
    listCloudOrders: vi.fn(),
    cancelCloudOrder: vi.fn(),
  }
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('StorageCheckoutRedirect', () => {
  it('creates a package checkout session and redirects externally', async () => {
    vi.mocked(createCloudCheckout).mockResolvedValue({
      orderId: 'order-1',
      url: 'https://cloud.example.test/checkout',
    })

    render(<StorageCheckoutRedirect search={{ action: 'checkout', packageId: 'pkg-1', priceId: 'price-usd' }} />)

    await waitFor(() => expect(createCloudCheckout).toHaveBeenCalledWith('pkg-1', 'price-usd', undefined))
    expect(redirectExternal).toHaveBeenCalledWith('https://cloud.example.test/checkout')
  })

  it('forwards the promotion code to checkout when present', async () => {
    vi.mocked(createCloudCheckout).mockResolvedValue({
      orderId: 'order-1',
      url: 'https://cloud.example.test/checkout',
    })

    render(
      <StorageCheckoutRedirect
        search={{ action: 'checkout', packageId: 'pkg-1', priceId: 'price-usd', promotionCode: 'SAVE10' }}
      />,
    )

    await waitFor(() => expect(createCloudCheckout).toHaveBeenCalledWith('pkg-1', 'price-usd', 'SAVE10'))
    expect(redirectExternal).toHaveBeenCalledWith('https://cloud.example.test/checkout')
  })

  it('continues payment and redirects externally', async () => {
    vi.mocked(continueCloudOrderPayment).mockResolvedValue({
      orderId: 'order-1',
      url: 'https://cloud.example.test/pay',
    })

    render(<StorageCheckoutRedirect search={{ action: 'payment', orderId: 'order-1' }} />)

    await waitFor(() => expect(continueCloudOrderPayment).toHaveBeenCalledWith('order-1'))
    expect(redirectExternal).toHaveBeenCalledWith('https://cloud.example.test/pay')
  })

  it('opens the billing portal session and redirects externally', async () => {
    vi.mocked(createCloudBillingPortalSession).mockResolvedValue({
      url: 'https://billing.stripe.test/session',
      stripeSubscriptionId: 'sub-1',
    })

    render(<StorageCheckoutRedirect search={{ action: 'portal' }} />)

    await waitFor(() => expect(createCloudBillingPortalSession).toHaveBeenCalled())
    expect(redirectExternal).toHaveBeenCalledWith('https://billing.stripe.test/session')
  })

  it('handles workspace_plan_exists error, cancels pending plan order, and retries checkout', async () => {
    const apiError = new ApiError(400, { error: { code: 'workspace_plan_exists' } } as unknown as ApiErrorBody)

    vi.mocked(createCloudCheckout).mockRejectedValueOnce(apiError).mockResolvedValueOnce({
      orderId: 'order-2',
      url: 'https://cloud.example.test/checkout-retry',
    })

    vi.mocked(listCloudOrders).mockResolvedValue({
      items: [
        {
          id: 'order-pending-plan',
          status: 'pending',
          items: [
            {
              fulfillmentPayload: {
                deliverable: {
                  type: 'zpan.plan',
                },
              },
            },
          ],
        },
      ] as unknown as CloudOrder[],
      total: 1,
    })

    vi.mocked(cancelCloudOrder).mockResolvedValue({} as unknown as CloudOrder)

    render(<StorageCheckoutRedirect search={{ action: 'checkout', packageId: 'pkg-1', priceId: 'price-usd' }} />)

    await waitFor(() => expect(createCloudCheckout).toHaveBeenCalledTimes(2))
    expect(cancelCloudOrder).toHaveBeenCalledWith('order-pending-plan')
    expect(redirectExternal).toHaveBeenCalledWith('https://cloud.example.test/checkout-retry')
  })

  it('shows an error for invalid checkout requests', async () => {
    const view = render(<StorageCheckoutRedirect search={{ action: 'checkout' }} />)

    expect(await view.findByText('invalid_checkout_request')).toBeTruthy()
    expect(redirectExternal).not.toHaveBeenCalled()
  })
})
