import type { CloudProduct } from '@shared/types'
import { HardDrive, PlusCircle } from 'lucide-react'
import type * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cloudProductIncludedCredits, cloudProductStorageBytes } from '@/lib/cloud-product'
import { formatSize } from '@/lib/format'

export function StoragePackages({
  packages,
  disabled,
  onCheckout,
}: {
  packages: CloudProduct[]
  disabled: boolean
  onCheckout: (packageId: string, priceId: string) => void
}) {
  const { t, i18n } = useTranslation()
  const language = i18n.resolvedLanguage ?? 'en'
  return (
    <section className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold">{t('storage.availableProductsTitle')}</h3>
        <p className="text-sm text-muted-foreground">{t('storage.availableProductsDescription')}</p>
      </div>
      <div className="grid grid-cols-[340px] gap-5 lg:grid-cols-[repeat(2,340px)] xl:grid-cols-[repeat(3,340px)]">
        {packages.map((pkg) => (
          <PackageCard key={pkg.id} pkg={pkg} disabled={disabled} language={language} onCheckout={onCheckout} />
        ))}
      </div>
      {packages.length === 0 && (
        <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          {t('storage.noPackages')}
        </div>
      )}
    </section>
  )
}

function ProductCardShell({
  active = false,
  title,
  description,
  badge,
  icon,
  price,
  children,
  action,
}: {
  active?: boolean
  title: string
  description: string
  badge?: string
  icon?: React.ReactNode
  price: string
  children: React.ReactNode
  action: React.ReactNode
}) {
  return (
    <div
      className={
        active
          ? 'flex h-[380px] w-[340px] flex-col overflow-hidden rounded-lg border border-primary/50 bg-card p-5 text-card-foreground shadow-sm'
          : 'flex h-[380px] w-[340px] flex-col overflow-hidden rounded-lg border border-border/60 bg-card p-5 text-card-foreground shadow-sm transition-colors hover:border-primary/50'
      }
    >
      <div className="flex min-h-[58px] items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-lg font-semibold leading-6">{title}</div>
          {description && (
            <div className="mt-1 line-clamp-2 text-sm leading-5 text-muted-foreground">{description}</div>
          )}
        </div>
        {badge ? (
          <Badge variant="outline" className="shrink-0 border-primary/40 text-primary">
            {badge}
          </Badge>
        ) : (
          <div className="shrink-0 text-muted-foreground">{icon}</div>
        )}
      </div>
      <div className="mt-3 shrink-0 truncate text-3xl font-semibold" style={{ height: 42, lineHeight: '42px' }}>
        {price}
      </div>
      <div className="mt-3 shrink-0 space-y-3 rounded-md border bg-muted/20 p-4">{children}</div>
      <div className="mt-4 shrink-0">{action}</div>
    </div>
  )
}

function PackageCard({
  pkg,
  disabled,
  language,
  onCheckout,
}: {
  pkg: CloudProduct
  disabled: boolean
  language: string
  onCheckout: (packageId: string, priceId: string) => void
}) {
  const { t } = useTranslation()
  const prices = selectPlanPrices(pkg.prices)
  const primaryPrice = prices.monthly ?? prices.yearly
  if (!primaryPrice) throw new Error('cloud_product_price_missing')
  const priceLabel = formatPlanPrice(primaryPrice, language, t)
  const storageBytes = cloudProductStorageBytes(pkg)
  const includedCredits = cloudProductIncludedCredits(pkg)
  return (
    <ProductCardShell
      title={pkg.name}
      description={pkg.description ?? ''}
      badge={t('storage.planBadge')}
      icon={<HardDrive className="h-4 w-4" />}
      price={priceLabel}
      action={
        <div className="grid gap-2">
          {prices.monthly && (
            <Button className="h-9 w-full" disabled={disabled} onClick={() => onCheckout(pkg.id, prices.monthly!.id)}>
              <PlusCircle className="h-3.5 w-3.5" />
              {t('storage.checkoutMonthly')}
            </Button>
          )}
          {prices.yearly && (
            <Button
              className="h-9 w-full"
              variant={prices.monthly ? 'outline' : 'default'}
              disabled={disabled}
              onClick={() => onCheckout(pkg.id, prices.yearly!.id)}
            >
              <PlusCircle className="h-3.5 w-3.5" />
              {t('storage.checkoutYearly')}
            </Button>
          )}
        </div>
      }
    >
      <PlanDetailRow label={t('storage.baseStorageQuota')} value={formatSize(storageBytes)} />
      <PlanDetailRow label={t('storage.includedCredits')} value={formatCredits(includedCredits)} />
      <PlanDetailRow label={t('storage.trafficPolicy')} value={t('storage.usageBilledWithCredits')} />
    </ProductCardShell>
  )
}

function PlanDetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm leading-6">
      <span className="truncate text-muted-foreground">{label}</span>
      <span className="max-w-[128px] shrink-0 truncate text-right font-medium tabular-nums">{value}</span>
    </div>
  )
}

function selectPlanPrices(prices: CloudProduct['prices']) {
  return {
    monthly: recurringPrice(prices, 'month'),
    yearly: recurringPrice(prices, 'year'),
  }
}

function formatMoney(amount: number, currency: string, language: string) {
  return new Intl.NumberFormat(language, { style: 'currency', currency: currency.toUpperCase() }).format(amount / 100)
}

function formatPlanPrice(
  price: CloudProduct['prices'][number],
  language: string,
  t: ReturnType<typeof useTranslation>['t'],
) {
  const amount = formatMoney(price.amount, price.currency, language)
  if (price.recurring?.interval === 'month' && price.recurring.intervalCount === 1)
    return t('storage.priceMonthly', { amount })
  if (price.recurring?.interval === 'year' && price.recurring.intervalCount === 1)
    return t('storage.priceYearly', { amount })
  return amount
}

function recurringPrice(prices: CloudProduct['prices'], interval: 'month' | 'year') {
  const price = prices.find(
    (item) =>
      item.currency === 'usd' &&
      item.recurring?.interval === interval &&
      item.recurring.intervalCount === 1 &&
      item.recurring.usageType !== 'metered',
  )
  if (!price) return null
  const priceId = price.id
  if (!priceId) throw new Error('cloud_product_price_missing')
  return { ...price, id: priceId }
}

function formatCredits(credits: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(credits)
}
