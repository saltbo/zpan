import type { CloudOrder } from '@shared/types'
import { Eye } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  cloudOrderItemStorageBytes,
  cloudOrderItemTrafficBytes,
  cloudOrderStorageBytes,
  cloudOrderTrafficBytes,
} from '@/lib/cloud-order'
import { formatMoney, formatSize } from '@/lib/format'

export function StorageOrdersTable({ orders }: { orders: CloudOrder[] }) {
  const { t } = useTranslation()

  if (orders.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
        {t('admin.cloudStore.orders.empty')}
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-md border">
      <Table className="table-fixed">
        <colgroup>
          <col />
          <col className="w-32" />
          <col className="w-40" />
          <col className="w-40" />
          <col className="w-24" />
          <col className="w-36" />
          <col className="w-16" />
        </colgroup>
        <TableHeader>
          <TableRow>
            <TableHead>{t('admin.cloudStore.orders.order')}</TableHead>
            <TableHead>{t('admin.cloudStore.orders.status')}</TableHead>
            <TableHead>{t('admin.cloudStore.orders.customer')}</TableHead>
            <TableHead>{t('admin.cloudStore.orders.planQuota')}</TableHead>
            <TableHead>{t('admin.cloudStore.orders.amount')}</TableHead>
            <TableHead>{t('admin.cloudStore.orders.createdAt')}</TableHead>
            <TableHead className="text-right">{t('common.actions')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {orders.map((order) => (
            <TableRow key={order.id}>
              <TableCell className="min-w-0">
                <div className="truncate font-medium" title={formatOrderItems(order)}>
                  {formatOrderItems(order)}
                </div>
                <div className="truncate font-mono text-xs text-muted-foreground" title={order.id}>
                  {order.id}
                </div>
              </TableCell>
              <TableCell>
                <OrderStatusBadges order={order} />
              </TableCell>
              <TableCell className="min-w-0">
                <div className="truncate" title={formatCustomer(order)}>
                  {formatCustomer(order)}
                </div>
                <div
                  className="truncate font-mono text-xs text-muted-foreground"
                  title={formatTargetValue(order, 'orgId')}
                >
                  {formatTargetValue(order, 'orgId')}
                </div>
              </TableCell>
              <TableCell className="truncate" title={formatOrderQuota(order, t)}>
                {formatOrderQuota(order, t)}
              </TableCell>
              <TableCell className="whitespace-nowrap tabular-nums">
                {formatMoney(order.totalAmount, order.currency)}
              </TableCell>
              <TableCell className="truncate" title={formatDateTime(order.createdAt)}>
                {formatDateTime(order.createdAt)}
              </TableCell>
              <TableCell className="text-right">
                <OrderDetailsDrawer order={order} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function OrderDetailsDrawer({ order }: { order: CloudOrder }) {
  const { t } = useTranslation()
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t('admin.cloudStore.orders.viewDetails')}
          title={t('admin.cloudStore.orders.viewDetails')}
        >
          <Eye className="h-4 w-4" />
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{t('admin.cloudStore.orders.detailTitle')}</SheetTitle>
          <SheetDescription className="font-mono">{order.id}</SheetDescription>
        </SheetHeader>
        <div className="space-y-6 px-4 pb-6">
          <DetailSection title={t('admin.cloudStore.orders.summary')}>
            <DetailGrid
              items={[
                [t('admin.cloudStore.orders.status'), order.status],
                [t('admin.cloudStore.orders.paymentStatus'), order.paymentStatus],
                [t('admin.cloudStore.orders.fulfillmentStatus'), order.fulfillmentStatus],
                [t('admin.cloudStore.orders.amount'), formatMoney(order.totalAmount, order.currency)],
                [t('admin.cloudStore.orders.discount'), formatMoney(order.discountAmount, order.currency)],
                [t('admin.cloudStore.orders.subtotal'), formatMoney(order.subtotalAmount, order.currency)],
              ]}
            />
          </DetailSection>

          <DetailSection title={t('admin.cloudStore.orders.customer')}>
            <DetailGrid
              items={[
                [t('admin.cloudStore.orders.customer'), formatCustomer(order)],
                [t('admin.cloudStore.orders.target'), formatTargetValue(order, 'orgId')],
                [t('admin.cloudStore.orders.buyerAccount'), order.buyerAccountId ?? '-'],
                [t('admin.cloudStore.orders.store'), order.storeId],
              ]}
            />
          </DetailSection>

          <DetailSection title={t('admin.cloudStore.orders.items')}>
            <div className="space-y-3">
              {order.items.map((item) => (
                <div key={item.id} className="rounded-md border p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-medium" title={item.name}>
                        {item.name}
                      </div>
                      <div
                        className="truncate text-xs text-muted-foreground"
                        title={item.description ?? item.productId}
                      >
                        {item.description ?? item.productId}
                      </div>
                    </div>
                    <div className="shrink-0 text-right text-sm tabular-nums">
                      {formatMoney(item.totalAmount, order.currency)}
                    </div>
                  </div>
                  <DetailGrid
                    className="mt-3"
                    items={[
                      [t('admin.cloudStore.orders.quantity'), String(item.quantity)],
                      [t('admin.cloudStore.orders.unitAmount'), formatMoney(item.unitAmount, order.currency)],
                      [t('admin.cloudStore.orders.planQuota'), formatItemQuota(item, t)],
                      [t('admin.cloudStore.orders.productType'), item.productType],
                    ]}
                  />
                </div>
              ))}
            </div>
          </DetailSection>

          <DetailSection title={t('admin.cloudStore.orders.payments')}>
            {order.payments && order.payments.length > 0 ? (
              <div className="space-y-3">
                {order.payments.map((payment) => (
                  <div key={payment.id} className="rounded-md border p-3">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <Badge variant={payment.status === 'paid' ? 'default' : 'secondary'}>{payment.status}</Badge>
                      <span className="text-sm tabular-nums">{formatMoney(payment.amount, payment.currency)}</span>
                    </div>
                    <DetailGrid
                      items={[
                        [t('admin.cloudStore.orders.provider'), payment.provider],
                        [
                          t('admin.cloudStore.orders.reference'),
                          payment.providerPaymentIntentId ?? payment.providerSessionId ?? '-',
                        ],
                        [t('admin.cloudStore.orders.createdAt'), formatDateTime(payment.createdAt)],
                        [t('admin.cloudStore.orders.paidAt'), formatNullableDateTime(payment.paidAt)],
                      ]}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                {t('admin.cloudStore.orders.noPayments')}
              </div>
            )}
          </DetailSection>

          <DetailSection title={t('admin.cloudStore.orders.timeline')}>
            <DetailGrid
              items={[
                [t('admin.cloudStore.orders.createdAt'), formatDateTime(order.createdAt)],
                [t('admin.cloudStore.orders.paidAt'), formatNullableDateTime(order.paidAt)],
                [t('admin.cloudStore.orders.fulfilledAt'), formatNullableDateTime(order.fulfilledAt)],
                [t('admin.cloudStore.orders.canceledAt'), formatNullableDateTime(order.canceledAt)],
              ]}
            />
          </DetailSection>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function OrderStatusBadges({ order }: { order: CloudOrder }) {
  return (
    <div className="flex flex-wrap gap-1">
      <Badge variant={order.paymentStatus === 'paid' ? 'default' : 'secondary'}>{order.paymentStatus}</Badge>
      <Badge variant={order.fulfillmentStatus === 'fulfilled' ? 'default' : 'outline'}>{order.fulfillmentStatus}</Badge>
    </div>
  )
}

function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-medium">{title}</h3>
      {children}
    </section>
  )
}

function DetailGrid({ items, className }: { items: [string, string][]; className?: string }) {
  return (
    <dl className={`grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 ${className ?? ''}`}>
      {items.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="break-all font-medium" title={value}>
            {value}
          </dd>
        </div>
      ))}
    </dl>
  )
}

function formatOrderQuota(order: CloudOrder, t: ReturnType<typeof useTranslation>['t']) {
  return formatQuotaParts(cloudOrderStorageBytes(order), cloudOrderTrafficBytes(order), t)
}

function formatItemQuota(item: CloudOrder['items'][number], t: ReturnType<typeof useTranslation>['t']) {
  return formatQuotaParts(cloudOrderItemStorageBytes(item), cloudOrderItemTrafficBytes(item), t)
}

function formatQuotaParts(storageBytes: number, trafficBytes: number, t: ReturnType<typeof useTranslation>['t']) {
  const parts = []
  if (storageBytes > 0) parts.push(t('admin.cloudStore.orders.storageQuota', { size: formatSize(storageBytes) }))
  if (trafficBytes > 0) parts.push(t('admin.cloudStore.orders.trafficQuota', { size: formatSize(trafficBytes) }))
  return parts.length > 0 ? parts.join(' / ') : '-'
}

function formatOrderItems(order: CloudOrder) {
  if (order.items.length === 0) return order.id
  if (order.items.length === 1) return order.items[0].name
  return `${order.items[0].name} +${order.items.length - 1}`
}

function formatCustomer(order: CloudOrder) {
  return formatTargetValue(order, 'customerLabel') !== '-'
    ? formatTargetValue(order, 'customerLabel')
    : formatTargetValue(order, 'customerId')
}

function formatTargetValue(order: CloudOrder, key: string) {
  const value = order.target?.[key]
  return typeof value === 'string' ? value : '-'
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString()
}

function formatNullableDateTime(value: string | null) {
  return value ? formatDateTime(value) : '-'
}
