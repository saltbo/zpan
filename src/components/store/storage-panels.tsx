import type { CloudOrder, CloudProduct } from '@shared/types'
import { Activity, HardDrive, PlusCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { formatSize } from '@/lib/format'

export { StorageActions } from './storage-dialogs'

export function StorageStatusMetrics({ quota }: { quota?: { quota: number } }) {
  const { t } = useTranslation()
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <StatusMetric label={t('storage.status')} value={t('storage.available')} />
      <StatusMetric label={t('storage.currentQuota')} value={quota ? formatSize(quota.quota) : '-'} />
    </div>
  )
}

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
  return (
    <>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {packages.map((pkg) => (
          <PackageCard
            key={pkg.id}
            pkg={pkg}
            disabled={disabled}
            language={i18n.resolvedLanguage ?? 'en'}
            onCheckout={onCheckout}
          />
        ))}
      </div>
      {packages.length === 0 && (
        <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          {t('storage.noPackages')}
        </div>
      )}
    </>
  )
}

export function StorageOrderHistory({ orders }: { orders: CloudOrder[] }) {
  const { t } = useTranslation()
  return (
    <Card className="border-border/60">
      <CardHeader>
        <CardTitle>{t('storage.historyTitle')}</CardTitle>
        <CardDescription>{t('storage.historyDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <OrderRows orders={orders} />
      </CardContent>
    </Card>
  )
}

function StatusMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-medium">{value}</div>
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
  return (
    <Card className="border-border/60">
      <CardHeader>
        <PackageHeader pkg={pkg} />
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          {pkg.metadata.storageBytes > 0 && (
            <p className="text-2xl font-semibold">{formatSize(pkg.metadata.storageBytes)}</p>
          )}
          {pkg.metadata.trafficBytes > 0 && (
            <p className={pkg.metadata.storageBytes > 0 ? 'text-sm font-medium' : 'text-2xl font-semibold'}>
              {t('storage.trafficQuota', { size: formatSize(pkg.metadata.trafficBytes) })}
            </p>
          )}
          <p className="text-sm text-muted-foreground">{formatMoney(price.amount, price.currency, language)}</p>
        </div>
        <Button className="w-full" disabled={disabled} onClick={() => onCheckout(pkg.id, price.currency)}>
          <PlusCircle className="mr-2 h-4 w-4" />
          {t('storage.checkout')} · {formatMoney(price.amount, price.currency, language)}
        </Button>
      </CardContent>
    </Card>
  )
}

function PackageHeader({ pkg }: { pkg: CloudProduct }) {
  const Icon =
    pkg.metadata.storageBytes > 0 && pkg.metadata.trafficBytes > 0
      ? HardDrive
      : pkg.metadata.trafficBytes > 0
        ? Activity
        : HardDrive
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <CardTitle>{pkg.name}</CardTitle>
        <CardDescription className="mt-1">{pkg.description ?? ''}</CardDescription>
      </div>
      <Icon className="h-5 w-5 text-muted-foreground" />
    </div>
  )
}

function OrderRows({ orders }: { orders: CloudOrder[] }) {
  return (
    <>
      {orders.map((order) => (
        <OrderRow key={order.id} order={order} />
      ))}
      {orders.length === 0 && <OrderEmptyState />}
    </>
  )
}

function OrderRow({ order }: { order: CloudOrder }) {
  const item = order.items[0]
  const payload = item?.fulfillmentPayload
  const storageBytes = payload?.storageBytes ?? 0
  const trafficBytes = payload?.trafficBytes ?? 0
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border px-4 py-3">
      <div>
        <div className="flex items-center gap-2">
          <span className="font-medium">{item?.name ?? order.id}</span>
          <Badge variant="outline">{formatSize(storageBytes)}</Badge>
          {trafficBytes > 0 && <Badge variant="outline">{formatSize(trafficBytes)}</Badge>}
          <Badge variant={order.paymentStatus === 'paid' ? 'default' : 'secondary'}>{order.paymentStatus}</Badge>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{order.target?.orgId ?? '-'}</p>
      </div>
      <span className="text-xs text-muted-foreground">{new Date(order.createdAt).toLocaleString()}</span>
    </div>
  )
}

function OrderEmptyState() {
  const { t } = useTranslation()
  return (
    <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
      {t('storage.noHistory')}
    </div>
  )
}

function selectPrice(prices: CloudProduct['prices'], language: string) {
  const currency = language.startsWith('zh') ? 'cny' : 'usd'
  const price = prices.find((item) => item.currency === currency)
  if (!price) throw new Error(`cloud_product_price_missing_${currency.toLowerCase()}`)
  return price
}

function formatMoney(amount: number, currency: string, language: string) {
  return new Intl.NumberFormat(language, { style: 'currency', currency: currency.toUpperCase() }).format(amount / 100)
}
