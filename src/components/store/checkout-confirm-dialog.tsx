import type { DiscountQuote } from '@shared/schemas'
import { Loader2, TicketPercent } from 'lucide-react'
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
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ApiError, createDiscountQuote } from '@/lib/api'

export type CheckoutSelection = {
  packageId: string
  priceId: string
  productName: string
  amount: number
  currency: string
  interval: 'month' | 'year' | null
}

export function CheckoutConfirmDialog({
  selection,
  language,
  onOpenChange,
  onConfirm,
}: {
  selection: CheckoutSelection | null
  language: string
  onOpenChange: (open: boolean) => void
  onConfirm: (packageId: string, priceId: string, promotionCode?: string) => void
}) {
  const { t } = useTranslation()
  const [code, setCode] = useState('')
  const [validating, setValidating] = useState(false)
  const [quote, setQuote] = useState<DiscountQuote | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (!selection) return null

  const subtotal = quote?.subtotal ?? selection.amount

  async function applyCoupon() {
    const trimmed = code.trim()
    if (!trimmed || validating) return
    setValidating(true)
    setError(null)
    try {
      setQuote(await createDiscountQuote(trimmed, selection!.priceId))
    } catch (err) {
      setQuote(null)
      setError(err instanceof ApiError ? t('storage.couponInvalid') : (err as Error).message)
    } finally {
      setValidating(false)
    }
  }

  function removeCoupon() {
    setCode('')
    setQuote(null)
    setError(null)
  }

  function confirm() {
    onConfirm(selection!.packageId, selection!.priceId, quote?.code)
    onOpenChange(false)
  }

  return (
    <Dialog open={!!selection} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('storage.confirmCheckoutTitle')}</DialogTitle>
          <DialogDescription>{t('storage.confirmCheckoutDescription')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-md border bg-muted/20 p-4">
            <div className="text-sm font-medium">{selection.productName}</div>
            <div className="mt-2 space-y-1 text-sm">
              <Row label={t('storage.subtotalLabel')} value={periodPrice(subtotal, selection, language, t)} />
              {quote && quote.discount > 0 && (
                <>
                  <Row
                    label={t('storage.discountLabel')}
                    value={`-${formatMoney(quote.discount, selection.currency, language)}`}
                    accent
                  />
                  <Row
                    label={t('storage.totalLabel')}
                    value={periodPrice(quote.total, selection, language, t)}
                    strong
                  />
                </>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="checkout-coupon">{t('storage.couponLabel')}</Label>
            {quote ? (
              <div className="flex items-center justify-between gap-2 rounded-md border border-primary/40 bg-primary/5 px-3 py-2">
                <Badge variant="outline" className="border-primary/40 text-primary">
                  <TicketPercent className="h-3.5 w-3.5" />
                  {quote.code}
                </Badge>
                <span className="text-sm text-muted-foreground">{t('storage.couponApplied')}</span>
                <Button variant="ghost" size="sm" className="ml-auto" onClick={removeCoupon}>
                  {t('storage.couponRemove')}
                </Button>
              </div>
            ) : (
              <div className="flex gap-2">
                <Input
                  id="checkout-coupon"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  onKeyDown={(event) => event.key === 'Enter' && applyCoupon()}
                  placeholder={t('storage.couponPlaceholder')}
                  aria-invalid={!!error}
                  disabled={validating}
                />
                <Button variant="outline" onClick={applyCoupon} disabled={validating || !code.trim()}>
                  {validating ? <Loader2 className="h-4 w-4 animate-spin" /> : t('storage.couponApply')}
                </Button>
              </div>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          <p className="text-xs text-muted-foreground">{t('storage.couponNote')}</p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={confirm}>{t('storage.proceedToCheckout')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Row({ label, value, accent, strong }: { label: string; value: string; accent?: boolean; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className={accent ? 'tabular-nums text-primary' : strong ? 'font-semibold tabular-nums' : 'tabular-nums'}>
        {value}
      </span>
    </div>
  )
}

function formatMoney(amount: number, currency: string, language: string) {
  return new Intl.NumberFormat(language, { style: 'currency', currency: currency.toUpperCase() }).format(amount / 100)
}

function periodPrice(
  amount: number,
  selection: CheckoutSelection,
  language: string,
  t: ReturnType<typeof useTranslation>['t'],
) {
  const label = formatMoney(amount, selection.currency, language)
  if (selection.interval === 'month') return t('storage.priceMonthly', { amount: label })
  if (selection.interval === 'year') return t('storage.priceYearly', { amount: label })
  return label
}
