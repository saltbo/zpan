import type { AdminStatsCoverage } from '@shared/types'
import { and, eq, gte, inArray, lt, or, sql } from 'drizzle-orm'
import { statsRollupsHourly } from '../../db/schema'
import {
  ADMIN_STATS_DIMENSIONS,
  ADMIN_STATS_METRICS,
  type AdminStatsDimension,
  type AdminStatsMetric,
  type AdminStatsRollupMetadata,
  type AdminStatsRollupScope,
  assertMetricDimension,
  metricDefinition,
  parseAdminStatsRollupMetadata,
  ROLLUP_VERSION,
} from '../../domain/admin-stats-metrics'
import { statsDayKey } from '../../domain/admin-stats-time'
import type { Database } from '../../platform/interface'
import type { AdminStatsDateRange } from '../../usecases/ports'

const HOUR_MS = 3_600_000
const DASHBOARD_RANKING_LIMIT = 8

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
  private readonly queryFrom: Date
  private readonly counterQueryTo: Date
  private readonly snapshotQueryTo: Date
  private readonly metricRows = new Map<string, Promise<HourlyMetricRow[]>>()
  private readonly markerRowsPromises = new Map<string, Promise<CompatibleMarkerRow[]>>()

  constructor(
    private readonly db: Database,
    range: AdminStatsDateRange,
    now: Date,
  ) {
    const rangeToExclusive = range.to.getTime() + 1
    if (range.from.getTime() % HOUR_MS !== 0 || rangeToExclusive % HOUR_MS !== 0) {
      throw new Error('stats_range_must_align_to_utc_hours')
    }
    this.queryFrom = range.from
    const currentHourStart = floorHour(now).getTime()
    this.counterQueryTo = new Date(Math.min(rangeToExclusive, currentHourStart))
    this.snapshotQueryTo = new Date(Math.min(rangeToExclusive, currentHourStart + HOUR_MS))
  }

  async rows(
    metric: AdminStatsMetric,
    dimensionKeys: readonly (AdminStatsDimension | '')[] = [''],
  ): Promise<HourlyMetricRow[]> {
    const normalizedKeys = [...new Set(dimensionKeys)].sort()
    if (normalizedKeys.length === 0) return []
    for (const dimensionKey of normalizedKeys) assertMetricDimension(metric, dimensionKey)
    const cacheKey = `${metric}\u0000${normalizedKeys.join(',')}`
    const cached = this.metricRows.get(cacheKey)
    if (cached) return cached
    const rows = this.loadRows(metric, normalizedKeys)
    this.metricRows.set(cacheKey, rows)
    return rows
  }

  async latestRows(
    metric: AdminStatsMetric,
    dimensionKeys: readonly (AdminStatsDimension | '')[] = [''],
  ): Promise<HourlyMetricRow[]> {
    const rows = await this.rows(metric, dimensionKeys)
    const latest = rows.reduce((value, row) => Math.max(value, row.bucketStart.getTime()), Number.NEGATIVE_INFINITY)
    return rows.filter((row) => row.bucketStart.getTime() === latest)
  }

  async topSpaceUsage(
    options: { limit?: number; personalOnly?: boolean } = {},
  ): Promise<Array<{ orgId: string; usedBytes: number; quotaBytes: number }>> {
    if (this.queryFrom >= this.snapshotQueryTo) return []
    const limit = options.limit ?? DASHBOARD_RANKING_LIMIT
    const personalFilter = options.personalOnly
      ? sql`AND (org.slug LIKE 'personal-%' OR (json_valid(org.metadata) = 1 AND json_extract(org.metadata, '$.type') = 'personal'))`
      : sql``
    const rows = await this.db.all<{ orgId: string; usedBytes: number; quotaBytes: number }>(sql`
      WITH latest AS (
        SELECT MAX(bucket_start) AS bucketStart
        FROM stats_rollups_hourly
        WHERE org_id = ''
          AND metric_key = ${ADMIN_STATS_METRICS.statsRollupRun}
          AND dimension_key = ''
          AND dimension_value = ''
          AND bucket_start >= ${this.queryFrom.getTime()}
          AND bucket_start < ${this.snapshotQueryTo.getTime()}
          AND CASE WHEN json_valid(metadata) = 1 THEN json_extract(metadata, '$.version') END = ${ROLLUP_VERSION}
          AND CASE WHEN json_valid(metadata) = 1 THEN json_extract(metadata, '$.scope') END IN ('snapshots', 'full')
          AND CASE WHEN json_valid(metadata) = 1 THEN
            COALESCE(json_extract(metadata, '$.snapshotQuality'), json_extract(metadata, '$.quality'))
          END = 'exact'
      )
      SELECT used.org_id AS orgId, used.bytes AS usedBytes, quota.bytes AS quotaBytes
      FROM stats_rollups_hourly used
      INNER JOIN stats_rollups_hourly quota
        ON quota.bucket_start = used.bucket_start
        AND quota.org_id = used.org_id
        AND quota.metric_key = ${ADMIN_STATS_METRICS.storageQuota}
        AND quota.dimension_key = ''
        AND quota.dimension_value = ''
        AND CASE WHEN json_valid(quota.metadata) = 1 THEN json_extract(quota.metadata, '$.version') END = ${ROLLUP_VERSION}
        AND CASE WHEN json_valid(quota.metadata) = 1 THEN json_extract(quota.metadata, '$.scope') END IN ('snapshots', 'full')
        AND CASE WHEN json_valid(quota.metadata) = 1 THEN json_extract(quota.metadata, '$.quality') END = 'exact'
      INNER JOIN organization org ON org.id = used.org_id
      WHERE used.bucket_start = (SELECT bucketStart FROM latest)
        AND used.org_id <> ''
        AND used.metric_key = ${ADMIN_STATS_METRICS.storageUsed}
        AND used.dimension_key = ''
        AND used.dimension_value = ''
        AND CASE WHEN json_valid(used.metadata) = 1 THEN json_extract(used.metadata, '$.version') END = ${ROLLUP_VERSION}
        AND CASE WHEN json_valid(used.metadata) = 1 THEN json_extract(used.metadata, '$.scope') END IN ('snapshots', 'full')
        AND CASE WHEN json_valid(used.metadata) = 1 THEN json_extract(used.metadata, '$.quality') END = 'exact'
        ${personalFilter}
      ORDER BY used.bytes DESC, used.org_id
      LIMIT ${limit}
    `)
    return rows.map((row: { orgId: string; usedBytes: number; quotaBytes: number }) => ({
      orgId: row.orgId,
      usedBytes: Number(row.usedBytes),
      quotaBytes: Number(row.quotaBytes),
    }))
  }

  async coverage(
    requiredScope: AdminStatsRollupScope = 'full',
    metric?: AdminStatsMetric,
  ): Promise<AdminStatsCoverage> {
    const queryTo = this.queryTo(requiredScope)
    const expectedBuckets = Math.max(0, Math.floor((queryTo.getTime() - this.queryFrom.getTime()) / HOUR_MS))
    const markerRows = await this.markerRows(requiredScope, metric)
    const completedBuckets = markerRows.length
    const lowerBoundBuckets = markerRows.filter(
      (row) => qualityForScope(row.metadata, requiredScope) === 'lower_bound',
    ).length
    const latest = markerRows.reduce<CompatibleMarkerRow | null>(
      (value, row) => (!value || row.bucketStart.getTime() > value.bucketStart.getTime() ? row : value),
      null,
    )
    return {
      status: completedBuckets === 0 ? 'empty' : completedBuckets === expectedBuckets ? 'complete' : 'partial',
      expectedBuckets,
      completedBuckets,
      lowerBoundBuckets,
      quality: lowerBoundBuckets > 0 ? 'lower_bound' : 'exact',
      dataThrough: latest ? dataThroughForScope(latest, requiredScope) : null,
    }
  }

  async completeDayKeys(requiredScope: AdminStatsRollupScope, metric?: AdminStatsMetric): Promise<Set<string>> {
    const markerBuckets = await this.markerBuckets(requiredScope, metric)
    if (markerBuckets.size === 0) return new Set()
    const queryTo = this.queryTo(requiredScope)
    const firstCompletedBucket = Math.max(this.queryFrom.getTime(), Math.min(...markerBuckets))
    const lastCompletedBucketExclusive = Math.min(queryTo.getTime(), Math.max(...markerBuckets) + HOUR_MS)
    const expectedByDay = new Map<string, number>()
    const completedByDay = new Map<string, number>()
    for (let at = firstCompletedBucket; at < lastCompletedBucketExclusive; at += HOUR_MS) {
      const day = this.dayKey(new Date(at))
      expectedByDay.set(day, (expectedByDay.get(day) ?? 0) + 1)
      if (markerBuckets.has(at)) completedByDay.set(day, (completedByDay.get(day) ?? 0) + 1)
    }
    return new Set(
      [...expectedByDay]
        .filter(([day, expected]) => expected > 0 && completedByDay.get(day) === expected)
        .map(([day]) => day),
    )
  }

  endExclusive(): Date {
    return this.counterQueryTo
  }

  dayKey(date: Date): string {
    return statsDayKey(date)
  }

  private async loadRows(
    metric: AdminStatsMetric,
    dimensionKeys: readonly (AdminStatsDimension | '')[],
  ): Promise<HourlyMetricRow[]> {
    const requiredScope = metricDefinition(metric).kind === 'gauge' ? 'snapshots' : 'counters'
    const queryTo = this.queryTo(requiredScope)
    if (this.queryFrom >= queryTo) return []
    const markerBuckets = await this.markerBuckets(requiredScope, metric)
    if (markerBuckets.size === 0) return []
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
          inArray(statsRollupsHourly.dimensionKey, dimensionKeys),
          gte(statsRollupsHourly.bucketStart, this.queryFrom),
          lt(statsRollupsHourly.bucketStart, queryTo),
          sql`CASE WHEN json_valid(${statsRollupsHourly.metadata}) = 1 THEN json_extract(${statsRollupsHourly.metadata}, '$.version') END = ${ROLLUP_VERSION}`,
          requiredScope === 'snapshots'
            ? sql`CASE WHEN json_valid(${statsRollupsHourly.metadata}) = 1 THEN json_extract(${statsRollupsHourly.metadata}, '$.scope') END IN ('snapshots', 'full')`
            : sql`CASE WHEN json_valid(${statsRollupsHourly.metadata}) = 1 THEN json_extract(${statsRollupsHourly.metadata}, '$.scope') END IN ('counters', 'full')`,
          sql`CASE WHEN json_valid(${statsRollupsHourly.metadata}) = 1 THEN json_extract(${statsRollupsHourly.metadata}, '$.quality') END = 'exact'`,
        ),
      )
    return rows
      .filter((row) => {
        const metadata = parseAdminStatsRollupMetadata(row.metadata)
        return markerBuckets.has(row.bucketStart.getTime()) && supportsScope(metadata?.scope, requiredScope)
      })
      .map((row) => ({
        bucketStart: row.bucketStart,
        orgId: row.orgId,
        dimensionKey: row.dimensionKey,
        dimensionValue: row.dimensionValue,
        count: row.count,
        bytes: row.bytes,
        uniqueCount: row.uniqueCount,
        lowerBound: false,
      }))
  }

  private markerBuckets(requiredScope: AdminStatsRollupScope, metric?: AdminStatsMetric): Promise<Set<number>> {
    return this.markerRows(requiredScope, metric).then((rows) => new Set(rows.map((row) => row.bucketStart.getTime())))
  }

  private markerRows(requiredScope: AdminStatsRollupScope, metric?: AdminStatsMetric): Promise<CompatibleMarkerRow[]> {
    const cacheKey = `${requiredScope}\u0000${metric ?? ''}`
    const cached = this.markerRowsPromises.get(cacheKey)
    if (cached) return cached
    const rows = this.loadMarkerRows(requiredScope, metric)
    this.markerRowsPromises.set(cacheKey, rows)
    return rows
  }

  private async loadMarkerRows(
    requiredScope: AdminStatsRollupScope,
    metric?: AdminStatsMetric,
  ): Promise<CompatibleMarkerRow[]> {
    const queryTo = this.queryTo(requiredScope)
    if (this.queryFrom >= queryTo) return []
    const rows = await this.db
      .select({ bucketStart: statsRollupsHourly.bucketStart, metadata: statsRollupsHourly.metadata })
      .from(statsRollupsHourly)
      .where(
        and(
          eq(statsRollupsHourly.metricKey, ADMIN_STATS_METRICS.statsRollupRun),
          eq(statsRollupsHourly.orgId, ''),
          metric
            ? or(
                and(eq(statsRollupsHourly.dimensionKey, ''), eq(statsRollupsHourly.dimensionValue, '')),
                and(
                  eq(statsRollupsHourly.dimensionKey, ADMIN_STATS_DIMENSIONS.metric),
                  eq(statsRollupsHourly.dimensionValue, metric),
                ),
              )
            : and(eq(statsRollupsHourly.dimensionKey, ''), eq(statsRollupsHourly.dimensionValue, '')),
          gte(statsRollupsHourly.bucketStart, this.queryFrom),
          lt(statsRollupsHourly.bucketStart, queryTo),
        ),
      )
    const compatibleRows = rows.flatMap((row) => {
      const metadata = parseAdminStatsRollupMetadata(row.metadata)
      return metadata &&
        supportsScope(metadata.scope, requiredScope) &&
        qualityForScope(metadata, requiredScope) === 'exact'
        ? [{ bucketStart: row.bucketStart, metadata }]
        : []
    })
    return [...new Map(compatibleRows.map((row) => [row.bucketStart.getTime(), row])).values()]
  }

  private queryTo(requiredScope: AdminStatsRollupScope): Date {
    return requiredScope === 'snapshots' ? this.snapshotQueryTo : this.counterQueryTo
  }
}

type CompatibleMarkerRow = { bucketStart: Date; metadata: AdminStatsRollupMetadata }

function qualityForScope(
  metadata: AdminStatsRollupMetadata,
  requiredScope: AdminStatsRollupScope,
): 'exact' | 'lower_bound' {
  if (requiredScope === 'counters') return metadata.counterQuality ?? metadata.quality
  if (requiredScope === 'snapshots') return metadata.snapshotQuality ?? metadata.quality
  return metadata.quality
}

function dataThroughForScope(row: CompatibleMarkerRow, requiredScope: AdminStatsRollupScope): string {
  if (requiredScope === 'snapshots' && row.metadata.snapshotObservedAt) return row.metadata.snapshotObservedAt
  return new Date(row.bucketStart.getTime() + HOUR_MS).toISOString()
}

function supportsScope(scope: AdminStatsRollupScope | undefined, requiredScope: AdminStatsRollupScope): boolean {
  return (
    scope === 'full' ||
    (requiredScope === 'counters' && scope === 'counters') ||
    (requiredScope === 'snapshots' && scope === 'snapshots')
  )
}

function floorHour(date: Date): Date {
  return new Date(Math.floor(date.getTime() / HOUR_MS) * HOUR_MS)
}
