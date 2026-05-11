import type { CloudProduct } from '@shared/types'
import { Pencil, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatSize } from '@/lib/format'

export function StoragePlanList({
  packages,
  onEdit,
  onDelete,
  onPublishChange,
  actionPending,
}: {
  packages: CloudProduct[]
  onEdit: (pkg: CloudProduct) => void
  onDelete: (pkg: CloudProduct) => void
  onPublishChange: (pkg: CloudProduct, active: boolean) => void
  actionPending?: boolean
}) {
  const { t } = useTranslation()

  return (
    <div className="rounded-md border">
      <Table className="table-fixed">
        <colgroup>
          <col />
          <col className="w-28" />
          <col className="w-36" />
          <col className="w-24" />
          <col className="w-24" />
          <col className="w-20" />
          <col className="w-44" />
        </colgroup>
        <TableHeader>
          <TableRow>
            <TableHead>{t('admin.cloudStore.planName')}</TableHead>
            <TableHead className="w-28">{t('admin.cloudStore.storageQuota')}</TableHead>
            <TableHead className="w-36">{t('admin.cloudStore.trafficQuota')}</TableHead>
            <TableHead className="w-24">{t('admin.cloudStore.prices')}</TableHead>
            <TableHead className="w-24">{t('admin.cloudStore.active')}</TableHead>
            <TableHead className="w-20">{t('admin.cloudStore.sortOrder')}</TableHead>
            <TableHead className="w-44 text-right">{t('common.actions')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {packages.map((pkg) => (
            <TableRow key={pkg.id}>
              <TableCell className="min-w-0">
                <div className="min-w-0">
                  <div className="truncate font-medium">{pkg.name}</div>
                  <div className="mt-1 truncate text-xs text-muted-foreground">{pkg.description ?? ''}</div>
                </div>
              </TableCell>
              <TableCell className="tabular-nums">
                {pkg.metadata.storageBytes > 0 ? formatSize(pkg.metadata.storageBytes) : '—'}
              </TableCell>
              <TableCell className="tabular-nums">
                {pkg.metadata.trafficBytes > 0 ? formatSize(pkg.metadata.trafficBytes) : '—'}
              </TableCell>
              <TableCell className="tabular-nums">{formatUsdPrice(pkg.prices)}</TableCell>
              <TableCell>
                <Badge variant={pkg.active ? 'default' : 'secondary'}>
                  {pkg.active ? t('common.active') : t('common.disabled')}
                </Badge>
              </TableCell>
              <TableCell className="tabular-nums">{pkg.sortOrder}</TableCell>
              <TableCell>
                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={actionPending}
                    onClick={() => onPublishChange(pkg, !pkg.active)}
                  >
                    {pkg.active ? t('admin.cloudStore.unpublish') : t('admin.cloudStore.publish')}
                  </Button>
                  <Button variant="outline" size="icon-sm" onClick={() => onEdit(pkg)} title={t('common.edit')}>
                    <Pencil />
                    <span className="sr-only">{t('common.edit')}</span>
                  </Button>
                  <Button
                    variant="outline"
                    size="icon-sm"
                    disabled={actionPending}
                    onClick={() => onDelete(pkg)}
                    title={t('common.delete')}
                  >
                    <Trash2 className="text-destructive" />
                    <span className="sr-only">{t('common.delete')}</span>
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {packages.length === 0 && (
        <div className="border-t p-8 text-center text-sm text-muted-foreground">{t('admin.cloudStore.noPlans')}</div>
      )}
    </div>
  )
}

function formatUsdPrice(prices: CloudProduct['prices']) {
  const price = prices.find((item) => item.currency === 'usd' && !isMeteredTrafficPrice(item))
  return price ? `${(price.amount / 100).toFixed(2)} USD` : '—'
}

function isMeteredTrafficPrice(price: CloudProduct['prices'][number]) {
  return price.recurring?.usageType === 'metered' && price.metadata?.usageResource === 'traffic_egress'
}
