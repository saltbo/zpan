import type { CloudCreditLedgerEntry } from '@shared/schemas'
import type { CloudProduct } from '@shared/types'
import { BadgeCent, CircleDollarSign } from 'lucide-react'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { cloudProductIncludedCredits } from '@/lib/cloud-product'
import { formatCurrency } from '@/lib/format'
import { StorageActions } from './storage-dialogs'

export function CreditBillingPanel({
  credits,
  products,
  entries,
  loading,
  onRedeem,
  onCheckout,
  isRedeeming,
  checkoutDisabled,
  accountAction,
}: {
  credits?: { balance: number }
  products: CloudProduct[]
  entries: CloudCreditLedgerEntry[]
  loading: boolean
  onRedeem: (code: string) => void
  onCheckout: (packageId: string, priceId: string) => void
  isRedeeming: boolean
  checkoutDisabled: boolean
  accountAction?: ReactNode
}) {
  const { t } = useTranslation()
  return (
    <section className="space-y-6">
      <div className="flex min-h-32 flex-wrap items-center justify-between gap-6 rounded-lg border bg-card px-6 py-5">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <BadgeCent className="size-4" />
            <span>{t('storage.creditBalance')}</span>
          </div>
          <div className="text-4xl font-semibold tracking-tight tabular-nums">
            {credits ? formatCredits(credits.balance) : t('common.loading')}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <CreditTopUpDialog products={products} disabled={checkoutDisabled} onCheckout={onCheckout} />
          <StorageActions onRedeem={onRedeem} isRedeeming={isRedeeming} />
          {accountAction}
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-lg font-semibold">{t('storage.creditActivityTitle')}</h3>
        <CreditActivity entries={entries} loading={loading} />
      </div>
    </section>
  )
}

function CreditTopUpDialog({
  products,
  disabled,
  onCheckout,
}: {
  products: CloudProduct[]
  disabled: boolean
  onCheckout: (packageId: string, priceId: string) => void
}) {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const purchasableProducts = products
    .map((product) => ({ product, price: oneTimeUsdPrice(product) }))
    .filter((item): item is { product: CloudProduct; price: CloudProduct['prices'][number] & { id: string } } =>
      Boolean(item.price),
    )
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = purchasableProducts.find(({ product }) => product.id === selectedId) ?? purchasableProducts[0]

  function continueCheckout() {
    if (!selected) return
    setOpen(false)
    onCheckout(selected.product.id, selected.price.id)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button disabled={disabled}>
          <CircleDollarSign className="size-4" />
          {t('storage.creditTopUpTitle')}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('storage.creditTopUpTitle')}</DialogTitle>
          <DialogDescription>{t('storage.creditTopUpDialogDescription')}</DialogDescription>
        </DialogHeader>
        {purchasableProducts.length > 0 ? (
          <div className="space-y-2 py-2">
            {purchasableProducts.map(({ product, price }) => {
              const selectedProduct = selected?.product.id === product.id
              return (
                <label
                  key={product.id}
                  className={`flex cursor-pointer items-center justify-between gap-4 rounded-md border px-4 py-3 transition-colors ${
                    selectedProduct ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-muted/50'
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <input
                      type="radio"
                      name="credit-top-up"
                      value={product.id}
                      checked={selectedProduct}
                      className="size-4 shrink-0 accent-primary"
                      onChange={() => setSelectedId(product.id)}
                    />
                    <span className="font-medium">
                      {t('storage.creditTopUpAmount', {
                        amount: formatCredits(cloudProductIncludedCredits(product)),
                      })}
                    </span>
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums">
                    {formatCurrency(price.amount, price.currency, i18n.resolvedLanguage ?? 'en')}
                  </span>
                </label>
              )
            })}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            {t('storage.noCreditTopUps')}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            {t('common.cancel')}
          </Button>
          <Button disabled={!selected} onClick={continueCheckout}>
            {t('storage.proceedToCheckout')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CreditActivity({ entries, loading }: { entries: CloudCreditLedgerEntry[]; loading: boolean }) {
  const { t } = useTranslation()

  if (loading) return <CreditEmptyState label={t('common.loading')} />
  if (entries.length === 0) return <CreditEmptyState label={t('storage.creditActivityEmpty')} />

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full caption-bottom text-left text-sm">
        <thead className="sticky top-0 border-b bg-background">
          <tr>
            <th className="h-10 px-3 font-medium text-muted-foreground">{t('storage.creditTableType')}</th>
            <th className="h-10 px-3 font-medium text-muted-foreground">{t('storage.creditTableChange')}</th>
            <th className="h-10 px-3 font-medium text-muted-foreground">{t('storage.creditTableStatus')}</th>
            <th className="h-10 px-3 font-medium text-muted-foreground">{t('storage.creditTableReference')}</th>
            <th className="h-10 px-3 font-medium text-muted-foreground">{t('storage.creditTableDate')}</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id} className="border-b last:border-0">
              <td className="p-3 align-middle font-medium">{creditSourceLabel(entry.sourceType, t)}</td>
              <td
                className={`p-3 align-middle font-mono font-semibold ${
                  entry.direction === 'credit' ? 'text-emerald-600 dark:text-emerald-400' : 'text-foreground'
                }`}
              >
                {entry.direction === 'credit' ? '+' : '-'}
                {formatCredits(entry.amount)}
              </td>
              <td className="p-3 align-middle">
                <Badge variant="outline">{creditStatusLabel(entry.status, t)}</Badge>
              </td>
              <td className="p-3 align-middle text-muted-foreground">{creditReference(entry)}</td>
              <td className="p-3 align-middle text-muted-foreground">{new Date(entry.createdAt).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CreditEmptyState({ label }: { label: string }) {
  return <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">{label}</div>
}

function formatCredits(amount: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(amount)
}

function oneTimeUsdPrice(pricesProduct: CloudProduct) {
  const price = pricesProduct.prices.find((item) => item.currency === 'usd' && !item.recurring)
  return price?.id ? { ...price, id: price.id } : null
}

function creditSourceLabel(
  sourceType: CloudCreditLedgerEntry['sourceType'],
  t: ReturnType<typeof useTranslation>['t'],
) {
  switch (sourceType) {
    case 'subscription_grant':
      return t('storage.creditSourceSubscriptionGrant')
    case 'top_up':
      return t('storage.creditSourceTopUp')
    case 'gift_card_redemption':
      return t('storage.creditSourceGiftCard')
    case 'admin_grant':
      return t('storage.creditSourceAdminGrant')
    case 'usage_charge':
      return t('storage.creditSourceUsageCharge')
    case 'adjustment':
      return t('storage.creditSourceAdjustment')
  }
}

function creditStatusLabel(status: CloudCreditLedgerEntry['status'], t: ReturnType<typeof useTranslation>['t']) {
  switch (status) {
    case 'posted':
      return t('storage.creditStatusPosted')
    case 'reversed':
      return t('storage.creditStatusReversed')
  }
}

function creditReference(entry: CloudCreditLedgerEntry) {
  if (entry.paymentId) return entry.paymentId.slice(0, 8)
  if (entry.orderId) return entry.orderId.slice(0, 8)
  if (entry.sourceId) return entry.sourceId.slice(0, 8)
  return '-'
}
