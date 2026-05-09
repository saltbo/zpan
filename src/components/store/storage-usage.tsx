import { Activity, HardDrive } from 'lucide-react'
import type * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import type { UserQuota } from '@/lib/api'
import { formatSize } from '@/lib/format'

export function CurrentPlanCard({
  quota,
  onManagePlan,
  isManagingPlan,
}: {
  quota: UserQuota
  onManagePlan: () => void
  isManagingPlan: boolean
}) {
  const { t } = useTranslation()
  const plan = quota.currentPlan
  const title = plan?.name ?? quota.storagePlanName ?? quota.trafficPlanName ?? t('storage.currentPlan')

  return (
    <Card className="border-border/60 shadow-none">
      <CardHeader className="border-b">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge>{t('storage.planActive')}</Badge>
              {plan?.expiresAt && <Badge variant="outline">{new Date(plan.expiresAt).toLocaleDateString()}</Badge>}
            </div>
            <div>
              <CardDescription>{t('storage.currentPlan')}</CardDescription>
              <CardTitle className="mt-1 text-3xl">{title}</CardTitle>
            </div>
            <p className="max-w-2xl text-sm text-muted-foreground">{t('storage.currentPlanDescription')}</p>
          </div>
          <Button variant="outline" disabled={isManagingPlan} onClick={onManagePlan}>
            {t('storage.managePlan')}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
          <UsageRows quota={quota} />
          <PlanEntitlementSummary quota={quota} />
        </div>
      </CardContent>
    </Card>
  )
}

export function FreeQuotaCard({ quota }: { quota?: UserQuota }) {
  const { t } = useTranslation()
  return (
    <div className="max-w-5xl rounded-lg border border-border/60 bg-card p-4 shadow-sm">
      <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)] lg:items-center">
        <div className="min-w-0 border-b pb-4 lg:border-b-0 lg:border-r lg:pb-0 lg:pr-4">
          <div className="text-xs font-medium uppercase text-muted-foreground">{t('storage.currentPlan')}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <div className="text-xl font-semibold">{t('storage.freePlanName')}</div>
            <Badge variant="outline" className="border-primary/40 text-primary">
              {t('storage.planActive')}
            </Badge>
          </div>
          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{t('storage.freePlanDescription')}</p>
        </div>
        {quota ? (
          <FreeQuotaUsage quota={quota} />
        ) : (
          <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
        )}
      </div>
    </div>
  )
}

function FreeQuotaUsage({ quota }: { quota: UserQuota }) {
  const { t } = useTranslation()
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <CompactQuotaMetric
        label={t('storage.storageUsage')}
        used={quota.used}
        total={quota.quota}
        footer={t('storage.storageQuotaDetail', {
          used: formatSize(quota.used),
          base: formatSize(quota.baseQuota),
          cloud: formatSize(quota.entitlementQuota),
        })}
      />
      <CompactQuotaMetric
        label={t('storage.trafficUsage')}
        used={quota.trafficUsed}
        total={quota.trafficQuota}
        footer={t('storage.trafficPeriodDetail', { period: quota.trafficPeriod })}
      />
    </div>
  )
}

function CompactQuotaMetric({
  label,
  used,
  total,
  footer,
}: {
  label: string
  used: number
  total: number
  footer: string
}) {
  const { t } = useTranslation()
  const percent = total > 0 ? Math.min(100, (used / total) * 100) : 100
  return (
    <div className="min-w-0 rounded-md bg-muted/30 p-3">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="font-medium text-muted-foreground">{label}</span>
        <span className="shrink-0 text-muted-foreground">
          {total > 0 ? t('storage.usageTotal', { total: formatSize(total) }) : t('storage.usageNoLimit')}
        </span>
      </div>
      <div className="mt-2 flex items-center gap-3">
        <span className="shrink-0 text-xl font-semibold tabular-nums">{formatSize(used)}</span>
        <Progress value={percent} className="h-2 min-w-0 flex-1" />
      </div>
      <p className="mt-1 truncate text-xs text-muted-foreground">{footer}</p>
    </div>
  )
}

function UsageRows({ quota, compact = false }: { quota: UserQuota; compact?: boolean }) {
  const { t } = useTranslation()
  return (
    <div className={compact ? 'space-y-5' : 'grid gap-6 md:grid-cols-2'}>
      <UsageMeter
        icon={<HardDrive className="h-4 w-4" />}
        label={t('storage.effectiveStorageQuota')}
        used={quota.used}
        total={quota.quota}
        detail={t('storage.storageQuotaDetail', {
          used: formatSize(quota.used),
          base: formatSize(quota.baseQuota),
          cloud: formatSize(quota.entitlementQuota),
        })}
      />
      <UsageMeter
        icon={<Activity className="h-4 w-4" />}
        label={t('storage.trafficUsage')}
        used={quota.trafficUsed}
        total={quota.trafficQuota}
        detail={t('storage.trafficPeriodDetail', { period: quota.trafficPeriod })}
      />
    </div>
  )
}

function UsageMeter({
  icon,
  label,
  used,
  total,
  detail,
}: {
  icon: React.ReactNode
  label: string
  used: number
  total: number
  detail: string
}) {
  const { t } = useTranslation()
  const overCap = total > 0 && used >= total
  const percent = total > 0 ? Math.min(100, (used / total) * 100) : 100
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <span className="text-muted-foreground">{icon}</span>
          <span>{label}</span>
        </div>
        {overCap && <Badge variant="destructive">{t('storage.overCap')}</Badge>}
      </div>
      <div className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-2xl font-semibold tabular-nums">{formatSize(used)}</span>
          <span className="text-sm text-muted-foreground">
            {total > 0 ? t('storage.usageTotal', { total: formatSize(total) }) : t('storage.usageNoLimit')}
          </span>
        </div>
        <Progress value={percent} className="h-2" />
        <p className="text-xs text-muted-foreground">{detail}</p>
      </div>
    </div>
  )
}

function PlanEntitlementSummary({ quota }: { quota: UserQuota }) {
  const { t } = useTranslation()
  const plan = quota.currentPlan
  const rows = [
    {
      label: t('storage.baseStorageQuota'),
      value: formatQuotaPlanValue(plan?.storageBytes ?? quota.baseQuota, quota.storagePlanName),
    },
    {
      label: t('storage.includedTraffic'),
      value: formatQuotaPlanValue(plan?.trafficBytes ?? quota.baseTrafficQuota, quota.trafficPlanName),
    },
    {
      label: t('storage.cloudStorageEntitlement'),
      value: formatExtraValue(quota.entitlementQuota, quota.storageExtraNames),
    },
    {
      label: t('storage.cloudTrafficEntitlement'),
      value: formatExtraValue(quota.entitlementTrafficQuota, quota.trafficExtraNames),
    },
    {
      label: t('storage.trafficPolicy'),
      value:
        (plan?.trafficOveragePriceCents ?? 0) > 0
          ? t('storage.trafficOverageEnabled')
          : t('storage.trafficStopsAtQuota'),
    },
  ]
  return (
    <div className="space-y-4 border-t pt-5 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
      {rows.map((row) => (
        <div key={row.label} className="flex items-start justify-between gap-3">
          <div className="text-sm text-muted-foreground">{row.label}</div>
          <div className="max-w-[160px] text-right text-sm font-medium tabular-nums">{row.value}</div>
        </div>
      ))}
    </div>
  )
}

function formatQuotaPlanValue(bytes: number, planName: string | null) {
  const size = formatSize(bytes)
  return bytes > 0 && planName ? `${planName} · ${size}` : size
}

function formatExtraValue(bytes: number, names: string[]) {
  const size = formatSize(bytes)
  if (bytes <= 0 || names.length === 0) return size
  if (names.length === 1) return `${names[0]} · ${size}`
  return `${names[0]} +${names.length - 1} · ${size}`
}
