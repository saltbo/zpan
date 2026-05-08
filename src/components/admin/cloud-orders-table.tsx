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
            <TableHead>{t('admin.cloudStore.orders.storage')}</TableHead>
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
              <TableCell>{formatOrderQuota(order)}</TableCell>
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

function formatOrderQuota(order: CloudOrder) {
  const payload = order.items[0]?.fulfillmentPayload
  const storageBytes = payload?.storageBytes ?? 0
  const trafficBytes = payload?.trafficBytes ?? 0
  return `${formatSize(storageBytes)}${trafficBytes > 0 ? ` / ${formatSize(trafficBytes)}` : ''}`
}

function formatOrderReference(order: CloudOrder) {
  const payment = order.payments?.[0]
  if (payment?.providerPaymentIntentId) return payment.providerPaymentIntentId
  if (payment?.providerSessionId) return payment.providerSessionId
  return formatMoney(order.totalAmount, order.currency)
}
