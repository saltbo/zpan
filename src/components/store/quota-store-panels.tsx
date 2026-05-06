import type { QuotaGrant, QuotaStorePackage, QuotaTarget } from '@shared/types'
import { Gift, HardDrive, PlusCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatSize } from '@/lib/format'

export function StoreStatusMetrics({ quota }: { quota?: { quota: number; grantedQuota: number } }) {
  const { t } = useTranslation()
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <StatusMetric label={t('store.status')} value={t('store.available')} />
      <StatusMetric label={t('store.currentQuota')} value={quota ? formatSize(quota.quota) : '-'} />
      <StatusMetric label={t('store.grantedQuota')} value={quota ? formatSize(quota.grantedQuota) : '-'} />
    </div>
  )
}

export function TargetSelect({
  targets,
  value,
  onValueChange,
}: {
  targets: QuotaTarget[]
  value: string
  onValueChange: (value: string) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="w-full space-y-2 sm:w-72">
      <Label>{t('store.target')}</Label>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {targets.map((target) => (
            <TargetOption key={target.orgId} target={target} />
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

export function StorePackages({
  packages,
  disabled,
  onCheckout,
}: {
  packages: QuotaStorePackage[]
  disabled: boolean
  onCheckout: (packageId: string) => void
}) {
  const { t } = useTranslation()
  return (
    <>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {packages.map((pkg) => (
          <PackageCard key={pkg.id} pkg={pkg} disabled={disabled} onCheckout={() => onCheckout(pkg.id)} />
        ))}
      </div>
      {packages.length === 0 && (
        <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          {t('store.noPackages')}
        </div>
      )}
    </>
  )
}

export function StoreRedeemAndHistory({
  code,
  grants,
  redeemDisabled,
  onCodeChange,
  onRedeem,
}: {
  code: string
  grants: QuotaGrant[]
  redeemDisabled: boolean
  onCodeChange: (code: string) => void
  onRedeem: () => void
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
      <RedeemCard code={code} disabled={redeemDisabled} onCodeChange={onCodeChange} onRedeem={onRedeem} />
      <GrantHistory grants={grants} />
    </div>
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

function TargetOption({ target }: { target: QuotaTarget }) {
  return (
    <SelectItem value={target.orgId}>
      {target.name} · {target.type}
    </SelectItem>
  )
}

function PackageCard({
  pkg,
  disabled,
  onCheckout,
}: {
  pkg: QuotaStorePackage
  disabled: boolean
  onCheckout: () => void
}) {
  const { t } = useTranslation()
  return (
    <Card className="border-border/60">
      <CardHeader>
        <PackageHeader pkg={pkg} />
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <p className="text-2xl font-semibold">{formatSize(pkg.bytes)}</p>
          <p className="text-sm text-muted-foreground">{formatMoney(pkg.amount, pkg.currency)}</p>
        </div>
        <Button className="w-full" disabled={disabled} onClick={onCheckout}>
          <PlusCircle className="mr-2 h-4 w-4" />
          {t('store.checkout')}
        </Button>
      </CardContent>
    </Card>
  )
}

function PackageHeader({ pkg }: { pkg: QuotaStorePackage }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <CardTitle>{pkg.name}</CardTitle>
        <CardDescription className="mt-1">{pkg.description}</CardDescription>
      </div>
      <HardDrive className="h-5 w-5 text-muted-foreground" />
    </div>
  )
}

function RedeemCard({
  code,
  disabled,
  onCodeChange,
  onRedeem,
}: {
  code: string
  disabled: boolean
  onCodeChange: (code: string) => void
  onRedeem: () => void
}) {
  const { t } = useTranslation()
  return (
    <Card className="border-border/60">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Gift className="h-5 w-5 text-primary" />
          <CardTitle>{t('store.redeemTitle')}</CardTitle>
        </div>
        <CardDescription>{t('store.redeemDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="storageCode">{t('store.storageCode')}</Label>
          <Input id="storageCode" value={code} onChange={(event) => onCodeChange(event.target.value)} />
        </div>
        <Button className="w-full" disabled={disabled} onClick={onRedeem}>
          {t('store.redeemButton')}
        </Button>
      </CardContent>
    </Card>
  )
}

function GrantHistory({ grants }: { grants: QuotaGrant[] }) {
  const { t } = useTranslation()
  return (
    <Card className="border-border/60">
      <CardHeader>
        <CardTitle>{t('store.historyTitle')}</CardTitle>
        <CardDescription>{t('store.historyDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {grants.map((grant) => (
          <GrantRow key={grant.id} grant={grant} />
        ))}
        {grants.length === 0 && <GrantEmptyState />}
      </CardContent>
    </Card>
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
      {t('store.noHistory')}
    </div>
  )
}

function formatMoney(amount: number, currency: string) {
  return `${(amount / 100).toFixed(2)} ${currency}`
}
