import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { continueCloudOrderPayment, createCloudBillingPortalSession, createCloudCheckout, getSession } from '@/lib/api'
import { redirectExternal } from '@/lib/browser-navigation'

type CheckoutSearch = {
  action: 'checkout' | 'payment' | 'portal' | 'invalid'
  packageId?: string
  currency?: string
  orderId?: string
}

export const Route = createFileRoute('/store/checkout')({
  validateSearch: normalizeCheckoutSearch,
  beforeLoad: async ({ location }) => {
    const data = await getSession()
    if (!data?.session) {
      const redirectUrl = encodeURIComponent(`${location.pathname}${location.searchStr ?? ''}`)
      throw redirect({ to: '/sign-in', search: { redirect: redirectUrl } as never })
    }
  },
  component: StorageCheckoutPage,
})

function StorageCheckoutPage() {
  return <StorageCheckoutRedirect search={Route.useSearch()} />
}

export function StorageCheckoutRedirect({ search }: { search: CheckoutSearch }) {
  const { t } = useTranslation()
  const started = useRef(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (started.current) return
    started.current = true
    createCheckoutSession(search)
      .then((url) => redirectExternal(url))
      .catch((err: Error) => setError(err.message))
  }, [search])

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-6">
      <div className="w-full max-w-sm space-y-4 text-center">
        {error ? (
          <>
            <h2 className="text-xl font-semibold">{t('storage.checkoutRedirectErrorTitle')}</h2>
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button asChild>
              <Link to="/storage">{t('storage.checkoutRedirectBack')}</Link>
            </Button>
          </>
        ) : (
          <>
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />
            <h2 className="text-xl font-semibold">{t('storage.checkoutRedirectTitle')}</h2>
            <p className="text-sm text-muted-foreground">{t('storage.checkoutRedirectDescription')}</p>
          </>
        )}
      </div>
    </div>
  )
}

function normalizeCheckoutSearch(search: Record<string, unknown>): CheckoutSearch {
  const action = search.action
  if (action === 'checkout') {
    return {
      action,
      packageId: stringValue(search.packageId),
      currency: stringValue(search.currency),
    }
  }
  if (action === 'payment') return { action, orderId: stringValue(search.orderId) }
  if (action === 'portal') return { action }
  return { action: 'invalid' }
}

async function createCheckoutSession(search: CheckoutSearch) {
  if (search.action === 'checkout') {
    if (!search.packageId || !search.currency) throw new Error('invalid_checkout_request')
    const result = await createCloudCheckout(search.packageId, search.currency)
    return result.url
  }
  if (search.action === 'payment') {
    if (!search.orderId) throw new Error('invalid_checkout_request')
    const result = await continueCloudOrderPayment(search.orderId)
    return result.url
  }
  if (search.action === 'portal') {
    const result = await createCloudBillingPortalSession()
    return result.url
  }
  throw new Error('invalid_checkout_request')
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}
