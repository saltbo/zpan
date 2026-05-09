import type { CloudProduct } from '@shared/types'
import { HardDrive, PlusCircle } from 'lucide-react'
import type * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatSize } from '@/lib/format'

export function StoragePackages({
  packages,
  disabled,
  onCheckout,
}: {
  packages: CloudProduct[]
  disabled: boolean
  onCheckout: (packageId: string, currency: string) => void
}) {
  const { t, i18n } = useTranslation()
  const language = i18n.resolvedLanguage ?? 'en'
  return (
    <section className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold">{t('storage.availablePlansTitle')}</h3>
        <p className="text-sm text-muted-foreground">{t('storage.availablePlansDescription')}</p>
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

function PlanCardShell({
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
          ? 'flex h-[430px] w-[340px] flex-col overflow-hidden rounded-lg border border-primary/50 bg-card p-5 text-card-foreground shadow-sm'
          : 'flex h-[430px] w-[340px] flex-col overflow-hidden rounded-lg border border-border/60 bg-card p-5 text-card-foreground shadow-sm transition-colors hover:border-primary/50'
      }
    >
      <div className="flex h-[88px] items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-lg font-semibold leading-6">{title}</div>
          <div className="mt-2 line-clamp-3 text-sm leading-5 text-muted-foreground">{description}</div>
        </div>
        {badge ? (
          <Badge variant="outline" className="shrink-0 border-primary/40 text-primary">
            {badge}
          </Badge>
        ) : (
          <div className="shrink-0 text-muted-foreground">{icon}</div>
        )}
      </div>
      <div className="mt-4 shrink-0 truncate text-3xl font-semibold" style={{ height: 42, lineHeight: '42px' }}>
        {price}
      </div>
      <div className="mt-4 shrink-0 space-y-3 rounded-md border bg-muted/20 p-4">{children}</div>
      <div className="mt-auto pt-5">{action}</div>
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
  onCheckout: (packageId: string, currency: string) => void
}) {
  const { t } = useTranslation()
  const price = selectPrice(pkg.prices, language)
  const priceLabel = formatPackagePrice(price, pkg, language, t)
  return (
    <PlanCardShell
      title={pkg.name}
      description={pkg.description ?? ''}
      icon={<HardDrive className="h-4 w-4" />}
      price={priceLabel}
      action={
        <Button className="h-9 w-full" disabled={disabled} onClick={() => onCheckout(pkg.id, price.currency)}>
          <PlusCircle className="h-3.5 w-3.5" />
          {t('storage.checkoutPlan')}
        </Button>
      }
    >
      <PlanDetailRow label={t('storage.baseStorageQuota')} value={formatSize(pkg.metadata.storageBytes)} />
      <PlanDetailRow label={t('storage.includedTraffic')} value={formatSize(pkg.metadata.trafficBytes)} />
      <PlanDetailRow label={t('storage.planBilling')} value={formatBilling(price, pkg, t)} />
      <PlanDetailRow label={t('storage.trafficPolicy')} value={formatTrafficPolicy(pkg, t)} />
    </PlanCardShell>
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

function selectPrice(prices: CloudProduct['prices'], language: string) {
  const currency = language.startsWith('zh') ? 'cny' : 'usd'
  const purchasablePrices = prices.filter((item) => item.recurring?.usageType !== 'metered')
  const price = purchasablePrices.find((item) => item.currency === currency) ?? purchasablePrices[0]
  if (!price) throw new Error('cloud_product_price_missing')
  return price
}

function formatMoney(amount: number, currency: string, language: string) {
  return new Intl.NumberFormat(language, { style: 'currency', currency: currency.toUpperCase() }).format(amount / 100)
}

function formatPackagePrice(
  price: CloudProduct['prices'][number],
  pkg: CloudProduct,
  language: string,
  t: ReturnType<typeof useTranslation>['t'],
) {
  const amount = formatMoney(price.amount, price.currency, language)
  if (price.recurring?.interval === 'month' && price.recurring.intervalCount === 1)
    return t('storage.priceMonthly', { amount })
  if (pkg.metadata.validityDays) return t('storage.priceForDays', { amount, days: pkg.metadata.validityDays })
  return amount
}

function formatBilling(
  price: CloudProduct['prices'][number],
  pkg: CloudProduct,
  t: ReturnType<typeof useTranslation>['t'],
) {
  if (price.recurring?.interval === 'month' && price.recurring.intervalCount === 1) return t('storage.billingMonthly')
  if (pkg.metadata.validityDays) return t('storage.billingFixedDays', { days: pkg.metadata.validityDays })
  return t('storage.billingOneTime')
}

function formatTrafficPolicy(pkg: CloudProduct, t: ReturnType<typeof useTranslation>['t']) {
  return pkg.metadata.trafficBytes > 0 ? t('storage.trafficStopsAtQuota') : t('storage.usageNoLimit')
}
