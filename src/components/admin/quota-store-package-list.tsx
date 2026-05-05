import type { QuotaStorePackage } from '@shared/types'
import { BadgeAlert, CheckCircle2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { formatSize } from '@/lib/format'

export function QuotaStorePackageList({
  packages,
  onEdit,
}: {
  packages: QuotaStorePackage[]
  onEdit: (pkg: QuotaStorePackage) => void
}) {
  const { t } = useTranslation()

  return (
    <div className="space-y-3">
      {packages.map((pkg) => (
        <Card key={pkg.id} className="border-border/60">
          <CardContent className="flex flex-wrap items-start justify-between gap-4 p-4">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-medium">{pkg.name}</h3>
                <Badge variant={pkg.active ? 'default' : 'secondary'}>
                  {pkg.active ? t('common.active') : t('common.disabled')}
                </Badge>
                <SyncBadge pkg={pkg} />
              </div>
              <p className="text-sm text-muted-foreground">{pkg.description}</p>
              <p className="text-sm tabular-nums">
                {formatSize(pkg.bytes)} · {formatMoney(pkg.amount, pkg.currency)}
              </p>
              {pkg.syncError && <p className="text-xs text-destructive">{pkg.syncError}</p>}
            </div>
            <Button variant="outline" onClick={() => onEdit(pkg)}>
              {t('common.edit')}
            </Button>
          </CardContent>
        </Card>
      ))}
      {packages.length === 0 && (
        <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          {t('admin.quotaStore.noPackages')}
        </div>
      )}
    </div>
  )
}

function SyncBadge({ pkg }: { pkg: QuotaStorePackage }) {
  const icon = pkg.syncStatus === 'synced' ? <CheckCircle2 className="h-3 w-3" /> : <BadgeAlert className="h-3 w-3" />
  return (
    <Badge variant={pkg.syncStatus === 'failed' ? 'destructive' : 'outline'} className="gap-1">
      {icon}
      {pkg.syncStatus}
    </Badge>
  )
}

function formatMoney(amount: number, currency: string) {
  return `${(amount / 100).toFixed(2)} ${currency}`
}
