import { and, eq, gte, inArray, isNull, lt, ne, notInArray, sql } from 'drizzle-orm'
import { organization } from '../../db/auth-schema'
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
  storageUsageLedger,
  webhookEvents,
} from '../../db/schema'
import { type AtomicQuery, executeWriteTransaction } from '../../db/transaction'
import {
  type AdminStatsDimension,
  type AdminStatsMetric,
  assertMetricDimension,
  ADMIN_STATS_METRICS as M,
  parseAdminStatsRollupMetadata,
  ROLLUP_VERSION,
} from '../../domain/admin-stats-metrics'
import type { Database } from '../../platform/interface'
import { createCloudTrafficReportRepo, trafficLedgerExactFrom } from './cloud-traffic-report'
import { getEffectiveQuotasByOrg } from './quota'
import {
  ensureStorageUsageOpeningBalances,
  getStorageUsageLedgerOpening,
  storageUsageLedgerExactFrom,
} from './storage-usage-ledger'

const HOUR_MS = 3_600_000
const D1_MAX_BOUND_PARAMS = 100
const ROLLUP_BOUND_PARAMS_PER_ROW = 11
export const ADMIN_STATS_ROLLUP_WRITE_BATCH_SIZE = Math.floor(D1_MAX_BOUND_PARAMS / ROLLUP_BOUND_PARAMS_PER_ROW)
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
  M.storageLedgerBalance,
  M.storageLedgerChange,
  M.transferDownloadFailed,
  M.transferDownloadIssued,
  M.transferUpload,
  M.userSignup,
]
const GAUGE_METRICS: AdminStatsMetric[] = [
  M.backgroundJobSnapshot,
  M.downloaderSnapshot,
  M.remoteDownloadTaskSnapshot,
  M.shareInventory,
  M.statsDataQualitySnapshot,
  M.storageInventory,
  M.storageQuota,
  M.storageTrashSnapshot,
  M.storageUsed,
  M.trafficReportSnapshot,
  M.userActiveSnapshot,
  M.userInventory,
  M.webhookSnapshot,
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
): Promise<AdminStatsHourlyRollupResult> {
  const bucketStart = startOfHour(bucketStartInput)
  if (bucketStart.getTime() !== bucketStartInput.getTime()) throw new Error('stats_bucket_must_align_to_utc_hour')
  const bucketEnd = new Date(bucketStart.getTime() + HOUR_MS)
  const rollups = new RollupAccumulator()
  const capturedSnapshot = await compatibleSnapshotMarker(db, bucketStart)

  await ensureStorageUsageOpeningBalances(db, generatedAt)
  await createCloudTrafficReportRepo(db).ensureLedgerOpening(generatedAt)
  await addEventMetrics(db, rollups, bucketStart, bucketEnd)
  await addTransferDownloadMetrics(db, rollups, bucketStart, bucketEnd)
  await addUserMetrics(db, rollups, bucketStart, bucketEnd)
  await addOperationalMetrics(db, rollups, bucketStart, bucketEnd)
  await addStorageLedgerChanges(db, rollups, bucketStart, bucketEnd)
  await addStorageLedgerBalance(db, rollups, bucketEnd)
  const values = rollups.values()
  const lowerBoundRows = values.filter((row) => row.lowerBound).length
  rollups.add(M.statsRollupRun, '', 1, 0, { outcome: 'success' }, lowerBoundRows > 0)
  const completionScope = capturedSnapshot ? 'full' : 'counters'
  const counterQuality = lowerBoundRows > 0 ? 'lower_bound' : 'exact'

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
    metadata: JSON.stringify(
      row.metric === M.statsRollupRun
        ? {
            version: ROLLUP_VERSION,
            scope: completionScope,
            quality:
              counterQuality === 'lower_bound' || capturedSnapshot?.quality === 'lower_bound' ? 'lower_bound' : 'exact',
            counterQuality,
            ...(capturedSnapshot
              ? {
                  snapshotQuality: capturedSnapshot.quality,
                  snapshotObservedAt: capturedSnapshot.observedAt,
                }
              : {}),
            generatedAt: generatedAt.toISOString(),
          }
        : {
            version: ROLLUP_VERSION,
            scope: 'counters',
            quality: row.lowerBound ? 'lower_bound' : 'exact',
            generatedAt: generatedAt.toISOString(),
          },
    ),
    updatedAt,
  }))

  const writes: AtomicQuery[] = [
    db
      .delete(statsRollupsHourly)
      .where(
        and(eq(statsRollupsHourly.bucketStart, bucketStart), inArray(statsRollupsHourly.metricKey, COUNTER_METRICS)),
      ),
  ]
  for (let index = 0; index < rows.length; index += ADMIN_STATS_ROLLUP_WRITE_BATCH_SIZE) {
    writes.push(db.insert(statsRollupsHourly).values(rows.slice(index, index + ADMIN_STATS_ROLLUP_WRITE_BATCH_SIZE)))
  }
  await executeWriteTransaction(db, writes)
  return { bucketStart, bucketEnd, rows: rows.length, lowerBoundRows }
}

export async function captureAdminStatsSnapshot(
  db: Database,
  bucketStartInput: Date,
  observedAt: Date,
): Promise<AdminStatsHourlyRollupResult> {
  const bucketStart = startOfHour(bucketStartInput)
  if (bucketStart.getTime() !== bucketStartInput.getTime()) throw new Error('stats_bucket_must_align_to_utc_hour')
  if (startOfHour(observedAt).getTime() !== bucketStart.getTime()) {
    throw new Error('stats_snapshot_must_be_captured_in_bucket')
  }
  const bucketEnd = new Date(bucketStart.getTime() + HOUR_MS)
  const rollups = new RollupAccumulator()
  await ensureStorageUsageOpeningBalances(db, observedAt)
  await addSnapshotMetrics(db, rollups, observedAt)
  rollups.add(M.statsRollupRun, '', 1, 0, { outcome: 'success' })
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
      scope: 'snapshots',
      quality: 'exact',
      ...(row.metric === M.statsRollupRun
        ? { snapshotQuality: 'exact', snapshotObservedAt: observedAt.toISOString() }
        : { observedAt: observedAt.toISOString() }),
    }),
    updatedAt: observedAt,
  }))
  const writes: AtomicQuery[] = [
    db
      .delete(statsRollupsHourly)
      .where(
        and(
          eq(statsRollupsHourly.bucketStart, bucketStart),
          inArray(statsRollupsHourly.metricKey, [...GAUGE_METRICS, M.statsRollupRun]),
        ),
      ),
  ]
  for (let index = 0; index < rows.length; index += ADMIN_STATS_ROLLUP_WRITE_BATCH_SIZE) {
    writes.push(db.insert(statsRollupsHourly).values(rows.slice(index, index + ADMIN_STATS_ROLLUP_WRITE_BATCH_SIZE)))
  }
  await executeWriteTransaction(db, writes)
  return { bucketStart, bucketEnd, rows: rows.length, lowerBoundRows: 0 }
}

async function compatibleSnapshotMarker(
  db: Database,
  bucketStart: Date,
): Promise<{ quality: 'exact' | 'lower_bound'; observedAt: string } | null> {
  const rows = await db
    .select({ metadata: statsRollupsHourly.metadata })
    .from(statsRollupsHourly)
    .where(
      and(
        eq(statsRollupsHourly.bucketStart, bucketStart),
        eq(statsRollupsHourly.orgId, ''),
        eq(statsRollupsHourly.metricKey, M.statsRollupRun),
        eq(statsRollupsHourly.dimensionKey, ''),
        eq(statsRollupsHourly.dimensionValue, ''),
      ),
    )
    .limit(1)
  const metadata = parseAdminStatsRollupMetadata(rows[0]?.metadata ?? null)
  if ((metadata?.scope !== 'snapshots' && metadata?.scope !== 'full') || !metadata.snapshotObservedAt) return null
  return { quality: metadata.snapshotQuality ?? metadata.quality, observedAt: metadata.snapshotObservedAt }
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
        CASE WHEN action = 'upload_confirm'
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

async function addTransferDownloadMetrics(
  db: Database,
  rollups: RollupAccumulator,
  from: Date,
  to: Date,
): Promise<void> {
  const opening = await createCloudTrafficReportRepo(db).getLedgerOpening()
  if (!opening) throw new Error('traffic_ledger_opening_missing')
  const lowerBound = from < trafficLedgerExactFrom(opening)
  const rows = await db.all<{
    orgId: string
    source: string
    storageId: string | null
    count: number
    bytes: number
  }>(sql`
    SELECT
      org_id AS orgId,
      source,
      storage_id AS storageId,
      COUNT(*) AS count,
      COALESCE(SUM(bytes), 0) AS bytes
    FROM cloud_traffic_reports
    WHERE issued_at >= ${from.getTime()}
      AND issued_at < ${to.getTime()}
      AND status <> 'reversed'
    GROUP BY org_id, source, storage_id
  `)
  for (const row of rows) {
    rollups.add(
      M.transferDownloadIssued,
      row.orgId,
      Number(row.count),
      Number(row.bytes),
      { source: row.source, storage_id: row.storageId },
      lowerBound,
    )
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
  const rows = await db.all<{
    action: string
    orgId: string
    provider: string | null
    kind: string | null
    count: number
    lowerBound: number
  }>(sql`
    SELECT
      action,
      org_id AS orgId,
      CASE WHEN json_valid(metadata) = 1 THEN json_extract(metadata, '$.provider') END AS provider,
      CASE WHEN json_valid(metadata) = 1 THEN json_extract(metadata, '$.kind') END AS kind,
      COUNT(*) AS count,
      SUM(CASE WHEN json_valid(metadata) = 1 AND json_extract(metadata, '$.statsQuality') = 'lower_bound' THEN 1 ELSE 0 END) AS lowerBound
    FROM activity_events
    WHERE created_at >= ${Math.floor(from.getTime() / 1000)}
      AND created_at < ${Math.floor(to.getTime() / 1000)}
      AND action IN ('stats_user_signup', 'stats_share_created')
    GROUP BY action, org_id, provider, kind
  `)

  for (const row of rows) {
    if (row.action === 'stats_user_signup') {
      rollups.add(M.userSignup, '', Number(row.count), 0, { provider: row.provider ?? 'unknown' }, row.lowerBound > 0)
    } else {
      rollups.add(M.shareCreated, row.orgId, Number(row.count), 0, { kind: row.kind ?? 'unknown' }, row.lowerBound > 0)
    }
  }
}

async function addOperationalMetrics(db: Database, rollups: RollupAccumulator, from: Date, to: Date): Promise<void> {
  const rows = await db.all<{
    action: string
    orgId: string
    category: string | null
    downloaderId: string | null
    jobType: string | null
    outcome: string | null
    count: number
    bytes: number
    lowerBound: number
  }>(sql`
    SELECT
      action,
      org_id AS orgId,
      CASE WHEN json_valid(metadata) = 1 THEN json_extract(metadata, '$.category') END AS category,
      CASE WHEN json_valid(metadata) = 1 THEN json_extract(metadata, '$.downloaderId') END AS downloaderId,
      CASE WHEN json_valid(metadata) = 1 THEN json_extract(metadata, '$.jobType') END AS jobType,
      CASE WHEN json_valid(metadata) = 1 THEN json_extract(metadata, '$.outcome') END AS outcome,
      COUNT(*) AS count,
      SUM(CASE WHEN json_valid(metadata) = 1 THEN COALESCE(json_extract(metadata, '$.bytes'), 0) ELSE 0 END) AS bytes,
      SUM(CASE WHEN json_valid(metadata) = 1 AND json_extract(metadata, '$.statsQuality') = 'lower_bound' THEN 1 ELSE 0 END) AS lowerBound
    FROM activity_events
    WHERE created_at >= ${Math.floor(from.getTime() / 1000)}
      AND created_at < ${Math.floor(to.getTime() / 1000)}
      AND action IN ('stats_background_job_finished', 'stats_remote_download_finished')
    GROUP BY action, org_id, category, downloaderId, jobType, outcome
  `)

  for (const row of rows) {
    if (row.action === 'stats_remote_download_finished') {
      rollups.add(
        M.remoteDownloadTaskFinished,
        row.orgId,
        Number(row.count),
        Number(row.bytes),
        {
          category: row.category ?? 'uncategorized',
          downloader_id: row.downloaderId,
          outcome: row.outcome ?? 'unknown',
        },
        row.lowerBound > 0,
      )
    } else {
      rollups.add(
        M.backgroundJobFinished,
        row.orgId,
        Number(row.count),
        0,
        { job_type: row.jobType ?? 'unknown', outcome: row.outcome ?? 'unknown' },
        row.lowerBound > 0,
      )
    }
  }
}

async function addStorageLedgerBalance(db: Database, rollups: RollupAccumulator, bucketEnd: Date): Promise<void> {
  const complete = await queryStage(
    'storage-ledger-opening',
    db
      .select({ id: storageUsageLedger.id })
      .from(storageUsageLedger)
      .where(
        and(eq(storageUsageLedger.reason, 'opening_balance_complete'), lt(storageUsageLedger.occurredAt, bucketEnd)),
      )
      .limit(1),
  )
  if (complete.length === 0) return

  const rows = await queryStage(
    'storage-ledger-balance',
    db
      .select({ bytes: sql<number>`COALESCE(SUM(${storageUsageLedger.deltaBytes}), 0)` })
      .from(storageUsageLedger)
      .where(lt(storageUsageLedger.occurredAt, bucketEnd)),
  )
  rollups.setGauge(M.storageLedgerBalance, '', 0, Number(rows[0]?.bytes ?? 0))
}

async function addStorageLedgerChanges(
  db: Database,
  rollups: RollupAccumulator,
  bucketStart: Date,
  bucketEnd: Date,
): Promise<void> {
  const opening = await queryStage('storage-ledger-change-opening', getStorageUsageLedgerOpening(db))
  if (!opening || bucketStart < storageUsageLedgerExactFrom(opening)) return

  const direction = sql<string>`CASE WHEN ${storageUsageLedger.deltaBytes} > 0 THEN 'written' ELSE 'released' END`
  const rows = await queryStage(
    'storage-ledger-change',
    db
      .select({
        orgId: storageUsageLedger.orgId,
        storageId: storageUsageLedger.storageId,
        reason: storageUsageLedger.reason,
        direction,
        count: sql<number>`COUNT(*)`,
        bytes: sql<number>`SUM(ABS(${storageUsageLedger.deltaBytes}))`,
      })
      .from(storageUsageLedger)
      .where(
        and(
          gte(storageUsageLedger.occurredAt, bucketStart),
          lt(storageUsageLedger.occurredAt, bucketEnd),
          ne(storageUsageLedger.deltaBytes, 0),
          notInArray(storageUsageLedger.reason, ['opening_balance', 'opening_balance_complete']),
        ),
      )
      .groupBy(storageUsageLedger.orgId, storageUsageLedger.storageId, storageUsageLedger.reason, direction),
  )
  for (const row of rows) {
    rollups.add(M.storageLedgerChange, row.orgId, Number(row.count), Number(row.bytes), {
      direction: row.direction,
      reason: row.reason,
      storage_id: row.storageId,
    })
  }
}

async function addSnapshotMetrics(db: Database, rollups: RollupAccumulator, now: Date): Promise<void> {
  const [
    userRows,
    activeUserRows,
    quotaBaseRows,
    inventoryRows,
    inventoryByType,
    inventoryBySize,
    inventoryByAge,
    trashRows,
    shareRows,
    dataQualityRows,
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
          orgId: organization.id,
          quotaId: orgQuotas.id,
          used: sql<number>`COALESCE(${orgQuotas.used}, 0)`,
        })
        .from(organization)
        .leftJoin(orgQuotas, eq(orgQuotas.orgId, organization.id)),
    ),
    queryStage('inventory-base', inventoryGroups(db, now, 'base')),
    queryStage('inventory-type', inventoryGroups(db, now, 'file_type_group')),
    queryStage('inventory-size', inventoryGroups(db, now, 'size_bucket')),
    queryStage('inventory-age', inventoryGroups(db, now, 'age_bucket')),
    queryStage('trash-inventory', trashInventoryGroups(db)),
    queryStage('shares', shareSnapshotGroups(db, now)),
    queryStage('data-quality', dataQualitySnapshot(db)),
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
        .where(
          inArray(cloudTrafficReports.status, [
            'pending',
            'reported',
            'skipped_unbound',
            'failed',
            'dead_letter',
            'blocked',
          ]),
        )
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

  const effectiveQuotas = await queryStage(
    'effective-quota',
    getEffectiveQuotasByOrg(
      db,
      quotaBaseRows.map((row) => row.orgId),
      now,
    ),
  )

  rollups.setGauge(M.userInventory, '', userRows.total, 0)
  rollups.setGauge(M.userInventory, '', userRows.normal, 0, 'status', 'normal')
  rollups.setGauge(M.userInventory, '', userRows.verified, 0, 'status', 'verified')
  rollups.setGauge(M.userInventory, '', userRows.unverified, 0, 'status', 'unverified')
  rollups.setGauge(M.userInventory, '', userRows.banned, 0, 'status', 'banned')
  rollups.setGauge(M.userInventory, '', userRows.silent, 0, 'status', 'silent')
  rollups.setGauge(M.userActiveSnapshot, '', activeUserRows.find((row) => row.window === 'mau')?.count ?? 0, 0)
  for (const row of activeUserRows) rollups.setGauge(M.userActiveSnapshot, '', row.count, 0, 'window', row.window)
  rollups.setGauge(M.storageUsed, '', 0, 0)
  rollups.setGauge(M.storageQuota, '', 0, 0)
  rollups.setGauge(M.storageInventory, '', 0, 0)
  rollups.setGauge(M.storageTrashSnapshot, '', 0, 0)
  rollups.setGauge(M.shareInventory, '', 0, 0)
  rollups.setGauge(M.statsDataQualitySnapshot, '', dataQualityRows.unlocatedShareEvents, 0)
  rollups.setGauge(M.statsDataQualitySnapshot, '', dataQualityRows.unlocatedShareViews, 0, 'kind', 'share_views')
  rollups.setGauge(
    M.statsDataQualitySnapshot,
    '',
    dataQualityRows.unlocatedShareDownloads,
    0,
    'kind',
    'share_downloads',
  )
  rollups.setGauge(
    M.statsDataQualitySnapshot,
    '',
    dataQualityRows.storageUsageDriftSpaces,
    dataQualityRows.storageUsageDriftBytes,
    'kind',
    'storage_usage_drift',
  )
  rollups.setGauge(
    M.statsDataQualitySnapshot,
    '',
    dataQualityRows.storageLedgerDriftSpaces,
    dataQualityRows.storageLedgerDriftBytes,
    'kind',
    'storage_ledger_drift',
  )
  rollups.setGauge(M.backgroundJobSnapshot, '', 0, 0)
  rollups.setGauge(M.remoteDownloadTaskSnapshot, '', 0, 0)
  rollups.setGauge(M.downloaderSnapshot, '', 0, 0)
  rollups.setGauge(M.trafficReportSnapshot, '', 0, 0)
  rollups.setGauge(M.webhookSnapshot, '', 0, 0)
  for (const row of quotaBaseRows) {
    const effective = effectiveQuotas.get(row.orgId)
    if (!effective) throw new Error(`stats_effective_quota_missing:${row.orgId}`)
    const quota = row.quotaId ? effective.quota : 0
    rollups.setGauge(M.storageUsed, row.orgId, 0, row.used)
    rollups.setGauge(M.storageQuota, row.orgId, 0, quota)
    rollups.incrementGauge(M.storageUsed, '', 0, row.used)
    rollups.incrementGauge(M.storageQuota, '', 1, quota)
    const status = quota <= 0 ? 'invalid' : row.used >= quota ? 'over' : row.used >= quota * 0.8 ? 'near' : 'healthy'
    rollups.incrementGauge(M.storageQuota, '', 1, 0, 'status', status)
  }
  for (const row of [...inventoryRows, ...inventoryByType, ...inventoryBySize, ...inventoryByAge]) {
    rollups.incrementGauge(M.storageInventory, row.orgId, row.files, row.bytes, row.dimensionKey, row.dimensionValue)
    rollups.incrementGauge(M.storageInventory, '', row.files, row.bytes, row.dimensionKey, row.dimensionValue)
  }
  for (const row of trashRows) {
    rollups.incrementGauge(M.storageTrashSnapshot, row.orgId, row.files, row.bytes)
    rollups.incrementGauge(M.storageTrashSnapshot, '', row.files, row.bytes)
    rollups.incrementGauge(M.storageTrashSnapshot, row.orgId, row.files, row.bytes, 'storage_id', row.storageId)
    rollups.incrementGauge(M.storageTrashSnapshot, '', row.files, row.bytes, 'storage_id', row.storageId)
  }
  for (const row of shareRows) {
    rollups.incrementGauge(M.shareInventory, row.orgId, Number(row.count), 0)
    rollups.incrementGauge(M.shareInventory, row.orgId, Number(row.count), 0, 'lifecycle', row.lifecycle)
    rollups.incrementGauge(M.shareInventory, '', Number(row.count), 0)
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

async function dataQualitySnapshot(db: Database): Promise<{
  unlocatedShareEvents: number
  unlocatedShareViews: number
  unlocatedShareDownloads: number
  storageUsageDriftSpaces: number
  storageUsageDriftBytes: number
  storageLedgerDriftSpaces: number
  storageLedgerDriftBytes: number
}> {
  const rows = await db.all<{
    unlocatedShareViews: number
    unlocatedShareDownloads: number
    storageUsageDriftSpaces: number
    storageUsageDriftBytes: number
    storageLedgerDriftSpaces: number
    storageLedgerDriftBytes: number
  }>(sql`
    WITH event_counts AS (
      SELECT
        COALESCE(CASE WHEN json_valid(metadata) = 1 THEN json_extract(metadata, '$.shareId') END, target_id) AS share_id,
        SUM(CASE WHEN action = 'share_view' THEN 1 ELSE 0 END) AS views,
        SUM(CASE WHEN action = 'share_download' THEN 1 ELSE 0 END) AS downloads
      FROM activity_events
      WHERE action IN ('share_view', 'share_download')
      GROUP BY share_id
    ),
    billable_storage AS (
      SELECT org_id, SUM(bytes) AS bytes
      FROM (
        SELECT org_id, COALESCE(size, 0) AS bytes
        FROM matters
        WHERE status IN ('active', 'trashed') AND dirtype = 0 AND purged_at IS NULL
        UNION ALL
        SELECT org_id, COALESCE(size, 0) AS bytes
        FROM image_hostings
        WHERE status = 'active' AND purged_at IS NULL
      ) inventory
      GROUP BY org_id
    ),
    storage_drift AS (
      SELECT ABS(q.used - COALESCE(billable_storage.bytes, 0)) AS bytes
      FROM org_quotas q
      JOIN organization o ON o.id = q.org_id
      LEFT JOIN billable_storage ON billable_storage.org_id = q.org_id
      WHERE q.used <> COALESCE(billable_storage.bytes, 0)
    ),
    ledger_storage AS (
      SELECT org_id, SUM(delta_bytes) AS bytes
      FROM storage_usage_ledger
      WHERE org_id <> ''
      GROUP BY org_id
    ),
    ledger_drift AS (
      SELECT ABS(COALESCE(ledger_storage.bytes, 0) - COALESCE(billable_storage.bytes, 0)) AS bytes
      FROM organization o
      LEFT JOIN billable_storage ON billable_storage.org_id = o.id
      LEFT JOIN ledger_storage ON ledger_storage.org_id = o.id
      WHERE COALESCE(ledger_storage.bytes, 0) <> COALESCE(billable_storage.bytes, 0)
    )
    SELECT
      COALESCE(SUM(MAX(${shares.views} - COALESCE(event_counts.views, 0), 0)), 0) AS unlocatedShareViews,
      COALESCE(SUM(MAX(${shares.downloads} - COALESCE(event_counts.downloads, 0), 0)), 0) AS unlocatedShareDownloads,
      (SELECT COUNT(*) FROM storage_drift) AS storageUsageDriftSpaces,
      (SELECT COALESCE(SUM(bytes), 0) FROM storage_drift) AS storageUsageDriftBytes,
      (SELECT COUNT(*) FROM ledger_drift) AS storageLedgerDriftSpaces,
      (SELECT COALESCE(SUM(bytes), 0) FROM ledger_drift) AS storageLedgerDriftBytes
    FROM ${shares}
    LEFT JOIN event_counts ON event_counts.share_id = ${shares.id}
  `)
  const unlocatedShareViews = Number(rows[0]?.unlocatedShareViews ?? 0)
  const unlocatedShareDownloads = Number(rows[0]?.unlocatedShareDownloads ?? 0)
  return {
    unlocatedShareEvents: unlocatedShareViews + unlocatedShareDownloads,
    unlocatedShareViews,
    unlocatedShareDownloads,
    storageUsageDriftSpaces: Number(rows[0]?.storageUsageDriftSpaces ?? 0),
    storageUsageDriftBytes: Number(rows[0]?.storageUsageDriftBytes ?? 0),
    storageLedgerDriftSpaces: Number(rows[0]?.storageLedgerDriftSpaces ?? 0),
    storageLedgerDriftBytes: Number(rows[0]?.storageLedgerDriftBytes ?? 0),
  }
}

async function trashInventoryGroups(
  db: Database,
): Promise<Array<{ orgId: string; storageId: string; files: number; bytes: number }>> {
  const rows = await db
    .select({
      orgId: matters.orgId,
      storageId: matters.storageId,
      files: sql<number>`COUNT(*)`,
      bytes: sql<number>`COALESCE(SUM(${matters.size}), 0)`,
    })
    .from(matters)
    .where(
      and(
        inArray(matters.status, ['active', 'trashed']),
        sql`${matters.trashedAt} IS NOT NULL`,
        isNull(matters.purgedAt),
        eq(matters.dirtype, 0),
      ),
    )
    .groupBy(matters.orgId, matters.storageId)
  return rows.map((row) => ({ ...row, files: Number(row.files), bytes: Number(row.bytes) }))
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
  const activeCutoffSec = Math.floor((now.getTime() - 30 * 86_400_000) / 1000)
  const rows = await db.all<UserInventorySnapshot>(sql`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN email_verified = 1 THEN 1 ELSE 0 END) AS verified,
      SUM(CASE WHEN email_verified = 0 AND COALESCE(banned, 0) = 0 THEN 1 ELSE 0 END) AS unverified,
      SUM(CASE WHEN COALESCE(banned, 0) = 1 THEN 1 ELSE 0 END) AS banned,
      SUM(CASE WHEN email_verified = 1 AND COALESCE(banned, 0) = 0
        AND NOT EXISTS (
          SELECT 1 FROM activity_events ae
          WHERE ae.user_id = user.id
            AND ae.created_at >= ${activeCutoffSec}
            AND COALESCE(ae.actor_type, 'user') = 'user'
            AND ae.action NOT IN (
              'download_task_assigned', 'download_task_started', 'download_task_ingesting',
              'download_task_completed', 'download_task_failed', 'download_task_suspended',
              'download_task_queued', 'download_task_error', 'download_task_billing_suspended',
              'download_resolve_started', 'download_resolve_completed', 'download_completed',
              'download_ingest_started', 'download_ingest_completed',
              'download_seeding_started', 'download_seeding_stopped',
              'download_stale_control_resolved', 'download_stale_requeued'
            )
            AND ae.action NOT LIKE 'stats_%'
        )
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
      const cutoffSec = Math.floor((now.getTime() - days * 86_400_000) / 1000)
      const rows = await db.all<{ count: number }>(sql`
        SELECT COUNT(DISTINCT ae.user_id) AS count
        FROM activity_events ae
        JOIN user u ON u.id = ae.user_id
        WHERE ae.user_id IS NOT NULL
          AND ae.created_at >= ${cutoffSec}
          AND COALESCE(ae.actor_type, 'user') = 'user'
          AND ae.action NOT IN (
            'download_task_assigned', 'download_task_started', 'download_task_ingesting',
            'download_task_completed', 'download_task_failed', 'download_task_suspended',
            'download_task_queued', 'download_task_error', 'download_task_billing_suspended',
            'download_resolve_started', 'download_resolve_completed', 'download_completed',
            'download_ingest_started', 'download_ingest_completed',
            'download_seeding_started', 'download_seeding_stopped',
            'download_stale_control_resolved', 'download_stale_requeued'
          )
          AND ae.action NOT LIKE 'stats_%'
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
    .where(
      and(eq(matters.status, 'active'), isNull(matters.trashedAt), isNull(matters.purgedAt), eq(matters.dirtype, 0)),
    )
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
    .where(and(eq(imageHostings.status, 'active'), isNull(imageHostings.purgedAt)))
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
