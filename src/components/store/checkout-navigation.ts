import type { CloudProduct } from '@shared/types'
import { openNewTab } from '@/lib/browser-navigation'
import type { CheckoutSelection } from './checkout-confirm-dialog'

type CheckoutTabInput =
  | { action: 'checkout'; packageId: string; priceId: string; promotionCode?: string }
  | { action: 'payment'; orderId: string }
  | { action: 'portal' }

export function openCheckoutTab(input: CheckoutTabInput) {
  const search = new URLSearchParams({ action: input.action })
  if (input.action === 'checkout') {
    search.set('packageId', input.packageId)
    search.set('priceId', input.priceId)
    if (input.promotionCode) search.set('promotionCode', input.promotionCode)
  }
  if (input.action === 'payment') search.set('orderId', input.orderId)
  openNewTab(`/store/checkout?${search.toString()}`)
}

export function resolveCheckoutSelection(
  products: CloudProduct[],
  packageId: string,
  priceId: string,
): CheckoutSelection | null {
  const product = products.find((item) => item.id === packageId)
  const price = product?.prices.find((item) => item.id === priceId)
  if (!product || !price) return null
  const interval = price.recurring?.interval
  return {
    packageId,
    priceId,
    productName: product.name,
    amount: price.amount,
    currency: price.currency,
    interval: interval === 'month' || interval === 'year' ? interval : null,
  }
}
