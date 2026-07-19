import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm'
import {
  backgroundJobs,
  cloudTrafficReports,
  downloaders,
  downloadTasks,
  imageHostings,
  matters,
  orgQuotas,
  shares,
  statsRollupsHourly,
  webhookEvents,
} from '../../db/schema'
import { type AtomicQuery, executeWriteTransaction } from '../../db/transaction'
import {
  type AdminStatsDimension,
  type AdminStatsMetric,
  assertMetricDimension,
  ADMIN_STATS_METRICS as M,
  ROLLUP_VERSION,
} from '../../domain/admin-stats-metrics'
import type { Database } from '../../platform/interface'

const HOUR_MS = 3_600_000
const D1_MAX_BOUND_PARAMS = 100
const ROLLUP_BOUND_PARAMS_PER_ROW = 11
export const ADMIN_STATS_ROLLUP_WRITE_BATCH_SIZE = Math.floor(D1_MAX_BOUND_PARAMS / ROLLUP_BOUND_PARAMS_PER_ROW)
const DOWNLOAD_ACTIONS = ['share_download', 'object_download', 'image_hosting_download', 'webdav_download']
const COUNTER_METRICS: AdminStatsMetric[] = [
  M.backgroundJobFinished,
  M.remoteDownloadTaskFinished,
  M.shareCreated,
  M.shareDownloadIssued,
  M.sharePasswordPassed,
  M.shareSaved,
  M.shareView,
  M.statsMissingBytes,
  M.statsRollupRun,
  M.transferDownloadFailed,
  M.transferDownloadIssued,
  M.transferUpload,
  M.userSignup,
]

type RollupValue = {
  metric: AdminStatsMetric
  orgId: string
  dimensionKey: AdminStatsDimension | ''
  dimensionValue: string
  count: number
  bytes: number
  uniqueCount: number
  lowerBound: boolean
}

type DimensionValues = Partial<Record<AdminStatsDimension, string | null | undefined>>

export interface AdminStatsHourlyRollupResult {
  bucketStart: Date
  bucketEnd: Date
  rows: number
  lowerBoundRows: number
}

export async function rebuildAdminStatsHour(
  db: Database,
  bucketStartInput: Date,
  generatedAt: Date,
  includeSnapshots: boolean,
): Promise<AdminStatsHourlyRollupResult> {
  const bucketStart = startOfHour(bucketStartInput)
  if (bucketStart.getTime() !== bucketStartInput.getTime()) throw new Error('stats_bucket_must_align_to_utc_hour')
  const bucketEnd = new Date(bucketStart.getTime() + HOUR_MS)
  const rollups = new RollupAccumulator()

  await addEventMetrics(db, rollups, bucketStart, bucketEnd)
  await addUserMetrics(db, rollups, bucketStart, bucketEnd)
  await addOperationalMetrics(db, rollups, bucketStart, bucketEnd)
  if (includeSnapshots) await addSnapshotMetrics(db, rollups, generatedAt)

  const values = rollups.values()
  const lowerBoundRows = values.filter((row) => row.lowerBound).length
  rollups.add(M.statsRollupRun, '', 1, 0, { outcome: 'success' })

  const updatedAt = generatedAt
  const rows = rollups.values().map((row) => ({
    id: rollupId(bucketStart, row),
    bucketStart,
    orgId: row.orgId,
    metricKey: row.metric,
    dimensionKey: row.dimensionKey,
    dimensionValue: row.dimensionValue,
    count: row.count,
    bytes: row.bytes,
    uniqueCount: row.uniqueCount,
    metadata: JSON.stringify({
      version: ROLLUP_VERSION,
      scope: includeSnapshots ? 'full' : 'counters',
      quality: row.lowerBound ? 'lower_bound' : 'exact',
      generatedAt: generatedAt.toISOString(),
    }),
    updatedAt,
  }))

  const deleteWhere = includeSnapshots
    ? eq(statsRollupsHourly.bucketStart, bucketStart)
    : and(eq(statsRollupsHourly.bucketStart, bucketStart), inArray(statsRollupsHourly.metricKey, COUNTER_METRICS))
  const writes: AtomicQuery[] = [db.delete(statsRollupsHourly).where(deleteWhere)]
  for (let index = 0; index < rows.length; index += ADMIN_STATS_ROLLUP_WRITE_BATCH_SIZE) {
    writes.push(db.insert(statsRollupsHourly).values(rows.slice(index, index + ADMIN_STATS_ROLLUP_WRITE_BATCH_SIZE)))
  }
  await executeWriteTransaction(db, writes)
  return { bucketStart, bucketEnd, rows: rows.length, lowerBoundRows }
}

async function addEventMetrics(db: Database, rollups: RollupAccumulator, from: Date, to: Date): Promise<void> {
  const rows = await db.all<EventMetricGroup>(sql`
    WITH facts AS (
      SELECT
        org_id AS orgId,
        action,
        COALESCE(actor_type, CASE WHEN user_id IS NULL THEN 'anonymous' ELSE 'user' END) AS actorType,
        CASE WHEN json_valid(metadata) = 1 THEN json_extract(metadata, '$.source') END AS source,
        CASE WHEN json_valid(metadata) = 1 THEN json_extract(metadata, '$.storageId') END AS storageId,
        CASE WHEN json_valid(metadata) = 1 THEN json_extract(metadata, '$.reason') END AS reason,
        CASE WHEN action IN ('share_view', 'share_download', 'save_from_share', 'share_password_passed')
          THEN COALESCE(CASE WHEN json_valid(metadata) = 1 THEN json_extract(metadata, '$.shareId') END, target_id)
        END AS shareId,
        CASE WHEN json_valid(metadata) = 1 THEN json_extract(metadata, '$.kind') END AS kind,
        CASE WHEN json_valid(metadata) = 1 THEN
          CASE WHEN json_type(metadata, '$.bytes') IN ('integer', 'real') THEN json_extract(metadata, '$.bytes') ELSE 0 END
        ELSE 0 END AS bytes,
        CASE WHEN action IN ('upload_confirm', 'share_download', 'object_download', 'image_hosting_download', 'webdav_download')
          THEN CASE
            WHEN json_valid(metadata) = 0 THEN 1
            WHEN json_type(metadata, '$.bytes') IN ('integer', 'real') THEN 0
            ELSE 1
          END
          ELSE 0
        END AS missingBytes
      FROM activity_events
      WHERE created_at >= ${Math.floor(from.getTime() / 1000)}
        AND created_at < ${Math.floor(to.getTime() / 1000)}
        AND action IN (
          'upload_confirm', 'upload_cancel', 'upload_failed',
          'share_download', 'object_download', 'image_hosting_download', 'webdav_download', 'download_failed',
          'share_view', 'save_from_share', 'share_password_passed'
        )
    )
    SELECT
      orgId, action, actorType, source, storageId, reason, shareId, kind,
      COUNT(*) AS count, COALESCE(SUM(bytes), 0) AS bytes, SUM(missingBytes) AS missingBytes
    FROM facts
    GROUP BY orgId, action, actorType, source, storageId, reason, shareId, kind
  `)

  for (const row of rows) {
    const count = Number(row.count)
    const bytes = Number(row.bytes)
    const missingBytes = Number(row.missingBytes)
    const lowerBound = missingBytes > 0

    if (row.action === 'upload_confirm' || row.action === 'upload_cancel' || row.action === 'upload_failed') {
      const status =
        row.action === 'upload_confirm' ? 'success' : row.action === 'upload_cancel' ? 'canceled' : 'failed'
      const reason =
        row.action === 'upload_confirm'
          ? null
          : (row.reason ?? (row.action === 'upload_cancel' ? 'upload_canceled' : 'upload_failed'))
      const confirmedBytes = row.action === 'upload_confirm' ? bytes : 0
      rollups.add(
        M.transferUpload,
        row.orgId,
        count,
        confirmedBytes,
        { source: row.source ?? 'upload', status, reason, storage_id: row.storageId },
        lowerBound,
      )
    }

    if (DOWNLOAD_ACTIONS.includes(row.action)) {
      rollups.add(
        M.transferDownloadIssued,
        row.orgId,
        count,
        bytes,
        {
          source: row.source ?? downloadSourceForAction(row.action),
          storage_id: row.storageId,
          actor_type: row.actorType,
        },
        lowerBound,
      )
    }

    if (row.action === 'download_failed') {
      rollups.add(M.transferDownloadFailed, row.orgId, count, bytes, {
        source: row.source ?? 'unknown',
        reason: row.reason ?? 'unknown',
      })
    }

    if (row.action === 'share_view') {
      rollups.add(M.shareView, row.orgId, count, 0, { share_id: row.shareId, actor_type: row.actorType })
    }
    if (row.action === 'share_download') {
      rollups.add(M.shareDownloadIssued, row.orgId, count, bytes, {
        share_id: row.shareId,
        kind: row.kind,
        source: row.source ?? downloadSourceForAction(row.action),
        actor_type: row.actorType,
      })
    }
    if (row.action === 'save_from_share') {
      rollups.add(M.shareSaved, row.orgId, count, bytes, { share_id: row.shareId, actor_type: row.actorType })
    }
    if (row.action === 'share_password_passed') {
      rollups.add(M.sharePasswordPassed, row.orgId, count, 0, { share_id: row.shareId })
    }
    if (lowerBound) {
      rollups.add(M.statsMissingBytes, row.orgId, missingBytes, 0, {
        direction: row.action === 'upload_confirm' ? 'upload' : 'download',
        source: row.source ?? row.action,
      })
    }
  }
}

type EventMetricGroup = {
  orgId: string
  action: string
  actorType: string
  source: string | null
  storageId: string | null
  reason: string | null
  shareId: string | null
  kind: string | null
  count: number
  bytes: number
  missingBytes: number
}

async function addUserMetrics(db: Database, rollups: RollupAccumulator, from: Date, to: Date): Promise<void> {
  const [signupRows, shareRows] = await Promise.all([
    db.all<{ provider: string; count: number }>(sql`
      SELECT provider, COUNT(*) AS count
      FROM (
        SELECT COALESCE((
          SELECT a.provider_id FROM account a
          WHERE a.user_id = u.id
          ORDER BY a.created_at, a.id
          LIMIT 1
        ), 'direct') AS provider
        FROM "user" u
        WHERE u.created_at >= ${from.getTime()} AND u.created_at < ${to.getTime()}
      ) signups
      GROUP BY provider
    `),
    db
      .select({ orgId: shares.orgId, kind: shares.kind, count: sql<number>`COUNT(*)` })
      .from(shares)
      .where(and(gte(shares.createdAt, from), lt(shares.createdAt, to)))
      .groupBy(shares.orgId, shares.kind),
  ])

  for (const row of signupRows) rollups.add(M.userSignup, '', Number(row.count), 0, { provider: row.provider })
  for (const row of shareRows) rollups.add(M.shareCreated, row.orgId, Number(row.count), 0, { kind: row.kind })
}

async function addOperationalMetrics(db: Database, rollups: RollupAccumulator, from: Date, to: Date): Promise<void> {
  const [taskFinishedRows, jobRows] = await Promise.all([
    db
      .select({
        orgId: downloadTasks.orgId,
        category: downloadTasks.category,
        downloaderId: downloadTasks.assignedDownloaderId,
        status: downloadTasks.status,
        count: sql<number>`COUNT(*)`,
        bytes: sql<number>`COALESCE(SUM(${downloadTasks.billingChargedBytes}), 0)`,
      })
      .from(downloadTasks)
      .where(and(gte(downloadTasks.finishedAt, from), lt(downloadTasks.finishedAt, to)))
      .groupBy(downloadTasks.orgId, downloadTasks.category, downloadTasks.assignedDownloaderId, downloadTasks.status),
    db
      .select({
        orgId: backgroundJobs.orgId,
        type: backgroundJobs.type,
        status: backgroundJobs.status,
        count: sql<number>`COUNT(*)`,
      })
      .from(backgroundJobs)
      .where(and(gte(backgroundJobs.finishedAt, from), lt(backgroundJobs.finishedAt, to)))
      .groupBy(backgroundJobs.orgId, backgroundJobs.type, backgroundJobs.status),
  ])

  for (const row of taskFinishedRows) {
    rollups.add(M.remoteDownloadTaskFinished, row.orgId, Number(row.count), Number(row.bytes), {
      category: row.category ?? 'uncategorized',
      downloader_id: row.downloaderId,
      outcome: row.status,
    })
  }
  for (const row of jobRows) {
    rollups.add(M.backgroundJobFinished, row.orgId, Number(row.count), 0, {
      job_type: row.type,
      outcome: row.status,
    })
  }
}

async function addSnapshotMetrics(db: Database, rollups: RollupAccumulator, now: Date): Promise<void> {
  const [
    userRows,
    activeUserRows,
    quotaRows,
    inventoryRows,
    inventoryByType,
    inventoryBySize,
    inventoryByAge,
    shareRows,
    jobRows,
    taskRows,
    downloaderRows,
    trafficReportRows,
    webhookRows,
  ] = await Promise.all([
    queryStage('user-inventory', userInventorySnapshot(db, now)),
    queryStage('user-activity', activeUserSnapshot(db, now)),
    queryStage(
      'quota',
      db
        .select({
          orgId: orgQuotas.orgId,
          used: orgQuotas.used,
          quota: orgQuotas.quota,
        })
        .from(orgQuotas),
    ),
    queryStage('inventory-base', inventoryGroups(db, now, 'base')),
    queryStage('inventory-type', inventoryGroups(db, now, 'file_type_group')),
    queryStage('inventory-size', inventoryGroups(db, now, 'size_bucket')),
    queryStage('inventory-age', inventoryGroups(db, now, 'age_bucket')),
    queryStage('shares', shareSnapshotGroups(db, now)),
    queryStage(
      'jobs',
      db
        .select({ orgId: backgroundJobs.orgId, count: sql<number>`COUNT(*)` })
        .from(backgroundJobs)
        .where(inArray(backgroundJobs.status, ['queued', 'running']))
        .groupBy(backgroundJobs.orgId),
    ),
    queryStage(
      'tasks',
      db
        .select({ orgId: downloadTasks.orgId, count: sql<number>`COUNT(*)` })
        .from(downloadTasks)
        .where(
          inArray(downloadTasks.status, [
            'queued',
            'assigned',
            'downloading',
            'uploading',
            'suspended',
            'paused',
            'interrupted',
          ]),
        )
        .groupBy(downloadTasks.orgId),
    ),
    queryStage(
      'downloaders',
      db
        .select({ status: downloaders.status, count: sql<number>`COUNT(*)` })
        .from(downloaders)
        .groupBy(downloaders.status),
    ),
    queryStage(
      'traffic-report-snapshot',
      db
        .select({
          status: cloudTrafficReports.status,
          count: sql<number>`COUNT(*)`,
          bytes: sql<number>`COALESCE(SUM(${cloudTrafficReports.bytes}), 0)`,
        })
        .from(cloudTrafficReports)
        .groupBy(cloudTrafficReports.status),
    ),
    queryStage(
      'webhook-snapshot',
      db
        .select({ status: webhookEvents.status, count: sql<number>`COUNT(*)` })
        .from(webhookEvents)
        .groupBy(webhookEvents.status),
    ),
  ])

  rollups.setGauge(M.userInventory, '', userRows.total, 0)
  rollups.setGauge(M.userInventory, '', userRows.normal, 0, 'status', 'normal')
  rollups.setGauge(M.userInventory, '', userRows.verified, 0, 'status', 'verified')
  rollups.setGauge(M.userInventory, '', userRows.unverified, 0, 'status', 'unverified')
  rollups.setGauge(M.userInventory, '', userRows.banned, 0, 'status', 'banned')
  rollups.setGauge(M.userInventory, '', userRows.silent, 0, 'status', 'silent')
  for (const row of activeUserRows) rollups.setGauge(M.userActiveSnapshot, '', row.count, 0, 'window', row.window)
  for (const row of quotaRows) {
    rollups.setGauge(M.storageUsed, row.orgId, 0, row.used)
    rollups.setGauge(M.storageQuota, row.orgId, 0, row.quota)
    rollups.incrementGauge(M.storageUsed, '', 0, row.used)
    rollups.incrementGauge(M.storageQuota, '', 1, row.quota)
    const status =
      row.quota > 0 && row.used >= row.quota
        ? 'over'
        : row.quota > 0 && row.used >= row.quota * 0.8
          ? 'near'
          : 'healthy'
    rollups.incrementGauge(M.storageQuota, '', 1, 0, 'status', status)
  }
  for (const row of [...inventoryRows, ...inventoryByType, ...inventoryBySize, ...inventoryByAge]) {
    rollups.incrementGauge(M.storageInventory, row.orgId, row.files, row.bytes, row.dimensionKey, row.dimensionValue)
    rollups.incrementGauge(M.storageInventory, '', row.files, row.bytes, row.dimensionKey, row.dimensionValue)
  }
  for (const row of shareRows) {
    rollups.incrementGauge(M.shareInventory, row.orgId, Number(row.count), 0, 'lifecycle', row.lifecycle)
    rollups.incrementGauge(M.shareInventory, '', Number(row.count), 0, 'lifecycle', row.lifecycle)
  }
  for (const row of jobRows) {
    rollups.incrementGauge(M.backgroundJobSnapshot, row.orgId, Number(row.count), 0)
    rollups.incrementGauge(M.backgroundJobSnapshot, '', Number(row.count), 0)
  }
  for (const row of taskRows) {
    rollups.incrementGauge(M.remoteDownloadTaskSnapshot, row.orgId, Number(row.count), 0)
    rollups.incrementGauge(M.remoteDownloadTaskSnapshot, '', Number(row.count), 0)
  }
  for (const row of downloaderRows) {
    rollups.incrementGauge(M.downloaderSnapshot, '', Number(row.count), 0)
    rollups.incrementGauge(M.downloaderSnapshot, '', Number(row.count), 0, 'status', row.status)
  }
  for (const row of trafficReportRows) {
    rollups.incrementGauge(M.trafficReportSnapshot, '', Number(row.count), Number(row.bytes))
    rollups.incrementGauge(M.trafficReportSnapshot, '', Number(row.count), Number(row.bytes), 'status', row.status)
  }
  for (const row of webhookRows) {
    rollups.incrementGauge(M.webhookSnapshot, '', Number(row.count), 0)
    rollups.incrementGauge(M.webhookSnapshot, '', Number(row.count), 0, 'status', row.status)
  }
}

async function shareSnapshotGroups(
  db: Database,
  now: Date,
): Promise<Array<{ orgId: string; lifecycle: string; count: number }>> {
  const nowSeconds = Math.floor(now.getTime() / 1000)
  const lifecycle = sql<string>`CASE
    WHEN ${shares.status} <> 'active' THEN 'revoked'
    WHEN ${shares.expiresAt} IS NOT NULL AND ${shares.expiresAt} <= ${nowSeconds} THEN 'expired'
    WHEN ${shares.downloadLimit} IS NOT NULL AND ${shares.downloads} >= ${shares.downloadLimit} THEN 'download_limit_reached'
    ELSE 'usable'
  END`
  return await db
    .select({ orgId: shares.orgId, lifecycle, count: sql<number>`COUNT(*)` })
    .from(shares)
    .groupBy(shares.orgId, lifecycle)
}

type UserInventorySnapshot = {
  total: number
  normal: number
  unverified: number
  banned: number
  silent: number
  verified: number
}

async function userInventorySnapshot(db: Database, now: Date): Promise<UserInventorySnapshot> {
  const activeCutoffMs = now.getTime() - 30 * 86_400_000
  const activeCutoffSec = Math.floor(activeCutoffMs / 1000)
  const rows = await db.all<UserInventorySnapshot>(sql`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN email_verified = 1 THEN 1 ELSE 0 END) AS verified,
      SUM(CASE WHEN email_verified = 0 AND COALESCE(banned, 0) = 0 THEN 1 ELSE 0 END) AS unverified,
      SUM(CASE WHEN COALESCE(banned, 0) = 1 THEN 1 ELSE 0 END) AS banned,
      SUM(CASE WHEN email_verified = 1 AND COALESCE(banned, 0) = 0
        AND NOT EXISTS (SELECT 1 FROM activity_events ae WHERE ae.user_id = user.id AND ae.created_at >= ${activeCutoffSec})
        AND NOT EXISTS (SELECT 1 FROM session s WHERE s.user_id = user.id AND s.created_at >= ${activeCutoffMs})
        THEN 1 ELSE 0 END) AS silent
    FROM user
  `)
  const row = rows[0] ?? { total: 0, verified: 0, unverified: 0, banned: 0, silent: 0, normal: 0 }
  const total = Number(row.total)
  const unverified = Number(row.unverified)
  const banned = Number(row.banned)
  const silent = Number(row.silent)
  const verified = Number(row.verified)
  return { total, verified, unverified, banned, silent, normal: Math.max(0, total - unverified - banned - silent) }
}

async function activeUserSnapshot(
  db: Database,
  now: Date,
): Promise<Array<{ window: 'dau' | 'wau' | 'mau'; count: number }>> {
  const windows = [
    { window: 'dau' as const, days: 1 },
    { window: 'wau' as const, days: 7 },
    { window: 'mau' as const, days: 30 },
  ]
  return await Promise.all(
    windows.map(async ({ window, days }) => {
      const cutoffMs = now.getTime() - days * 86_400_000
      const cutoffSec = Math.floor(cutoffMs / 1000)
      const rows = await db.all<{ count: number }>(sql`
        SELECT COUNT(DISTINCT user_id) AS count
        FROM (
          SELECT s.user_id AS user_id FROM session s JOIN user u ON u.id = s.user_id WHERE s.created_at >= ${cutoffMs}
          UNION ALL
          SELECT ae.user_id AS user_id FROM activity_events ae JOIN user u ON u.id = ae.user_id
            WHERE ae.user_id IS NOT NULL AND ae.created_at >= ${cutoffSec}
        ) active_users
      `)
      return { window, count: Number(rows[0]?.count ?? 0) }
    }),
  )
}

type InventoryGroup = {
  orgId: string
  files: number
  bytes: number
  dimensionKey: AdminStatsDimension | ''
  dimensionValue: string
}

async function inventoryGroups(
  db: Database,
  now: Date,
  dimension: '' | 'base' | AdminStatsDimension,
): Promise<InventoryGroup[]> {
  const dimensionSql =
    dimension === 'file_type_group'
      ? sql<string>`CASE WHEN instr(${matters.type}, '/') > 0 THEN substr(${matters.type}, 1, instr(${matters.type}, '/') - 1) ELSE COALESCE(NULLIF(${matters.type}, ''), 'unknown') END`
      : dimension === 'size_bucket'
        ? sql<string>`CASE WHEN ${matters.size} <= ${10 * 1024 * 1024} THEN '<10MB' WHEN ${matters.size} <= ${100 * 1024 * 1024} THEN '10-100MB' WHEN ${matters.size} <= ${1024 * 1024 * 1024} THEN '100MB-1GB' ELSE '>1GB' END`
        : dimension === 'age_bucket'
          ? sql<string>`CASE WHEN ${matters.createdAt} >= ${Math.floor(now.getTime() / 1000) - 30 * 86_400} THEN '<30d' WHEN ${matters.createdAt} >= ${Math.floor(now.getTime() / 1000) - 90 * 86_400} THEN '30-90d' WHEN ${matters.createdAt} >= ${Math.floor(now.getTime() / 1000) - 180 * 86_400} THEN '90-180d' ELSE '>180d' END`
          : sql<string>`''`
  const matterRows = await db
    .select({
      orgId: matters.orgId,
      files: sql<number>`COUNT(*)`,
      bytes: sql<number>`COALESCE(SUM(${matters.size}), 0)`,
      dimensionValue: dimensionSql,
    })
    .from(matters)
    .where(and(eq(matters.status, 'active'), eq(matters.dirtype, 0)))
    .groupBy(matters.orgId, dimensionSql)
  const imageDimensionSql =
    dimension === 'file_type_group'
      ? sql<string>`'image'`
      : dimension === 'size_bucket'
        ? sql<string>`CASE WHEN ${imageHostings.size} <= ${10 * 1024 * 1024} THEN '<10MB' WHEN ${imageHostings.size} <= ${100 * 1024 * 1024} THEN '10-100MB' WHEN ${imageHostings.size} <= ${1024 * 1024 * 1024} THEN '100MB-1GB' ELSE '>1GB' END`
        : dimension === 'age_bucket'
          ? sql<string>`CASE WHEN ${imageHostings.createdAt} >= ${now.getTime() - 30 * 86_400_000} THEN '<30d' WHEN ${imageHostings.createdAt} >= ${now.getTime() - 90 * 86_400_000} THEN '30-90d' WHEN ${imageHostings.createdAt} >= ${now.getTime() - 180 * 86_400_000} THEN '90-180d' ELSE '>180d' END`
          : sql<string>`''`
  const imageRows = await db
    .select({
      orgId: imageHostings.orgId,
      files: sql<number>`COUNT(*)`,
      bytes: sql<number>`COALESCE(SUM(${imageHostings.size}), 0)`,
      dimensionValue: imageDimensionSql,
    })
    .from(imageHostings)
    .where(eq(imageHostings.status, 'active'))
    .groupBy(imageHostings.orgId, imageDimensionSql)
  const result: InventoryGroup[] = matterRows.map((row) => ({
    orgId: row.orgId,
    files: Number(row.files),
    bytes: Number(row.bytes),
    dimensionKey: dimension === 'base' ? '' : dimension,
    dimensionValue: row.dimensionValue,
  }))
  for (const row of imageRows) {
    result.push({
      orgId: row.orgId,
      files: Number(row.files),
      bytes: Number(row.bytes),
      dimensionKey: dimension === 'base' ? '' : dimension,
      dimensionValue: row.dimensionValue,
    })
  }
  return result
}

class RollupAccumulator {
  private readonly rows = new Map<string, RollupValue>()

  add(
    metric: AdminStatsMetric,
    orgId: string,
    count: number,
    bytes = 0,
    dimensions: DimensionValues = {},
    lowerBound = false,
  ): void {
    this.increment(metric, orgId, '', '', count, bytes, 0, lowerBound)
    for (const [dimensionKey, dimensionValue] of Object.entries(dimensions)) {
      if (!dimensionValue) continue
      assertMetricDimension(metric, dimensionKey)
      this.increment(metric, orgId, dimensionKey, dimensionValue, count, bytes, 0, lowerBound)
    }
  }

  setGauge(
    metric: AdminStatsMetric,
    orgId: string,
    count: number,
    bytes: number,
    dimensionKey: AdminStatsDimension | '' = '',
    dimensionValue = '',
  ): void {
    if (dimensionKey) assertMetricDimension(metric, dimensionKey)
    this.rows.set(key(metric, orgId, dimensionKey, dimensionValue), {
      metric,
      orgId,
      dimensionKey,
      dimensionValue,
      count,
      bytes,
      uniqueCount: 0,
      lowerBound: false,
    })
  }

  incrementGauge(
    metric: AdminStatsMetric,
    orgId: string,
    count: number,
    bytes: number,
    dimensionKey: AdminStatsDimension | '' = '',
    dimensionValue = '',
  ): void {
    if (dimensionKey) assertMetricDimension(metric, dimensionKey)
    this.increment(metric, orgId, dimensionKey, dimensionValue, count, bytes, 0, false)
  }

  values(): RollupValue[] {
    return [...this.rows.values()]
  }

  private increment(
    metric: AdminStatsMetric,
    orgId: string,
    dimensionKey: AdminStatsDimension | '',
    dimensionValue: string,
    count: number,
    bytes: number,
    uniqueCount: number,
    lowerBound: boolean,
  ): void {
    const rowKey = key(metric, orgId, dimensionKey, dimensionValue)
    const row = this.rows.get(rowKey) ?? {
      metric,
      orgId,
      dimensionKey,
      dimensionValue,
      count: 0,
      bytes: 0,
      uniqueCount: 0,
      lowerBound: false,
    }
    row.count += count
    row.bytes += bytes
    row.uniqueCount += uniqueCount
    row.lowerBound ||= lowerBound
    this.rows.set(rowKey, row)
  }
}

function startOfHour(date: Date): Date {
  return new Date(Math.floor(date.getTime() / HOUR_MS) * HOUR_MS)
}

function key(metric: AdminStatsMetric, orgId: string, dimensionKey: string, dimensionValue: string): string {
  return `${metric}\u0000${orgId}\u0000${dimensionKey}\u0000${dimensionValue}`
}

function rollupId(bucketStart: Date, row: RollupValue): string {
  return `${bucketStart.getTime()}:${row.orgId || 'global'}:${row.metric}:${row.dimensionKey || 'all'}:${row.dimensionValue || 'all'}`
}

function downloadSourceForAction(action: string): string {
  if (action === 'object_download') return 'object_download'
  if (action === 'image_hosting_download') return 'image_hosting'
  if (action === 'webdav_download') return 'webdav_download'
  return 'landing_share'
}

async function queryStage<T>(name: string, query: PromiseLike<T>): Promise<T> {
  try {
    return await query
  } catch (error) {
    throw new Error(`stats_rollup_query_failed:${name}`, { cause: error })
  }
}
