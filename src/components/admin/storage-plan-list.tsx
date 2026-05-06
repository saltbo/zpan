import type { QuotaStorePackage } from '@shared/types'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatSize } from '@/lib/format'

export function StoragePlanList({
  packages,
  onEdit,
}: {
  packages: QuotaStorePackage[]
  onEdit: (pkg: QuotaStorePackage) => void
}) {
  const { t } = useTranslation()

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('admin.storagePlans.packageName')}</TableHead>
            <TableHead>{t('admin.storagePlans.size')}</TableHead>
            <TableHead>{t('admin.storagePlans.prices')}</TableHead>
            <TableHead>{t('admin.storagePlans.active')}</TableHead>
            <TableHead>{t('admin.storagePlans.sortOrder')}</TableHead>
            <TableHead className="w-24 text-right">{t('common.actions')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {packages.map((pkg) => (
            <TableRow key={pkg.id}>
              <TableCell className="max-w-md">
                <div className="font-medium">{pkg.name}</div>
                <div className="mt-1 whitespace-normal text-xs text-muted-foreground">{pkg.description}</div>
              </TableCell>
              <TableCell className="tabular-nums">{formatSize(pkg.resourceBytes)}</TableCell>
              <TableCell className="tabular-nums">{formatPrices(pkg.prices)}</TableCell>
              <TableCell>
                <Badge variant={pkg.active ? 'default' : 'secondary'}>
                  {pkg.active ? t('common.active') : t('common.disabled')}
                </Badge>
              </TableCell>
              <TableCell className="tabular-nums">{pkg.sortOrder}</TableCell>
              <TableCell className="text-right">
                <Button variant="outline" size="sm" onClick={() => onEdit(pkg)}>
                  {t('common.edit')}
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {packages.length === 0 && (
        <div className="border-t p-8 text-center text-sm text-muted-foreground">
          {t('admin.storagePlans.noPackages')}
        </div>
      )}
    </div>
  )
}

function formatPrices(prices: QuotaStorePackage['prices']) {
  return prices.map((price) => `${(price.amount / 100).toFixed(2)} ${price.currency}`).join(' / ')
}
