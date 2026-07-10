import { and, eq, gte, lt } from 'drizzle-orm'
import { statsRollupsHourly } from '../../db/schema'
import { ADMIN_STATS_METRICS, type AdminStatsMetric } from '../../domain/admin-stats-metrics'
import { statsDayKey } from '../../domain/admin-stats-time'
import type { Database } from '../../platform/interface'
import type { AdminStatsDateRange } from '../../usecases/ports'

const HOUR_MS = 3_600_000

export interface StatsInterval {
  from: Date
  toExclusive: Date
}

export interface HourlyMetricRow {
  bucketStart: Date
  orgId: string
  dimensionKey: string
  dimensionValue: string
  count: number
  bytes: number
  uniqueCount: number
  lowerBound: boolean
}

export class AdminStatsHourlyReader {
  private readonly toExclusive: Date
  private readonly plan: Promise<HourlyReadPlan>

  constructor(
    private readonly db: Database,
    private readonly range: AdminStatsDateRange,
    now: Date,
  ) {
    const nextWholeSecond = Math.ceil((now.getTime() + 1) / 1000) * 1000
    this.toExclusive = new Date(Math.min(range.to.getTime() + 1, nextWholeSecond))
    this.plan = buildReadPlan(db, { from: range.from, toExclusive: this.toExclusive }, range.timeZone)
  }

  async rows(metric: AdminStatsMetric): Promise<HourlyMetricRow[]> {
    const plan = await this.plan
    if (plan.completeBuckets.size === 0) return []
    const rows = await this.db
      .select({
        bucketStart: statsRollupsHourly.bucketStart,
        orgId: statsRollupsHourly.orgId,
        dimensionKey: statsRollupsHourly.dimensionKey,
        dimensionValue: statsRollupsHourly.dimensionValue,
        count: statsRollupsHourly.count,
        bytes: statsRollupsHourly.bytes,
        uniqueCount: statsRollupsHourly.uniqueCount,
        metadata: statsRollupsHourly.metadata,
      })
      .from(statsRollupsHourly)
      .where(
        and(
          eq(statsRollupsHourly.metricKey, metric),
          gte(statsRollupsHourly.bucketStart, plan.queryFrom),
          lt(statsRollupsHourly.bucketStart, plan.queryTo),
        ),
      )
    return rows
      .filter((row) => plan.completeBuckets.has(row.bucketStart.getTime()))
      .map((row) => ({
        bucketStart: row.bucketStart,
        orgId: row.orgId,
        dimensionKey: row.dimensionKey,
        dimensionValue: row.dimensionValue,
        count: row.count,
        bytes: row.bytes,
        uniqueCount: row.uniqueCount,
        lowerBound: parseQuality(row.metadata) === 'lower_bound',
      }))
  }

  async rawIntervals(): Promise<StatsInterval[]> {
    return (await this.plan).rawIntervals
  }

  endExclusive(): Date {
    return this.toExclusive
  }

  dayKey(date: Date): string {
    return statsDayKey(date, this.range.timeZone)
  }
}

type HourlyReadPlan = {
  queryFrom: Date
  queryTo: Date
  completeBuckets: Set<number>
  rawIntervals: StatsInterval[]
}

async function buildReadPlan(db: Database, range: StatsInterval, timeZone: string): Promise<HourlyReadPlan> {
  const queryFrom = ceilHour(range.from)
  const queryTo = floorHour(range.toExclusive)
  const markerRows =
    queryFrom < queryTo
      ? await db
          .select({ bucketStart: statsRollupsHourly.bucketStart })
          .from(statsRollupsHourly)
          .where(
            and(
              eq(statsRollupsHourly.metricKey, ADMIN_STATS_METRICS.statsRollupRun),
              eq(statsRollupsHourly.dimensionKey, ''),
              gte(statsRollupsHourly.bucketStart, queryFrom),
              lt(statsRollupsHourly.bucketStart, queryTo),
            ),
          )
      : []
  const marked = new Set(markerRows.map((row) => row.bucketStart.getTime()))
  const completeBuckets = new Set<number>()
  const rawIntervals: StatsInterval[] = []

  if (range.from < queryFrom)
    rawIntervals.push({ from: range.from, toExclusive: minDate(queryFrom, range.toExclusive) })
  for (let at = queryFrom.getTime(); at < queryTo.getTime(); at += HOUR_MS) {
    const from = new Date(at)
    const toExclusive = new Date(at + HOUR_MS)
    const crossesLocalDay = statsDayKey(from, timeZone) !== statsDayKey(new Date(toExclusive.getTime() - 1), timeZone)
    if (!marked.has(at) || crossesLocalDay) rawIntervals.push({ from, toExclusive })
    else completeBuckets.add(at)
  }
  if (queryTo < range.toExclusive)
    rawIntervals.push({ from: maxDate(queryTo, range.from), toExclusive: range.toExclusive })

  return { queryFrom, queryTo, completeBuckets, rawIntervals: mergeIntervals(rawIntervals) }
}

function parseQuality(metadata: string | null): string {
  if (!metadata) return 'unknown'
  try {
    const value: unknown = JSON.parse(metadata)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return 'unknown'
    const quality = (value as Record<string, unknown>).quality
    return typeof quality === 'string' ? quality : 'unknown'
  } catch {
    return 'unknown'
  }
}

function floorHour(date: Date): Date {
  return new Date(Math.floor(date.getTime() / HOUR_MS) * HOUR_MS)
}

function ceilHour(date: Date): Date {
  const floor = floorHour(date)
  return floor.getTime() === date.getTime() ? floor : new Date(floor.getTime() + HOUR_MS)
}

function mergeIntervals(intervals: StatsInterval[]): StatsInterval[] {
  const sorted = intervals
    .filter((interval) => interval.from < interval.toExclusive)
    .sort((left, right) => left.from.getTime() - right.from.getTime())
  const result: StatsInterval[] = []
  for (const interval of sorted) {
    const previous = result.at(-1)
    if (!previous || interval.from > previous.toExclusive) {
      result.push({ ...interval })
      continue
    }
    if (interval.toExclusive > previous.toExclusive) previous.toExclusive = interval.toExclusive
  }
  return result
}

function minDate(left: Date, right: Date): Date {
  return left < right ? left : right
}

function maxDate(left: Date, right: Date): Date {
  return left > right ? left : right
}
