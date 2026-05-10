import { cleanup, render, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { continueCloudOrderPayment, createCloudBillingPortalSession, createCloudCheckout } from '@/lib/api'
import { redirectExternal } from '@/lib/browser-navigation'
import { StorageCheckoutRedirect } from './checkout'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => options,
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}))

vi.mock('@/lib/browser-navigation', () => ({
  redirectExternal: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  continueCloudOrderPayment: vi.fn(),
  createCloudBillingPortalSession: vi.fn(),
  createCloudCheckout: vi.fn(),
}))

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

    render(<StorageCheckoutRedirect search={{ action: 'checkout', packageId: 'pkg-1', currency: 'usd' }} />)

    await waitFor(() => expect(createCloudCheckout).toHaveBeenCalledWith('pkg-1', 'usd'))
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

  it('shows an error for invalid checkout requests', async () => {
    const view = render(<StorageCheckoutRedirect search={{ action: 'checkout' }} />)

    expect(await view.findByText('invalid_checkout_request')).toBeTruthy()
    expect(redirectExternal).not.toHaveBeenCalled()
  })
})
