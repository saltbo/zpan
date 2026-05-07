import type { QuotaGrant, QuotaStorePackage } from '@shared/types'
import { Activity, HardDrive, PlusCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { formatSize } from '@/lib/format'

export { StorageActions } from './storage-dialogs'

export function StorageStatusMetrics({ quota }: { quota?: { quota: number; grantedQuota: number } }) {
  const { t } = useTranslation()
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <StatusMetric label={t('storage.status')} value={t('storage.available')} />
      <StatusMetric label={t('storage.currentQuota')} value={quota ? formatSize(quota.quota) : '-'} />
      <StatusMetric label={t('storage.grantedQuota')} value={quota ? formatSize(quota.grantedQuota) : '-'} />
    </div>
  )
}

export function StoragePackages({
  packages,
  disabled,
  onCheckout,
}: {
  packages: QuotaStorePackage[]
  disabled: boolean
  onCheckout: (packageId: string, currency: string) => void
}) {
  const { t } = useTranslation()
  return (
    <>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {packages.map((pkg) => (
          <PackageCard key={pkg.id} pkg={pkg} disabled={disabled} onCheckout={onCheckout} />
        ))}
      </div>
      {packages.length === 0 && (
        <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          {t('storage.noPackages')}
        </div>
      )}
    </>
  )
}

export function StorageGrantHistory({ grants }: { grants: QuotaGrant[] }) {
  const { t } = useTranslation()
  return (
    <Card className="border-border/60">
      <CardHeader>
        <CardTitle>{t('storage.historyTitle')}</CardTitle>
        <CardDescription>{t('storage.historyDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <GrantRows grants={grants} />
      </CardContent>
    </Card>
  )
}

function StatusMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-medium">{value}</div>
    </div>
  )
}

function PackageCard({
  pkg,
  disabled,
  onCheckout,
}: {
  pkg: QuotaStorePackage
  disabled: boolean
  onCheckout: (packageId: string, currency: string) => void
}) {
  const { t } = useTranslation()
  return (
    <Card className="border-border/60">
      <CardHeader>
        <PackageHeader pkg={pkg} />
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          {pkg.storageBytes > 0 && <p className="text-2xl font-semibold">{formatSize(pkg.storageBytes)}</p>}
          {pkg.trafficBytes > 0 && (
            <p className={pkg.storageBytes > 0 ? 'text-sm font-medium' : 'text-2xl font-semibold'}>
              {t('storage.trafficQuota', { size: formatSize(pkg.trafficBytes) })}
            </p>
          )}
          <p className="text-sm text-muted-foreground">{formatPrices(pkg.prices)}</p>
        </div>
        {pkg.prices.map((price) => (
          <Button
            key={price.currency}
            className="w-full"
            disabled={disabled}
            onClick={() => onCheckout(pkg.id, price.currency)}
          >
            <PlusCircle className="mr-2 h-4 w-4" />
            {t('storage.checkout')} · {formatMoney(price.amount, price.currency)}
          </Button>
        ))}
      </CardContent>
    </Card>
  )
}

function PackageHeader({ pkg }: { pkg: QuotaStorePackage }) {
  const Icon = pkg.storageBytes > 0 && pkg.trafficBytes > 0 ? HardDrive : pkg.trafficBytes > 0 ? Activity : HardDrive
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <CardTitle>{pkg.name}</CardTitle>
        <CardDescription className="mt-1">{pkg.description}</CardDescription>
      </div>
      <Icon className="h-5 w-5 text-muted-foreground" />
    </div>
  )
}

function GrantRows({ grants }: { grants: QuotaGrant[] }) {
  return (
    <>
      {grants.map((grant) => (
        <GrantRow key={grant.id} grant={grant} />
      ))}
      {grants.length === 0 && <GrantEmptyState />}
    </>
  )
}

function GrantRow({ grant }: { grant: QuotaGrant }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border px-4 py-3">
      <div>
        <div className="flex items-center gap-2">
          <span className="font-medium">{formatSize(grant.bytes)}</span>
          <Badge variant="outline">{grant.source}</Badge>
          <Badge variant={grant.active ? 'default' : 'secondary'}>{grant.active ? 'active' : 'inactive'}</Badge>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{grant.orgId}</p>
      </div>
      <span className="text-xs text-muted-foreground">{new Date(grant.createdAt).toLocaleString()}</span>
    </div>
  )
}

function GrantEmptyState() {
  const { t } = useTranslation()
  return (
    <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
      {t('storage.noHistory')}
    </div>
  )
}

function formatPrices(prices: QuotaStorePackage['prices']) {
  return prices.map((price) => formatMoney(price.amount, price.currency)).join(' / ')
}

function formatMoney(amount: number, currency: string) {
  return `${(amount / 100).toFixed(2)} ${currency}`
}
