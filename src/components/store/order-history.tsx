import type { CloudOrder } from '@shared/types'
import { CreditCard, ShoppingCart, X } from 'lucide-react'
import type * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cloudOrderItemStorageBytes, cloudOrderItemTrafficBytes } from '@/lib/cloud-order'
import { formatSize } from '@/lib/format'

export function StorageOrderHistoryDialog({
  orders,
  onContinuePayment,
  onCancelOrder,
  continuingOrderId,
  cancelingOrderId,
}: {
  orders: CloudOrder[]
  onContinuePayment: (orderId: string) => void
  onCancelOrder: (orderId: string) => void
  continuingOrderId: string | null
  cancelingOrderId: string | null
}) {
  const { t } = useTranslation()
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <ShoppingCart />
          {t('storage.historyTitle')}
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[min(720px,calc(100vh-2rem))] flex-col overflow-hidden sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('storage.historyTitle')}</DialogTitle>
          <DialogDescription>{t('storage.historyDescription')}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto pr-1">
          <StorageOrderHistoryContent
            orders={orders}
            onContinuePayment={onContinuePayment}
            onCancelOrder={onCancelOrder}
            continuingOrderId={continuingOrderId}
            cancelingOrderId={cancelingOrderId}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function StorageOrderHistoryContent({
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
    <div className="space-y-3">
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
    </div>
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
  const storageBytes = cloudOrderItemStorageBytes(item)
  const trafficBytes = cloudOrderItemTrafficBytes(item)
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 rounded-lg border bg-card/40 px-4 py-4">
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{item?.name ?? order.id}</span>
          <Badge variant={order.paymentStatus === 'paid' ? 'default' : 'secondary'}>{order.paymentStatus}</Badge>
          <Badge variant={order.fulfillmentStatus === 'fulfilled' ? 'default' : 'outline'}>
            {order.fulfillmentStatus}
          </Badge>
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
          <span>{formatTargetValue(order, 'orgId')}</span>
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
        {isActionableOrder(order) && (
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

function formatMoney(amount: number, currency: string, language: string) {
  return new Intl.NumberFormat(language, { style: 'currency', currency: currency.toUpperCase() }).format(amount / 100)
}

function isActionableOrder(order: CloudOrder) {
  if (order.status !== 'pending') return false
  return order.paymentStatus !== 'paid' && order.paymentStatus !== 'canceled'
}

function formatTargetValue(order: CloudOrder, key: string) {
  const value = order.target?.[key]
  return typeof value === 'string' ? value : '-'
}
