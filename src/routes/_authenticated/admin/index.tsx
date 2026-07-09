import type {
  AdminDashboardGrowthStats,
  AdminDashboardOverviewStats,
  AdminDashboardRankingStats,
  AdminDashboardSharingStats,
  AdminDashboardStorageStats,
  AdminDashboardTrafficStats,
} from '@shared/types'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { endOfDay, endOfMonth, format, startOfDay, startOfMonth, subDays, subMonths } from 'date-fns'
import { FunnelChart as EChartsFunnelChart } from 'echarts/charts'
import { TooltipComponent } from 'echarts/components'
import * as echarts from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
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
  Users,
} from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import type { DateRange } from 'react-day-picker'
import {
  Area,
  AreaChart,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts'
import { UpgradeHint } from '@/components/UpgradeHint'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useEntitlement } from '@/hooks/useEntitlement'
import {
  type AdminStatsRangeFilter,
  getAdminDashboardGrowthStats,
  getAdminDashboardOverviewStats,
  getAdminDashboardRankingStats,
  getAdminDashboardSharingStats,
  getAdminDashboardStorageStats,
  getAdminDashboardTrafficStats,
} from '@/lib/api'
import { formatDate, formatSize } from '@/lib/format'
import { cn } from '@/lib/utils'

echarts.use([EChartsFunnelChart, TooltipComponent, CanvasRenderer])

export const Route = createFileRoute('/_authenticated/admin/')({
  component: OverviewPage,
})

type SectionId = 'overview' | 'growth' | 'storage' | 'traffic' | 'sharing' | 'ranking'

const SECTION_ORDER: SectionId[] = ['overview', 'growth', 'storage', 'traffic', 'sharing', 'ranking']
const CHART_COLORS = ['#0f766e', '#0369a1', '#b45309', '#7c3aed', '#be123c', '#64748b', '#0284c7', '#15803d']

export function OverviewPage() {
  const today = useMemo(() => new Date(), [])
  const [openSections, setOpenSections] = useState<Set<SectionId>>(() => new Set(['overview']))
  const [ranges, setRanges] = useState<Record<SectionId, DateRange>>(() => initialRanges(today))
  const { hasFeature, isLoading: entitlementLoading } = useEntitlement()
  const hasAnalytics = hasFeature('analytics')

  const overviewQuery = useQuery({
    queryKey: ['admin', 'dashboard', 'overview', rangeKey(ranges.overview)],
    queryFn: () => getAdminDashboardOverviewStats(toRangeFilter(ranges.overview)),
    staleTime: 30_000,
  })
  const growthQuery = useDashboardSectionQuery(
    'growth',
    ranges.growth,
    openSections,
    hasAnalytics,
    getAdminDashboardGrowthStats,
  )
  const storageQuery = useDashboardSectionQuery(
    'storage',
    ranges.storage,
    openSections,
    hasAnalytics,
    getAdminDashboardStorageStats,
  )
  const trafficQuery = useDashboardSectionQuery(
    'traffic',
    ranges.traffic,
    openSections,
    hasAnalytics,
    getAdminDashboardTrafficStats,
  )
  const sharingQuery = useDashboardSectionQuery(
    'sharing',
    ranges.sharing,
    openSections,
    hasAnalytics,
    getAdminDashboardSharingStats,
  )
  const rankingQuery = useDashboardSectionQuery(
    'ranking',
    ranges.ranking,
    openSections,
    hasAnalytics,
    getAdminDashboardRankingStats,
  )

  function updateRange(section: SectionId, range: DateRange) {
    setRanges((current) => ({ ...current, [section]: range }))
  }

  function toggleSection(section: SectionId) {
    if (section !== 'overview' && !hasAnalytics) return
    setOpenSections((current) => {
      const next = new Set(current)
      if (next.has(section)) next.delete(section)
      else next.add(section)
      return next
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <DashboardSection
        id="overview"
        title="站点概览"
        description="站长每天最先看的核心经营数据。"
        open={openSections.has('overview')}
        range={ranges.overview}
        onRangeChange={(range) => updateRange('overview', range)}
        onToggle={() => toggleSection('overview')}
      >
        <QueryState query={overviewQuery}>{(data) => <OverviewSection stats={data} />}</QueryState>
      </DashboardSection>

      {SECTION_ORDER.filter((section) => section !== 'overview').map((section) => (
        <DashboardSection
          key={section}
          id={section}
          title={sectionTitle(section)}
          description={sectionDescription(section)}
          open={openSections.has(section)}
          locked={!hasAnalytics && !entitlementLoading}
          range={ranges[section]}
          onRangeChange={(range) => updateRange(section, range)}
          onToggle={() => toggleSection(section)}
        >
          {!hasAnalytics ? (
            <UpgradeHint
              feature="analytics"
              title="解锁高级统计"
              description="这些下钻看板需要 ZPan Pro 或 Business。核心概览数据会继续展示。"
              actionLabel="打开授权"
            />
          ) : section === 'growth' ? (
            <QueryState query={growthQuery}>{(data) => <GrowthSection stats={data} />}</QueryState>
          ) : section === 'storage' ? (
            <QueryState query={storageQuery}>{(data) => <StorageSection stats={data} />}</QueryState>
          ) : section === 'traffic' ? (
            <QueryState query={trafficQuery}>{(data) => <TrafficSection stats={data} />}</QueryState>
          ) : section === 'sharing' ? (
            <QueryState query={sharingQuery}>{(data) => <SharingSection stats={data} />}</QueryState>
          ) : (
            <QueryState query={rankingQuery}>{(data) => <RankingSection stats={data} />}</QueryState>
          )}
        </DashboardSection>
      ))}
    </div>
  )
}

function useDashboardSectionQuery<T>(
  section: SectionId,
  range: DateRange,
  openSections: Set<SectionId>,
  enabled: boolean,
  queryFn: (filter: AdminStatsRangeFilter) => Promise<T>,
) {
  return useQuery({
    queryKey: ['admin', 'dashboard', section, rangeKey(range)],
    queryFn: () => queryFn(toRangeFilter(range)),
    enabled: enabled && openSections.has(section),
    staleTime: 30_000,
  })
}

function DashboardSection({
  title,
  description,
  open,
  locked,
  range,
  children,
  onToggle,
  onRangeChange,
}: {
  id: SectionId
  title: string
  description: string
  open: boolean
  locked?: boolean
  range: DateRange
  children: ReactNode
  onToggle: () => void
  onRangeChange: (range: DateRange) => void
}) {
  return (
    <section className="rounded-md border bg-card">
      <div className="flex flex-col gap-3 border-b px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={onToggle}>
          <ChevronDown
            className={cn(
              'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
              open ? 'rotate-0' : '-rotate-90',
            )}
          />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold tracking-tight">{title}</h2>
              {locked && <Lock className="h-3.5 w-3.5 text-muted-foreground" />}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          </div>
        </button>
        {open && !locked && <DateRangePicker value={range} onChange={onRangeChange} />}
      </div>
      {open && <div className="p-4">{children}</div>}
    </section>
  )
}

function DateRangePicker({ value, onChange }: { value: DateRange; onChange: (range: DateRange) => void }) {
  const presets = dateRangePresets()
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="h-8 justify-start gap-2">
          <CalendarDays className="h-4 w-4" />
          <span>{formatRange(value)}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto p-3">
        <div className="grid gap-3 lg:grid-cols-[140px_auto]">
          <div className="grid content-start gap-1">
            {presets.map((preset) => (
              <Button
                key={preset.label}
                type="button"
                variant="ghost"
                size="sm"
                className="justify-start"
                onClick={() => onChange(preset.range)}
              >
                {preset.label}
              </Button>
            ))}
          </div>
          <Calendar mode="range" selected={value} onSelect={(range) => range && onChange(range)} numberOfMonths={2} />
        </div>
      </PopoverContent>
    </Popover>
  )
}

function OverviewSection({ stats }: { stats: AdminDashboardOverviewStats }) {
  const cards = [
    {
      label: '注册用户',
      value: formatNumber(stats.totals.users),
      delta: formatDelta(stats.totals.newUsers),
      icon: Users,
      metrics: [
        { label: '新增用户', value: formatNumber(stats.totals.newUsers.value) },
        { label: '活跃用户', value: formatNumber(stats.totals.activeUsers.value) },
      ],
    },
    {
      label: '活跃用户',
      value: formatNumber(stats.totals.activeUsers.value),
      delta: formatDelta(stats.totals.activeUsers),
      icon: TrendingUp,
      metrics: [
        { label: '活跃率', value: formatPercent(ratio(stats.totals.activeUsers.value, stats.totals.users)) },
        { label: '环比人数', value: formatNumber(stats.totals.activeUsers.previousValue) },
      ],
    },
    {
      label: '存储占用',
      value: formatSize(stats.totals.storageUsedBytes),
      delta: formatDelta(stats.totals.uploadBytes, formatSize),
      icon: Database,
      metrics: [
        { label: '使用率', value: formatPercent(ratio(stats.totals.storageUsedBytes, stats.totals.storageQuotaBytes)) },
        { label: '区间新增', value: formatSize(stats.totals.uploadBytes.value) },
      ],
    },
    {
      label: '流量统计',
      value: formatSize(stats.totals.trafficBytes.value),
      delta: formatDelta(stats.totals.trafficBytes, formatSize),
      icon: Network,
      metrics: [
        { label: '上传', value: formatSize(stats.totals.uploadBytes.value) },
        { label: '下载', value: formatSize(stats.totals.downloadBytes.value) },
      ],
    },
  ]

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <StatCard key={card.label} {...card} />
        ))}
      </div>
      <ChartCard title="核心趋势" subtitle={`数据范围 ${formatDate(stats.from)} - ${formatDate(stats.to)}`}>
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={stats.trends} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="date" tickLine={false} axisLine={false} fontSize={12} minTickGap={18} />
            <YAxis
              yAxisId="count"
              tickLine={false}
              axisLine={false}
              fontSize={12}
              width={42}
              tickFormatter={formatCompactNumber}
            />
            <YAxis
              yAxisId="bytes"
              orientation="right"
              tickLine={false}
              axisLine={false}
              fontSize={12}
              width={56}
              tickFormatter={formatCompactSize}
            />
            <RechartsTooltip formatter={chartTooltipFormatter} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar yAxisId="count" dataKey="newUsers" name="新增用户" fill={CHART_COLORS[1]} radius={[4, 4, 0, 0]} />
            <Line
              yAxisId="count"
              type="monotone"
              dataKey="activeUsers"
              name="活跃用户"
              stroke={CHART_COLORS[0]}
              strokeWidth={2}
              dot={false}
            />
            <Line
              yAxisId="bytes"
              type="monotone"
              dataKey="uploadBytes"
              name="上传流量"
              stroke={CHART_COLORS[2]}
              strokeWidth={2}
              dot={false}
            />
            <Line
              yAxisId="bytes"
              type="monotone"
              dataKey="downloadBytes"
              name="下载流量"
              stroke={CHART_COLORS[3]}
              strokeWidth={2}
              dot={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  )
}

function GrowthSection({ stats }: { stats: AdminDashboardGrowthStats }) {
  return (
    <div className="grid gap-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="总用户数"
          value={formatNumber(stats.summary.totalUsers)}
          delta={formatDelta(stats.summary.newUsers)}
          icon={Users}
          metrics={[
            { label: '新增用户', value: formatNumber(stats.summary.newUsers.value) },
            { label: '已验证', value: formatNumber(stats.summary.verifiedUsers) },
          ]}
        />
        <StatCard
          label="活跃用户"
          value={formatNumber(stats.summary.activeUsers.value)}
          delta={formatDelta(stats.summary.activeUsers)}
          icon={Activity}
          metrics={[
            { label: '沉默用户', value: formatNumber(stats.summary.silentUsers) },
            { label: '禁用用户', value: formatNumber(stats.summary.bannedUsers) },
          ]}
        />
        <StatCard
          label="新增用户"
          value={formatNumber(stats.summary.newUsers.value)}
          delta={formatDelta(stats.summary.newUsers)}
          icon={TrendingUp}
          metrics={[
            { label: '上期新增', value: formatNumber(stats.summary.newUsers.previousValue) },
            { label: '变化', value: formatPercent(stats.summary.newUsers.changePercent) },
          ]}
        />
        <StatCard
          label="沉默用户"
          value={formatNumber(stats.summary.silentUsers)}
          icon={FileClock}
          metrics={[
            { label: '占比', value: formatPercent(ratio(stats.summary.silentUsers, stats.summary.totalUsers)) },
            { label: '活跃率', value: formatPercent(ratio(stats.summary.activeUsers.value, stats.summary.totalUsers)) },
          ]}
        />
      </div>
      <ChartCard title="用户规模趋势">
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={stats.userScaleTrend}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="date" tickLine={false} axisLine={false} fontSize={12} />
            <YAxis tickLine={false} axisLine={false} fontSize={12} width={48} tickFormatter={formatCompactNumber} />
            <RechartsTooltip formatter={chartTooltipFormatter} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="newUsers" name="新增用户" fill={CHART_COLORS[1]} radius={[4, 4, 0, 0]} />
            <Line
              type="monotone"
              dataKey="totalUsers"
              name="累计用户"
              stroke={CHART_COLORS[0]}
              strokeWidth={2}
              dot={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </ChartCard>
      <ChartCard title="活跃用户趋势">
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={stats.activeUserTrend}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="date" tickLine={false} axisLine={false} fontSize={12} />
            <YAxis tickLine={false} axisLine={false} fontSize={12} width={48} tickFormatter={formatCompactNumber} />
            <RechartsTooltip formatter={chartTooltipFormatter} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Area
              type="monotone"
              dataKey="mau"
              name="MAU"
              stroke={CHART_COLORS[5]}
              fill={CHART_COLORS[5]}
              fillOpacity={0.08}
            />
            <Area
              type="monotone"
              dataKey="wau"
              name="WAU"
              stroke={CHART_COLORS[3]}
              fill={CHART_COLORS[3]}
              fillOpacity={0.12}
            />
            <Area
              type="monotone"
              dataKey="dau"
              name="DAU"
              stroke={CHART_COLORS[0]}
              fill={CHART_COLORS[0]}
              fillOpacity={0.16}
            />
          </AreaChart>
        </ResponsiveContainer>
      </ChartCard>
      <BreakdownGrid
        leftTitle="用户状态分布"
        leftData={stats.userStatus}
        rightTitle="注册来源分布"
        rightData={stats.registrationSources}
      />
    </div>
  )
}

function StorageSection({ stats }: { stats: AdminDashboardStorageStats }) {
  return (
    <div className="grid gap-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="存储占用"
          value={formatSize(stats.summary.storageUsedBytes)}
          icon={HardDrive}
          metrics={[
            {
              label: '配额使用率',
              value: formatPercent(ratio(stats.summary.storageUsedBytes, stats.summary.quotaBytes)),
            },
            { label: '文件数', value: formatNumber(stats.summary.fileCount) },
          ]}
        />
        <StatCard
          label="新增容量"
          value={formatSize(stats.summary.newBytes.value)}
          delta={formatDelta(stats.summary.newBytes, formatSize)}
          icon={Upload}
          metrics={[
            { label: '新增文件', value: formatNumber(stats.summary.newFiles.value) },
            { label: '上期容量', value: formatSize(stats.summary.newBytes.previousValue) },
          ]}
        />
        <StatCard
          label="新增文件"
          value={formatNumber(stats.summary.newFiles.value)}
          delta={formatDelta(stats.summary.newFiles)}
          icon={Database}
          metrics={[
            { label: '上期新增', value: formatNumber(stats.summary.newFiles.previousValue) },
            { label: '文件总数', value: formatNumber(stats.summary.fileCount) },
          ]}
        />
        <StatCard
          label="冷文件容量"
          value={formatSize(stats.summary.coldFileBytes)}
          icon={FileClock}
          metrics={[
            {
              label: '冷文件占比',
              value: formatPercent(ratio(stats.summary.coldFileBytes, stats.summary.storageUsedBytes)),
            },
            { label: '当前占用', value: formatSize(stats.summary.storageUsedBytes) },
          ]}
        />
      </div>
      <ChartCard title="存储增长趋势">
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={stats.storageTrend}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="date" tickLine={false} axisLine={false} fontSize={12} />
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
            <RechartsTooltip formatter={chartTooltipFormatter} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar yAxisId="files" dataKey="newFiles" name="新增文件" fill={CHART_COLORS[1]} radius={[4, 4, 0, 0]} />
            <Line
              yAxisId="bytes"
              type="monotone"
              dataKey="usedBytes"
              name="存储占用"
              stroke={CHART_COLORS[0]}
              strokeWidth={2}
              dot={false}
            />
            <Line
              yAxisId="bytes"
              type="monotone"
              dataKey="newBytes"
              name="新增容量"
              stroke={CHART_COLORS[2]}
              strokeWidth={2}
              dot={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </ChartCard>
      <BreakdownGrid
        leftTitle="文件类型容量占比"
        leftData={stats.typeBreakdown.map((row) => ({ name: row.type, value: row.bytes, percent: row.percent }))}
        rightTitle="文件大小结构"
        rightData={stats.sizeBreakdown.map((row) => ({ name: row.name, value: row.bytes, percent: row.percent }))}
        valueFormatter={formatSize}
      />
      <BreakdownTable
        title="文件年龄分布"
        rows={stats.ageBreakdown.map((row) => ({
          name: row.name,
          value: row.bytes,
          percent: row.percent,
          detail: `${formatNumber(row.files)} files`,
        }))}
        valueFormatter={formatSize}
      />
    </div>
  )
}

function TrafficSection({ stats }: { stats: AdminDashboardTrafficStats }) {
  return (
    <div className="grid gap-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="总流量"
          value={formatSize(stats.summary.totalBytes.value)}
          delta={formatDelta(stats.summary.totalBytes, formatSize)}
          icon={Network}
          metrics={[
            { label: '峰值日流量', value: formatSize(stats.summary.peakDailyBytes) },
            { label: '请求量', value: formatNumber(stats.summary.requestCount.value) },
          ]}
        />
        <StatCard
          label="请求量"
          value={formatNumber(stats.summary.requestCount.value)}
          delta={formatDelta(stats.summary.requestCount)}
          icon={Activity}
          metrics={[
            { label: '下载签发', value: formatNumber(stats.summary.issuedDownloads) },
            { label: '拦截请求', value: formatNumber(stats.summary.blockedDownloads) },
          ]}
        />
        <StatCard
          label="签发放行率"
          value={formatPercent(stats.summary.issueRate)}
          icon={Download}
          metrics={[
            { label: '签发成功', value: formatNumber(stats.summary.issuedDownloads) },
            { label: '计量拦截', value: formatNumber(stats.summary.blockedDownloads) },
          ]}
        />
        <StatCard
          label="峰值日流量"
          value={formatSize(stats.summary.peakDailyBytes)}
          icon={TrendingUp}
          metrics={[
            { label: '统计口径', value: '签发/计费流量' },
            { label: '总流量', value: formatSize(stats.summary.totalBytes.value) },
          ]}
        />
      </div>
      <ChartCard title="流量与请求趋势">
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={stats.trafficTrend}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="date" tickLine={false} axisLine={false} fontSize={12} />
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
            <RechartsTooltip formatter={chartTooltipFormatter} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar yAxisId="count" dataKey="requests" name="请求量" fill={CHART_COLORS[5]} radius={[4, 4, 0, 0]} />
            <Line
              yAxisId="bytes"
              type="monotone"
              dataKey="uploadBytes"
              name="上传流量"
              stroke={CHART_COLORS[0]}
              strokeWidth={2}
              dot={false}
            />
            <Line
              yAxisId="bytes"
              type="monotone"
              dataKey="downloadBytes"
              name="下载流量"
              stroke={CHART_COLORS[2]}
              strokeWidth={2}
              dot={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </ChartCard>
      <BreakdownGrid
        leftTitle="流量来源占比"
        leftData={stats.sourceBreakdown.map((row) => ({ name: row.name, value: row.bytes, percent: row.percent }))}
        rightTitle="签发状态分布"
        rightData={stats.issueStatus.map((row) => ({ name: row.status, value: row.count, percent: row.percent }))}
        valueFormatter={formatSize}
      />
    </div>
  )
}

function SharingSection({ stats }: { stats: AdminDashboardSharingStats }) {
  return (
    <div className="grid gap-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="分享链接"
          value={formatNumber(stats.summary.activeShares)}
          delta={formatDelta(stats.summary.createdShares)}
          icon={Share2}
          metrics={[
            { label: '区间创建', value: formatNumber(stats.summary.createdShares.value) },
            { label: '下载转化', value: formatPercent(stats.summary.downloadConversionRate) },
          ]}
        />
        <StatCard
          label="访问次数"
          value={formatNumber(stats.summary.views.value)}
          delta={formatDelta(stats.summary.views)}
          icon={Activity}
          metrics={[
            { label: '下载请求', value: formatNumber(stats.summary.downloads.value) },
            { label: '转存次数', value: formatNumber(stats.summary.saves.value) },
          ]}
        />
        <StatCard
          label="下载签发"
          value={formatNumber(stats.summary.downloads.value)}
          delta={formatDelta(stats.summary.downloads)}
          icon={Download}
          metrics={[
            { label: '访问转化', value: formatPercent(stats.summary.downloadConversionRate) },
            { label: '上期下载', value: formatNumber(stats.summary.downloads.previousValue) },
          ]}
        />
        <StatCard
          label="转存到网盘"
          value={formatNumber(stats.summary.saves.value)}
          delta={formatDelta(stats.summary.saves)}
          icon={Link2}
          metrics={[
            { label: '转存率', value: formatPercent(ratio(stats.summary.saves.value, stats.summary.views.value)) },
            { label: '上期转存', value: formatNumber(stats.summary.saves.previousValue) },
          ]}
        />
      </div>
      <ChartCard title="分享转化漏斗">
        <FunnelChart data={stats.funnel} />
      </ChartCard>
      <ChartCard title="访问行为趋势">
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={stats.trend}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="date" tickLine={false} axisLine={false} fontSize={12} />
            <YAxis tickLine={false} axisLine={false} fontSize={12} width={48} tickFormatter={formatCompactNumber} />
            <RechartsTooltip formatter={chartTooltipFormatter} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Area
              type="monotone"
              dataKey="views"
              name="访问"
              stroke={CHART_COLORS[0]}
              fill={CHART_COLORS[0]}
              fillOpacity={0.12}
            />
            <Area
              type="monotone"
              dataKey="downloads"
              name="下载签发"
              stroke={CHART_COLORS[2]}
              fill={CHART_COLORS[2]}
              fillOpacity={0.1}
            />
            <Area
              type="monotone"
              dataKey="saves"
              name="转存"
              stroke={CHART_COLORS[3]}
              fill={CHART_COLORS[3]}
              fillOpacity={0.08}
            />
          </AreaChart>
        </ResponsiveContainer>
      </ChartCard>
      <BreakdownGrid
        leftTitle="分享类型分布"
        leftData={stats.typeBreakdown}
        rightTitle="访问来源分布"
        rightData={stats.sourceBreakdown}
      />
      <TopSharesTable rows={stats.topShares} />
    </div>
  )
}

function RankingSection({ stats }: { stats: AdminDashboardRankingStats }) {
  return (
    <div className="grid gap-4">
      <TopSharesTable rows={stats.topShares} />
      <ChartCard title="空间容量排行">
        <div className="grid gap-3">
          {stats.topSpaces.map((space) => (
            <div key={space.orgId} className="grid gap-2 rounded-md border px-3 py-2">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="truncate font-medium">{space.orgName}</span>
                <span className="shrink-0 tabular-nums">{formatSize(space.usedBytes)}</span>
              </div>
              <Progress value={clampPercent(space.utilization)} />
              <p className="text-xs text-muted-foreground">
                {space.orgType} · {formatPercent(space.utilization)}
              </p>
            </div>
          ))}
        </div>
      </ChartCard>
      <BreakdownTable
        title="文件类型排行"
        rows={stats.storageByType.map((row) => ({
          name: row.type,
          value: row.bytes,
          detail: `${formatNumber(row.files)} files`,
        }))}
        valueFormatter={formatSize}
      />
    </div>
  )
}

function StatCard({
  label,
  value,
  delta,
  icon: Icon,
  metrics = [],
}: {
  label: string
  value: string
  delta?: string
  icon: typeof Users
  metrics?: Array<{ label: string; value: string }>
}) {
  return (
    <Card className="shadow-none">
      <CardContent className="p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground">{label}</p>
            <p className="mt-1 truncate text-2xl font-semibold tabular-nums">{value}</p>
          </div>
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 border-t pt-2">
          {metrics.slice(0, 2).map((metric) => (
            <div key={metric.label} className="min-w-0">
              <p className="truncate text-[11px] text-muted-foreground">{metric.label}</p>
              <p className="truncate text-sm font-medium tabular-nums">{metric.value}</p>
            </div>
          ))}
          {delta && (
            <div className="min-w-0">
              <p className="truncate text-[11px] text-muted-foreground">环比</p>
              <p className="truncate text-sm font-medium tabular-nums">{delta}</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function ChartCard({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <Card className="shadow-none">
      <CardHeader className="px-4 pb-2 pt-3">
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
        {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
      </CardHeader>
      <CardContent className="px-4 pb-4">{children}</CardContent>
    </Card>
  )
}

function BreakdownGrid({
  leftTitle,
  leftData,
  rightTitle,
  rightData,
  valueFormatter = formatNumber,
}: {
  leftTitle: string
  leftData: Array<{ name: string; value: number; percent: number }>
  rightTitle: string
  rightData: Array<{ name: string; value: number; percent: number }>
  valueFormatter?: (value: number) => string
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <BreakdownChart title={leftTitle} rows={leftData} valueFormatter={valueFormatter} />
      <BreakdownChart title={rightTitle} rows={rightData} valueFormatter={valueFormatter} />
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
  return (
    <ChartCard title={title}>
      <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={rows} dataKey="value" nameKey="name" innerRadius={52} outerRadius={84} paddingAngle={2}>
                {rows.map((row, index) => (
                  <Cell key={row.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                ))}
              </Pie>
              <RechartsTooltip formatter={(value) => valueFormatter(Number(value))} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <BreakdownRows rows={rows} valueFormatter={valueFormatter} />
      </div>
    </ChartCard>
  )
}

function BreakdownTable({
  title,
  rows,
  valueFormatter,
}: {
  title: string
  rows: Array<{ name: string; value: number; percent?: number; detail?: string }>
  valueFormatter: (value: number) => string
}) {
  return (
    <ChartCard title={title}>
      <BreakdownRows rows={rows} valueFormatter={valueFormatter} />
    </ChartCard>
  )
}

function BreakdownRows({
  rows,
  valueFormatter,
}: {
  rows: Array<{ name: string; value: number; percent?: number; detail?: string }>
  valueFormatter: (value: number) => string
}) {
  if (rows.length === 0) return <EmptyState />
  return (
    <div className="grid content-start gap-2">
      {rows.map((row, index) => (
        <div key={row.name} className="grid gap-1 rounded-md border px-3 py-2">
          <div className="flex items-center justify-between gap-3 text-sm">
            <div className="flex min-w-0 items-center gap-2">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }}
              />
              <span className="truncate font-medium">{labelize(row.name)}</span>
            </div>
            <span className="shrink-0 tabular-nums">{valueFormatter(row.value)}</span>
          </div>
          {row.percent !== undefined && <Progress value={clampPercent(row.percent)} />}
          <p className="text-xs text-muted-foreground">
            {row.detail ?? (row.percent !== undefined ? `${formatPercent(row.percent)} of total` : '')}
          </p>
        </div>
      ))}
    </div>
  )
}

function FunnelChart({ data }: { data: Array<{ name: string; value: number; percent: number }> }) {
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!ref.current) return
    const chart = echarts.init(ref.current)
    chart.setOption({
      tooltip: {
        trigger: 'item',
        formatter: ({ name, value }: { name: string; value: number }) => `${labelize(name)}: ${formatNumber(value)}`,
      },
      series: [
        {
          type: 'funnel',
          left: '4%',
          top: 12,
          bottom: 12,
          width: '92%',
          minSize: '24%',
          maxSize: '96%',
          sort: 'none',
          gap: 4,
          label: {
            formatter: ({ name, value }: { name: string; value: number }) =>
              `${labelize(name)}  ${formatNumber(value)}`,
          },
          itemStyle: { borderColor: 'var(--color-card)', borderWidth: 1 },
          data: data.map((item, index) => ({
            name: item.name,
            value: item.value,
            itemStyle: { color: CHART_COLORS[index % CHART_COLORS.length] },
          })),
        },
      ],
    })
    const onResize = () => chart.resize()
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      chart.dispose()
    }
  }, [data])
  return <div ref={ref} className="h-72 w-full" />
}

function TopSharesTable({ rows }: { rows: AdminDashboardSharingStats['topShares'] }) {
  return (
    <ChartCard title="Top 分享">
      {rows.length === 0 ? (
        <EmptyState />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>分享</TableHead>
              <TableHead>创建者</TableHead>
              <TableHead className="text-right">访问</TableHead>
              <TableHead className="text-right">下载</TableHead>
              <TableHead className="text-right">占比</TableHead>
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
      )}
    </ChartCard>
  )
}

function QueryState<T>({
  query,
  children,
}: {
  query: { isLoading: boolean; isError: boolean; data: T | undefined }
  children: (data: T) => ReactNode
}) {
  if (query.isLoading) return <SectionSkeleton />
  if (query.isError)
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
        统计数据加载失败。
      </div>
    )
  if (!query.data) return <EmptyState />
  return <>{children(query.data)}</>
}

function SectionSkeleton() {
  return (
    <div className="grid gap-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {[1, 2, 3, 4].map((item) => (
          <Skeleton key={item} className="h-28 rounded-md" />
        ))}
      </div>
      <Skeleton className="h-80 rounded-md" />
    </div>
  )
}

function EmptyState() {
  return (
    <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">暂无统计数据</div>
  )
}

function initialRanges(today: Date): Record<SectionId, DateRange> {
  const last30 = { from: startOfDay(subDays(today, 29)), to: endOfDay(today) }
  return {
    overview: last30,
    growth: last30,
    storage: { from: startOfDay(subDays(today, 89)), to: endOfDay(today) },
    traffic: { from: startOfDay(subDays(today, 6)), to: endOfDay(today) },
    sharing: last30,
    ranking: last30,
  }
}

function dateRangePresets(): Array<{ label: string; range: DateRange }> {
  const today = new Date()
  return [
    { label: '最近 3 天', range: { from: startOfDay(subDays(today, 2)), to: endOfDay(today) } },
    { label: '最近 7 天', range: { from: startOfDay(subDays(today, 6)), to: endOfDay(today) } },
    { label: '最近 30 天', range: { from: startOfDay(subDays(today, 29)), to: endOfDay(today) } },
    { label: '最近一个月', range: { from: startOfDay(subDays(today, 30)), to: endOfDay(today) } },
    { label: '本月', range: { from: startOfMonth(today), to: endOfDay(today) } },
    { label: '上月', range: { from: startOfMonth(subMonths(today, 1)), to: endOfMonth(subMonths(today, 1)) } },
  ]
}

function toRangeFilter(range: DateRange): AdminStatsRangeFilter {
  return {
    ...(range.from ? { from: startOfDay(range.from).toISOString() } : {}),
    ...(range.to ? { to: endOfDay(range.to).toISOString() } : {}),
  }
}

function rangeKey(range: DateRange): string {
  return `${range.from?.toISOString() ?? ''}:${range.to?.toISOString() ?? ''}`
}

function formatRange(range: DateRange): string {
  if (!range.from) return '选择时间范围'
  if (!range.to) return format(range.from, 'yyyy-MM-dd')
  return `${format(range.from, 'yyyy-MM-dd')} - ${format(range.to, 'yyyy-MM-dd')}`
}

function sectionTitle(section: SectionId): string {
  if (section === 'growth') return '用户与增长'
  if (section === 'storage') return '存储与文件'
  if (section === 'traffic') return '流量统计'
  if (section === 'sharing') return '分享与访问'
  return '排行与明细'
}

function sectionDescription(section: SectionId): string {
  if (section === 'growth') return '注册、活跃、沉默用户和增长来源。'
  if (section === 'storage') return '容量增长、文件结构、冷文件和空间压力。'
  if (section === 'traffic') return '上传确认、下载签发、计费流量和请求放行情况。'
  if (section === 'sharing') return '分享访问、下载签发、转存和 Top 分享。'
  return '用于站长定位高占用空间、高访问分享和主要文件类型。'
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value)
}

function formatPercent(value: number): string {
  return `${Math.round(value * 10) / 10}%`
}

function ratio(part: number, total: number): number {
  if (total <= 0) return 0
  return (part / total) * 100
}

function formatDelta(
  delta: { value: number; previousValue: number; changePercent: number },
  valueFormatter: (value: number) => string = formatNumber,
): string {
  const sign = delta.value >= delta.previousValue ? '+' : ''
  return `${sign}${valueFormatter(delta.value - delta.previousValue)} (${formatPercent(delta.changePercent)})`
}

function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

function formatCompactSize(value: number): string {
  if (value < 1024) return `${value} B`
  return formatSize(value).replace(' ', '')
}

function chartTooltipFormatter(value: unknown, name: unknown) {
  const numeric = Number(value)
  const label = String(name)
  const formatted = label.includes('容量') || label.includes('流量') ? formatSize(numeric) : formatNumber(numeric)
  return [formatted, label]
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, value))
}

function labelize(value: string): string {
  const labels: Record<string, string> = {
    normal: '正常用户',
    unverified: '未验证',
    banned: '已禁用',
    silent: '沉默用户',
    direct: '直接注册',
    credential: '账号密码',
    landing: '落地页分享',
    direct_share: '直链分享',
    views: '访问分享',
    password_passed: '密码通过',
    downloads: '下载签发',
    saved_to_drive: '转存到网盘',
    landing_share: '分享下载',
    object_download: '文件下载',
    webdav_download: 'WebDAV',
    upload: '上传确认',
    reported: '已上报',
    pending: '待上报',
    failed: '失败',
  }
  return labels[value] ?? value
}
