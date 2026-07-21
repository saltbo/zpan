import type { AdminOverview, AdminOverviewDownloader, AdminOverviewStorage } from '@shared/types'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Activity, CircleAlert, Database, Download, HardDrive, RefreshCw, Upload, UserPlus, Users } from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts'
import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { getAdminOverview } from '@/lib/api'
import { formatSize } from '@/lib/format'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/_authenticated/admin/dashboard')({
  component: AdminOverviewPage,
})

const QUERY_KEY = ['admin', 'overview'] as const
const CHART_COLORS = {
  primary: 'var(--color-chart-1)',
  teal: 'var(--color-chart-2)',
  violet: 'var(--color-chart-3)',
  muted: 'var(--color-chart-muted)',
}
const ACTIVITY_COLORS = [CHART_COLORS.primary, CHART_COLORS.teal, CHART_COLORS.violet, CHART_COLORS.muted]
const TREND_CHART_INITIAL_SIZE = { width: 720, height: 288 }
const DONUT_CHART_INITIAL_SIZE = { width: 280, height: 208 }
const tooltipContentStyle: CSSProperties = {
  border: '1px solid var(--color-border)',
  borderRadius: 10,
  background: 'var(--color-popover)',
  boxShadow: '0 18px 42px -30px rgba(15, 23, 42, 0.65)',
  color: 'var(--color-popover-foreground)',
}

export function AdminOverviewPage() {
  const { t } = useTranslation()
  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: getAdminOverview,
    refetchInterval: 15_000,
  })

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-5">
      <AdminPageHeader
        title={t('admin.overview.title')}
        description={t('admin.overview.subtitle')}
        actions={
          <div className="flex items-center gap-2">
            {query.data && (
              <span className="hidden items-center gap-2 text-xs tabular-nums text-muted-foreground sm:flex">
                <span className="size-2 rounded-full bg-emerald-500" aria-hidden="true" />
                {t('admin.overview.updatedAt', { time: formatClock(query.data.observedAt) })}
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              className="h-11 sm:h-8"
              onClick={() => query.refetch()}
              disabled={query.isFetching}
            >
              <RefreshCw data-icon="inline-start" className={cn(query.isFetching && 'animate-spin')} />
              {t('admin.overview.refresh')}
            </Button>
          </div>
        }
      />

      {query.isLoading ? (
        <OverviewSkeleton />
      ) : query.isError || !query.data ? (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>{t('admin.overview.errorTitle')}</AlertTitle>
          <AlertDescription>
            <p>{t('admin.overview.errorDescription')}</p>
            <Button variant="outline" size="sm" className="h-11 sm:h-8" onClick={() => query.refetch()}>
              {t('admin.overview.retry')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        <OverviewContent overview={query.data} />
      )}
    </div>
  )
}

function OverviewContent({ overview }: { overview: AdminOverview }) {
  const { t } = useTranslation()
  const storagePercent = percent(overview.storages.used, overview.storages.capacity)
  const activeRate = percent(overview.users.active30Days, overview.users.total)

  return (
    <div className="flex flex-col gap-4">
      <section aria-label={t('admin.overview.summary.title')} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <MetricCard
          icon={<Users />}
          label={t('admin.overview.metrics.totalUsers')}
          value={formatCount(overview.users.total)}
          detail={t('admin.overview.metrics.totalUsersDetail')}
        />
        <MetricCard
          icon={<Activity />}
          label={t('admin.overview.metrics.active30Days')}
          value={formatCount(overview.users.active30Days)}
          detail={t('admin.overview.metrics.activeRate', { value: formatPercent(activeRate) })}
        />
        <MetricCard
          icon={<UserPlus />}
          label={t('admin.overview.metrics.new7Days')}
          value={formatCount(overview.users.new7Days)}
          detail={t('admin.overview.metrics.new7DaysDetail')}
        />
        <MetricCard
          icon={<Database />}
          label={t('admin.overview.metrics.storageCapacity')}
          value={overview.storages.capacity > 0 ? formatSize(overview.storages.capacity) : '—'}
          detail={t('admin.overview.metrics.storageBackends', { value: overview.storages.total })}
        />
        <MetricCard
          icon={<HardDrive />}
          label={t('admin.overview.metrics.storageUsed')}
          value={formatSize(overview.storages.used)}
          detail={t('admin.overview.metrics.storageUsage', { value: formatPercent(storagePercent) })}
        />
      </section>

      <section aria-label={t('admin.overview.users.section')} className="grid items-stretch gap-4 xl:grid-cols-12">
        <UserTrendCard overview={overview} />
        <UserActivityCard overview={overview} />
      </section>

      <section aria-label={t('admin.overview.storage.section')} className="grid items-stretch gap-4 xl:grid-cols-12">
        <StorageTrendCard overview={overview} />
        <StorageUsageCard overview={overview} />
      </section>

      <section
        aria-label={t('admin.overview.details.section')}
        className="grid items-stretch gap-4 lg:grid-cols-2 xl:grid-cols-3"
      >
        <TopUsersCard overview={overview} />
        <StorageBackendsCard overview={overview} />
        <DownloadersCard overview={overview} />
      </section>
    </div>
  )
}

function MetricCard({ icon, label, value, detail }: { icon: ReactNode; label: string; value: string; detail: string }) {
  return (
    <Card className="gap-3 px-5 py-4 shadow-none">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary [&>svg]:size-5">
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <p className="mt-1 truncate text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
          <p className="mt-1 truncate text-xs text-muted-foreground">{detail}</p>
        </div>
      </div>
    </Card>
  )
}

function UserTrendCard({ overview }: { overview: AdminOverview }) {
  const { t } = useTranslation()
  const hasData = overview.users.trend.some((row) => row.totalUsers !== null || row.activeUsers !== null)

  return (
    <ChartCard
      className="xl:col-span-8"
      title={t('admin.overview.users.trendTitle')}
      description={t('admin.overview.users.trendDescription')}
      badge="30D"
    >
      {hasData ? (
        <div className="h-72 min-w-0" role="img" aria-label={t('admin.overview.users.trendAriaLabel')}>
          <ResponsiveContainer
            width="100%"
            height="100%"
            minWidth={0}
            minHeight={1}
            initialDimension={TREND_CHART_INITIAL_SIZE}
          >
            <LineChart data={overview.users.trend} margin={{ top: 8, right: 8, bottom: 0, left: 4 }} accessibilityLayer>
              <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" tickFormatter={formatChartDate} tickLine={false} axisLine={false} minTickGap={28} />
              <YAxis yAxisId="users" allowDecimals={false} tickLine={false} axisLine={false} width={48} />
              <YAxis yAxisId="new" orientation="right" allowDecimals={false} tickLine={false} axisLine={false} />
              <RechartsTooltip
                contentStyle={tooltipContentStyle}
                labelFormatter={(value) => formatFullDate(String(value))}
                formatter={(value, name) => [Number(value).toLocaleString(), String(name)]}
              />
              <Line
                yAxisId="users"
                type="monotone"
                dataKey="totalUsers"
                name={t('admin.overview.users.totalUsers')}
                stroke={CHART_COLORS.primary}
                strokeWidth={2.5}
                dot={false}
                connectNulls
              />
              <Line
                yAxisId="users"
                type="monotone"
                dataKey="activeUsers"
                name={t('admin.overview.users.activeUsers')}
                stroke={CHART_COLORS.teal}
                strokeWidth={2}
                dot={false}
                connectNulls
              />
              <Line
                yAxisId="new"
                type="monotone"
                dataKey="newUsers"
                name={t('admin.overview.users.newUsers')}
                stroke={CHART_COLORS.violet}
                strokeWidth={2}
                strokeDasharray="5 4"
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <EmptyChart />
      )}
      {hasData && (
        <ChartLegend
          items={[
            { label: t('admin.overview.users.totalUsers'), color: CHART_COLORS.primary },
            { label: t('admin.overview.users.activeUsers'), color: CHART_COLORS.teal },
            { label: t('admin.overview.users.newUsers'), color: CHART_COLORS.violet, dashed: true },
          ]}
        />
      )}
    </ChartCard>
  )
}

function UserActivityCard({ overview }: { overview: AdminOverview }) {
  const { t } = useTranslation()
  const activity = overview.users.activity
  const rows = [
    { key: 'today', label: t('admin.overview.users.activity.today'), value: activity.today },
    { key: 'last7Days', label: t('admin.overview.users.activity.last7Days'), value: activity.last7Days },
    { key: 'last30Days', label: t('admin.overview.users.activity.last30Days'), value: activity.last30Days },
    { key: 'inactive', label: t('admin.overview.users.activity.inactive'), value: activity.inactive },
  ]
  const chartRows = rows.map((row) => ({ ...row, value: row.value ?? 0 }))
  const total = chartRows.reduce((sum, row) => sum + row.value, 0)

  return (
    <ChartCard
      className="xl:col-span-4"
      title={t('admin.overview.users.activityTitle')}
      description={t('admin.overview.users.activityDescription')}
      badge="30D"
    >
      {total > 0 ? (
        <div className="grid min-h-72 items-center gap-3 sm:grid-cols-[minmax(0,1fr)_10rem] xl:grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_10rem]">
          <div className="relative h-52 min-w-0" role="img" aria-label={t('admin.overview.users.activityAriaLabel')}>
            <ResponsiveContainer
              width="100%"
              height="100%"
              minWidth={0}
              minHeight={1}
              initialDimension={DONUT_CHART_INITIAL_SIZE}
            >
              <PieChart accessibilityLayer>
                <Pie
                  data={chartRows}
                  dataKey="value"
                  nameKey="label"
                  innerRadius={62}
                  outerRadius={86}
                  paddingAngle={2}
                >
                  {chartRows.map((row, index) => (
                    <Cell key={row.key} fill={ACTIVITY_COLORS[index]} />
                  ))}
                </Pie>
                <RechartsTooltip
                  contentStyle={tooltipContentStyle}
                  formatter={(value, name) => [Number(value).toLocaleString(), String(name)]}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-semibold tabular-nums">{formatCount(overview.users.total)}</span>
              <span className="text-xs text-muted-foreground">{t('admin.overview.users.totalUsers')}</span>
            </div>
          </div>
          <BreakdownLegend rows={chartRows} colors={ACTIVITY_COLORS} total={total} />
        </div>
      ) : (
        <EmptyChart />
      )}
    </ChartCard>
  )
}

function StorageTrendCard({ overview }: { overview: AdminOverview }) {
  const { t } = useTranslation()
  const hasData = overview.storages.trend.some((row) => row.usedBytes !== null)

  return (
    <ChartCard
      className="xl:col-span-8"
      title={t('admin.overview.storage.trendTitle')}
      description={t('admin.overview.storage.trendDescription')}
      badge="30D"
    >
      {hasData ? (
        <div className="h-72 min-w-0" role="img" aria-label={t('admin.overview.storage.trendAriaLabel')}>
          <ResponsiveContainer
            width="100%"
            height="100%"
            minWidth={0}
            minHeight={1}
            initialDimension={TREND_CHART_INITIAL_SIZE}
          >
            <AreaChart
              data={overview.storages.trend}
              margin={{ top: 8, right: 8, bottom: 0, left: 4 }}
              accessibilityLayer
            >
              <defs>
                <linearGradient id="storage-used-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={CHART_COLORS.primary} stopOpacity={0.24} />
                  <stop offset="100%" stopColor={CHART_COLORS.primary} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" tickFormatter={formatChartDate} tickLine={false} axisLine={false} minTickGap={28} />
              <YAxis tickFormatter={formatAxisSize} tickLine={false} axisLine={false} width={54} />
              <RechartsTooltip
                contentStyle={tooltipContentStyle}
                labelFormatter={(value) => formatFullDate(String(value))}
                formatter={(value) => [formatSize(Number(value)), t('admin.overview.storage.used')]}
              />
              <Area
                type="monotone"
                dataKey="usedBytes"
                name={t('admin.overview.storage.used')}
                stroke={CHART_COLORS.primary}
                strokeWidth={2.5}
                fill="url(#storage-used-fill)"
                connectNulls
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <EmptyChart />
      )}
      {hasData && <ChartLegend items={[{ label: t('admin.overview.storage.used'), color: CHART_COLORS.primary }]} />}
    </ChartCard>
  )
}

function StorageUsageCard({ overview }: { overview: AdminOverview }) {
  const { t } = useTranslation()
  const available = Math.max(0, overview.storages.capacity - overview.storages.used)
  const usage = percent(overview.storages.used, overview.storages.capacity)
  const data = [
    { name: t('admin.overview.storage.used'), value: Math.min(overview.storages.used, overview.storages.capacity) },
    { name: t('admin.overview.storage.available'), value: available },
  ]

  return (
    <ChartCard
      className="xl:col-span-4"
      title={t('admin.overview.storage.usageTitle')}
      description={t('admin.overview.storage.usageDescription')}
      badge={t('admin.overview.live')}
    >
      {overview.storages.capacity > 0 ? (
        <div className="grid min-h-72 items-center gap-3 sm:grid-cols-[minmax(0,1fr)_10rem] xl:grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_10rem]">
          <div className="relative h-52 min-w-0" role="img" aria-label={t('admin.overview.storage.usageAriaLabel')}>
            <ResponsiveContainer
              width="100%"
              height="100%"
              minWidth={0}
              minHeight={1}
              initialDimension={DONUT_CHART_INITIAL_SIZE}
            >
              <PieChart accessibilityLayer>
                <Pie
                  data={data}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={62}
                  outerRadius={86}
                  startAngle={90}
                  endAngle={-270}
                >
                  <Cell fill={CHART_COLORS.primary} />
                  <Cell fill={CHART_COLORS.muted} />
                </Pie>
                <RechartsTooltip
                  contentStyle={tooltipContentStyle}
                  formatter={(value, name) => [formatSize(Number(value)), String(name)]}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-semibold tabular-nums">{formatPercent(usage)}</span>
              <span className="text-xs text-muted-foreground">{t('admin.overview.storage.used')}</span>
            </div>
          </div>
          <dl className="space-y-4 text-sm">
            <BreakdownValue
              label={t('admin.overview.storage.used')}
              value={formatSize(overview.storages.used)}
              color={CHART_COLORS.primary}
            />
            <BreakdownValue
              label={t('admin.overview.storage.available')}
              value={formatSize(available)}
              color={CHART_COLORS.muted}
            />
            <BreakdownValue label={t('admin.overview.storage.total')} value={formatSize(overview.storages.capacity)} />
          </dl>
        </div>
      ) : (
        <EmptyChart label={t('admin.overview.storage.unboundedOnly')} />
      )}
    </ChartCard>
  )
}

function TopUsersCard({ overview }: { overview: AdminOverview }) {
  const { t } = useTranslation()
  const maxUsage = Math.max(...overview.users.topUsage.map((row) => row.usedBytes), 1)

  return (
    <DetailCard
      title={t('admin.overview.topUsers.title')}
      description={t('admin.overview.topUsers.description')}
      action={<Badge variant="secondary">Top 10</Badge>}
    >
      {overview.users.topUsage.length === 0 ? (
        <EmptyList label={t('admin.overview.topUsers.empty')} />
      ) : (
        <ol className="divide-y">
          {overview.users.topUsage.map((row, index) => (
            <li key={row.userId} className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-3 py-2.5">
              <span className="text-xs tabular-nums text-muted-foreground">{index + 1}</span>
              <div className="min-w-0">
                <div className="flex min-w-0 items-baseline justify-between gap-3">
                  <span className="truncate text-sm font-medium" title={`${row.name} · ${row.email}`}>
                    {row.name}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {row.utilization === null ? '—' : `${row.utilization.toFixed(1)}%`}
                  </span>
                </div>
                <Progress value={(row.usedBytes / maxUsage) * 100} className="mt-1.5 h-1" />
              </div>
              <span className="text-xs font-medium tabular-nums">{formatSize(row.usedBytes)}</span>
            </li>
          ))}
        </ol>
      )}
    </DetailCard>
  )
}

function StorageBackendsCard({ overview }: { overview: AdminOverview }) {
  const { t } = useTranslation()

  return (
    <DetailCard
      title={t('admin.overview.backends.title')}
      description={t('admin.overview.backends.description')}
      action={<Badge variant="secondary">{overview.storages.total}</Badge>}
    >
      {overview.storages.items.length === 0 ? (
        <EmptyList label={t('admin.overview.backends.empty')} />
      ) : (
        <div className="divide-y">
          {overview.storages.items.map((storage) => (
            <StorageBackendRow key={storage.id} storage={storage} />
          ))}
        </div>
      )}
    </DetailCard>
  )
}

function StorageBackendRow({ storage }: { storage: AdminOverviewStorage }) {
  const { t } = useTranslation()
  const status = storage.writable ? 'writable' : storage.status === 'active' ? 'full' : 'disabled'
  const usage = percent(storage.used, storage.capacity)

  return (
    <article className="py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <Database className="size-4" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{storage.provider || 'S3'}</p>
            <p className="truncate text-xs text-muted-foreground" title={storage.bucket}>
              {storage.bucket}
            </p>
          </div>
        </div>
        <StatusBadge status={status} label={t(`admin.overview.backends.status.${status}`)} />
      </div>
      <div className="mt-2.5 flex items-center gap-3">
        <Progress value={usage ?? 0} className="h-1 flex-1" />
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {storage.capacity > 0
            ? `${formatSize(storage.used)} / ${formatSize(storage.capacity)}`
            : formatSize(storage.used)}
        </span>
      </div>
    </article>
  )
}

function DownloadersCard({ overview }: { overview: AdminOverview }) {
  const { t } = useTranslation()

  return (
    <DetailCard
      className="lg:col-span-2 xl:col-span-1"
      title={t('admin.overview.downloaders.title')}
      description={t('admin.overview.downloaders.description')}
      action={
        <Badge variant="secondary">
          {overview.downloaders.online} / {overview.downloaders.total}
        </Badge>
      }
    >
      {overview.downloaders.items.length === 0 ? (
        <EmptyList label={t('admin.overview.downloaders.empty')} />
      ) : (
        <div className="divide-y">
          {overview.downloaders.items.map((downloader) => (
            <DownloaderRow key={downloader.id} downloader={downloader} observedAt={overview.observedAt} />
          ))}
        </div>
      )}
    </DetailCard>
  )
}

function DownloaderRow({ downloader, observedAt }: { downloader: AdminOverviewDownloader; observedAt: string }) {
  const { t } = useTranslation()

  return (
    <article className="py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{downloader.name}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {t('admin.overview.downloaders.heartbeat', {
              value: formatAge(downloader.lastHeartbeatAt, observedAt, t),
            })}
          </p>
        </div>
        <StatusBadge status={downloader.status} label={t(`admin.overview.downloaders.status.${downloader.status}`)} />
      </div>
      <dl className="mt-2.5 grid grid-cols-3 gap-2 rounded-lg bg-muted/50 px-3 py-2.5">
        <DownloaderFact
          icon={<Download />}
          label={t('admin.overview.downloaders.download')}
          value={formatRate(downloader.downloadBps)}
        />
        <DownloaderFact
          icon={<Upload />}
          label={t('admin.overview.downloaders.upload')}
          value={formatRate(downloader.uploadBps)}
        />
        <DownloaderFact
          icon={<Activity />}
          label={t('admin.overview.downloaders.tasks')}
          value={`${downloader.currentTasks}/${downloader.maxConcurrentTasks}`}
        />
      </dl>
    </article>
  )
}

function DownloaderFact({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1 text-[11px] text-muted-foreground [&>svg]:size-3">
        {icon}
        {label}
      </dt>
      <dd className="mt-1 truncate text-xs font-medium tabular-nums" title={value}>
        {value}
      </dd>
    </div>
  )
}

function ChartCard({
  title,
  description,
  badge,
  className,
  children,
}: {
  title: string
  description: string
  badge: string
  className?: string
  children: ReactNode
}) {
  return (
    <Card className={cn('h-full gap-4 py-5 shadow-none', className)}>
      <CardHeader className="gap-1 px-5">
        <CardTitle>
          <h2 className="text-base">{title}</h2>
        </CardTitle>
        <CardDescription className="text-xs">{description}</CardDescription>
        <CardAction>
          <Badge variant="secondary">{badge}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col px-5">{children}</CardContent>
    </Card>
  )
}

function DetailCard({
  title,
  description,
  action,
  className,
  children,
}: {
  title: string
  description: string
  action: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <Card className={cn('h-[24rem] min-h-0 gap-3 overflow-hidden py-5 shadow-none', className)}>
      <CardHeader className="shrink-0 gap-1 px-5">
        <CardTitle>
          <h2 className="text-base">{title}</h2>
        </CardTitle>
        <CardDescription className="text-xs">{description}</CardDescription>
        <CardAction>{action}</CardAction>
      </CardHeader>
      <CardContent className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-5">
        {children}
      </CardContent>
    </Card>
  )
}

function ChartLegend({ items }: { items: Array<{ label: string; color: string; dashed?: boolean }> }) {
  return (
    <div className="mt-3 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
      {items.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-2">
          <span
            className={cn('h-0.5 w-5', item.dashed && 'border-t-2 border-dashed bg-transparent')}
            style={item.dashed ? { borderColor: item.color } : { backgroundColor: item.color }}
            aria-hidden="true"
          />
          {item.label}
        </span>
      ))}
    </div>
  )
}

function BreakdownLegend({
  rows,
  colors,
  total,
}: {
  rows: Array<{ key: string; label: string; value: number }>
  colors: string[]
  total: number
}) {
  return (
    <dl className="space-y-3">
      {rows.map((row, index) => (
        <div key={row.key} className="flex items-center justify-between gap-3 text-xs">
          <dt className="flex min-w-0 items-center gap-2 text-muted-foreground">
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: colors[index] }}
              aria-hidden="true"
            />
            <span className="truncate">{row.label}</span>
          </dt>
          <dd className="shrink-0 font-medium tabular-nums">
            {row.value.toLocaleString()}{' '}
            <span className="text-muted-foreground">{formatPercent((row.value / total) * 100)}</span>
          </dd>
        </div>
      ))}
    </dl>
  )
}

function BreakdownValue({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="flex items-center gap-2 text-muted-foreground">
        {color && <span className="size-2 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />}
        {label}
      </dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  )
}

function StatusBadge({ status, label }: { status: string; label: string }) {
  const healthy = status === 'writable' || status === 'online'
  const disabled = status === 'disabled'
  return (
    <Badge variant={disabled ? 'secondary' : healthy ? 'outline' : 'destructive'}>
      <span
        className={cn(
          'size-1.5 rounded-full',
          healthy ? 'bg-emerald-500' : disabled ? 'bg-muted-foreground' : 'bg-current',
        )}
        aria-hidden="true"
      />
      {label}
    </Badge>
  )
}

function EmptyChart({ label }: { label?: string }) {
  const { t } = useTranslation()
  return (
    <div className="flex min-h-72 items-center justify-center text-sm text-muted-foreground">
      {label ?? t('admin.overview.emptyChart')}
    </div>
  )
}

function EmptyList({ label }: { label: string }) {
  return <div className="flex min-h-48 items-center justify-center text-sm text-muted-foreground">{label}</div>
}

function OverviewSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {['users', 'active', 'new', 'capacity', 'used'].map((key) => (
          <Skeleton key={key} className="h-28" />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-12">
        <Skeleton className="h-[390px] xl:col-span-8" />
        <Skeleton className="h-[390px] xl:col-span-4" />
      </div>
      <div className="grid gap-4 xl:grid-cols-12">
        <Skeleton className="h-[390px] xl:col-span-8" />
        <Skeleton className="h-[390px] xl:col-span-4" />
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        {['top-users', 'backends', 'downloaders'].map((key) => (
          <Skeleton key={key} className="h-[24rem]" />
        ))}
      </div>
    </div>
  )
}

function percent(value: number | null, total: number | null): number | null {
  if (value === null || total === null || total <= 0) return null
  return Math.min(Math.max((value / total) * 100, 0), 100)
}

function formatCount(value: number | null): string {
  return value === null ? '—' : value.toLocaleString()
}

function formatPercent(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1)}%`
}

function formatRate(bytesPerSecond: number): string {
  return `${formatSize(bytesPerSecond)}/s`
}

function formatClock(value: string): string {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function formatChartDate(value: string): string {
  const date = new Date(`${value}T00:00:00Z`)
  return date.toLocaleDateString([], { month: 'numeric', day: 'numeric', timeZone: 'UTC' })
}

function formatFullDate(value: string): string {
  const date = new Date(`${value}T00:00:00Z`)
  return date.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })
}

function formatAxisSize(value: number): string {
  if (value === 0) return '0'
  const units = ['B', 'K', 'M', 'G', 'T']
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1)
  return `${(value / 1024 ** index).toFixed(index > 2 ? 1 : 0)}${units[index]}`
}

function formatAge(
  value: string | null,
  observedAt: string,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (!value) return t('admin.overview.time.never')
  const seconds = Math.max(0, Math.floor((new Date(observedAt).getTime() - new Date(value).getTime()) / 1000))
  if (seconds < 15) return t('admin.overview.time.now')
  if (seconds < 60) return t('admin.overview.time.seconds', { count: seconds })
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return t('admin.overview.time.minutes', { count: minutes })
  return t('admin.overview.time.hours', { count: Math.floor(minutes / 60) })
}
