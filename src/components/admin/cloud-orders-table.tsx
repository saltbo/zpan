import type { CloudOrder } from '@shared/types'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
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
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('admin.cloudStore.orders.source')}</TableHead>
            <TableHead>{t('admin.cloudStore.orders.planQuota')}</TableHead>
            <TableHead>{t('admin.cloudStore.orders.target')}</TableHead>
            <TableHead>{t('admin.cloudStore.orders.terminalUser')}</TableHead>
            <TableHead>{t('admin.cloudStore.orders.reference')}</TableHead>
            <TableHead>{t('admin.cloudStore.orders.createdAt')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {orders.map((order) => (
            <TableRow key={order.id}>
              <TableCell>
                <Badge variant="outline">{order.payments?.[0]?.provider ?? order.paymentStatus}</Badge>
              </TableCell>
              <TableCell>{formatOrderQuota(order, t)}</TableCell>
              <TableCell className="font-mono text-xs">{order.target?.orgId ?? '-'}</TableCell>
              <TableCell>{order.target?.endUserLabel ?? order.target?.endUserId ?? '-'}</TableCell>
              <TableCell className="font-mono text-xs">{formatOrderReference(order)}</TableCell>
              <TableCell>{new Date(order.createdAt).toLocaleString()}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function formatOrderQuota(order: CloudOrder, t: ReturnType<typeof useTranslation>['t']) {
  const payload = order.items[0]?.fulfillmentPayload
  const storageBytes = payload?.storageBytes ?? 0
  const trafficBytes = payload?.trafficBytes ?? 0
  const parts = []
  if (storageBytes > 0) parts.push(t('admin.cloudStore.orders.storageQuota', { size: formatSize(storageBytes) }))
  if (trafficBytes > 0) parts.push(t('admin.cloudStore.orders.trafficQuota', { size: formatSize(trafficBytes) }))
  return parts.length > 0 ? parts.join(' / ') : '-'
}

function formatOrderReference(order: CloudOrder) {
  const payment = order.payments?.[0]
  if (payment?.providerPaymentIntentId) return payment.providerPaymentIntentId
  if (payment?.providerSessionId) return payment.providerSessionId
  return formatMoney(order.totalAmount, order.currency)
}
