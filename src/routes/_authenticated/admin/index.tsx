import type {
  AdminDashboardGrowthStats,
  AdminDashboardOperationsStats,
  AdminDashboardOverviewStats,
  AdminDashboardSharingStats,
  AdminDashboardStorageStats,
  AdminDashboardTrafficStats,
  AdminStatsRange,
  AdminTransferDataQuality,
} from '@shared/types'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { endOfDay, endOfMonth, format, startOfDay, startOfMonth, subDays, subMonths } from 'date-fns'
import {
  Activity,
  BarChart3,
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
import { UpgradeHint } from '@/components/UpgradeHint'
import { Badge } from '@/components/ui/badge'
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
  getAdminDashboardOperationsStats,
  getAdminDashboardOverviewStats,
  getAdminDashboardSharingStats,
  getAdminDashboardStorageStats,
  getAdminDashboardTrafficStats,
} from '@/lib/api'
import { formatSize } from '@/lib/format'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/_authenticated/admin/')({
  component: OverviewPage,
})

type SectionId = 'overview' | 'growth' | 'storage' | 'traffic' | 'sharing' | 'operations'

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
const SECTION_META: Array<{
  id: SectionId
  title: string
  description: string
  badges: string[]
  icon: typeof BarChart3
}> = [
  {
    id: 'overview',
    title: '站点概览',
    description: '判断站点规模、活跃、存储占用和传输流量是否健康。',
    badges: [],
    icon: BarChart3,
  },
  {
    id: 'growth',
    title: '用户与增长',
    description: '观察用户规模、活跃度、账号状态和注册方式结构。',
    badges: ['Pro+'],
    icon: Users,
  },
  {
    id: 'storage',
    title: '存储与文件',
    description: '观察容量水位、文件结构、文件年龄和大对象占用。',
    badges: ['Pro+'],
    icon: HardDrive,
  },
  {
    id: 'traffic',
    title: '流量与传输',
    description: '观察确认上传、下载签发、失败率和计量状态。',
    badges: ['Pro+'],
    icon: UploadCloud,
  },
  {
    id: 'sharing',
    title: '分享与访问',
    description: '观察分享创建、访问、下载签发和转存行为。',
    badges: ['Pro+'],
    icon: Share2,
  },
  {
    id: 'operations',
    title: '运行状态',
    description: '检查后台任务、远程下载、下载器和计量上报健康。',
    badges: ['Pro+'],
    icon: Network,
  },
]

export function OverviewPage() {
  const today = useMemo(() => utcCalendarDate(new Date()), [])
  const [openSections, setOpenSections] = useState<Set<SectionId>>(() => new Set(['overview']))
  const [range, setRange] = useState<DateRange>(() => ({ from: startOfDay(subDays(today, 29)), to: endOfDay(today) }))
  const { hasFeature, isLoading: entitlementLoading } = useEntitlement()
  const hasAnalytics = hasFeature('analytics')

  const overviewQuery = useQuery({
    queryKey: ['admin', 'dashboard', 'overview', rangeKey(range)],
    queryFn: () => getAdminDashboardOverviewStats(toRangeFilter(range)),
    staleTime: 30_000,
  })
  const growthQuery = useDashboardSectionQuery(
    'growth',
    range,
    openSections,
    hasAnalytics,
    getAdminDashboardGrowthStats,
  )
  const storageQuery = useDashboardSectionQuery(
    'storage',
    range,
    openSections,
    hasAnalytics,
    getAdminDashboardStorageStats,
  )
  const trafficQuery = useDashboardSectionQuery(
    'traffic',
    range,
    openSections,
    hasAnalytics,
    getAdminDashboardTrafficStats,
  )
  const sharingQuery = useDashboardSectionQuery(
    'sharing',
    range,
    openSections,
    hasAnalytics,
    getAdminDashboardSharingStats,
  )
  const operationsQuery = useDashboardSectionQuery(
    'operations',
    range,
    openSections,
    hasAnalytics,
    getAdminDashboardOperationsStats,
  )

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
    <div className="-m-4 min-h-[calc(100svh-3.5rem)] bg-canvas p-4">
      <div className="mx-auto flex max-w-[1180px] flex-col gap-5">
        <div className="flex flex-col gap-3 rounded-xl border border-border/70 bg-background/95 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div>
            <h1 className="text-lg font-semibold">站点统计</h1>
            <p className="mt-1 text-sm text-muted-foreground">统一使用 UTC 日期与已完成的离线小时结果。</p>
          </div>
          <DateRangePicker value={range} onChange={setRange} />
        </div>
        <div className="flex flex-col gap-4">
          {SECTION_META.map((section) => (
            <DashboardSection
              key={section.id}
              section={section}
              open={openSections.has(section.id)}
              locked={section.id !== 'overview' && !hasAnalytics && !entitlementLoading}
              onToggle={() => toggleSection(section.id)}
            >
              {section.id === 'overview' ? (
                <QueryState query={overviewQuery}>{(data) => <OverviewSection stats={data} />}</QueryState>
              ) : !hasAnalytics ? (
                <UpgradeHint
                  feature="analytics"
                  title="解锁高级统计"
                  description="这些下钻看板需要 ZPan Pro 或 Business。核心概览数据会继续展示。"
                  actionLabel="打开授权"
                />
              ) : section.id === 'growth' ? (
                <QueryState query={growthQuery}>{(data) => <GrowthSection stats={data} />}</QueryState>
              ) : section.id === 'storage' ? (
                <QueryState query={storageQuery}>{(data) => <StorageSection stats={data} />}</QueryState>
              ) : section.id === 'traffic' ? (
                <QueryState query={trafficQuery}>{(data) => <TrafficSection stats={data} />}</QueryState>
              ) : section.id === 'sharing' ? (
                <QueryState query={sharingQuery}>{(data) => <SharingSection stats={data} />}</QueryState>
              ) : (
                <QueryState query={operationsQuery}>{(data) => <OperationsSection stats={data} />}</QueryState>
              )}
            </DashboardSection>
          ))}
        </div>
      </div>
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
  section,
  open,
  locked,
  children,
  onToggle,
}: {
  section: (typeof SECTION_META)[number]
  open: boolean
  locked?: boolean
  children: ReactNode
  onToggle: () => void
}) {
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
              {section.badges.map((badge) => (
                <Badge key={badge} variant={badge === 'Pro+' ? 'default' : 'secondary'} className="rounded-full">
                  {badge}
                </Badge>
              ))}
              {locked && <Lock className="size-3.5 text-muted-foreground" />}
            </span>
            <span className="mt-1 block text-[13px] leading-5 text-muted-foreground">{section.description}</span>
          </span>
        </button>
        <div className="flex shrink-0 items-center justify-between gap-2 sm:justify-end">
          <button
            type="button"
            onClick={onToggle}
            aria-label={open ? `折叠${section.title}` : `展开${section.title}`}
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
  const presets = dateRangePresets()
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
          <span className="truncate font-normal">{formatRange(value)}</span>
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
              <div className="text-xs text-muted-foreground">{formatRange(draft)}</div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
                  取消
                </Button>
                <Button type="button" size="sm" disabled={!draft.from || !draft.to} onClick={() => applyRange(draft)}>
                  应用
                </Button>
              </div>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function OverviewSection({ stats }: { stats: AdminDashboardOverviewStats }) {
  const cards = [
    {
      label: '期末注册用户',
      value: formatNumber(stats.totals.users),
      delta: formatDelta(stats.totals.newUsers),
      icon: Users,
      metrics: [
        { label: '新增用户', value: formatNumber(stats.totals.newUsers.value) },
        { label: '30 日活跃用户', value: formatNumber(stats.totals.activeUsers.value) },
      ],
    },
    {
      label: '30 日活跃用户',
      value: formatNumber(stats.totals.activeUsers.value),
      delta: formatDelta(stats.totals.activeUsers),
      icon: TrendingUp,
      metrics: [
        { label: '30 日活跃率', value: formatPercent(stats.totals.activeUserRate) },
        { label: '环比人数', value: formatNumber(stats.totals.activeUsers.previousValue) },
      ],
    },
    {
      label: '期末存储占用',
      value: formatSize(stats.totals.storageUsedBytes),
      delta: formatDelta(stats.totals.uploadBytes, formatSize),
      icon: Database,
      metrics: [
        { label: '使用率', value: formatPercent(stats.totals.storageUtilization) },
        { label: '区间新增', value: formatSize(stats.totals.uploadBytes.value) },
      ],
    },
    {
      label: '确认/签发字节',
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
      <TransferDataQualityNotice quality={stats.dataQuality} />
      <ChartCard
        title="用户增长与活跃趋势"
        subtitle="新增用户和活跃用户分开编码，避免把小量级新增淹没在活跃用户曲线里。"
      >
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={stats.trends} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={CHART_GRID_COLOR} strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              fontSize={12}
              minTickGap={18}
              tickFormatter={formatChartDate}
            />
            <YAxis
              yAxisId="count"
              tickLine={false}
              axisLine={false}
              fontSize={12}
              width={42}
              tickFormatter={formatCompactNumber}
            />
            <RechartsTooltip
              contentStyle={tooltipContentStyle}
              labelStyle={tooltipLabelStyle}
              formatter={chartTooltipFormatter}
            />
            <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
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
          </ComposedChart>
        </ResponsiveContainer>
      </ChartCard>
      <ChartCard title="资源消耗趋势" subtitle="存储水位、确认上传字节和下载签发字节按 UTC 日期聚合。">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={stats.trends} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={CHART_GRID_COLOR} strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              fontSize={12}
              minTickGap={18}
              tickFormatter={formatChartDate}
            />
            <YAxis
              yAxisId="bytes"
              tickLine={false}
              axisLine={false}
              fontSize={12}
              width={56}
              tickFormatter={formatCompactSize}
            />
            <RechartsTooltip
              contentStyle={tooltipContentStyle}
              labelStyle={tooltipLabelStyle}
              formatter={chartTooltipFormatter}
            />
            <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
            <Bar yAxisId="bytes" dataKey="uploadBytes" name="确认上传" fill={CHART_COLORS[1]} radius={[4, 4, 0, 0]} />
            <Bar yAxisId="bytes" dataKey="downloadBytes" name="下载签发" fill={CHART_COLORS[2]} radius={[4, 4, 0, 0]} />
            <Line
              yAxisId="bytes"
              type="monotone"
              dataKey="storageUsedBytes"
              name="存储总量"
              stroke={CHART_COLORS[0]}
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
    <div className="flex flex-col gap-4">
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
          label="30 日活跃用户"
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
            { label: '占比', value: formatPercent(stats.summary.silentUserRate) },
            { label: '30 日活跃率', value: formatPercent(stats.summary.activeUserRate) },
          ]}
        />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard title="用户规模趋势" subtitle="柱形看每日新增用户，折线看累计用户规模。">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={stats.userScaleTrend}>
              <CartesianGrid stroke={CHART_GRID_COLOR} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" tickLine={false} axisLine={false} fontSize={12} tickFormatter={formatChartDate} />
              <YAxis tickLine={false} axisLine={false} fontSize={12} width={48} tickFormatter={formatCompactNumber} />
              <RechartsTooltip
                contentStyle={tooltipContentStyle}
                labelStyle={tooltipLabelStyle}
                formatter={chartTooltipFormatter}
              />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
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
        <ChartCard title="活跃用户趋势" subtitle="DAU、WAU、MAU 同时展示，用于判断用户活跃基本盘。">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={stats.activeUserTrend}>
              <CartesianGrid stroke={CHART_GRID_COLOR} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" tickLine={false} axisLine={false} fontSize={12} tickFormatter={formatChartDate} />
              <YAxis tickLine={false} axisLine={false} fontSize={12} width={48} tickFormatter={formatCompactNumber} />
              <RechartsTooltip
                contentStyle={tooltipContentStyle}
                labelStyle={tooltipLabelStyle}
                formatter={chartTooltipFormatter}
              />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
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
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <BreakdownChart title="用户状态分布" rows={stats.userStatus} valueFormatter={formatNumber} />
        <BarBreakdownChart title="注册方式分布" rows={stats.registrationSources} valueFormatter={formatNumber} />
      </div>
    </div>
  )
}

function StorageSection({ stats }: { stats: AdminDashboardStorageStats }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="期末存储占用"
          value={formatSize(stats.summary.storageUsedBytes)}
          icon={HardDrive}
          metrics={[
            {
              label: '配额使用率',
              value: formatPercent(stats.summary.storageUtilization),
            },
            { label: '文件数', value: formatNumber(stats.summary.fileCount) },
          ]}
        />
        <StatCard
          label="确认写入字节"
          value={formatSize(stats.summary.newBytes.value)}
          delta={formatDelta(stats.summary.newBytes, formatSize)}
          icon={Upload}
          metrics={[
            { label: '确认上传文件', value: formatNumber(stats.summary.newFiles.value) },
            { label: '上期容量', value: formatSize(stats.summary.newBytes.previousValue) },
          ]}
        />
        <StatCard
          label="确认上传文件"
          value={formatNumber(stats.summary.newFiles.value)}
          delta={formatDelta(stats.summary.newFiles)}
          icon={Database}
          metrics={[
            { label: '上期新增', value: formatNumber(stats.summary.newFiles.previousValue) },
            { label: '文件总数', value: formatNumber(stats.summary.fileCount) },
          ]}
        />
        <StatCard
          label="90 天以上文件"
          value={formatSize(stats.summary.coldFileBytes)}
          icon={FileClock}
          metrics={[
            {
              label: '年龄文件占比',
              value: formatPercent(stats.summary.coldFilePercent),
            },
            { label: '期末占用', value: formatSize(stats.summary.storageUsedBytes) },
          ]}
        />
      </div>
      <TransferDataQualityNotice quality={stats.dataQuality} />
      <ChartCard
        title="空间配额压力"
        subtitle={`全部空间中 ${stats.summary.nearQuotaSpaces} 个达到 80%，${stats.summary.overQuotaSpaces} 个达到或超过配额。`}
        contentClassName="h-auto"
      >
        {stats.topSpaces.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="overflow-hidden rounded-lg border border-border/50">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>空间</TableHead>
                  <TableHead>类型</TableHead>
                  <TableHead className="text-right">占用</TableHead>
                  <TableHead className="text-right">配额</TableHead>
                  <TableHead className="text-right">使用率</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stats.topSpaces.map((space) => (
                  <TableRow key={space.orgId}>
                    <TableCell className="max-w-60 truncate font-medium" title={space.orgName}>
                      {space.orgName}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{labelize(space.orgType)}</TableCell>
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
        <ChartCard title="存储与写入趋势" subtitle="存储占用是水位；确认上传文件和字节是周期事件量，不代表净增长。">
          <ResponsiveContainer width="100%" height="100%">
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
                formatter={chartTooltipFormatter}
              />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
              <Bar
                yAxisId="files"
                dataKey="newFiles"
                name="确认上传文件"
                fill={CHART_COLORS[1]}
                radius={[4, 4, 0, 0]}
              />
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
                name="确认写入字节"
                stroke={CHART_COLORS[2]}
                strokeWidth={2}
                dot={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartCard>
        <BreakdownChart
          title="文件类型容量占比"
          rows={stats.typeBreakdown.map((row) => ({ name: row.type, value: row.bytes, percent: row.percent }))}
          valueFormatter={formatSize}
        />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard title="文件大小结构" subtitle="柱形看文件数量，折线看容量贡献，定位大对象压力。">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={stats.sizeBreakdown} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={CHART_GRID_COLOR} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={12} tickFormatter={labelize} />
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
                formatter={chartTooltipFormatter}
                labelFormatter={(value) => labelize(String(value))}
              />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
              <Bar
                yAxisId="files"
                dataKey="files"
                name="文件数"
                fill={CHART_COLORS[5]}
                radius={[4, 4, 0, 0]}
                isAnimationActive={false}
              />
              <Line
                yAxisId="bytes"
                type="monotone"
                dataKey="bytes"
                name="容量贡献"
                stroke={CHART_COLORS[4]}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="文件年龄分布" subtitle="仅按创建时间划分，不代表文件最近是否被访问。">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={stats.ageBreakdown} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={CHART_GRID_COLOR} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={12} tickFormatter={labelize} />
              <YAxis tickLine={false} axisLine={false} fontSize={12} width={58} tickFormatter={formatCompactSize} />
              <RechartsTooltip
                contentStyle={tooltipContentStyle}
                labelStyle={tooltipLabelStyle}
                formatter={(value, name) =>
                  name === '容量' ? [formatSize(Number(value)), name] : [formatNumber(Number(value)), name]
                }
                labelFormatter={(value) => labelize(String(value))}
              />
              <Bar dataKey="bytes" name="容量" fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} isAnimationActive={false}>
                <LabelList dataKey="percent" position="top" formatter={formatPercentLabel} fontSize={11} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </div>
  )
}

function TrafficSection({ stats }: { stats: AdminDashboardTrafficStats }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="确认/签发字节"
          value={formatSize(stats.summary.totalBytes.value)}
          delta={formatDelta(stats.summary.totalBytes, formatSize)}
          icon={Network}
          metrics={[
            { label: '峰值日字节', value: formatSize(stats.summary.peakDailyBytes) },
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
            { label: '签发失败', value: formatNumber(stats.summary.blockedDownloads) },
          ]}
        />
        <StatCard
          label="下载签发成功率"
          value={formatPercent(stats.summary.downloadIssueSuccessRate)}
          icon={Download}
          metrics={[
            { label: '签发成功', value: formatNumber(stats.summary.issuedDownloads) },
            { label: '签发失败', value: formatNumber(stats.summary.blockedDownloads) },
          ]}
        />
        <StatCard
          label="峰值日字节"
          value={formatSize(stats.summary.peakDailyBytes)}
          icon={TrendingUp}
          metrics={[
            { label: '统计口径', value: '确认上传 + 下载签发' },
            { label: '周期总量', value: formatSize(stats.summary.totalBytes.value) },
          ]}
        />
      </div>
      <TransferDataQualityNotice quality={stats.dataQuality} />
      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard
          title="传输事件趋势"
          subtitle="上传为确认完成字节，下载为链接签发对象字节，不代表客户端实际完成传输。"
        >
          <ResponsiveContainer width="100%" height="100%">
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
                formatter={chartTooltipFormatter}
              />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
              <Bar yAxisId="count" dataKey="requests" name="请求量" fill={CHART_COLORS[5]} radius={[4, 4, 0, 0]} />
              <Line
                yAxisId="bytes"
                type="monotone"
                dataKey="uploadBytes"
                name="确认上传字节"
                stroke={CHART_COLORS[0]}
                strokeWidth={2}
                dot={false}
              />
              <Line
                yAxisId="bytes"
                type="monotone"
                dataKey="downloadBytes"
                name="下载签发字节"
                stroke={CHART_COLORS[2]}
                strokeWidth={2}
                dot={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartCard>
        <BreakdownChart
          title="传输来源分布"
          rows={stats.sourceBreakdown.map((row) => ({ name: row.name, value: row.bytes, percent: row.percent }))}
          valueFormatter={formatSize}
        />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard
          title="签发与确认成功率"
          subtitle="上传成功指完成确认；下载成功指成功签发链接，不代表客户端下载完成。"
        >
          <ResponsiveContainer width="100%" height="100%">
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
                name="上传成功率"
                stroke={CHART_COLORS[1]}
                fill={CHART_COLORS[1]}
                fillOpacity={0.08}
                strokeWidth={2}
                isAnimationActive={false}
              />
              <Area
                type="monotone"
                dataKey="downloadSuccessRate"
                name="下载成功率"
                stroke={CHART_COLORS[0]}
                fill={CHART_COLORS[0]}
                fillOpacity={0.08}
                strokeWidth={2}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="失败原因分布" subtitle="分类比较用横向条形图，并标出每类占比。">
          {stats.failureReasons.length === 0 ? (
            <EmptyState />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
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
                  tickFormatter={labelize}
                />
                <RechartsTooltip
                  contentStyle={tooltipContentStyle}
                  labelStyle={tooltipLabelStyle}
                  formatter={(value) => formatNumber(Number(value))}
                  labelFormatter={(value) => labelize(String(value))}
                />
                <Bar
                  dataKey="value"
                  name="失败次数"
                  fill={CHART_COLORS[4]}
                  radius={[0, 4, 4, 0]}
                  isAnimationActive={false}
                >
                  <LabelList dataKey="percent" position="right" formatter={formatPercentLabel} fontSize={11} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>
    </div>
  )
}

function SharingSection({ stats }: { stats: AdminDashboardSharingStats }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="期末可用分享"
          value={formatNumber(stats.summary.activeShares)}
          delta={formatDelta(stats.summary.createdShares)}
          icon={Share2}
          metrics={[
            { label: '区间创建', value: formatNumber(stats.summary.createdShares.value) },
            { label: '每百次访问下载', value: formatPer100(stats.summary.downloadsPer100Views) },
          ]}
        />
        <StatCard
          label="访问次数"
          value={formatNumber(stats.summary.views.value)}
          delta={formatDelta(stats.summary.views)}
          icon={Activity}
          metrics={[
            { label: '下载请求', value: formatNumber(stats.summary.downloads.value) },
            { label: '密码通过', value: formatNumber(stats.summary.passwordPasses) },
          ]}
        />
        <StatCard
          label="下载签发"
          value={formatNumber(stats.summary.downloads.value)}
          delta={formatDelta(stats.summary.downloads)}
          icon={Download}
          metrics={[
            { label: '每百次访问下载', value: formatPer100(stats.summary.downloadsPer100Views) },
            { label: '上期下载', value: formatNumber(stats.summary.downloads.previousValue) },
          ]}
        />
        <StatCard
          label="转存到网盘"
          value={formatNumber(stats.summary.saves.value)}
          delta={formatDelta(stats.summary.saves)}
          icon={Link2}
          metrics={[
            {
              label: '每百次访问转存',
              value: formatPer100(stats.summary.savesPer100Views),
            },
            { label: '上期转存', value: formatNumber(stats.summary.saves.previousValue) },
          ]}
        />
      </div>
      <div className="grid gap-4">
        <ChartCard title="访问行为趋势" subtitle="这些是独立事件量，不表示同一访客完成了连续漏斗。">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={stats.trend}>
              <CartesianGrid stroke={CHART_GRID_COLOR} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" tickLine={false} axisLine={false} fontSize={12} tickFormatter={formatChartDate} />
              <YAxis tickLine={false} axisLine={false} fontSize={12} width={48} tickFormatter={formatCompactNumber} />
              <RechartsTooltip
                contentStyle={tooltipContentStyle}
                labelStyle={tooltipLabelStyle}
                formatter={chartTooltipFormatter}
              />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
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
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <BarBreakdownChart title="分享类型分布" rows={stats.typeBreakdown} valueFormatter={formatNumber} />
        <BreakdownChart title="访问来源分布" rows={stats.sourceBreakdown} valueFormatter={formatNumber} />
      </div>
      <TopSharesTable rows={stats.topShares} />
    </div>
  )
}

function OperationsSection({ stats }: { stats: AdminDashboardOperationsStats }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="后台任务"
          value={formatNumber(stats.summary.activeBackgroundJobs)}
          icon={Activity}
          metrics={[
            { label: '运行中', value: formatNumber(stats.summary.activeBackgroundJobs) },
            { label: '失败率', value: formatPercent(stats.summary.backgroundJobFailureRate) },
          ]}
        />
        <StatCard
          label="远程下载"
          value={formatNumber(stats.summary.activeRemoteDownloads)}
          icon={Download}
          metrics={[
            { label: '活跃任务', value: formatNumber(stats.summary.activeRemoteDownloads) },
            { label: '成功率', value: formatPercent(stats.summary.remoteDownloadSuccessRate) },
          ]}
        />
        <StatCard
          label="下载器在线"
          value={formatNumber(stats.summary.onlineDownloaders)}
          icon={Network}
          metrics={[
            { label: '在线', value: formatNumber(stats.summary.onlineDownloaders) },
            { label: '离线/禁用', value: formatNumber(stats.summary.offlineDownloaders) },
          ]}
        />
        <StatCard
          label="待处理异常"
          value={formatNumber(stats.summary.alertCount)}
          icon={FileClock}
          metrics={[
            { label: '计量积压', value: formatNumber(stats.summary.cloudReportBacklog) },
            { label: 'Webhook 失败', value: formatNumber(stats.summary.webhookFailures) },
          ]}
        />
      </div>
      <ChartCard title="任务完成趋势" subtitle="完成与失败分别统计，快速定位后台任务或远程下载异常。">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={stats.trend}>
            <CartesianGrid stroke={CHART_GRID_COLOR} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="date" tickLine={false} axisLine={false} fontSize={12} tickFormatter={formatChartDate} />
            <YAxis tickLine={false} axisLine={false} fontSize={12} width={48} tickFormatter={formatCompactNumber} />
            <RechartsTooltip
              contentStyle={tooltipContentStyle}
              labelStyle={tooltipLabelStyle}
              formatter={chartTooltipFormatter}
            />
            <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="completedJobs" name="后台任务完成" fill={CHART_COLORS[1]} radius={[4, 4, 0, 0]} />
            <Bar dataKey="failedJobs" name="后台任务失败" fill={CHART_COLORS[4]} radius={[4, 4, 0, 0]} />
            <Line
              dataKey="completedRemoteDownloads"
              name="远程下载完成"
              stroke={CHART_COLORS[0]}
              strokeWidth={2}
              dot={false}
            />
            <Line
              dataKey="failedRemoteDownloads"
              name="远程下载失败"
              stroke={CHART_COLORS[2]}
              strokeWidth={2}
              dot={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </ChartCard>
      <div className="grid gap-4 xl:grid-cols-2">
        <BarBreakdownChart title="后台任务结果" rows={stats.backgroundJobOutcomes} valueFormatter={formatNumber} />
        <BarBreakdownChart title="远程下载结果" rows={stats.remoteDownloadOutcomes} valueFormatter={formatNumber} />
        <BreakdownChart title="下载器状态" rows={stats.downloaderStatus} valueFormatter={formatNumber} />
        <BreakdownChart title="计量上报状态" rows={stats.cloudReportStatus} valueFormatter={formatNumber} />
      </div>
    </div>
  )
}

function StatCard({
  label,
  value,
  delta,
  deltaLabel = '环比',
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
              <span className="text-[10px] text-muted-foreground">{deltaLabel}</span>
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
  return (
    <ChartCard title={title}>
      <div className="grid h-full gap-4 lg:grid-cols-[minmax(0,1fr)_230px]">
        <ResponsiveContainer width="100%" height="100%">
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
        </ResponsiveContainer>
        <PercentList
          items={rows.map((row, index) => ({
            name: labelize(row.name),
            percent: row.percent,
            valueLabel: valueFormatter(row.value),
            fill: CHART_COLORS[index % CHART_COLORS.length],
          }))}
        />
      </div>
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
  return (
    <ChartCard title={title}>
      <ResponsiveContainer width="100%" height="100%">
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
            tickFormatter={labelize}
          />
          <RechartsTooltip
            contentStyle={tooltipContentStyle}
            labelStyle={tooltipLabelStyle}
            formatter={(value) => valueFormatter(Number(value))}
            labelFormatter={(value) => labelize(String(value))}
          />
          <Bar dataKey="value" name="数量" radius={[0, 4, 4, 0]} isAnimationActive={false}>
            {rows.map((row, index) => (
              <Cell key={row.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />
            ))}
            <LabelList dataKey="percent" position="right" formatter={formatPercentLabel} fontSize={11} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

function PercentList({ items }: { items: Array<{ name: string; percent: number; valueLabel: string; fill: string }> }) {
  return (
    <div className="flex flex-col justify-center gap-3">
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
  )
}

function TopSharesTable({ rows }: { rows: AdminDashboardSharingStats['topShares'] }) {
  return (
    <ChartCard title="Top 分享" contentClassName="h-auto">
      {rows.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border/50">
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
  if (query.isLoading) return <SectionSkeleton />
  if (query.isError)
    return (
      <div className="flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
        <span>统计结果加载失败。</span>
        {query.refetch && (
          <Button type="button" variant="outline" size="sm" onClick={() => query.refetch?.()}>
            重试
          </Button>
        )}
      </div>
    )
  if (!query.data) return <EmptyState />
  return (
    <div className="grid gap-4">
      <StatsCoverageNotice stats={query.data} />
      {children(query.data)}
    </div>
  )
}

function StatsCoverageNotice({ stats }: { stats: AdminStatsRange }) {
  const { coverage } = stats
  const comparisonCoverage = stats.comparisonCoverage
  const through = coverage.dataThrough
    ? new Date(coverage.dataThrough).toISOString().replace('T', ' ').slice(0, 16)
    : null
  const comparisonIncomplete = comparisonCoverage ? comparisonCoverage.status !== 'complete' : false
  const incomplete = coverage.status !== 'complete' || comparisonIncomplete
  return (
    <div
      role="status"
      className={cn(
        'flex flex-col gap-1 rounded-lg border px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between',
        incomplete ? 'border-amber-500/40 bg-amber-500/10' : 'border-border/70 bg-muted/20',
      )}
    >
      <span className={incomplete ? 'text-amber-800 dark:text-amber-200' : 'text-muted-foreground'}>
        {coverage.status === 'empty'
          ? '所选范围还没有可用的离线结果。'
          : coverage.status === 'partial'
            ? '所选范围存在缺失的小时结果，当前数据不完整。'
            : comparisonCoverage?.status === 'empty'
              ? '对比区间还没有可用的离线结果，环比不可对账。'
              : comparisonCoverage?.status === 'partial'
                ? '对比区间存在缺失的小时结果，环比数据不完整。'
                : '所选范围的离线结果完整。'}
      </span>
      <span className="text-xs text-muted-foreground">
        {through ? `数据截至 ${through} UTC · ` : ''}
        当前 {coverage.completedBuckets}/{coverage.expectedBuckets} 小时
        {comparisonCoverage
          ? ` · 对比 ${comparisonCoverage.completedBuckets}/${comparisonCoverage.expectedBuckets} 小时`
          : ''}
      </span>
    </div>
  )
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

function TransferDataQualityNotice({ quality }: { quality: AdminTransferDataQuality }) {
  const currentMissing = quality.missingBytesEvents
  const previousMissing = quality.previousMissingBytesEvents
  if (currentMissing === 0 && previousMissing === 0) return null

  return (
    <div
      role="status"
      className="flex flex-col gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm sm:flex-row sm:items-center"
    >
      <Badge variant="outline" className="w-fit border-amber-600/50 text-amber-700 dark:text-amber-300">
        历史数据不完整
      </Badge>
      <span className="text-muted-foreground">
        当前区间有 {formatNumber(currentMissing)} 条、对比区间有 {formatNumber(previousMissing)}
        条传输事件缺少可恢复的字节数；流量与新增容量仅代表已知下限，事件数量不受影响。
      </span>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-border/70 bg-muted/10 p-8 text-center text-sm text-muted-foreground">
      暂无统计数据
    </div>
  )
}

function dateRangePresets(): Array<{ label: string; range: DateRange }> {
  const today = utcCalendarDate(new Date())
  return [
    { label: '最近 3 天', range: { from: startOfDay(subDays(today, 2)), to: endOfDay(today) } },
    { label: '最近 7 天', range: { from: startOfDay(subDays(today, 6)), to: endOfDay(today) } },
    { label: '最近 30 天', range: { from: startOfDay(subDays(today, 29)), to: endOfDay(today) } },
    { label: '本月', range: { from: startOfMonth(today), to: endOfDay(today) } },
    { label: '上月', range: { from: startOfMonth(subMonths(today, 1)), to: endOfMonth(subMonths(today, 1)) } },
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

function formatRange(range: DateRange): string {
  if (!range.from) return '选择时间范围'
  if (!range.to) return format(range.from, 'yyyy-MM-dd')
  return `${format(range.from, 'yyyy-MM-dd')} - ${format(range.to, 'yyyy-MM-dd')}`
}

function normalizeDateRange(range: DateRange): DateRange {
  if (!range.from || !range.to) return range
  if (range.from <= range.to) return range
  return { from: range.to, to: range.from }
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value)
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

function formatPer100(value: number | null): string {
  return value === null ? '—' : value.toLocaleString('zh-CN', { maximumFractionDigits: 1 })
}

function formatDelta(
  delta: { value: number; previousValue: number; change: number; changePercent: number | null },
  valueFormatter: (value: number) => string = formatNumber,
): string {
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
