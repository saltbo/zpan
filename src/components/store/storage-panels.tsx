import type { CloudOrder, CloudProduct } from '@shared/types'
import { Activity, CreditCard, HardDrive, PlusCircle, Wallet, X } from 'lucide-react'
import type * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { formatSize } from '@/lib/format'

export { StorageActions } from './storage-dialogs'

export function StorageStatusMetrics({
  quota,
  wallet,
}: {
  quota?: { quota: number; trafficQuota: number }
  wallet?: { balance: number; currency: string }
}) {
  const { t, i18n } = useTranslation()
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatusMetric
        label={t('storage.status')}
        value={t('storage.available')}
        icon={<HardDrive className="h-4 w-4" />}
      />
      <StatusMetric
        label={t('storage.currentQuota')}
        value={quota ? formatSize(quota.quota) : '-'}
        icon={<HardDrive className="h-4 w-4" />}
      />
      <StatusMetric
        label={t('storage.currentTrafficQuota')}
        value={quota ? formatSize(quota.trafficQuota) : '-'}
        icon={<Activity className="h-4 w-4" />}
      />
      <StatusMetric
        label={t('storage.walletBalance')}
        value={wallet ? formatMoney(wallet.balance, wallet.currency, i18n.resolvedLanguage ?? 'en') : '-'}
        icon={<Wallet className="h-4 w-4" />}
      />
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

function StatusMetric({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-card/50 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-muted-foreground">{icon}</div>
      </div>
      <div className="mt-2 text-sm font-medium">{value}</div>
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

export function StorageOrderHistory({
  orders,
  onContinuePayment,
  onCancelOrder,
  continuingOrderId,
  cancelingOrderId,
}: {
  orders: CloudOrder[]
  onContinuePayment?: (orderId: string) => void
  onCancelOrder?: (orderId: string) => void
  continuingOrderId?: string | null
  cancelingOrderId?: string | null
}) {
  const { t } = useTranslation()
  return (
    <Card className="border-border/60">
      <CardHeader>
        <CardTitle>{t('storage.historyTitle')}</CardTitle>
        <CardDescription>{t('storage.historyDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <OrderRows
          orders={orders}
          onContinuePayment={onContinuePayment}
          onCancelOrder={onCancelOrder}
          continuingOrderId={continuingOrderId}
          cancelingOrderId={cancelingOrderId}
        />
      </CardContent>
    </Card>
  )
}

function OrderRows({
  orders,
  onContinuePayment,
  onCancelOrder,
  continuingOrderId,
  cancelingOrderId,
}: {
  orders: CloudOrder[]
  onContinuePayment?: (orderId: string) => void
  onCancelOrder?: (orderId: string) => void
  continuingOrderId?: string | null
  cancelingOrderId?: string | null
}) {
  return (
    <>
      {orders.map((order) => (
        <OrderRow
          key={order.id}
          order={order}
          onContinuePayment={onContinuePayment}
          onCancelOrder={onCancelOrder}
          isContinuing={continuingOrderId === order.id}
          isCanceling={cancelingOrderId === order.id}
        />
      ))}
      {orders.length === 0 && <OrderEmptyState />}
    </>
  )
}

function OrderRow({
  order,
  onContinuePayment,
  onCancelOrder,
  isContinuing,
  isCanceling,
}: {
  order: CloudOrder
  onContinuePayment?: (orderId: string) => void
  onCancelOrder?: (orderId: string) => void
  isContinuing: boolean
  isCanceling: boolean
}) {
  const { t, i18n } = useTranslation()
  const item = order.items[0]
  const payload = item?.fulfillmentPayload
  const storageBytes = payload?.storageBytes ?? 0
  const trafficBytes = payload?.trafficBytes ?? 0
  const actionable = isActionableOrder(order)
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 rounded-xl border bg-card/40 px-4 py-4">
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{item?.name ?? order.id}</span>
          <Badge variant={order.paymentStatus === 'paid' ? 'default' : 'secondary'}>{order.paymentStatus}</Badge>
          <Badge variant="outline">#{order.id.slice(0, 8)}</Badge>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          {storageBytes > 0 && (
            <Badge variant="outline">{t('storage.quotaChip', { size: formatSize(storageBytes) })}</Badge>
          )}
          {trafficBytes > 0 && (
            <Badge variant="outline">{t('storage.trafficQuota', { size: formatSize(trafficBytes) })}</Badge>
          )}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>{order.target?.orgId ?? '-'}</span>
          <span>{new Date(order.createdAt).toLocaleString()}</span>
        </div>
      </div>
      <div className="flex items-center gap-3 self-center">
        <div className="text-right">
          <div className="text-sm font-medium tabular-nums">
            {formatMoney(order.totalAmount, order.currency, i18n.resolvedLanguage ?? 'en')}
          </div>
          {order.discountAmount > 0 && (
            <div className="text-xs text-muted-foreground">
              {t('storage.walletCredit', {
                amount: formatMoney(order.discountAmount, order.currency, i18n.resolvedLanguage ?? 'en'),
              })}
            </div>
          )}
        </div>
        {actionable && (
          <TooltipProvider>
            <div className="flex items-center gap-1">
              <OrderIconButton
                label={t('storage.continuePayment')}
                disabled={isContinuing || isCanceling}
                onClick={() => onContinuePayment?.(order.id)}
                icon={<CreditCard className="h-4 w-4" />}
              />
              <OrderIconButton
                label={t('storage.cancelOrder')}
                disabled={isContinuing || isCanceling}
                onClick={() => onCancelOrder?.(order.id)}
                icon={<X className="h-4 w-4" />}
              />
            </div>
          </TooltipProvider>
        )}
      </div>
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

function isActionableOrder(order: CloudOrder) {
  if (order.status !== 'pending') return false
  return order.paymentStatus !== 'paid' && order.paymentStatus !== 'canceled'
}

function OrderIconButton({
  label,
  disabled,
  onClick,
  icon,
}: {
  label: string
  disabled: boolean
  onClick: () => void
  icon: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label={label}
          title={label}
          disabled={disabled}
          onClick={onClick}
        >
          {icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
