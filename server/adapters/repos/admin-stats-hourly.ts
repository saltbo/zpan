import { and, eq, gte, lt } from 'drizzle-orm'
import { statsRollupsHourly } from '../../db/schema'
import type { AdminStatsMetric } from '../../domain/admin-stats-metrics'
import { statsDayKey } from '../../domain/admin-stats-time'
import type { Database } from '../../platform/interface'
import type { AdminStatsDateRange } from '../../usecases/ports'

const HOUR_MS = 3_600_000

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
  private readonly queryFrom: Date
  private readonly queryTo: Date

  constructor(
    private readonly db: Database,
    private readonly range: AdminStatsDateRange,
    now: Date,
  ) {
    const nextWholeSecond = Math.ceil((now.getTime() + 1) / 1000) * 1000
    this.toExclusive = new Date(Math.min(range.to.getTime() + 1, nextWholeSecond))
    this.queryFrom = ceilHour(range.from)
    this.queryTo = floorHour(this.toExclusive)
  }

  async rows(metric: AdminStatsMetric): Promise<HourlyMetricRow[]> {
    if (this.queryFrom >= this.queryTo) return []
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
          gte(statsRollupsHourly.bucketStart, this.queryFrom),
          lt(statsRollupsHourly.bucketStart, this.queryTo),
        ),
      )
    return rows.map((row) => ({
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

  endExclusive(): Date {
    return this.toExclusive
  }

  dayKey(date: Date): string {
    return statsDayKey(date, this.range.timeZone)
  }
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
