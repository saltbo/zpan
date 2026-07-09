import type { AdminCoreStats, AdminDetailedStats } from '@shared/types'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import type { LucideIcon } from 'lucide-react'
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Cloud,
  Database,
  Gauge,
  HardDrive,
  Link2,
  RefreshCw,
  ShieldCheck,
  Users,
  Workflow,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts'
import { UpgradeHint } from '@/components/UpgradeHint'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useEntitlement } from '@/hooks/useEntitlement'
import { getAdminCoreStats, getAdminDetailedStats } from '@/lib/api'
import { formatDate, formatSize } from '@/lib/format'

export const Route = createFileRoute('/_authenticated/admin/')({
  component: OverviewPage,
})

type PeriodDays = 7 | 30 | 90

const PERIODS: PeriodDays[] = [7, 30, 90]
const CHART_COLORS = ['#2563eb', '#0891b2', '#16a34a', '#f97316', '#7c3aed', '#dc2626', '#ca8a04', '#db2777']
const SKELETON_METRICS = ['users', 'active', 'spaces', 'storage', 'traffic', 'shares'] as const

export function OverviewPage() {
  const { t } = useTranslation()
  const [periodDays, setPeriodDays] = useState<PeriodDays>(30)
  const { hasFeature, isLoading: entitlementLoading } = useEntitlement()
  const hasAnalytics = hasFeature('analytics')

  const coreQuery = useQuery({
    queryKey: ['admin', 'stats', 'core'],
    queryFn: getAdminCoreStats,
    staleTime: 30_000,
  })

  const detailsQuery = useQuery({
    queryKey: ['admin', 'stats', 'details', periodDays],
    queryFn: () => getAdminDetailedStats(periodDays),
    enabled: hasAnalytics,
    staleTime: 30_000,
  })

  if (coreQuery.isLoading) return <OverviewSkeleton />

  if (coreQuery.isError || !coreQuery.data) {
    return (
      <Card className="border-destructive/40 shadow-none">
        <CardHeader>
          <CardTitle>{t('admin.overview.errorTitle')}</CardTitle>
          <CardDescription>{t('admin.overview.errorDescription')}</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const core = coreQuery.data

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-2xl font-semibold tracking-tight">{t('admin.overview.title')}</h2>
            <Badge variant={hasAnalytics ? 'default' : 'secondary'}>
              {hasAnalytics ? t('admin.overview.badge.pro') : t('admin.overview.badge.core')}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">{t('admin.overview.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <RefreshCw className="h-3.5 w-3.5" />
          <span>{t('admin.overview.generatedAt', { time: formatDate(core.generatedAt) })}</span>
        </div>
      </div>

      <CoreMetricGrid core={core} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]">
        <CapacityPostureCard core={core} />
        <OperatingMixCard core={core} />
      </div>

      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-semibold">{t('admin.overview.analyticsTitle')}</h3>
              <Badge variant="outline">{t('admin.overview.analyticsBadge')}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">{t('admin.overview.analyticsDescription')}</p>
          </div>
          {hasAnalytics && (
            <div className="flex flex-wrap gap-2">
              {PERIODS.map((period) => (
                <Button
                  key={period}
                  type="button"
                  size="sm"
                  variant={periodDays === period ? 'default' : 'outline'}
                  onClick={() => setPeriodDays(period)}
                >
                  {t(`admin.overview.period.${period}`)}
                </Button>
              ))}
            </div>
          )}
        </div>

        {entitlementLoading && <DetailedSkeleton />}
        {!entitlementLoading && !hasAnalytics && (
          <UpgradeHint
            feature="analytics"
            title={t('admin.overview.analyticsLockedTitle')}
            description={t('admin.overview.analyticsLockedDescription')}
            actionLabel={t('admin.overview.analyticsLockedAction')}
          />
        )}
        {!entitlementLoading && hasAnalytics && detailsQuery.isLoading && <DetailedSkeleton />}
        {!entitlementLoading && hasAnalytics && detailsQuery.isError && (
          <Card className="border-destructive/40 shadow-none">
            <CardHeader>
              <CardTitle>{t('admin.overview.analyticsErrorTitle')}</CardTitle>
              <CardDescription>{t('admin.overview.analyticsErrorDescription')}</CardDescription>
            </CardHeader>
          </Card>
        )}
        {!entitlementLoading && hasAnalytics && detailsQuery.data && <DetailedDashboard stats={detailsQuery.data} />}
      </section>
    </div>
  )
}

function CoreMetricGrid({ core }: { core: AdminCoreStats }) {
  const { t } = useTranslation()
  const metrics = [
    {
      title: t('admin.overview.metrics.users'),
      value: formatNumber(core.users.total),
      detail: t('admin.overview.metrics.usersDetail', {
        active: formatNumber(core.users.activeLast30Days),
        newUsers: formatNumber(core.users.newLast7Days),
        admins: formatNumber(core.users.admins),
      }),
      icon: Users,
    },
    {
      title: t('admin.overview.metrics.activeUsers'),
      value: formatNumber(core.users.activeLast30Days),
      detail: t('admin.overview.metrics.activeUsersDetail', {
        percent: formatPercentRatio(core.users.activeLast30Days, core.users.total),
      }),
      icon: Activity,
    },
    {
      title: t('admin.overview.metrics.spaces'),
      value: formatNumber(core.spaces.total),
      detail: t('admin.overview.metrics.spacesDetail', {
        team: formatNumber(core.spaces.team),
        personal: formatNumber(core.spaces.personal),
        newSpaces: formatNumber(core.spaces.newLast30Days),
      }),
      icon: Workflow,
    },
    {
      title: t('admin.overview.metrics.storage'),
      value: formatSize(core.storage.usedBytes),
      detail: t('admin.overview.metrics.storageDetail', {
        percent: formatPercent(core.storage.quotaUtilization),
        quota: formatQuota(core.storage.usedBytes, core.storage.quotaBytes),
      }),
      icon: Database,
    },
    {
      title: t('admin.overview.metrics.traffic'),
      value: formatSize(core.traffic.usedBytes),
      detail: t('admin.overview.metrics.trafficDetail', {
        usage: formatQuota(core.traffic.usedBytes, core.traffic.quotaBytes),
        period: core.traffic.period,
      }),
      icon: Cloud,
    },
    {
      title: t('admin.overview.metrics.shares'),
      value: formatNumber(core.sharing.activeShares),
      detail: t('admin.overview.metrics.sharesDetail', {
        total: formatNumber(core.sharing.totalShares),
        views: formatNumber(core.sharing.views),
      }),
      icon: Link2,
    },
  ]

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
      {metrics.map((metric) => (
        <CoreMetricCard key={metric.title} {...metric} />
      ))}
    </div>
  )
}

function CoreMetricCard({
  title,
  value,
  detail,
  icon: Icon,
}: {
  title: string
  value: string
  detail: string
  icon: LucideIcon
}) {
  return (
    <Card className="border-border/60 shadow-none">
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 p-4 pb-2">
        <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
        <p className="mt-1 line-clamp-2 min-h-8 text-xs text-muted-foreground" title={detail}>
          {detail}
        </p>
      </CardContent>
    </Card>
  )
}

function CapacityPostureCard({ core }: { core: AdminCoreStats }) {
  const { t } = useTranslation()

  return (
    <Card className="border-border/60 shadow-none">
      <CardHeader className="pb-3">
        <CardTitle>{t('admin.overview.capacityTitle')}</CardTitle>
        <CardDescription>{t('admin.overview.capacityDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5 lg:grid-cols-2">
        <CapacityMeter
          label={t('admin.overview.storageQuota')}
          value={core.storage.quotaUtilization}
          description={formatQuota(core.storage.usedBytes, core.storage.quotaBytes)}
        />
        <CapacityMeter
          label={t('admin.overview.trafficQuota')}
          value={core.traffic.utilization}
          description={formatQuota(core.traffic.usedBytes, core.traffic.quotaBytes)}
        />
        <SummaryTile
          icon={HardDrive}
          label={t('admin.overview.storageBackendHealth')}
          value={t('admin.overview.storageBackendCount', {
            active: core.storage.activeBackendCount,
            total: core.storage.backendCount,
          })}
          detail={t('admin.overview.totalStorageCapacity', { capacity: formatSize(core.storage.capacityBytes) })}
        />
        <SummaryTile
          icon={Gauge}
          label={t('admin.overview.riskSignals')}
          value={formatNumber(core.operations.failedBackgroundJobs + core.operations.offlineDownloaders)}
          detail={t('admin.overview.riskSignalsDetail', {
            failed: formatNumber(core.operations.failedBackgroundJobs),
            offline: formatNumber(core.operations.offlineDownloaders),
          })}
        />
      </CardContent>
    </Card>
  )
}

function OperatingMixCard({ core }: { core: AdminCoreStats }) {
  const { t } = useTranslation()
  const shareDownloadRate = formatPercentRatio(core.sharing.downloads, core.sharing.views)

  return (
    <Card className="border-border/60 shadow-none">
      <CardHeader className="pb-3">
        <CardTitle>{t('admin.overview.mixTitle')}</CardTitle>
        <CardDescription>{t('admin.overview.mixDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <MetricRow
          label={t('admin.overview.mix.activeUsers')}
          value={formatPercentRatio(core.users.activeLast30Days, core.users.total)}
          detail={t('admin.overview.mix.activeUsersDetail', {
            active: formatNumber(core.users.activeLast30Days),
            total: formatNumber(core.users.total),
          })}
          percent={percentage(core.users.activeLast30Days, core.users.total)}
        />
        <MetricRow
          label={t('admin.overview.mix.teamSpaces')}
          value={formatPercentRatio(core.spaces.team, core.spaces.total)}
          detail={t('admin.overview.mix.teamSpacesDetail', {
            team: formatNumber(core.spaces.team),
            total: formatNumber(core.spaces.total),
          })}
          percent={percentage(core.spaces.team, core.spaces.total)}
        />
        <MetricRow
          label={t('admin.overview.mix.activeShares')}
          value={formatPercentRatio(core.sharing.activeShares, core.sharing.totalShares)}
          detail={t('admin.overview.mix.activeSharesDetail', {
            active: formatNumber(core.sharing.activeShares),
            total: formatNumber(core.sharing.totalShares),
          })}
          percent={percentage(core.sharing.activeShares, core.sharing.totalShares)}
        />
        <MetricRow
          label={t('admin.overview.mix.shareDownloads')}
          value={shareDownloadRate}
          detail={t('admin.overview.mix.shareDownloadsDetail', {
            downloads: formatNumber(core.sharing.downloads),
            views: formatNumber(core.sharing.views),
          })}
          percent={percentage(core.sharing.downloads, core.sharing.views)}
        />
      </CardContent>
    </Card>
  )
}

function DetailedDashboard({ stats }: { stats: AdminDetailedStats }) {
  return (
    <div className="flex flex-col gap-4">
      <PeriodSummaryGrid stats={stats} />
      <ActivityTrendCard stats={stats} />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <StorageByTypeCard stats={stats} />
        <UsageBySpaceCard stats={stats} />
      </div>
      <div className="grid gap-4 xl:grid-cols-[420px_minmax(0,1fr)]">
        <SharePerformanceCard stats={stats} />
        <TopSharesCard stats={stats} />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <RemoteDownloadsCard stats={stats} />
        <ReliabilityCard stats={stats} />
      </div>
    </div>
  )
}

function PeriodSummaryGrid({ stats }: { stats: AdminDetailedStats }) {
  const { t } = useTranslation()
  const totals = summarizeTrends(stats)
  const topSpacePressure = stats.usageBySpace.reduce((max, space) => Math.max(max, space.utilization), 0)
  const cards = [
    {
      label: t('admin.overview.periodKpi.signups'),
      value: formatNumber(totals.signups),
      detail: t('admin.overview.periodKpi.periodDays', { days: stats.periodDays }),
    },
    {
      label: t('admin.overview.periodKpi.shareViews'),
      value: formatNumber(totals.shareViews),
      detail: t('admin.overview.periodKpi.shareDownloads', { downloads: formatNumber(totals.shareDownloads) }),
    },
    {
      label: t('admin.overview.periodKpi.conversion'),
      value: formatPercent(stats.sharing.conversionRate),
      detail: t('admin.overview.periodKpi.conversionDetail'),
    },
    {
      label: t('admin.overview.periodKpi.remoteSuccess'),
      value: formatPercent(stats.remoteDownloads.successRate),
      detail: t('admin.overview.remoteCompleted', {
        completed: formatNumber(stats.remoteDownloads.completed),
        total: formatNumber(stats.remoteDownloads.total),
      }),
    },
    {
      label: t('admin.overview.periodKpi.jobFailures'),
      value: formatNumber(stats.reliability.backgroundJobs.failed),
      detail: t('admin.overview.jobFailures', {
        failed: formatNumber(stats.reliability.backgroundJobs.failed),
        total: formatNumber(stats.reliability.backgroundJobs.total),
      }),
    },
    {
      label: t('admin.overview.periodKpi.topSpacePressure'),
      value: formatPercent(topSpacePressure),
      detail: t('admin.overview.periodKpi.topSpacePressureDetail'),
    },
  ]

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
      {cards.map((card) => (
        <AnalyticsKpiCard key={card.label} {...card} />
      ))}
    </div>
  )
}

function AnalyticsKpiCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-md border bg-card px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
      <p className="mt-1 truncate text-xs text-muted-foreground" title={detail}>
        {detail}
      </p>
    </div>
  )
}

function ActivityTrendCard({ stats }: { stats: AdminDetailedStats }) {
  const { t } = useTranslation()
  const hasData = stats.trends.some(
    (point) =>
      point.signups > 0 ||
      point.activeUsers > 0 ||
      point.shareViews > 0 ||
      point.shareDownloads > 0 ||
      point.remoteTasks > 0 ||
      point.failedJobs > 0,
  )
  const data = stats.trends.map((point) => ({ ...point, label: formatChartDate(point.date) }))

  return (
    <Card className="border-border/60 shadow-none">
      <CardHeader className="pb-3">
        <CardTitle>{t('admin.overview.charts.activityTitle')}</CardTitle>
        <CardDescription>{t('admin.overview.charts.activityDescription')}</CardDescription>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <EmptyState label={t('admin.overview.emptyChart')} />
        ) : (
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} minTickGap={18} />
                <YAxis tickFormatter={formatCompactNumber} tickLine={false} axisLine={false} width={42} fontSize={12} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                <RechartsTooltip formatter={formatTooltipValue} labelFormatter={(label) => String(label)} />
                <Area
                  type="monotone"
                  dataKey="activeUsers"
                  name={t('admin.overview.charts.activeUsers')}
                  stroke={CHART_COLORS[0]}
                  fill={CHART_COLORS[0]}
                  fillOpacity={0.1}
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="signups"
                  name={t('admin.overview.charts.signups')}
                  stroke={CHART_COLORS[1]}
                  fill={CHART_COLORS[1]}
                  fillOpacity={0.08}
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="shareViews"
                  name={t('admin.overview.charts.shareViews')}
                  stroke={CHART_COLORS[2]}
                  fill={CHART_COLORS[2]}
                  fillOpacity={0.08}
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="shareDownloads"
                  name={t('admin.overview.charts.shareDownloads')}
                  stroke={CHART_COLORS[3]}
                  fill={CHART_COLORS[3]}
                  fillOpacity={0.08}
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="remoteTasks"
                  name={t('admin.overview.charts.remoteTasks')}
                  stroke={CHART_COLORS[4]}
                  fill={CHART_COLORS[4]}
                  fillOpacity={0.08}
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="failedJobs"
                  name={t('admin.overview.charts.failedJobs')}
                  stroke={CHART_COLORS[5]}
                  fill={CHART_COLORS[5]}
                  fillOpacity={0.08}
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function StorageByTypeCard({ stats }: { stats: AdminDetailedStats }) {
  const { t } = useTranslation()
  const data = stats.storageByType.map((item) => ({ ...item, label: formatStorageType(item.type) }))

  return (
    <Card className="border-border/60 shadow-none">
      <CardHeader className="pb-3">
        <CardTitle>{t('admin.overview.charts.storageByTypeTitle')}</CardTitle>
        <CardDescription>{t('admin.overview.charts.storageByTypeDescription')}</CardDescription>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <EmptyState label={t('admin.overview.emptyChart')} />
        ) : (
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis
                  type="number"
                  tickFormatter={formatCompactSize}
                  tickLine={false}
                  axisLine={false}
                  fontSize={12}
                />
                <YAxis type="category" dataKey="label" width={104} tickLine={false} axisLine={false} fontSize={12} />
                <RechartsTooltip formatter={(value) => formatSize(Number(value))} />
                <Bar dataKey="bytes" name={t('admin.overview.table.bytes')} radius={[0, 4, 4, 0]}>
                  {data.map((item, index) => (
                    <Cell key={item.type} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function UsageBySpaceCard({ stats }: { stats: AdminDetailedStats }) {
  const { t } = useTranslation()

  return (
    <Card className="border-border/60 shadow-none">
      <CardHeader className="pb-3">
        <CardTitle>{t('admin.overview.usageBySpaceTitle')}</CardTitle>
        <CardDescription>{t('admin.overview.usageBySpaceDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {stats.usageBySpace.length === 0 ? (
          <EmptyState label={t('admin.overview.emptyTable')} />
        ) : (
          stats.usageBySpace.map((space) => (
            <div key={space.orgId} className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium">{space.orgName}</p>
                  <p className="text-xs text-muted-foreground">{space.orgType}</p>
                </div>
                <span className="shrink-0 font-medium tabular-nums">{formatPercent(space.utilization)}</span>
              </div>
              <Progress value={clampPercent(space.utilization)} />
              <p className="text-xs text-muted-foreground">{formatQuota(space.usedBytes, space.quotaBytes)}</p>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  )
}

function SharePerformanceCard({ stats }: { stats: AdminDetailedStats }) {
  const { t } = useTranslation()

  return (
    <Card className="border-border/60 shadow-none">
      <CardHeader className="pb-3">
        <CardTitle>{t('admin.overview.sharePerformanceTitle')}</CardTitle>
        <CardDescription>{t('admin.overview.sharePerformanceDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <SummaryTile
          icon={Gauge}
          label={t('admin.overview.conversionRate')}
          value={formatPercent(stats.sharing.conversionRate)}
          detail={t('admin.overview.conversionRateDetail')}
        />
        <SummaryTile
          icon={AlertTriangle}
          label={t('admin.overview.expiredShares')}
          value={formatNumber(stats.sharing.expiredShares)}
          detail={t('admin.overview.revokedShares', { count: formatNumber(stats.sharing.revokedShares) })}
        />
        <SummaryTile
          icon={ShieldCheck}
          label={t('admin.overview.downloadLimitHitShares')}
          value={formatNumber(stats.sharing.downloadLimitHitShares)}
          detail={t('admin.overview.downloadLimitHitSharesDetail')}
        />
      </CardContent>
    </Card>
  )
}

function TopSharesCard({ stats }: { stats: AdminDetailedStats }) {
  const { t } = useTranslation()

  return (
    <Card className="border-border/60 shadow-none">
      <CardHeader className="pb-3">
        <CardTitle>{t('admin.overview.topSharesTitle')}</CardTitle>
        <CardDescription>{t('admin.overview.topSharesDescription')}</CardDescription>
      </CardHeader>
      <CardContent>
        {stats.topShares.length === 0 ? (
          <EmptyState label={t('admin.overview.emptyTable')} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('admin.overview.table.share')}</TableHead>
                <TableHead>{t('admin.overview.table.creator')}</TableHead>
                <TableHead className="text-right">{t('admin.overview.table.views')}</TableHead>
                <TableHead className="text-right">{t('admin.overview.table.downloads')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stats.topShares.map((share) => (
                <TableRow key={share.id}>
                  <TableCell className="max-w-56 truncate font-medium" title={share.name}>
                    {share.name}
                  </TableCell>
                  <TableCell className="max-w-40 truncate text-muted-foreground" title={share.creatorName}>
                    {share.creatorName}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(share.views)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(share.downloads)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

function RemoteDownloadsCard({ stats }: { stats: AdminDetailedStats }) {
  const { t } = useTranslation()

  return (
    <Card className="border-border/60 shadow-none">
      <CardHeader className="pb-3">
        <CardTitle>{t('admin.overview.remoteDownloadsTitle')}</CardTitle>
        <CardDescription>{t('admin.overview.remoteDownloadsDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-3">
          <SummaryTile
            icon={CheckCircle2}
            label={t('admin.overview.remoteSuccess')}
            value={formatPercent(stats.remoteDownloads.successRate)}
            detail={t('admin.overview.remoteCompleted', {
              completed: formatNumber(stats.remoteDownloads.completed),
              total: formatNumber(stats.remoteDownloads.total),
            })}
          />
          <SummaryTile
            icon={Activity}
            label={t('admin.overview.remoteRunning')}
            value={formatNumber(stats.remoteDownloads.running)}
            detail={t('admin.overview.remoteFailed', { failed: formatNumber(stats.remoteDownloads.failed) })}
          />
        </div>
        <StatusList title={t('admin.overview.statusBreakdown')} items={stats.remoteDownloads.byStatus} />
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">{t('admin.overview.failureReasons')}</p>
          {stats.remoteDownloads.failureReasons.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('admin.overview.noFailures')}</p>
          ) : (
            stats.remoteDownloads.failureReasons.map((item) => (
              <div
                key={item.reason}
                className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm"
              >
                <span className="truncate">{item.reason}</span>
                <span className="font-medium tabular-nums">{formatNumber(item.count)}</span>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function ReliabilityCard({ stats }: { stats: AdminDetailedStats }) {
  const { t } = useTranslation()
  const license = stats.reliability.license

  return (
    <Card className="border-border/60 shadow-none">
      <CardHeader className="pb-3">
        <CardTitle>{t('admin.overview.reliabilityTitle')}</CardTitle>
        <CardDescription>{t('admin.overview.reliabilityDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-3">
          <SummaryTile
            icon={AlertTriangle}
            label={t('admin.overview.jobFailureRate')}
            value={formatPercent(stats.reliability.backgroundJobs.failureRate)}
            detail={t('admin.overview.jobFailures', {
              failed: formatNumber(stats.reliability.backgroundJobs.failed),
              total: formatNumber(stats.reliability.backgroundJobs.total),
            })}
          />
          <SummaryTile
            icon={ShieldCheck}
            label={t('admin.overview.licenseStatus')}
            value={license.active ? t('admin.overview.licenseActive') : t('admin.overview.licenseInactive')}
            detail={license.edition ?? t('admin.overview.licenseNone')}
          />
        </div>
        <StatusList title={t('admin.overview.jobStatusBreakdown')} items={stats.reliability.backgroundJobs.byStatus} />
        <div className="grid gap-3 md:grid-cols-2">
          <SummaryTile
            icon={Cloud}
            label={t('admin.overview.cloudReportPending')}
            value={formatNumber(stats.reliability.cloudTrafficReports.pending)}
            detail={t('admin.overview.cloudReportPendingDetail')}
          />
          <SummaryTile
            icon={AlertTriangle}
            label={t('admin.overview.cloudReportFailed')}
            value={formatNumber(stats.reliability.cloudTrafficReports.failed)}
            detail={t('admin.overview.cloudReportFailedDetail')}
          />
        </div>
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">{t('admin.overview.recentJobFailures')}</p>
          {stats.reliability.backgroundJobs.failures.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('admin.overview.noFailures')}</p>
          ) : (
            stats.reliability.backgroundJobs.failures.map((job) => (
              <div key={job.id} className="rounded-md border px-3 py-2 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate font-medium">{job.type}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{formatDate(job.createdAt)}</span>
                </div>
                <p className="mt-1 truncate text-xs text-muted-foreground" title={job.errorMessage ?? undefined}>
                  {job.errorMessage ?? t('admin.overview.noErrorMessage')}
                </p>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function MetricRow({
  label,
  value,
  detail,
  percent,
}: {
  label: string
  value: string
  detail: string
  percent: number
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3 text-sm">
        <div className="min-w-0">
          <p className="font-medium">{label}</p>
          <p className="truncate text-xs text-muted-foreground" title={detail}>
            {detail}
          </p>
        </div>
        <span className="shrink-0 font-semibold tabular-nums">{value}</span>
      </div>
      <Progress value={clampPercent(percent)} />
    </div>
  )
}

function StatusList({ title, items }: { title: string; items: Array<{ status: string; count: number }> }) {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium">{title}</p>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('admin.overview.emptyTable')}</p>
      ) : (
        items.map((item) => (
          <div
            key={item.status}
            className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm"
          >
            <Badge variant="outline">{item.status}</Badge>
            <span className="font-medium tabular-nums">{formatNumber(item.count)}</span>
          </div>
        ))
      )}
    </div>
  )
}

function CapacityMeter({ label, value, description }: { label: string; value: number; description: string }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-medium">{label}</span>
        <span className="shrink-0 font-semibold tabular-nums">{formatPercent(value)}</span>
      </div>
      <Progress value={clampPercent(value)} />
      <p className="truncate text-xs text-muted-foreground" title={description}>
        {description}
      </p>
    </div>
  )
}

function SummaryTile({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: LucideIcon
  label: string
  value: string
  detail: string
}) {
  return (
    <div className="rounded-md border bg-muted/20 px-3 py-3">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        <span className="truncate">{label}</span>
      </div>
      <p className="mt-2 text-xl font-semibold tabular-nums">{value}</p>
      <p className="mt-1 truncate text-xs text-muted-foreground" title={detail}>
        {detail}
      </p>
    </div>
  )
}

function OverviewSkeleton() {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        {SKELETON_METRICS.map((metric) => (
          <Skeleton key={metric} className="h-32" />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]">
        <Skeleton className="h-72" />
        <Skeleton className="h-72" />
      </div>
    </div>
  )
}

function DetailedSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        {SKELETON_METRICS.map((metric) => (
          <Skeleton key={metric} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-80" />
      <div className="grid gap-4 xl:grid-cols-2">
        <Skeleton className="h-80" />
        <Skeleton className="h-80" />
      </div>
    </div>
  )
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="rounded-md border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">{label}</div>
  )
}

function summarizeTrends(stats: AdminDetailedStats) {
  return stats.trends.reduce(
    (totals, point) => ({
      signups: totals.signups + point.signups,
      shareViews: totals.shareViews + point.shareViews,
      shareDownloads: totals.shareDownloads + point.shareDownloads,
      remoteTasks: totals.remoteTasks + point.remoteTasks,
      failedJobs: totals.failedJobs + point.failedJobs,
    }),
    { signups: 0, shareViews: 0, shareDownloads: 0, remoteTasks: 0, failedJobs: 0 },
  )
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value)
}

function formatPercent(value: number): string {
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value)}%`
}

function formatPercentRatio(numerator: number, denominator: number): string {
  return formatPercent(percentage(numerator, denominator))
}

function percentage(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return 0
  return (numerator / denominator) * 100
}

function formatQuota(used: number, total: number): string {
  if (total <= 0) return formatSize(used)
  return `${formatSize(used)} / ${formatSize(total)}`
}

function formatChartDate(value: string): string {
  const date = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function formatStorageType(value: string): string {
  if (!value) return 'unknown'
  if (!value.includes('/')) return value
  return value.split('/').at(-1) || value
}

function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

function formatCompactSize(value: number): string {
  if (value < 1024) return formatNumber(value)
  return formatSize(value)
}

function formatTooltipValue(value: unknown, name: unknown) {
  return [formatNumber(Number(value ?? 0)), String(name)]
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, value))
}
