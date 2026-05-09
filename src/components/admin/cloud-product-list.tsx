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
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('admin.cloudStore.planName')}</TableHead>
            <TableHead>{t('admin.cloudStore.storageQuota')}</TableHead>
            <TableHead>{t('admin.cloudStore.trafficQuota')}</TableHead>
            <TableHead>{t('admin.cloudStore.prices')}</TableHead>
            <TableHead>{t('admin.cloudStore.active')}</TableHead>
            <TableHead>{t('admin.cloudStore.sortOrder')}</TableHead>
            <TableHead className="w-56 text-right">{t('common.actions')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {packages.map((pkg) => (
            <TableRow key={pkg.id}>
              <TableCell className="max-w-md">
                <div className="font-medium">{pkg.name}</div>
                <div className="mt-1 whitespace-normal text-xs text-muted-foreground">{pkg.description ?? ''}</div>
              </TableCell>
              <TableCell className="tabular-nums">
                {pkg.metadata.storageBytes > 0 ? formatSize(pkg.metadata.storageBytes) : '—'}
              </TableCell>
              <TableCell className="tabular-nums">
                {pkg.metadata.trafficBytes > 0 ? formatSize(pkg.metadata.trafficBytes) : '—'}
              </TableCell>
              <TableCell className="tabular-nums">{formatPrices(pkg.prices)}</TableCell>
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

function formatPrices(prices: CloudProduct['prices']) {
  return prices.map((price) => `${(price.amount / 100).toFixed(2)} ${price.currency}`).join(' / ')
}
