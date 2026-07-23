import type { CloudProduct, CurrentStoragePlan } from '@shared/types'
import { BadgeCent, HardDrive, PlusCircle } from 'lucide-react'
import type * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cloudProductIncludedCredits, cloudProductStorageBytes } from '@/lib/cloud-product'
import { formatCurrency, formatSize } from '@/lib/format'

export function StoragePackages({
  packages,
  disabled,
  currentPlan,
  showHeader = true,
  onCheckout,
  onManagePlan,
}: {
  packages: CloudProduct[]
  disabled: boolean
  currentPlan?: CurrentStoragePlan | null
  showHeader?: boolean
  onCheckout: (packageId: string, priceId: string) => void
  onManagePlan?: () => void
}) {
  const { t, i18n } = useTranslation()
  const language = i18n.resolvedLanguage ?? 'en'
  return (
    <section className="min-w-0 space-y-4">
      {showHeader && (
        <div>
          <h3 className="text-lg font-semibold">{t('storage.availablePlansTitle')}</h3>
          <p className="text-sm text-muted-foreground">{t('storage.availableProductsDescription')}</p>
        </div>
      )}
      <div className="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {packages.map((pkg) => (
          <PackageCard
            key={pkg.id}
            pkg={pkg}
            disabled={disabled}
            currentPlan={currentPlan}
            language={language}
            onCheckout={onCheckout}
            onManagePlan={onManagePlan}
          />
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
          ? 'flex min-h-[360px] min-w-0 flex-col overflow-hidden rounded-lg border border-primary/60 bg-primary/5 p-5 text-card-foreground shadow-sm'
          : 'flex min-h-[360px] min-w-0 flex-col overflow-hidden rounded-lg border border-border/60 bg-card p-5 text-card-foreground shadow-sm transition-colors hover:border-primary/50'
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
      <div className="mt-auto pt-4">{action}</div>
    </div>
  )
}

function PackageCard({
  pkg,
  disabled,
  currentPlan,
  language,
  onCheckout,
  onManagePlan,
}: {
  pkg: CloudProduct
  disabled: boolean
  currentPlan?: CurrentStoragePlan | null
  language: string
  onCheckout: (packageId: string, priceId: string) => void
  onManagePlan?: () => void
}) {
  const { t } = useTranslation()
  const prices = selectPlanPrices(pkg.prices)
  const primaryPrice = prices.monthly ?? prices.yearly
  if (!primaryPrice) throw new Error('cloud_product_price_missing')
  const priceLabel = formatPlanPrice(primaryPrice, language, t)
  const storageBytes = cloudProductStorageBytes(pkg)
  const includedCredits = cloudProductIncludedCredits(pkg)
  const isCurrent = currentPlan?.packageId === pkg.id
  const hasPlan = Boolean(currentPlan?.subscription)
  const isHigherPlan = hasPlan && storageBytes > (currentPlan?.storageBytes ?? 0)
  return (
    <ProductCardShell
      active={isCurrent}
      title={pkg.name}
      description={pkg.description ?? ''}
      badge={isCurrent ? t('storage.currentPlanBadge') : t('storage.planBadge')}
      icon={<HardDrive className="h-4 w-4" />}
      price={priceLabel}
      action={planActions({
        disabled,
        hasPlan,
        isCurrent,
        isHigherPlan,
        prices,
        pkgId: pkg.id,
        t,
        onCheckout,
        onManagePlan,
      })}
    >
      <PlanDetailRow
        icon={<HardDrive className="h-4 w-4" />}
        label={t('storage.storageQuota')}
        value={formatSize(storageBytes)}
      />
      <PlanDetailRow
        icon={<BadgeCent className="h-4 w-4" />}
        label={t('storage.includedCredits')}
        value={formatCredits(includedCredits)}
      />
    </ProductCardShell>
  )
}

function planActions({
  disabled,
  hasPlan,
  isCurrent,
  isHigherPlan,
  prices,
  pkgId,
  t,
  onCheckout,
  onManagePlan,
}: {
  disabled: boolean
  hasPlan: boolean
  isCurrent: boolean
  isHigherPlan: boolean
  prices: ReturnType<typeof selectPlanPrices>
  pkgId: string
  t: ReturnType<typeof useTranslation>['t']
  onCheckout: (packageId: string, priceId: string) => void
  onManagePlan?: () => void
}) {
  if (hasPlan) {
    const label = isCurrent
      ? t('storage.managePlan')
      : isHigherPlan
        ? t('storage.upgradeToPlan')
        : t('storage.changePlan')
    return (
      <Button
        className="h-9 w-full"
        variant={isCurrent ? 'outline' : 'default'}
        disabled={disabled || !onManagePlan}
        onClick={onManagePlan}
      >
        <PlusCircle className="h-3.5 w-3.5" />
        {label}
      </Button>
    )
  }

  return (
    <div className="grid gap-2">
      {prices.monthly && (
        <Button className="h-9 w-full" disabled={disabled} onClick={() => onCheckout(pkgId, prices.monthly!.id)}>
          <PlusCircle className="h-3.5 w-3.5" />
          {t('storage.checkoutMonthly')}
        </Button>
      )}
      {prices.yearly && (
        <Button
          className="h-9 w-full"
          variant={prices.monthly ? 'outline' : 'default'}
          disabled={disabled}
          onClick={() => onCheckout(pkgId, prices.yearly!.id)}
        >
          <PlusCircle className="h-3.5 w-3.5" />
          {t('storage.checkoutYearly')}
        </Button>
      )}
    </div>
  )
}

function PlanDetailRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm leading-6">
      <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
        <span className="shrink-0">{icon}</span>
        <span className="truncate">{label}</span>
      </span>
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

function formatPlanPrice(
  price: CloudProduct['prices'][number],
  language: string,
  t: ReturnType<typeof useTranslation>['t'],
) {
  const amount = formatCurrency(price.amount, price.currency, language)
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
