import type { StoreOrder } from '@shared/types'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatMoney, formatSize } from '@/lib/format'

export function StorageOrdersTable({ orders }: { orders: StoreOrder[] }) {
  const { t } = useTranslation()

  if (orders.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
        {t('admin.storagePlans.orders.empty')}
      </div>
    )
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('admin.storagePlans.orders.source')}</TableHead>
            <TableHead>{t('admin.storagePlans.orders.storage')}</TableHead>
            <TableHead>{t('admin.storagePlans.orders.target')}</TableHead>
            <TableHead>{t('admin.storagePlans.orders.terminalUser')}</TableHead>
            <TableHead>{t('admin.storagePlans.orders.reference')}</TableHead>
            <TableHead>{t('admin.storagePlans.orders.createdAt')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {orders.map((order) => (
            <TableRow key={order.id}>
              <TableCell>
                <Badge variant="outline">{order.paymentStatus}</Badge>
              </TableCell>
              <TableCell>
                {formatSize(order.storageBytes)}
                {order.trafficBytes > 0 ? ` / ${formatSize(order.trafficBytes)}` : ''}
              </TableCell>
              <TableCell className="font-mono text-xs">{order.orgId}</TableCell>
              <TableCell>{order.terminalUserEmail ?? order.terminalUserId ?? '-'}</TableCell>
              <TableCell className="font-mono text-xs">{formatMoney(order.paidAmount, order.currency)}</TableCell>
              <TableCell>{new Date(order.createdAt).toLocaleString()}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
