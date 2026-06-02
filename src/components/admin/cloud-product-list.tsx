import type { CloudProduct } from '@shared/types'
import { Pencil, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cloudProductIncludedCredits, cloudProductStorageBytes } from '@/lib/cloud-product'
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
          <col className="w-32" />
          <col className="w-36" />
          <col className="w-24" />
          <col className="w-20" />
          <col className="w-44" />
        </colgroup>
        <TableHeader>
          <TableRow>
            <TableHead>{t('admin.cloudStore.planName')}</TableHead>
            <TableHead className="w-28">{t('admin.cloudStore.storageQuota')}</TableHead>
            <TableHead className="w-32">{t('admin.cloudStore.includedCredits')}</TableHead>
            <TableHead className="w-36">{t('admin.cloudStore.prices')}</TableHead>
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
                {cloudProductStorageBytes(pkg) > 0 ? formatSize(cloudProductStorageBytes(pkg)) : '—'}
              </TableCell>
              <TableCell className="tabular-nums">{formatCredits(cloudProductIncludedCredits(pkg))}</TableCell>
              <TableCell className="tabular-nums">{formatUsdPrices(pkg.prices)}</TableCell>
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

export function CreditPackageList({
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
          <col className="w-32" />
          <col className="w-32" />
          <col className="w-24" />
          <col className="w-20" />
          <col className="w-44" />
        </colgroup>
        <TableHeader>
          <TableRow>
            <TableHead>{t('admin.cloudStore.creditPackageName')}</TableHead>
            <TableHead className="w-32">{t('admin.cloudStore.creditAmount')}</TableHead>
            <TableHead className="w-32">{t('admin.cloudStore.prices')}</TableHead>
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
              <TableCell className="tabular-nums">{formatCredits(cloudProductIncludedCredits(pkg))}</TableCell>
              <TableCell className="tabular-nums">{formatOneTimeUsdPrice(pkg.prices)}</TableCell>
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
        <div className="border-t p-8 text-center text-sm text-muted-foreground">
          {t('admin.cloudStore.noCreditPackages')}
        </div>
      )}
    </div>
  )
}

function formatUsdPrices(prices: CloudProduct['prices']) {
  const monthly = recurringPrice(prices, 'month')
  const yearly = recurringPrice(prices, 'year')
  const parts = [
    monthly ? `$${(monthly.amount / 100).toFixed(2)}/mo` : null,
    yearly ? `$${(yearly.amount / 100).toFixed(2)}/yr` : null,
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : '—'
}

function formatOneTimeUsdPrice(prices: CloudProduct['prices']) {
  const price = prices.find((item) => item.currency === 'usd' && !item.recurring)
  return price ? `$${(price.amount / 100).toFixed(2)}` : '—'
}

function recurringPrice(prices: CloudProduct['prices'], interval: 'month' | 'year') {
  return prices.find(
    (item) =>
      item.currency === 'usd' &&
      item.recurring?.interval === interval &&
      item.recurring.intervalCount === 1 &&
      item.recurring.usageType !== 'metered',
  )
}

function formatCredits(credits: number) {
  return credits > 0 ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(credits) : '—'
}
