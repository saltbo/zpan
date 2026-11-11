import type {
  AdminDashboardGrowthStats,
  AdminDashboardSharingStats,
  AdminDashboardStorageStats,
  AdminDashboardTrafficStats,
  AdminStatsRange,
} from '@shared/types'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { endOfDay, endOfMonth, format, startOfDay, startOfMonth, subDays, subMonths } from 'date-fns'
import {
  Activity,
  CalendarDays,
  ChevronDown,
  Database,
  Download,
  FileClock,
  HardDrive,
  Link2,
  Lock,
  Network,
  Share2,
  TrendingUp,
  Upload,
  UploadCloud,
  Users,
} from 'lucide-react'
import { type CSSProperties, type ReactNode, useMemo, useState } from 'react'
import type { DateRange } from 'react-day-picker'
import { useTranslation } from 'react-i18next'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Legend,
  Line,
  Pie,
  PieChart,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts'
import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { ProBadge } from '@/components/ProBadge'
import { UpgradeHint } from '@/components/UpgradeHint'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Card, CardContent, CardTitle } from '@/components/ui/card'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useEntitlement } from '@/hooks/useEntitlement'
import {
  type AdminStatsRangeFilter,
  getAdminDashboardGrowthStats,
  getAdminDashboardSharingStats,
  getAdminDashboardStorageStats,
  getAdminDashboardTrafficStats,
} from '@/lib/api'
import { formatSize as formatByteSize } from '@/lib/format'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/_authenticated/admin/analytics')({
  component: OverviewPage,
})

type SectionId = 'growth' | 'storage' | 'traffic' | 'sharing'

// Passing the translate function into the pure format helpers keeps chart
// formatters and range presets language-aware without a hook call site.
type AnalyticsTranslate = (key: string, options?: Record<string, string | number>) => string

const COLORS = {
  blue: '#0369a1',
  teal: '#0f766e',
  amber: '#b45309',
  violet: '#7c3aed',
  rose: '#be123c',
  slate: '#64748b',
  sky: '#0284c7',
  green: '#15803d',
}
const CHART_COLORS = [
  COLORS.blue,
  COLORS.teal,
  COLORS.amber,
  COLORS.violet,
  COLORS.rose,
  COLORS.slate,
  COLORS.sky,
  COLORS.green,
]
const CHART_GRID_COLOR = 'var(--color-border)'
const CHART_INITIAL_DIMENSION = { width: 640, height: 288 }
const tooltipContentStyle: CSSProperties = {
  border: '1px solid var(--color-border)',
  borderRadius: 10,
  background: 'var(--color-popover)',
  boxShadow: '0 18px 42px -30px rgba(15, 23, 42, 0.65)',
  color: 'var(--color-popover-foreground)',
}
const tooltipLabelStyle: CSSProperties = {
  color: 'var(--color-muted-foreground)',
  fontSize: 12,
}
// Section copy lives in the locale files (admin.analytics.section.*), so the
// page renders in English as well as Chinese.
const SECTION_META: Array<{
  id: SectionId
  icon: typeof Users
}> = [
  { id: 'growth', icon: Users },
  { id: 'storage', icon: HardDrive },
  { id: 'traffic', icon: UploadCloud },
  { id: 'sharing', icon: Share2 },
]

export function OverviewPage() {
  const { t } = useTranslation()
  const today = useMemo(() => utcCalendarDate(new Date()), [])
  const [openSection, setOpenSection] = useState<SectionId | null>('growth')
  const [range, setRange] = useState<DateRange>(() => ({ from: startOfDay(subDays(today, 29)), to: endOfDay(today) }))
  const { hasFeature, isLoading: entitlementLoading } = useEntitlement()
  const hasAnalytics = hasFeature('analytics')

  const growthQuery = useDashboardSectionQuery('growth', range, openSection, hasAnalytics, getAdminDashboardGrowthStats)
  const storageQuery = useDashboardSectionQuery(
    'storage',
    range,
    openSection,
    hasAnalytics,
    getAdminDashboardStorageStats,
  )
  const trafficQuery = useDashboardSectionQuery(
    'traffic',
    range,
    openSection,
    hasAnalytics,
    getAdminDashboardTrafficStats,
  )
  const sharingQuery = useDashboardSectionQuery(
    'sharing',
    range,
    openSection,
    hasAnalytics,
    getAdminDashboardSharingStats,
  )
  function toggleSection(section: SectionId) {
    if (!hasAnalytics) return
    setOpenSection((current) => (current === section ? null : section))
  }

  const sections = SECTION_META.map((meta) => ({
    ...meta,
    title: t(`admin.analytics.section.${meta.id}.title`),
    description: t(`admin.analytics.section.${meta.id}.description`),
  }))

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title={t('admin.analytics.title')}
        description={t('admin.analytics.description')}
        badge={<ProBadge />}
        action={<DateRangePicker value={range} onChange={setRange} />}
      />
      <div className="flex flex-col gap-4">
        {sections.map((section) => (
          <DashboardSection
            key={section.id}
            section={section}
            open={openSection === section.id}
            locked={!hasAnalytics && !entitlementLoading}
            onToggle={() => toggleSection(section.id)}
          >
            {!hasAnalytics ? (
              <UpgradeHint
                feature="analytics"
                title={t('admin.analytics.upgrade.title')}
                description={t('admin.analytics.upgrade.description')}
                actionLabel={t('admin.analytics.upgrade.action')}
              />
            ) : section.id === 'growth' ? (
              <QueryState query={growthQuery}>{(data) => <GrowthSection stats={data} />}</QueryState>
            ) : section.id === 'storage' ? (
              <QueryState query={storageQuery}>{(data) => <StorageSection stats={data} />}</QueryState>
            ) : section.id === 'traffic' ? (
              <QueryState query={trafficQuery}>{(data) => <TrafficSection stats={data} />}</QueryState>
            ) : section.id === 'sharing' ? (
              <QueryState query={sharingQuery}>{(data) => <SharingSection stats={data} />}</QueryState>
            ) : null}
          </DashboardSection>
        ))}
      </div>
    </div>
  )
}

function useDashboardSectionQuery<T>(
  section: SectionId,
  range: DateRange,
  openSection: SectionId | null,
  enabled: boolean,
  queryFn: (filter: AdminStatsRangeFilter) => Promise<T>,
) {
  return useQuery({
    queryKey: ['admin', 'dashboard', section, rangeKey(range)],
    queryFn: () => queryFn(toRangeFilter(range)),
    enabled: enabled && openSection === section,
    staleTime: 30_000,
  })
}

function AnalyticsChartContainer({ children }: { children: ReactNode }) {
  return (
    <ResponsiveContainer
      width="100%"
      height="100%"
      minWidth={0}
      minHeight={1}
      initialDimension={CHART_INITIAL_DIMENSION}
    >
      {children}
    </ResponsiveContainer>
  )
}

function DashboardSection({
  section,
  open,
  locked,
  children,
  onToggle,
}: {
  section: { id: SectionId; icon: typeof Users; title: string; description: string }
  open: boolean
  locked?: boolean
  children: ReactNode
  onToggle: () => void
}) {
  const { t } = useTranslation()
  const Icon = section.icon

  return (
    <section className="overflow-hidden rounded-xl border border-border/70 bg-background/95 text-card-foreground shadow-[0_18px_50px_-38px_rgba(15,23,42,0.55)]">
      <div className="flex min-h-16 flex-col gap-3 bg-background/90 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-start gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-canvas text-primary shadow-inner">
            <Icon className="size-4" />
          </span>
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-[15px] font-semibold tracking-tight">{section.title}</span>
              {locked && <Lock className="size-3.5 text-muted-foreground" />}
            </span>
            <span className="mt-1 block text-[13px] leading-5 text-muted-foreground">{section.description}</span>
          </span>
        </button>
        <div className="flex shrink-0 items-center justify-between gap-2 sm:justify-end">
          <button
            type="button"
            onClick={onToggle}
            aria-label={
              open
                ? t('admin.analytics.section.collapse', { name: section.title })
                : t('admin.analytics.section.expand', { name: section.title })
            }
            className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} />
          </button>
        </div>
      </div>
      {open && <div className="border-t border-border/70 bg-card p-4 sm:p-5">{children}</div>}
    </section>
  )
}

function DateRangePicker({ value, onChange }: { value: DateRange; onChange: (range: DateRange) => void }) {
  const { t } = useTranslation()
  const presets = dateRangePresets(t)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<DateRange>(value)

  function applyRange(nextRange: DateRange) {
    if (!nextRange.from || !nextRange.to) return
    onChange(normalizeDateRange(nextRange))
    setOpen(false)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (nextOpen) setDraft(value)
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-w-[15.5rem] justify-start bg-background shadow-xs"
        >
          <CalendarDays className="size-4 text-muted-foreground" />
          <span className="truncate font-normal">{formatRange(value, t)}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(44rem,calc(100vw-2rem))] p-0">
        <div className="grid gap-0 md:grid-cols-[9.5rem_minmax(0,1fr)]">
          <div className="border-b p-3 md:border-r md:border-b-0">
            <div className="flex flex-wrap gap-2 md:flex-col">
              {presets.map((preset) => (
                <Button
                  key={preset.label}
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="justify-start"
                  onClick={() => applyRange(preset.range)}
                >
                  {preset.label}
                </Button>
              ))}
            </div>
          </div>
          <div className="p-3">
            <Calendar
              mode="range"
              selected={draft}
              onSelect={(range) => {
                if (range) setDraft(range)
              }}
              defaultMonth={draft.from}
              numberOfMonths={2}
              disabled={{ after: utcCalendarDate(new Date()) }}
            />
            <div className="mt-3 flex flex-col gap-3 border-t pt-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-xs text-muted-foreground">{formatRange(draft, t)}</div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
                  {t('common.cancel')}
                </Button>
                <Button type="button" size="sm" disabled={!draft.from || !draft.to} onClick={() => applyRange(draft)}>
                  {t('admin.analytics.range.apply')}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function GrowthSection({ stats }: { stats: AdminDashboardGrowthStats }) {
  const { t } = useTranslation()
  const totalUserPointCount = stats.userScaleTrend.filter((row) => row.totalUsers !== null).length
  const activePointCount = stats.activeUserTrend.filter(
    (row) => row.dau !== null || row.wau !== null || row.mau !== null,
  ).length
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={t('admin.analytics.metric.totalUsers')}
          value={formatNumber(stats.summary.totalUsers)}
          delta={formatDelta(stats.summary.newUsers)}
          icon={Users}
          metrics={[
            { label: t('admin.analytics.metric.newUsers'), value: formatNumber(stats.summary.newUsers.value) },
            { label: t('admin.analytics.metric.verifiedUsers'), value: formatNumber(stats.summary.verifiedUsers) },
          ]}
        />
        <StatCard
          label={t('admin.analytics.metric.activeUsers30')}
          value={formatNumber(stats.summary.activeUsers.value)}
          delta={formatDelta(stats.summary.activeUsers)}
          icon={Activity}
          metrics={[
            { label: t('admin.analytics.metric.silentUsers'), value: formatNumber(stats.summary.silentUsers) },
            { label: t('admin.analytics.metric.bannedUsers'), value: formatNumber(stats.summary.bannedUsers) },
          ]}
        />
        <StatCard
          label={t('admin.analytics.metric.newUsers')}
          value={formatNumber(stats.summary.newUsers.value)}
          delta={formatDelta(stats.summary.newUsers)}
          icon={TrendingUp}
          metrics={[
            {
              label: t('admin.analytics.metric.previousNewUsers'),
              value: formatNumber(stats.summary.newUsers.previousValue),
            },
            { label: t('admin.analytics.metric.change'), value: formatPercent(stats.summary.newUsers.changePercent) },
          ]}
        />
        <StatCard
          label={t('admin.analytics.metric.silentUsers')}
          value={formatNumber(stats.summary.silentUsers)}
          icon={FileClock}
          metrics={[
            { label: t('admin.analytics.metric.share'), value: formatPercent(stats.summary.silentUserRate) },
            { label: t('admin.analytics.metric.activeRate30'), value: formatPercent(stats.summary.activeUserRate) },
          ]}
        />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard
          title={t('admin.analytics.chart.userScaleTrend')}
          subtitle={t('admin.analytics.chart.userScaleTrendDescription')}
        >
          {hasNumericData(stats.userScaleTrend, ['newUsers', 'totalUsers']) ? (
            <AnalyticsChartContainer>
              <ComposedChart data={stats.userScaleTrend}>
                <CartesianGrid stroke={CHART_GRID_COLOR} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" tickLine={false} axisLine={false} fontSize={12} tickFormatter={formatChartDate} />
                <YAxis
                  yAxisId="total"
                  tickLine={false}
                  axisLine={false}
                  fontSize={12}
                  width={48}
                  tickFormatter={formatCompactNumber}
                />
                <YAxis
                  yAxisId="new"
                  orientation="right"
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                  fontSize={12}
                  width={40}
                  tickFormatter={formatCompactNumber}
                />
                <RechartsTooltip
                  contentStyle={tooltipContentStyle}
                  labelStyle={tooltipLabelStyle}
                  formatter={tooltipFormatter({ newUsers: formatNumber, totalUsers: formatNumber })}
                />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                <Bar
                  yAxisId="new"
                  dataKey="newUsers"
                  name={t('admin.analytics.series.newUsers')}
                  fill={CHART_COLORS[1]}
                  radius={[4, 4, 0, 0]}
                />
                <Line
                  yAxisId="total"
                  type="monotone"
                  dataKey="totalUsers"
                  name={t('admin.analytics.series.cumulativeUsers')}
                  stroke={CHART_COLORS[0]}
                  strokeWidth={2}
                  dot={singlePointDot(totalUserPointCount, CHART_COLORS[0])}
                />
              </ComposedChart>
            </AnalyticsChartContainer>
          ) : (
            <EmptyState />
          )}
        </ChartCard>
        <ChartCard
          title={t('admin.analytics.chart.activeUserTrend')}
          subtitle={t('admin.analytics.chart.activeUserTrendDescription')}
        >
          {hasNumericData(stats.activeUserTrend, ['dau', 'wau', 'mau']) ? (
            <AnalyticsChartContainer>
              <AreaChart data={stats.activeUserTrend}>
                <CartesianGrid stroke={CHART_GRID_COLOR} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" tickLine={false} axisLine={false} fontSize={12} tickFormatter={formatChartDate} />
                <YAxis tickLine={false} axisLine={false} fontSize={12} width={48} tickFormatter={formatCompactNumber} />
                <RechartsTooltip
                  contentStyle={tooltipContentStyle}
                  labelStyle={tooltipLabelStyle}
                  formatter={tooltipFormatter({ dau: formatNumber, wau: formatNumber, mau: formatNumber })}
                />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                <Area
                  type="monotone"
                  dataKey="mau"
                  name="MAU"
                  stroke={CHART_COLORS[5]}
                  fill={CHART_COLORS[5]}
                  fillOpacity={0.08}
                  dot={singlePointDot(activePointCount, CHART_COLORS[5])}
                />
                <Area
                  type="monotone"
                  dataKey="wau"
                  name="WAU"
                  stroke={CHART_COLORS[3]}
                  fill={CHART_COLORS[3]}
                  fillOpacity={0.12}
                  dot={singlePointDot(activePointCount, CHART_COLORS[3])}
                />
                <Area
                  type="monotone"
                  dataKey="dau"
                  name="DAU"
                  stroke={CHART_COLORS[0]}
                  fill={CHART_COLORS[0]}
                  fillOpacity={0.16}
                  dot={singlePointDot(activePointCount, CHART_COLORS[0])}
                />
              </AreaChart>
            </AnalyticsChartContainer>
          ) : (
            <EmptyState />
          )}
        </ChartCard>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <BreakdownChart
          title={t('admin.analytics.chart.userStatus')}
          rows={stats.userStatus}
          valueFormatter={formatNumber}
        />
        <BarBreakdownChart
          title={t('admin.analytics.chart.registrationSources')}
          rows={stats.registrationSources}
          valueFormatter={formatNumber}
        />
      </div>
    </div>
  )
}

function StorageSection({ stats }: { stats: AdminDashboardStorageStats }) {
  const { t } = useTranslation()
  const usedPointCount = stats.storageTrend.filter((row) => row.usedBytes !== null).length
  const writtenPointCount = stats.storageTrend.filter((row) => row.newBytes !== null).length
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={t('admin.analytics.metric.storageUsedEnd')}
          value={formatSize(stats.summary.storageUsedBytes)}
          icon={HardDrive}
          metrics={[
            {
              label: t('admin.analytics.metric.quotaUtilization'),
              value: formatPercent(stats.summary.storageUtilization),
            },
            { label: t('admin.analytics.metric.trashUsage'), value: formatSize(stats.summary.trashBytes) },
          ]}
        />
        <StatCard
          label={t('admin.analytics.metric.confirmedBytes')}
          value={formatSize(stats.summary.newBytes.value)}
          delta={formatDelta(stats.summary.newBytes, formatSize)}
          icon={Upload}
          metrics={[
            { label: t('admin.analytics.metric.confirmedFiles'), value: formatNumber(stats.summary.newFiles.value) },
            {
              label: t('admin.analytics.metric.previousCapacity'),
              value: formatSize(stats.summary.newBytes.previousValue),
            },
          ]}
        />
        <StatCard
          label={t('admin.analytics.metric.confirmedFiles')}
          value={formatNumber(stats.summary.newFiles.value)}
          delta={formatDelta(stats.summary.newFiles)}
          icon={Database}
          metrics={[
            {
              label: t('admin.analytics.metric.previousNewUsers'),
              value: formatNumber(stats.summary.newFiles.previousValue),
            },
            { label: t('admin.analytics.metric.activeFileCount'), value: formatNumber(stats.summary.fileCount) },
          ]}
        />
        <StatCard
          label={t('admin.analytics.metric.filesOver90Days')}
          value={formatSize(stats.summary.coldFileBytes)}
          icon={FileClock}
          metrics={[
            {
              label: t('admin.analytics.metric.coldFileShare'),
              value: formatPercent(stats.summary.coldFilePercent),
            },
            { label: t('admin.analytics.metric.endPeriodUsage'), value: formatSize(stats.summary.storageUsedBytes) },
          ]}
        />
      </div>
      <ChartCard
        title={t('admin.analytics.chart.quotaPressure')}
        subtitle={t('admin.analytics.chart.quotaPressureDescription', {
          near: formatNumber(stats.summary.nearQuotaSpaces),
          over: formatNumber(stats.summary.overQuotaSpaces),
          invalid: formatNumber(stats.summary.invalidQuotaSpaces),
        })}
        contentClassName="h-auto"
      >
        {stats.topSpaces.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="overflow-hidden rounded-lg border border-border/50">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('admin.analytics.table.space')}</TableHead>
                  <TableHead>{t('admin.analytics.table.type')}</TableHead>
                  <TableHead className="text-right">{t('admin.analytics.table.used')}</TableHead>
                  <TableHead className="text-right">{t('admin.analytics.table.quota')}</TableHead>
                  <TableHead className="text-right">{t('admin.analytics.table.utilization')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stats.topSpaces.map((space) => (
                  <TableRow key={space.orgId}>
                    <TableCell className="max-w-60 truncate font-medium" title={space.orgName}>
                      {space.orgName}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{labelize(space.orgType, t)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatSize(space.usedBytes)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatSize(space.quotaBytes)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatPercent(space.utilization)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </ChartCard>
      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard
          title={t('admin.analytics.chart.storageTrend')}
          subtitle={t('admin.analytics.chart.storageTrendDescription')}
        >
          {hasNumericData(stats.storageTrend, ['usedBytes', 'newBytes', 'newFiles']) ? (
            <AnalyticsChartContainer>
              <ComposedChart data={stats.storageTrend}>
                <CartesianGrid stroke={CHART_GRID_COLOR} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" tickLine={false} axisLine={false} fontSize={12} tickFormatter={formatChartDate} />
                <YAxis
                  yAxisId="bytes"
                  tickLine={false}
                  axisLine={false}
                  fontSize={12}
                  width={58}
                  tickFormatter={formatCompactSize}
                />
                <YAxis
                  yAxisId="files"
                  orientation="right"
                  tickLine={false}
                  axisLine={false}
                  fontSize={12}
                  width={48}
                  tickFormatter={formatCompactNumber}
                />
                <RechartsTooltip
                  contentStyle={tooltipContentStyle}
                  labelStyle={tooltipLabelStyle}
                  formatter={tooltipFormatter({ newFiles: formatNumber, usedBytes: formatSize, newBytes: formatSize })}
                />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                <Bar
                  yAxisId="files"
                  dataKey="newFiles"
                  name={t('admin.analytics.series.confirmedFiles')}
                  fill={CHART_COLORS[1]}
                  radius={[4, 4, 0, 0]}
                />
                <Line
                  yAxisId="bytes"
                  type="monotone"
                  dataKey="usedBytes"
                  name={t('admin.analytics.series.storageUsage')}
                  stroke={CHART_COLORS[0]}
                  strokeWidth={2}
                  dot={singlePointDot(usedPointCount, CHART_COLORS[0])}
                />
                <Line
                  yAxisId="bytes"
                  type="monotone"
                  dataKey="newBytes"
                  name={t('admin.analytics.series.confirmedBytes')}
                  stroke={CHART_COLORS[2]}
                  strokeWidth={2}
                  dot={singlePointDot(writtenPointCount, CHART_COLORS[2])}
                />
              </ComposedChart>
            </AnalyticsChartContainer>
          ) : (
            <EmptyState />
          )}
        </ChartCard>
        <BreakdownChart
          title={t('admin.analytics.chart.fileTypeShare')}
          rows={stats.typeBreakdown.map((row) => ({ name: row.type, value: row.bytes, percent: row.percent }))}
          valueFormatter={formatSize}
        />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard
          title={t('admin.analytics.chart.fileSizeStructure')}
          subtitle={t('admin.analytics.chart.fileSizeStructureDescription')}
        >
          {hasNumericData(stats.sizeBreakdown, ['files', 'bytes']) ? (
            <AnalyticsChartContainer>
              <ComposedChart data={stats.sizeBreakdown} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={CHART_GRID_COLOR} strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="name"
                  tickLine={false}
                  axisLine={false}
                  fontSize={12}
                  tickFormatter={(value) => labelize(String(value), t)}
                />
                <YAxis
                  yAxisId="files"
                  tickLine={false}
                  axisLine={false}
                  fontSize={12}
                  width={46}
                  tickFormatter={formatCompactNumber}
                />
                <YAxis
                  yAxisId="bytes"
                  orientation="right"
                  tickLine={false}
                  axisLine={false}
                  fontSize={12}
                  width={58}
                  tickFormatter={formatCompactSize}
                />
                <RechartsTooltip
                  contentStyle={tooltipContentStyle}
                  labelStyle={tooltipLabelStyle}
                  formatter={tooltipFormatter({ files: formatNumber, bytes: formatSize })}
                  labelFormatter={(value) => labelize(String(value), t)}
                />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                <Bar
                  yAxisId="files"
                  dataKey="files"
                  name={t('admin.analytics.series.fileCount')}
                  fill={CHART_COLORS[5]}
                  radius={[4, 4, 0, 0]}
                  isAnimationActive={false}
                />
                <Line
                  yAxisId="bytes"
                  type="monotone"
                  dataKey="bytes"
                  name={t('admin.analytics.series.capacityContribution')}
                  stroke={CHART_COLORS[4]}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </AnalyticsChartContainer>
          ) : (
            <EmptyState />
          )}
        </ChartCard>
        <ChartCard title={t('admin.analytics.chart.fileAge')} subtitle={t('admin.analytics.chart.fileAgeDescription')}>
          {hasNumericData(stats.ageBreakdown, ['bytes']) ? (
            <AnalyticsChartContainer>
              <BarChart data={stats.ageBreakdown} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={CHART_GRID_COLOR} strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="name"
                  tickLine={false}
                  axisLine={false}
                  fontSize={12}
                  tickFormatter={(value) => labelize(String(value), t)}
                />
                <YAxis tickLine={false} axisLine={false} fontSize={12} width={58} tickFormatter={formatCompactSize} />
                <RechartsTooltip
                  contentStyle={tooltipContentStyle}
                  labelStyle={tooltipLabelStyle}
                  formatter={(value, name) => [formatSize(Number(value)), String(name)]}
                  labelFormatter={(value) => labelize(String(value), t)}
                />
                <Bar
                  dataKey="bytes"
                  name={t('admin.analytics.series.capacity')}
                  fill={CHART_COLORS[0]}
                  radius={[4, 4, 0, 0]}
                  isAnimationActive={false}
                >
                  <LabelList dataKey="percent" position="top" formatter={formatPercentLabel} fontSize={11} />
                </Bar>
              </BarChart>
            </AnalyticsChartContainer>
          ) : (
            <EmptyState />
          )}
        </ChartCard>
      </div>
    </div>
  )
}

function TrafficSection({ stats }: { stats: AdminDashboardTrafficStats }) {
  const { t } = useTranslation()
  const uploadPointCount = stats.trafficTrend.filter((row) => row.uploadBytes !== null).length
  const downloadPointCount = stats.trafficTrend.filter((row) => row.downloadBytes !== null).length
  const uploadSuccessPointCount = stats.successTrend.filter((row) => row.uploadSuccessRate !== null).length
  const downloadSuccessPointCount = stats.successTrend.filter((row) => row.downloadSuccessRate !== null).length
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={t('admin.analytics.metric.issuedBytes')}
          value={formatSize(stats.summary.totalBytes.value)}
          delta={formatDelta(stats.summary.totalBytes, formatSize)}
          icon={Network}
          metrics={[
            { label: t('admin.analytics.metric.peakDailyBytes'), value: formatSize(stats.summary.peakDailyBytes) },
            { label: t('admin.analytics.metric.requests'), value: formatNumber(stats.summary.requestCount.value) },
          ]}
        />
        <StatCard
          label={t('admin.analytics.metric.requests')}
          value={formatNumber(stats.summary.requestCount.value)}
          delta={formatDelta(stats.summary.requestCount)}
          icon={Activity}
          metrics={[
            { label: t('admin.analytics.metric.issuedDownloads'), value: formatNumber(stats.summary.issuedDownloads) },
            { label: t('admin.analytics.metric.blockedIssues'), value: formatNumber(stats.summary.blockedDownloads) },
          ]}
        />
        <StatCard
          label={t('admin.analytics.metric.downloadIssueSuccessRate')}
          value={formatPercent(stats.summary.downloadIssueSuccessRate)}
          icon={Download}
          metrics={[
            {
              label: t('admin.analytics.metric.issuedSuccessfully'),
              value: formatNumber(stats.summary.issuedDownloads),
            },
            { label: t('admin.analytics.metric.blockedIssues'), value: formatNumber(stats.summary.blockedDownloads) },
          ]}
        />
        <StatCard
          label={t('admin.analytics.metric.peakDailyBytes')}
          value={formatSize(stats.summary.peakDailyBytes)}
          icon={TrendingUp}
          metrics={[
            { label: t('admin.analytics.metric.statBasis'), value: t('admin.analytics.metric.uploadPlusIssue') },
            { label: t('admin.analytics.metric.periodTotal'), value: formatSize(stats.summary.totalBytes.value) },
          ]}
        />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard
          title={t('admin.analytics.chart.trafficTrend')}
          subtitle={t('admin.analytics.chart.trafficTrendDescription')}
        >
          {hasNumericData(stats.trafficTrend, ['uploadBytes', 'downloadBytes', 'requests']) ? (
            <AnalyticsChartContainer>
              <ComposedChart data={stats.trafficTrend}>
                <CartesianGrid stroke={CHART_GRID_COLOR} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" tickLine={false} axisLine={false} fontSize={12} tickFormatter={formatChartDate} />
                <YAxis
                  yAxisId="bytes"
                  tickLine={false}
                  axisLine={false}
                  fontSize={12}
                  width={58}
                  tickFormatter={formatCompactSize}
                />
                <YAxis
                  yAxisId="count"
                  orientation="right"
                  tickLine={false}
                  axisLine={false}
                  fontSize={12}
                  width={46}
                  tickFormatter={formatCompactNumber}
                />
                <RechartsTooltip
                  contentStyle={tooltipContentStyle}
                  labelStyle={tooltipLabelStyle}
                  formatter={tooltipFormatter({
                    requests: formatNumber,
                    uploadBytes: formatSize,
                    downloadBytes: formatSize,
                  })}
                />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                <Bar
                  yAxisId="count"
                  dataKey="requests"
                  name={t('admin.analytics.metric.requests')}
                  fill={CHART_COLORS[5]}
                  radius={[4, 4, 0, 0]}
                />
                <Line
                  yAxisId="bytes"
                  type="monotone"
                  dataKey="uploadBytes"
                  name={t('admin.analytics.series.confirmedUploadBytes')}
                  stroke={CHART_COLORS[0]}
                  strokeWidth={2}
                  dot={singlePointDot(uploadPointCount, CHART_COLORS[0])}
                />
                <Line
                  yAxisId="bytes"
                  type="monotone"
                  dataKey="downloadBytes"
                  name={t('admin.analytics.series.issuedDownloadBytes')}
                  stroke={CHART_COLORS[2]}
                  strokeWidth={2}
                  dot={singlePointDot(downloadPointCount, CHART_COLORS[2])}
                />
              </ComposedChart>
            </AnalyticsChartContainer>
          ) : (
            <EmptyState />
          )}
        </ChartCard>
        <BreakdownChart
          title={t('admin.analytics.chart.trafficSources')}
          rows={stats.sourceBreakdown.map((row) => ({ name: row.name, value: row.bytes, percent: row.percent }))}
          valueFormatter={formatSize}
        />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard
          title={t('admin.analytics.chart.successRates')}
          subtitle={t('admin.analytics.chart.successRatesDescription')}
        >
          {hasNumericData(stats.successTrend, ['uploadSuccessRate', 'downloadSuccessRate']) ? (
            <AnalyticsChartContainer>
              <AreaChart data={stats.successTrend} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={CHART_GRID_COLOR} strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  fontSize={12}
                  minTickGap={16}
                  tickFormatter={formatChartDate}
                />
                <YAxis
                  domain={[0, 100]}
                  tickFormatter={(value) => `${value}%`}
                  tickLine={false}
                  axisLine={false}
                  fontSize={12}
                  width={46}
                />
                <RechartsTooltip
                  contentStyle={tooltipContentStyle}
                  labelStyle={tooltipLabelStyle}
                  formatter={(value, name) => [`${Number(value).toFixed(1)}%`, name]}
                />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                <Area
                  type="monotone"
                  dataKey="uploadSuccessRate"
                  name={t('admin.analytics.series.uploadSuccessRate')}
                  stroke={CHART_COLORS[1]}
                  fill={CHART_COLORS[1]}
                  fillOpacity={0.08}
                  strokeWidth={2}
                  dot={singlePointDot(uploadSuccessPointCount, CHART_COLORS[1])}
                  isAnimationActive={false}
                />
                <Area
                  type="monotone"
                  dataKey="downloadSuccessRate"
                  name={t('admin.analytics.series.downloadSuccessRate')}
                  stroke={CHART_COLORS[0]}
                  fill={CHART_COLORS[0]}
                  fillOpacity={0.08}
                  strokeWidth={2}
                  dot={singlePointDot(downloadSuccessPointCount, CHART_COLORS[0])}
                  isAnimationActive={false}
                />
              </AreaChart>
            </AnalyticsChartContainer>
          ) : (
            <EmptyState />
          )}
        </ChartCard>
        <ChartCard
          title={t('admin.analytics.chart.failureReasons')}
          subtitle={t('admin.analytics.chart.failureReasonsDescription')}
        >
          {stats.failureReasons.length === 0 ? (
            <EmptyState />
          ) : (
            <AnalyticsChartContainer>
              <BarChart
                data={stats.failureReasons}
                layout="vertical"
                margin={{ top: 8, right: 40, left: 12, bottom: 0 }}
              >
                <CartesianGrid stroke={CHART_GRID_COLOR} strokeDasharray="3 3" horizontal={false} />
                <XAxis
                  type="number"
                  tickLine={false}
                  axisLine={false}
                  fontSize={12}
                  tickFormatter={formatCompactNumber}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  tickLine={false}
                  axisLine={false}
                  width={86}
                  fontSize={12}
                  tickFormatter={(value) => labelize(String(value), t)}
                />
                <RechartsTooltip
                  contentStyle={tooltipContentStyle}
                  labelStyle={tooltipLabelStyle}
                  formatter={(value) => formatNumber(Number(value))}
                  labelFormatter={(value) => labelize(String(value), t)}
                />
                <Bar
                  dataKey="value"
                  name={t('admin.analytics.series.failureCount')}
                  fill={CHART_COLORS[4]}
                  radius={[0, 4, 4, 0]}
                  isAnimationActive={false}
                >
                  <LabelList dataKey="percent" position="right" formatter={formatPercentLabel} fontSize={11} />
                </Bar>
              </BarChart>
            </AnalyticsChartContainer>
          )}
        </ChartCard>
      </div>
    </div>
  )
}

function SharingSection({ stats }: { stats: AdminDashboardSharingStats }) {
  const { t } = useTranslation()
  const downloadPointCount = stats.trend.filter((row) => row.downloads !== null).length
  const savePointCount = stats.trend.filter((row) => row.saves !== null).length
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={t('admin.analytics.metric.activeSharesEnd')}
          value={formatNumber(stats.summary.activeShares)}
          delta={formatDelta(stats.summary.createdShares)}
          icon={Share2}
          metrics={[
            {
              label: t('admin.analytics.metric.createdInRange'),
              value: formatNumber(stats.summary.createdShares.value),
            },
            {
              label: t('admin.analytics.metric.previousCreated'),
              value: formatNumber(stats.summary.createdShares.previousValue),
            },
          ]}
        />
        <StatCard
          label={t('admin.analytics.metric.totalViews')}
          value={formatNumber(stats.summary.views)}
          icon={Activity}
          metrics={[
            {
              label: t('admin.analytics.metric.exactShareViews'),
              value: formatNumber(stats.summary.views),
            },
          ]}
        />
        <StatCard
          label={t('admin.analytics.metric.locatedDownloads')}
          value={formatNumber(stats.summary.downloads.value)}
          delta={formatDelta(stats.summary.downloads)}
          icon={Download}
          metrics={[
            {
              label: t('admin.analytics.metric.previousDownloads'),
              value: formatNumber(stats.summary.downloads.previousValue),
            },
          ]}
        />
        <StatCard
          label={t('admin.analytics.metric.savedToDrive')}
          value={formatNumber(stats.summary.saves.value)}
          delta={formatDelta(stats.summary.saves)}
          icon={Link2}
          metrics={[
            {
              label: t('admin.analytics.metric.previousSaves'),
              value: formatNumber(stats.summary.saves.previousValue),
            },
          ]}
        />
      </div>
      <div className="grid gap-4">
        <ChartCard
          title={t('admin.analytics.chart.sharingTrend')}
          subtitle={t('admin.analytics.chart.sharingTrendDescription')}
        >
          {hasNumericData(stats.trend, ['downloads', 'saves']) ? (
            <AnalyticsChartContainer>
              <AreaChart data={stats.trend}>
                <CartesianGrid stroke={CHART_GRID_COLOR} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" tickLine={false} axisLine={false} fontSize={12} tickFormatter={formatChartDate} />
                <YAxis tickLine={false} axisLine={false} fontSize={12} width={48} tickFormatter={formatCompactNumber} />
                <RechartsTooltip
                  contentStyle={tooltipContentStyle}
                  labelStyle={tooltipLabelStyle}
                  formatter={tooltipFormatter({ downloads: formatNumber, saves: formatNumber })}
                />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                <Area
                  type="monotone"
                  dataKey="downloads"
                  name={t('admin.analytics.metric.issuedDownloads')}
                  stroke={CHART_COLORS[2]}
                  fill={CHART_COLORS[2]}
                  fillOpacity={0.1}
                  dot={singlePointDot(downloadPointCount, CHART_COLORS[2])}
                />
                <Area
                  type="monotone"
                  dataKey="saves"
                  name={t('admin.analytics.series.save')}
                  stroke={CHART_COLORS[3]}
                  fill={CHART_COLORS[3]}
                  fillOpacity={0.08}
                  dot={singlePointDot(savePointCount, CHART_COLORS[3])}
                />
              </AreaChart>
            </AnalyticsChartContainer>
          ) : (
            <EmptyState />
          )}
        </ChartCard>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <BarBreakdownChart
          title={t('admin.analytics.chart.shareTypes')}
          rows={stats.typeBreakdown}
          valueFormatter={formatNumber}
        />
        <BreakdownChart
          title={t('admin.analytics.chart.shareSources')}
          rows={stats.sourceBreakdown}
          valueFormatter={formatNumber}
        />
      </div>
      <TopSharesTable rows={stats.topShares} />
    </div>
  )
}

function singlePointDot(pointCount: number, color: string) {
  return pointCount === 1 ? { r: 4, fill: color, strokeWidth: 0 } : false
}

function StatCard({
  label,
  value,
  delta,
  deltaLabel,
  icon: Icon,
  metrics = [],
}: {
  label: string
  value: string
  delta?: string
  deltaLabel?: string
  icon: typeof Users
  metrics?: Array<{ label: string; value: string }>
}) {
  const { t } = useTranslation()
  const deltaText = deltaLabel ?? t('admin.analytics.delta')

  return (
    <Card className="gap-0 rounded-lg border-border/70 bg-background py-0 shadow-[0_10px_26px_-26px_rgba(15,23,42,0.65)]">
      <CardContent className="p-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-xs font-medium text-muted-foreground">{label}</CardTitle>
          <span className="flex size-6 items-center justify-center rounded-md bg-muted/65 text-muted-foreground">
            <Icon className="size-3.5" />
          </span>
        </div>

        <div className="mt-2 flex items-baseline justify-between gap-3">
          <div className="text-[26px] font-semibold leading-none tracking-tight tabular-nums">{value}</div>
          {delta && (
            <div className="flex shrink-0 items-baseline gap-1.5">
              <span className="text-xs font-semibold text-primary tabular-nums">{delta}</span>
              <span className="text-[10px] text-muted-foreground">{deltaText}</span>
            </div>
          )}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 border-t border-dashed border-border/70 pt-2">
          {metrics.slice(0, 2).map((metric) => (
            <div key={metric.label} className="min-w-0 rounded-md bg-canvas/50 px-2 py-1.5">
              <div className="truncate text-[11px] leading-none text-muted-foreground">{metric.label}</div>
              <div className="mt-1 truncate text-sm font-semibold leading-none tabular-nums">{metric.value}</div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function ChartCard({
  title,
  subtitle,
  children,
  contentClassName,
}: {
  title: string
  subtitle?: string
  children: ReactNode
  contentClassName?: string
}) {
  return (
    <div className="min-w-0 rounded-xl border border-border/70 bg-background/95 p-4 shadow-[0_14px_36px_-34px_rgba(15,23,42,0.6)] sm:p-5">
      <div className="mb-4 flex flex-col gap-1">
        <h3 className="text-[15px] font-semibold tracking-tight">{title}</h3>
        {subtitle && <p className="text-[13px] leading-5 text-muted-foreground">{subtitle}</p>}
      </div>
      <div className={cn('h-72 min-w-0', contentClassName)}>{children}</div>
    </div>
  )
}

function BreakdownChart({
  title,
  rows,
  valueFormatter,
}: {
  title: string
  rows: Array<{ name: string; value: number; percent: number }>
  valueFormatter: (value: number) => string
}) {
  const { t } = useTranslation()

  return (
    <ChartCard title={title}>
      {hasPositiveBreakdown(rows) ? (
        <div className="grid h-full min-h-0 gap-4 lg:grid-cols-[minmax(0,1fr)_230px]">
          <AnalyticsChartContainer>
            <PieChart>
              <Pie
                data={rows}
                dataKey="value"
                nameKey="name"
                innerRadius="56%"
                outerRadius="78%"
                paddingAngle={2}
                isAnimationActive={false}
              >
                {rows.map((row, index) => (
                  <Cell key={row.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                ))}
              </Pie>
              <RechartsTooltip
                contentStyle={tooltipContentStyle}
                labelStyle={tooltipLabelStyle}
                formatter={(value) => valueFormatter(Number(value))}
              />
            </PieChart>
          </AnalyticsChartContainer>
          <PercentList
            items={rows.map((row, index) => ({
              name: labelize(row.name, t),
              percent: row.percent,
              valueLabel: valueFormatter(row.value),
              fill: CHART_COLORS[index % CHART_COLORS.length],
            }))}
          />
        </div>
      ) : (
        <EmptyState />
      )}
    </ChartCard>
  )
}

function BarBreakdownChart({
  title,
  rows,
  valueFormatter,
}: {
  title: string
  rows: Array<{ name: string; value: number; percent: number }>
  valueFormatter: (value: number) => string
}) {
  const { t } = useTranslation()

  return (
    <ChartCard title={title}>
      {hasPositiveBreakdown(rows) ? (
        <AnalyticsChartContainer>
          <BarChart data={rows} layout="vertical" margin={{ top: 8, right: 44, left: 8, bottom: 0 }}>
            <CartesianGrid stroke={CHART_GRID_COLOR} strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" tickLine={false} axisLine={false} fontSize={12} tickFormatter={formatCompactNumber} />
            <YAxis
              type="category"
              dataKey="name"
              width={86}
              tickLine={false}
              axisLine={false}
              fontSize={12}
              tickFormatter={(value) => labelize(String(value), t)}
            />
            <RechartsTooltip
              contentStyle={tooltipContentStyle}
              labelStyle={tooltipLabelStyle}
              formatter={(value) => valueFormatter(Number(value))}
              labelFormatter={(value) => labelize(String(value), t)}
            />
            <Bar
              dataKey="value"
              name={t('admin.analytics.series.count')}
              radius={[0, 4, 4, 0]}
              isAnimationActive={false}
            >
              {rows.map((row, index) => (
                <Cell key={row.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />
              ))}
              <LabelList dataKey="percent" position="right" formatter={formatPercentLabel} fontSize={11} />
            </Bar>
          </BarChart>
        </AnalyticsChartContainer>
      ) : (
        <EmptyState />
      )}
    </ChartCard>
  )
}

function PercentList({ items }: { items: Array<{ name: string; percent: number; valueLabel: string; fill: string }> }) {
  return (
    <div data-slot="breakdown-legend" className="min-h-0 overflow-y-auto pr-2 [scrollbar-gutter:stable]">
      <div className="flex min-h-full flex-col justify-center gap-3">
        {items.map((item) => (
          <div key={item.name} className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="flex min-w-0 items-center gap-2">
                <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.fill }} />
                <span className="truncate font-medium">{item.name}</span>
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">{item.valueLabel}</span>
            </div>
            <Progress value={clampPercent(item.percent)} className="h-1.5 bg-muted" />
            <p className="text-right text-xs text-muted-foreground">{formatPercent(item.percent)}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function TopSharesTable({ rows }: { rows: AdminDashboardSharingStats['topShares'] }) {
  const { t } = useTranslation()

  return (
    <ChartCard title={t('admin.analytics.chart.topShares')} contentClassName="h-auto">
      {rows.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border/50">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('admin.analytics.table.share')}</TableHead>
                <TableHead>{t('admin.analytics.table.creator')}</TableHead>
                <TableHead className="text-right">{t('admin.analytics.table.views')}</TableHead>
                <TableHead className="text-right">{t('admin.analytics.table.downloads')}</TableHead>
                <TableHead className="text-right">{t('admin.analytics.table.sharePercent')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="max-w-60 truncate font-medium" title={row.name}>
                    {row.name}
                  </TableCell>
                  <TableCell className="max-w-40 truncate text-muted-foreground" title={row.creatorName}>
                    {row.creatorName}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(row.views)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(row.downloads)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatPercent(row.viewPercent)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </ChartCard>
  )
}

function QueryState<T extends AdminStatsRange>({
  query,
  children,
}: {
  query: { isLoading: boolean; isError: boolean; data: T | undefined; refetch?: () => unknown }
  children: (data: T) => ReactNode
}) {
  const { t } = useTranslation()

  if (query.isLoading) return <SectionSkeleton />
  if (query.isError)
    return (
      <div className="flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
        <span>{t('admin.analytics.loadError')}</span>
        {query.refetch && (
          <Button type="button" variant="outline" size="sm" onClick={() => query.refetch?.()}>
            {t('admin.analytics.retry')}
          </Button>
        )}
      </div>
    )
  if (!query.data) return <EmptyState />
  return children(query.data)
}

function SectionSkeleton() {
  return (
    <div className="grid gap-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {[1, 2, 3, 4].map((item) => (
          <Skeleton key={item} className="h-28 rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-80 rounded-lg" />
    </div>
  )
}

function EmptyState() {
  const { t } = useTranslation()

  return (
    <div className="flex h-full min-h-32 items-center justify-center rounded-lg border border-dashed border-border/70 bg-muted/10 p-8 text-center text-sm text-muted-foreground">
      {t('admin.analytics.empty')}
    </div>
  )
}

function hasNumericData<T extends object>(rows: readonly T[], keys: readonly (keyof T)[]): boolean {
  return rows.some((row) => keys.some((key) => typeof row[key] === 'number' && Number.isFinite(row[key])))
}

function hasPositiveBreakdown(rows: Array<{ value: number }>): boolean {
  return rows.some((row) => row.value > 0)
}

function dateRangePresets(t: AnalyticsTranslate): Array<{ label: string; range: DateRange }> {
  const today = utcCalendarDate(new Date())
  return [
    { label: t('admin.analytics.preset.last3'), range: { from: startOfDay(subDays(today, 2)), to: endOfDay(today) } },
    { label: t('admin.analytics.preset.last7'), range: { from: startOfDay(subDays(today, 6)), to: endOfDay(today) } },
    {
      label: t('admin.analytics.preset.last30'),
      range: { from: startOfDay(subDays(today, 29)), to: endOfDay(today) },
    },
    { label: t('admin.analytics.preset.thisMonth'), range: { from: startOfMonth(today), to: endOfDay(today) } },
    {
      label: t('admin.analytics.preset.lastMonth'),
      range: { from: startOfMonth(subMonths(today, 1)), to: endOfMonth(subMonths(today, 1)) },
    },
  ]
}

function utcCalendarDate(value: Date): Date {
  return new Date(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate())
}

function toRangeFilter(range: DateRange): AdminStatsRangeFilter {
  return {
    ...(range.from ? { from: format(range.from, 'yyyy-MM-dd') } : {}),
    ...(range.to ? { to: format(range.to, 'yyyy-MM-dd') } : {}),
    timeZone: 'UTC',
  }
}

function rangeKey(range: DateRange): string {
  return `${range.from?.toISOString() ?? ''}:${range.to?.toISOString() ?? ''}`
}

function formatRange(range: DateRange, t: AnalyticsTranslate): string {
  if (!range.from) return t('admin.analytics.range.select')
  if (!range.to) return format(range.from, 'yyyy-MM-dd')
  return `${format(range.from, 'yyyy-MM-dd')} - ${format(range.to, 'yyyy-MM-dd')}`
}

function normalizeDateRange(range: DateRange): DateRange {
  if (!range.from || !range.to) return range
  if (range.from <= range.to) return range
  return { from: range.to, to: range.from }
}

function formatNumber(value: number | null): string {
  if (value === null) return '—'
  return new Intl.NumberFormat().format(value)
}

function formatSize(value: number | null): string {
  return value === null ? '—' : formatByteSize(value)
}

function formatChartDate(value: unknown): string {
  const text = String(value)
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text)
  if (!match) return text
  return `${Number(match[2])}/${Number(match[3])}`
}

function formatPercent(value: number | null): string {
  if (value === null) return '—'
  return `${Math.round(value * 10) / 10}%`
}

function formatPercentLabel(value: unknown): string {
  return `${value}%`
}

function formatDelta(
  delta: { value: number | null; previousValue: number | null; change: number | null; changePercent: number | null },
  valueFormatter: (value: number) => string = formatNumber,
): string {
  if (delta.change === null) return '—'
  const sign = delta.change >= 0 ? '+' : ''
  return `${sign}${valueFormatter(delta.change)} (${formatPercent(delta.changePercent)})`
}

function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

function formatCompactSize(value: number): string {
  if (value < 1024) return `${value} B`
  return formatSize(value).replace(' ', '')
}

// Series names come from the locale files, so the tooltip chooses its value
// formatter from the series dataKey rather than matching the label text.
function tooltipFormatter(formats: Record<string, (value: number) => string>) {
  return (value: unknown, name: unknown, item: { dataKey?: unknown }) => {
    const formatValue = formats[String(item?.dataKey ?? '')] ?? formatNumber
    return [formatValue(Number(value)), String(name)]
  }
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, value))
}

function labelize(value: string, t: AnalyticsTranslate): string {
  return t(`admin.analytics.label.${value}`, { defaultValue: value })
}
