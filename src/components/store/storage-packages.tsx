import type { CloudProduct } from '@shared/types'
import { HardDrive, Package, PlusCircle } from 'lucide-react'
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
  onCheckout: (packageId: string, currency: string) => void
}) {
  const { t } = useTranslation()
  const price = selectPrice(pkg.prices, language)
  const priceLabel = formatPackagePrice(price, pkg, language, t)
  const plan = isPlanProduct(pkg)
  return (
    <ProductCardShell
      title={pkg.name}
      description={pkg.description ?? ''}
      badge={plan ? t('storage.monthlyPlanBadge') : t('storage.resourcePackageBadge')}
      icon={plan ? <HardDrive className="h-4 w-4" /> : <Package className="h-4 w-4" />}
      price={priceLabel}
      action={
        <Button className="h-9 w-full" disabled={disabled} onClick={() => onCheckout(pkg.id, price.currency)}>
          <PlusCircle className="h-3.5 w-3.5" />
          {plan ? t('storage.checkoutPlan') : t('storage.checkoutPackage')}
        </Button>
      }
    >
      {plan ? (
        <>
          <PlanDetailRow label={t('storage.baseStorageQuota')} value={formatSize(pkg.metadata.storageBytes)} />
          <PlanDetailRow label={t('storage.includedTraffic')} value={formatSize(pkg.metadata.trafficBytes)} />
          <PlanDetailRow
            label={t('storage.trafficPolicy')}
            value={formatTrafficPolicy(pkg, price.currency, language, t)}
          />
        </>
      ) : (
        <>
          <PlanDetailRow label={t('storage.packageStorageQuota')} value={formatSize(pkg.metadata.storageBytes)} />
          <PlanDetailRow label={t('storage.packageTrafficQuota')} value={formatSize(pkg.metadata.trafficBytes)} />
          <PlanDetailRow label={t('storage.packageValidity')} value={formatValidity(pkg, t)} />
        </>
      )}
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

function selectPrice(prices: CloudProduct['prices'], language: string) {
  const currency = language.startsWith('zh') ? 'cny' : 'usd'
  const purchasablePrices = prices.filter((item) => item.recurring?.usageType !== 'metered')
  const price = purchasablePrices.find((item) => item.currency === currency) ?? purchasablePrices[0]
  if (!price) throw new Error('cloud_product_price_missing')
  return price
}

function isPlanProduct(pkg: CloudProduct) {
  return pkg.prices.some((price) => price.recurring && price.recurring.usageType !== 'metered')
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

function formatValidity(pkg: CloudProduct, t: ReturnType<typeof useTranslation>['t']) {
  if (pkg.metadata.validityDays) return t('storage.billingFixedDays', { days: pkg.metadata.validityDays })
  return t('storage.packageNoExpiry')
}

function selectMeteredTrafficPrice(prices: CloudProduct['prices'], currency: string) {
  return prices.find(
    (price) =>
      price.currency === currency &&
      price.recurring?.usageType === 'metered' &&
      price.metadata?.usageResource === 'traffic_egress',
  )
}

function formatTrafficPolicy(
  pkg: CloudProduct,
  currency: string,
  language: string,
  t: ReturnType<typeof useTranslation>['t'],
) {
  if (pkg.metadata.trafficBytes <= 0) return t('storage.usageNoLimit')
  const overagePrice = selectMeteredTrafficPrice(pkg.prices, currency)
  if (!overagePrice) return t('storage.trafficStopsAtQuota')
  return t('storage.trafficOveragePerGb', { amount: formatMoney(overagePrice.amount, currency, language) })
}
