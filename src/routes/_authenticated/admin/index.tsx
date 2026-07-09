import type { AdminCoreStats, AdminDetailedStats } from '@shared/types'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import type { LucideIcon } from 'lucide-react'
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Cloud,
  Database,
  Gauge,
  HardDrive,
  Link2,
  MailPlus,
  RefreshCw,
  Settings,
  ShieldCheck,
  UserPlus,
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
type AdminHref = '/admin/users' | '/admin/storages' | '/admin/settings' | '/admin/downloaders' | '/admin/licensing'

const PERIODS: PeriodDays[] = [7, 30, 90]
const CHART_COLORS = ['#2563eb', '#16a34a', '#f97316', '#7c3aed', '#0891b2', '#dc2626', '#ca8a04', '#db2777']
const SKELETON_METRICS = ['users', 'spaces', 'storage', 'traffic', 'shares', 'operations'] as const

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
      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle>{t('admin.overview.errorTitle')}</CardTitle>
          <CardDescription>{t('admin.overview.errorDescription')}</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const core = coreQuery.data
  const alerts = buildAlerts(core, t)

  return (
    <div className="flex flex-col gap-6">
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

      <CoreDashboard core={core} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="border-border/60">
          <CardHeader>
            <CardTitle>{t('admin.overview.coreCapacityTitle')}</CardTitle>
            <CardDescription>{t('admin.overview.coreCapacityDescription')}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5 lg:grid-cols-2">
            <UsageBar
              label={t('admin.overview.storageQuota')}
              value={core.storage.quotaUtilization}
              description={formatQuota(core.storage.usedBytes, core.storage.quotaBytes)}
            />
            <UsageBar
              label={t('admin.overview.trafficQuota')}
              value={core.traffic.utilization}
              description={formatQuota(core.traffic.usedBytes, core.traffic.quotaBytes)}
            />
            <SummaryTile
              icon={HardDrive}
              label={t('admin.overview.storageCapacity')}
              value={formatSize(core.storage.capacityBytes)}
              detail={t('admin.overview.storageBackendCount', {
                active: core.storage.activeBackendCount,
                total: core.storage.backendCount,
              })}
            />
            <SummaryTile
              icon={Link2}
              label={t('admin.overview.shareActivity')}
              value={formatNumber(core.sharing.views)}
              detail={t('admin.overview.shareActivityDetail', { downloads: formatNumber(core.sharing.downloads) })}
            />
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          <Card className="border-border/60">
            <CardHeader>
              <CardTitle>{t('admin.overview.pendingTitle')}</CardTitle>
              <CardDescription>{t('admin.overview.pendingDescription')}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {alerts.length === 0 && (
                <div className="rounded-md border border-dashed px-4 py-6 text-sm text-muted-foreground">
                  {t('admin.overview.noPendingWork')}
                </div>
              )}
              {alerts.map((alert) => (
                <PendingItem key={alert.title} {...alert} />
              ))}
            </CardContent>
          </Card>

          <Card className="border-border/60">
            <CardHeader>
              <CardTitle>{t('admin.overview.actionsTitle')}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2">
              <ActionLink href="/admin/users" icon={UserPlus} label={t('admin.overview.actions.manageUsers')} />
              <ActionLink href="/admin/storages" icon={Database} label={t('admin.overview.actions.configureStorage')} />
              <ActionLink href="/admin/downloaders" icon={Cloud} label={t('admin.overview.actions.downloaders')} />
              <ActionLink href="/admin/settings" icon={Settings} label={t('admin.overview.actions.siteSettings')} />
            </CardContent>
          </Card>
        </div>
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
          <Card className="border-destructive/40">
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

function CoreDashboard({ core }: { core: AdminCoreStats }) {
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
      color: 'text-blue-600',
      background: 'bg-blue-500/10',
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
      color: 'text-emerald-600',
      background: 'bg-emerald-500/10',
    },
    {
      title: t('admin.overview.metrics.storage'),
      value: formatPercent(core.storage.quotaUtilization),
      detail: formatQuota(core.storage.usedBytes, core.storage.quotaBytes),
      icon: Database,
      color: 'text-orange-600',
      background: 'bg-orange-500/10',
    },
    {
      title: t('admin.overview.metrics.traffic'),
      value: formatPercent(core.traffic.utilization),
      detail: t('admin.overview.metrics.trafficDetail', {
        usage: formatQuota(core.traffic.usedBytes, core.traffic.quotaBytes),
        period: core.traffic.period,
      }),
      icon: Gauge,
      color: 'text-violet-600',
      background: 'bg-violet-500/10',
    },
    {
      title: t('admin.overview.metrics.shares'),
      value: formatNumber(core.sharing.activeShares),
      detail: t('admin.overview.metrics.sharesDetail', {
        total: formatNumber(core.sharing.totalShares),
        views: formatNumber(core.sharing.views),
      }),
      icon: Link2,
      color: 'text-cyan-600',
      background: 'bg-cyan-500/10',
    },
    {
      title: t('admin.overview.metrics.operations'),
      value: formatNumber(core.operations.failedBackgroundJobs + core.operations.offlineDownloaders),
      detail: t('admin.overview.metrics.operationsDetail', {
        running: formatNumber(core.operations.runningDownloadTasks),
        invites: formatNumber(core.operations.pendingInvitations),
      }),
      icon: AlertTriangle,
      color: 'text-rose-600',
      background: 'bg-rose-500/10',
    },
  ]

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
      {metrics.map((metric) => (
        <Card key={metric.title} className="border-border/60">
          <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{metric.title}</CardTitle>
            <div className={`rounded-md p-2 ${metric.background} ${metric.color}`}>
              <metric.icon className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold tabular-nums">{metric.value}</div>
            <p className="mt-1 line-clamp-2 min-h-8 text-xs text-muted-foreground" title={String(metric.detail)}>
              {metric.detail}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

function DetailedDashboard({ stats }: { stats: AdminDetailedStats }) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <ActivityTrendCard stats={stats} />
      <StorageByTypeCard stats={stats} />
      <UsageBySpaceCard stats={stats} />
      <RemoteDownloadsCard stats={stats} />
      <TopSharesCard stats={stats} />
      <ReliabilityCard stats={stats} />
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

  return (
    <Card className="border-border/60 xl:col-span-2">
      <CardHeader>
        <CardTitle>{t('admin.overview.charts.activityTitle')}</CardTitle>
        <CardDescription>{t('admin.overview.charts.activityDescription')}</CardDescription>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <EmptyState label={t('admin.overview.emptyChart')} />
        ) : (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={stats.trends.map((point) => ({ ...point, label: formatChartDate(point.date) }))}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} minTickGap={18} />
                <YAxis tickFormatter={formatCompactNumber} tickLine={false} axisLine={false} width={40} fontSize={12} />
                <RechartsTooltip formatter={formatTooltipValue} labelFormatter={(label) => String(label)} />
                <Area
                  type="monotone"
                  dataKey="activeUsers"
                  name={t('admin.overview.charts.activeUsers')}
                  stroke={CHART_COLORS[0]}
                  fill={CHART_COLORS[0]}
                  fillOpacity={0.12}
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="shareViews"
                  name={t('admin.overview.charts.shareViews')}
                  stroke={CHART_COLORS[1]}
                  fill={CHART_COLORS[1]}
                  fillOpacity={0.1}
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="remoteTasks"
                  name={t('admin.overview.charts.remoteTasks')}
                  stroke={CHART_COLORS[2]}
                  fill={CHART_COLORS[2]}
                  fillOpacity={0.1}
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="failedJobs"
                  name={t('admin.overview.charts.failedJobs')}
                  stroke={CHART_COLORS[5]}
                  fill={CHART_COLORS[5]}
                  fillOpacity={0.1}
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
    <Card className="border-border/60">
      <CardHeader>
        <CardTitle>{t('admin.overview.charts.storageByTypeTitle')}</CardTitle>
        <CardDescription>{t('admin.overview.charts.storageByTypeDescription')}</CardDescription>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <EmptyState label={t('admin.overview.emptyChart')} />
        ) : (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} layout="vertical" margin={{ left: 12, right: 12 }}>
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
                <Bar dataKey="bytes" radius={[0, 4, 4, 0]}>
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
    <Card className="border-border/60">
      <CardHeader>
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

function RemoteDownloadsCard({ stats }: { stats: AdminDetailedStats }) {
  const { t } = useTranslation()

  return (
    <Card className="border-border/60">
      <CardHeader>
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

function TopSharesCard({ stats }: { stats: AdminDetailedStats }) {
  const { t } = useTranslation()

  return (
    <Card className="border-border/60">
      <CardHeader>
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
                  <TableCell className="max-w-44 truncate font-medium" title={share.name}>
                    {share.name}
                  </TableCell>
                  <TableCell className="max-w-32 truncate text-muted-foreground" title={share.creatorName}>
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

function ReliabilityCard({ stats }: { stats: AdminDetailedStats }) {
  const { t } = useTranslation()
  const license = stats.reliability.license

  return (
    <Card className="border-border/60">
      <CardHeader>
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
            icon={MailPlus}
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

function UsageBar({ label, value, description }: { label: string; value: number; description: string }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-medium">{label}</span>
        <span className="truncate text-muted-foreground" title={description}>
          {description}
        </span>
      </div>
      <Progress value={clampPercent(value)} />
      <p className="text-xs text-muted-foreground">{formatPercent(value)}</p>
    </div>
  )
}

function PendingItem({ title, description, href }: { title: string; description: string; href: AdminHref }) {
  return (
    <Link to={href} className="flex items-start gap-3 rounded-md border px-4 py-3 transition-colors hover:bg-muted/40">
      <div className="rounded-md bg-amber-500/10 p-2 text-amber-600">
        <AlertTriangle className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
      <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
    </Link>
  )
}

function ActionLink({ href, icon: Icon, label }: { href: AdminHref; icon: LucideIcon; label: string }) {
  return (
    <Button variant="outline" className="justify-start" asChild>
      <Link to={href}>
        <Icon className="mr-2 h-4 w-4" />
        {label}
        <ArrowRight className="ml-auto h-4 w-4 text-muted-foreground" />
      </Link>
    </Button>
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
    <div className="rounded-md border bg-card px-3 py-3">
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
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        {SKELETON_METRICS.map((metric) => (
          <Skeleton key={metric} className="h-32" />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Skeleton className="h-80" />
        <Skeleton className="h-80" />
      </div>
    </div>
  )
}

function DetailedSkeleton() {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Skeleton className="h-80 xl:col-span-2" />
      <Skeleton className="h-80" />
      <Skeleton className="h-80" />
    </div>
  )
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="rounded-md border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">{label}</div>
  )
}

function buildAlerts(core: AdminCoreStats, t: ReturnType<typeof useTranslation>['t']) {
  const alerts: Array<{ title: string; description: string; href: AdminHref }> = []

  if (core.storage.backendCount === 0) {
    alerts.push({
      title: t('admin.overview.pending.storageTitle'),
      description: t('admin.overview.pending.storageDescription'),
      href: '/admin/storages',
    })
  }
  if (core.storage.quotaBytes > 0 && core.storage.quotaUtilization >= 80) {
    alerts.push({
      title: t('admin.overview.pending.quotaTitle'),
      description: t('admin.overview.pending.quotaDescription', {
        percent: formatPercent(core.storage.quotaUtilization),
      }),
      href: '/admin/users',
    })
  }
  if (core.traffic.quotaBytes > 0 && core.traffic.utilization >= 80) {
    alerts.push({
      title: t('admin.overview.pending.trafficTitle'),
      description: t('admin.overview.pending.trafficDescription', { percent: formatPercent(core.traffic.utilization) }),
      href: '/admin/users',
    })
  }
  if (core.operations.pendingInvitations > 0) {
    alerts.push({
      title: t('admin.overview.pending.invitesTitle', { count: core.operations.pendingInvitations }),
      description: t('admin.overview.pending.invitesDescription'),
      href: '/admin/users',
    })
  }
  if (core.operations.offlineDownloaders > 0) {
    alerts.push({
      title: t('admin.overview.pending.downloadersTitle', { count: core.operations.offlineDownloaders }),
      description: t('admin.overview.pending.downloadersDescription'),
      href: '/admin/downloaders',
    })
  }
  if (core.operations.failedBackgroundJobs > 0) {
    alerts.push({
      title: t('admin.overview.pending.jobsTitle', { count: core.operations.failedBackgroundJobs }),
      description: t('admin.overview.pending.jobsDescription'),
      href: '/admin/settings',
    })
  }

  return alerts
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value)
}

function formatPercent(value: number): string {
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value)}%`
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
