import { Activity, HardDrive } from 'lucide-react'
import type * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import type { UserQuota } from '@/lib/api'
import { formatSize } from '@/lib/format'

export function CurrentPlanCard({
  quota,
  onManagePlan,
  isManagingPlan,
}: {
  quota: UserQuota
  creditsBalance?: number
  onManagePlan: () => void
  isManagingPlan: boolean
}) {
  const { t } = useTranslation()
  const plan = quota.currentPlan
  const title = plan?.name ?? quota.storagePlanName ?? quota.trafficPlanName ?? t('storage.currentPlan')

  return (
    <div className="rounded-lg border border-border/60 bg-card p-5 shadow-sm">
      <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        <div className="min-w-0 border-b pb-5 lg:border-b-0 lg:border-r lg:pb-0 lg:pr-5">
          <div className="text-xs font-medium uppercase text-muted-foreground">{t('storage.currentPlan')}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <div className="min-w-0 truncate text-xl font-semibold">{title}</div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge>{t('storage.planActive')}</Badge>
              {plan?.expiresAt && <Badge variant="outline">{new Date(plan.expiresAt).toLocaleDateString()}</Badge>}
            </div>
          </div>
          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{t('storage.currentPlanDescription')}</p>
          <Button className="mt-3 h-8" size="sm" variant="outline" disabled={isManagingPlan} onClick={onManagePlan}>
            {t('storage.managePlan')}
          </Button>
        </div>
        <PlanUsageOverview quota={quota} />
      </div>
    </div>
  )
}

export function FreeQuotaCard({ quota }: { quota?: UserQuota; creditsBalance?: number }) {
  const { t } = useTranslation()
  return (
    <div className="rounded-lg border border-border/60 bg-card p-5 shadow-sm">
      <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        <div className="min-w-0 border-b pb-5 lg:border-b-0 lg:border-r lg:pb-0 lg:pr-5">
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
          <PlanUsageOverview quota={quota} />
        ) : (
          <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
        )}
      </div>
    </div>
  )
}

function PlanUsageOverview({ quota }: { quota: UserQuota }) {
  const { t } = useTranslation()
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <UsageMeter
        icon={<HardDrive className="h-4 w-4" />}
        label={t('storage.storageUsage')}
        used={quota.used}
        total={quota.quota}
        detail={t('storage.storageUsageDetail', { used: formatSize(quota.used) })}
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
  const percent = total > 0 ? Math.min(100, (used / total) * 100) : 100
  return (
    <div className="min-w-0 rounded-md bg-muted/20 p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
          <span className="text-muted-foreground">{icon}</span>
          <span>{label}</span>
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {total > 0 ? t('storage.usageTotal', { total: formatSize(total) }) : t('storage.usageNoLimit')}
        </span>
      </div>
      <div className="mt-3 space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-2xl font-semibold tabular-nums">{formatSize(used)}</span>
        </div>
        <Progress value={percent} className="h-2" />
        <p className="text-xs text-muted-foreground">{detail}</p>
      </div>
    </div>
  )
}
