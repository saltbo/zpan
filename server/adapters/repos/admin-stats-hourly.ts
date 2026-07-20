import type { AdminStatsCoverage } from '@shared/types'
import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm'
import { statsRollupsHourly } from '../../db/schema'
import {
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
  private readonly queryTo: Date
  private readonly metricRows = new Map<string, Promise<HourlyMetricRow[]>>()
  private readonly markerRowsPromises = new Map<AdminStatsRollupScope, Promise<CompatibleMarkerRow[]>>()

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
    this.queryTo = new Date(Math.min(rangeToExclusive, floorHour(now).getTime()))
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

  async topShareActivity(): Promise<Array<{ shareId: string; views: number; downloads: number }>> {
    if (this.queryFrom >= this.queryTo) return []
    const rows = await this.db.all<{ shareId: string; views: number; downloads: number }>(sql`
      SELECT
        result.dimension_value AS shareId,
        SUM(CASE WHEN result.metric_key = ${ADMIN_STATS_METRICS.shareView} THEN result.count ELSE 0 END) AS views,
        SUM(CASE WHEN result.metric_key = ${ADMIN_STATS_METRICS.shareDownloadIssued} THEN result.count ELSE 0 END) AS downloads
      FROM stats_rollups_hourly result
      INNER JOIN stats_rollups_hourly marker
        ON marker.bucket_start = result.bucket_start
        AND marker.org_id = ''
        AND marker.metric_key = ${ADMIN_STATS_METRICS.statsRollupRun}
        AND marker.dimension_key = ''
        AND marker.dimension_value = ''
      WHERE result.metric_key IN (${ADMIN_STATS_METRICS.shareView}, ${ADMIN_STATS_METRICS.shareDownloadIssued})
        AND result.dimension_key = 'share_id'
        AND result.dimension_value <> ''
        AND result.bucket_start >= ${this.queryFrom.getTime()}
        AND result.bucket_start < ${this.queryTo.getTime()}
        AND CASE WHEN json_valid(result.metadata) = 1 THEN json_extract(result.metadata, '$.version') END = ${ROLLUP_VERSION}
        AND CASE WHEN json_valid(result.metadata) = 1 THEN json_extract(result.metadata, '$.scope') END IN ('counters', 'full')
        AND CASE WHEN json_valid(result.metadata) = 1 THEN json_extract(result.metadata, '$.quality') END IN ('exact', 'lower_bound')
        AND CASE WHEN json_valid(marker.metadata) = 1 THEN json_extract(marker.metadata, '$.version') END = ${ROLLUP_VERSION}
        AND CASE WHEN json_valid(marker.metadata) = 1 THEN json_extract(marker.metadata, '$.scope') END IN ('counters', 'full')
        AND CASE WHEN json_valid(marker.metadata) = 1 THEN json_extract(marker.metadata, '$.quality') END IN ('exact', 'lower_bound')
      GROUP BY result.dimension_value
      ORDER BY views DESC, downloads DESC, result.dimension_value
      LIMIT ${DASHBOARD_RANKING_LIMIT}
    `)
    return rows.map((row: { shareId: string; views: number; downloads: number }) => ({
      shareId: row.shareId,
      views: Number(row.views),
      downloads: Number(row.downloads),
    }))
  }

  async topSpaceUsage(): Promise<Array<{ orgId: string; usedBytes: number; quotaBytes: number }>> {
    if (this.queryFrom >= this.queryTo) return []
    const rows = await this.db.all<{ orgId: string; usedBytes: number; quotaBytes: number }>(sql`
      WITH latest AS (
        SELECT MAX(bucket_start) AS bucketStart
        FROM stats_rollups_hourly
        WHERE org_id = ''
          AND metric_key = ${ADMIN_STATS_METRICS.statsRollupRun}
          AND dimension_key = ''
          AND dimension_value = ''
          AND bucket_start >= ${this.queryFrom.getTime()}
          AND bucket_start < ${this.queryTo.getTime()}
          AND CASE WHEN json_valid(metadata) = 1 THEN json_extract(metadata, '$.version') END = ${ROLLUP_VERSION}
          AND CASE WHEN json_valid(metadata) = 1 THEN json_extract(metadata, '$.scope') END IN ('snapshots', 'full')
          AND CASE WHEN json_valid(metadata) = 1 THEN json_extract(metadata, '$.quality') END IN ('exact', 'lower_bound')
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
        AND CASE WHEN json_valid(quota.metadata) = 1 THEN json_extract(quota.metadata, '$.quality') END IN ('exact', 'lower_bound')
      WHERE used.bucket_start = (SELECT bucketStart FROM latest)
        AND used.org_id <> ''
        AND used.metric_key = ${ADMIN_STATS_METRICS.storageUsed}
        AND used.dimension_key = ''
        AND used.dimension_value = ''
        AND CASE WHEN json_valid(used.metadata) = 1 THEN json_extract(used.metadata, '$.version') END = ${ROLLUP_VERSION}
        AND CASE WHEN json_valid(used.metadata) = 1 THEN json_extract(used.metadata, '$.scope') END IN ('snapshots', 'full')
        AND CASE WHEN json_valid(used.metadata) = 1 THEN json_extract(used.metadata, '$.quality') END IN ('exact', 'lower_bound')
      ORDER BY used.bytes DESC, used.org_id
      LIMIT ${DASHBOARD_RANKING_LIMIT}
    `)
    return rows.map((row: { orgId: string; usedBytes: number; quotaBytes: number }) => ({
      orgId: row.orgId,
      usedBytes: Number(row.usedBytes),
      quotaBytes: Number(row.quotaBytes),
    }))
  }

  async coverage(requiredScope: AdminStatsRollupScope = 'full'): Promise<AdminStatsCoverage> {
    const expectedBuckets = Math.max(0, Math.floor((this.queryTo.getTime() - this.queryFrom.getTime()) / HOUR_MS))
    const markerRows = await this.markerRows(requiredScope)
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

  endExclusive(): Date {
    return this.queryTo
  }

  dayKey(date: Date): string {
    return statsDayKey(date)
  }

  private async loadRows(
    metric: AdminStatsMetric,
    dimensionKeys: readonly (AdminStatsDimension | '')[],
  ): Promise<HourlyMetricRow[]> {
    if (this.queryFrom >= this.queryTo) return []
    const requiredScope = metricDefinition(metric).kind === 'gauge' ? 'snapshots' : 'counters'
    const markerBuckets = await this.markerBuckets(requiredScope)
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
          lt(statsRollupsHourly.bucketStart, this.queryTo),
          sql`CASE WHEN json_valid(${statsRollupsHourly.metadata}) = 1 THEN json_extract(${statsRollupsHourly.metadata}, '$.version') END = ${ROLLUP_VERSION}`,
          requiredScope === 'snapshots'
            ? sql`CASE WHEN json_valid(${statsRollupsHourly.metadata}) = 1 THEN json_extract(${statsRollupsHourly.metadata}, '$.scope') END IN ('snapshots', 'full')`
            : sql`CASE WHEN json_valid(${statsRollupsHourly.metadata}) = 1 THEN json_extract(${statsRollupsHourly.metadata}, '$.scope') END IN ('counters', 'full')`,
          sql`CASE WHEN json_valid(${statsRollupsHourly.metadata}) = 1 THEN json_extract(${statsRollupsHourly.metadata}, '$.quality') END IN ('exact', 'lower_bound')`,
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
        lowerBound: parseAdminStatsRollupMetadata(row.metadata)?.quality === 'lower_bound',
      }))
  }

  private markerBuckets(requiredScope: AdminStatsRollupScope): Promise<Set<number>> {
    return this.markerRows(requiredScope).then((rows) => new Set(rows.map((row) => row.bucketStart.getTime())))
  }

  private markerRows(requiredScope: AdminStatsRollupScope): Promise<CompatibleMarkerRow[]> {
    const cached = this.markerRowsPromises.get(requiredScope)
    if (cached) return cached
    const rows = this.loadMarkerRows(requiredScope)
    this.markerRowsPromises.set(requiredScope, rows)
    return rows
  }

  private async loadMarkerRows(requiredScope: AdminStatsRollupScope): Promise<CompatibleMarkerRow[]> {
    if (this.queryFrom >= this.queryTo) return []
    const rows = await this.db
      .select({ bucketStart: statsRollupsHourly.bucketStart, metadata: statsRollupsHourly.metadata })
      .from(statsRollupsHourly)
      .where(
        and(
          eq(statsRollupsHourly.metricKey, ADMIN_STATS_METRICS.statsRollupRun),
          eq(statsRollupsHourly.orgId, ''),
          eq(statsRollupsHourly.dimensionKey, ''),
          gte(statsRollupsHourly.bucketStart, this.queryFrom),
          lt(statsRollupsHourly.bucketStart, this.queryTo),
        ),
      )
    return rows.flatMap((row) => {
      const metadata = parseAdminStatsRollupMetadata(row.metadata)
      return metadata && supportsScope(metadata.scope, requiredScope)
        ? [{ bucketStart: row.bucketStart, metadata }]
        : []
    })
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
