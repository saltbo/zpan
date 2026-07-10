import { isPersonalOrgLike } from '@shared/org-slugs'
import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm'
import { account, organization, session, user } from '../../db/auth-schema'
import {
  activityEvents,
  backgroundJobs,
  cloudTrafficReports,
  downloaders,
  downloadTasks,
  imageHostings,
  matters,
  orgQuotas,
  remoteDownloadUsageReports,
  shares,
  statsRollupsHourly,
  storages,
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
const DOWNLOAD_ACTIONS = ['share_download', 'object_download', 'image_hosting_download', 'webdav_download']
const COUNTER_METRICS: AdminStatsMetric[] = [
  M.backgroundJobFinished,
  M.licenseRefresh,
  M.remoteDownloadTaskCreated,
  M.remoteDownloadTaskFinished,
  M.remoteDownloadUsage,
  M.shareCreated,
  M.shareDownloadIssued,
  M.sharePasswordPassed,
  M.shareSaved,
  M.shareView,
  M.spaceCreated,
  M.statsMissingBytes,
  M.statsRollupRun,
  M.storageIngress,
  M.storageRemoved,
  M.storageRestored,
  M.teamMembershipChange,
  M.trafficCreditConsumed,
  M.trafficQuotaBlocked,
  M.trafficReportSync,
  M.transferDownloadFailed,
  M.transferDownloadIssued,
  M.transferUpload,
  M.userActiveHour,
  M.userSessionStarted,
  M.userSignup,
  M.webhookProcessed,
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
      quality: row.lowerBound ? 'lower_bound' : 'exact',
      generatedAt: generatedAt.toISOString(),
    }),
    updatedAt,
  }))

  const deleteWhere = includeSnapshots
    ? eq(statsRollupsHourly.bucketStart, bucketStart)
    : and(eq(statsRollupsHourly.bucketStart, bucketStart), inArray(statsRollupsHourly.metricKey, COUNTER_METRICS))
  const writes: AtomicQuery[] = [db.delete(statsRollupsHourly).where(deleteWhere)]
  for (let index = 0; index < rows.length; index += 80) {
    writes.push(db.insert(statsRollupsHourly).values(rows.slice(index, index + 80)))
  }
  await executeWriteTransaction(db, writes)
  return { bucketStart, bucketEnd, rows: rows.length, lowerBoundRows }
}

async function addEventMetrics(db: Database, rollups: RollupAccumulator, from: Date, to: Date): Promise<void> {
  const rows = await db
    .select({
      orgId: activityEvents.orgId,
      userId: activityEvents.userId,
      actorType: activityEvents.actorType,
      action: activityEvents.action,
      targetId: activityEvents.targetId,
      metadata: activityEvents.metadata,
    })
    .from(activityEvents)
    .where(and(gte(activityEvents.createdAt, from), lt(activityEvents.createdAt, to)))

  for (const row of rows) {
    const metadata = parseMetadata(row.metadata)
    const bytes = metadataNumber(metadata, 'bytes')
    const source = metadataString(metadata, 'source')
    const storageId = metadataString(metadata, 'storageId')
    const actorType = row.actorType ?? (row.userId ? 'user' : 'anonymous')
    const lowerBound = needsBytes(row.action) && !hasFiniteNumber(metadata.bytes)

    if (row.action === 'upload_confirm' || row.action === 'upload_cancel' || row.action === 'upload_failed') {
      const status =
        row.action === 'upload_confirm' ? 'success' : row.action === 'upload_cancel' ? 'canceled' : 'failed'
      const reason =
        row.action === 'upload_confirm'
          ? null
          : (metadataString(metadata, 'reason') ??
            (row.action === 'upload_cancel' ? 'upload_canceled' : 'upload_failed'))
      const confirmedBytes = row.action === 'upload_confirm' ? bytes : 0
      rollups.add(
        M.transferUpload,
        row.orgId,
        1,
        confirmedBytes,
        { source: source ?? 'upload', status, reason, storage_id: storageId },
        lowerBound,
      )
      if (row.action === 'upload_confirm') {
        rollups.add(
          M.storageIngress,
          row.orgId,
          1,
          bytes,
          { source: source ?? 'web_upload', status, storage_id: storageId },
          lowerBound,
        )
      }
    }

    if (DOWNLOAD_ACTIONS.includes(row.action)) {
      rollups.add(
        M.transferDownloadIssued,
        row.orgId,
        1,
        bytes,
        {
          source: source ?? fallbackDownloadSource(row.action),
          storage_id: storageId,
          actor_type: actorType,
        },
        lowerBound,
      )
    }

    if (row.action === 'download_failed') {
      const reason = metadataString(metadata, 'reason') ?? 'unknown'
      rollups.add(M.transferDownloadFailed, row.orgId, 1, bytes, { source: source ?? 'unknown', reason })
      if (reason === 'quota_exceeded') rollups.add(M.trafficQuotaBlocked, row.orgId, 1, bytes, { source })
    }

    if (row.action === 'share_view') {
      rollups.add(M.shareView, row.orgId, 1, 0, { share_id: row.targetId, actor_type: actorType })
    }
    if (row.action === 'share_download') {
      rollups.add(M.shareDownloadIssued, row.orgId, 1, bytes, {
        share_id: metadataString(metadata, 'shareId') ?? row.targetId,
        kind: metadataString(metadata, 'kind'),
        source: source ?? fallbackDownloadSource(row.action),
        actor_type: actorType,
      })
    }
    if (row.action === 'save_from_share') {
      rollups.add(M.shareSaved, row.orgId, 1, bytes, {
        share_id: metadataString(metadata, 'shareId') ?? row.targetId,
        actor_type: actorType,
      })
    }
    if (row.action === 'share_password_passed') {
      rollups.add(M.sharePasswordPassed, row.orgId, 1, 0, { share_id: row.targetId })
    }
    if (row.action === 'restore') rollups.add(M.storageRestored, row.orgId, 1, bytes, { source: 'trash' }, lowerBound)
    if (row.action === 'object_purge') {
      rollups.add(M.storageRemoved, row.orgId, 1, bytes, { reason: 'purged' }, lowerBound)
    }
    if (row.action === 'team_member_join') rollups.add(M.teamMembershipChange, row.orgId, 1, 0, { outcome: 'join' })
    if (row.action === 'team_member_remove') rollups.add(M.teamMembershipChange, row.orgId, 1, 0, { outcome: 'remove' })
    if (row.action === 'license_refresh') {
      rollups.add(M.licenseRefresh, '', 1, 0, { outcome: metadataString(metadata, 'status') ?? 'success' })
    }
    if (lowerBound) {
      rollups.add(M.statsMissingBytes, row.orgId, 1, 0, {
        direction: row.action === 'upload_confirm' ? 'upload' : 'download',
        source: source ?? row.action,
      })
    }
  }
}

async function addUserMetrics(db: Database, rollups: RollupAccumulator, from: Date, to: Date): Promise<void> {
  const [signupRows, sessionRows, activeActivityRows, spaceRows, shareRows] = await Promise.all([
    db
      .select({ userId: user.id, provider: account.providerId, accountCreatedAt: account.createdAt })
      .from(user)
      .leftJoin(account, eq(account.userId, user.id))
      .where(and(gte(user.createdAt, from), lt(user.createdAt, to))),
    db
      .select({ userId: session.userId })
      .from(session)
      .where(and(gte(session.createdAt, from), lt(session.createdAt, to))),
    db
      .select({ userId: activityEvents.userId })
      .from(activityEvents)
      .innerJoin(user, eq(activityEvents.userId, user.id))
      .where(and(gte(activityEvents.createdAt, from), lt(activityEvents.createdAt, to))),
    db
      .select({ slug: organization.slug, metadata: organization.metadata })
      .from(organization)
      .where(and(gte(organization.createdAt, from), lt(organization.createdAt, to))),
    db
      .select({ orgId: shares.orgId, kind: shares.kind })
      .from(shares)
      .where(and(gte(shares.createdAt, from), lt(shares.createdAt, to))),
  ])

  const providers = new Map<string, { provider: string; at: Date }>()
  for (const row of signupRows) {
    if (!row.provider || !row.accountCreatedAt) continue
    const current = providers.get(row.userId)
    if (!current || row.accountCreatedAt < current.at)
      providers.set(row.userId, { provider: row.provider, at: row.accountCreatedAt })
  }
  for (const userId of new Set(signupRows.map((row) => row.userId))) {
    rollups.add(M.userSignup, '', 1, 0, { provider: providers.get(userId)?.provider ?? 'direct' })
  }
  rollups.add(M.userSessionStarted, '', sessionRows.length)
  rollups.addDistinct(
    M.userActiveHour,
    '',
    [...sessionRows, ...activeActivityRows].map((row) => row.userId).filter(Boolean) as string[],
  )
  for (const row of spaceRows) {
    const orgType = isPersonalOrgLike({ slug: row.slug, metadata: row.metadata }) ? 'personal' : 'team'
    rollups.add(M.spaceCreated, '', 1, 0, { org_type: orgType })
  }
  for (const row of shareRows) rollups.add(M.shareCreated, row.orgId, 1, 0, { kind: row.kind })
}

async function addOperationalMetrics(db: Database, rollups: RollupAccumulator, from: Date, to: Date): Promise<void> {
  const [trafficRows, taskCreatedRows, taskFinishedRows, jobRows, usageRows, webhookRows] = await Promise.all([
    db
      .select({
        orgId: cloudTrafficReports.orgId,
        source: cloudTrafficReports.source,
        status: cloudTrafficReports.status,
        bytes: cloudTrafficReports.bytes,
        storageId: cloudTrafficReports.storageId,
        unitBytes: cloudTrafficReports.unitBytes,
        creditsPerUnit: cloudTrafficReports.creditsPerUnit,
      })
      .from(cloudTrafficReports)
      .where(and(gte(cloudTrafficReports.updatedAt, from), lt(cloudTrafficReports.updatedAt, to))),
    db
      .select({ orgId: downloadTasks.orgId, category: downloadTasks.category, sourceType: downloadTasks.sourceType })
      .from(downloadTasks)
      .where(and(gte(downloadTasks.createdAt, from), lt(downloadTasks.createdAt, to))),
    db
      .select({
        orgId: downloadTasks.orgId,
        category: downloadTasks.category,
        downloaderId: downloadTasks.assignedDownloaderId,
        status: downloadTasks.status,
        bytes: downloadTasks.billingChargedBytes,
      })
      .from(downloadTasks)
      .where(and(gte(downloadTasks.finishedAt, from), lt(downloadTasks.finishedAt, to))),
    db
      .select({ orgId: backgroundJobs.orgId, type: backgroundJobs.type, status: backgroundJobs.status })
      .from(backgroundJobs)
      .where(and(gte(backgroundJobs.finishedAt, from), lt(backgroundJobs.finishedAt, to))),
    db
      .select({
        orgId: remoteDownloadUsageReports.orgId,
        downloaderId: remoteDownloadUsageReports.downloaderId,
        status: remoteDownloadUsageReports.status,
        bytes: remoteDownloadUsageReports.unitBytes,
        credits: remoteDownloadUsageReports.creditsPerUnit,
      })
      .from(remoteDownloadUsageReports)
      .where(and(gte(remoteDownloadUsageReports.createdAt, from), lt(remoteDownloadUsageReports.createdAt, to))),
    db
      .select({ status: webhookEvents.status })
      .from(webhookEvents)
      .where(and(gte(webhookEvents.processedAt, from), lt(webhookEvents.processedAt, to))),
  ])

  for (const row of trafficRows) {
    rollups.add(M.trafficReportSync, row.orgId, 1, row.bytes, { source: row.source, status: row.status })
    if (row.status !== 'blocked' && row.unitBytes && row.creditsPerUnit) {
      rollups.add(
        M.trafficCreditConsumed,
        row.orgId,
        Math.ceil(row.bytes / row.unitBytes) * row.creditsPerUnit,
        row.bytes,
        { source: row.source, storage_id: row.storageId },
      )
    }
  }
  for (const row of taskCreatedRows) {
    rollups.add(M.remoteDownloadTaskCreated, row.orgId, 1, 0, {
      category: row.category ?? 'uncategorized',
      source: row.sourceType,
    })
  }
  for (const row of taskFinishedRows) {
    rollups.add(M.remoteDownloadTaskFinished, row.orgId, 1, row.bytes, {
      category: row.category ?? 'uncategorized',
      downloader_id: row.downloaderId,
      outcome: row.status,
    })
  }
  for (const row of jobRows) {
    rollups.add(M.backgroundJobFinished, row.orgId, 1, 0, { job_type: row.type, outcome: row.status })
  }
  for (const row of usageRows) {
    rollups.add(M.remoteDownloadUsage, row.orgId, row.credits, row.bytes, {
      downloader_id: row.downloaderId,
      status: row.status,
    })
  }
  for (const row of webhookRows) rollups.add(M.webhookProcessed, '', 1, 0, { outcome: row.status })
}

async function addSnapshotMetrics(db: Database, rollups: RollupAccumulator, now: Date): Promise<void> {
  const [
    quotaRows,
    storageRows,
    inventoryRows,
    inventoryByType,
    inventoryBySize,
    inventoryByAge,
    shareRows,
    jobRows,
    taskRows,
    downloaderRows,
  ] = await Promise.all([
    queryStage(
      'quota',
      db
        .select({
          orgId: orgQuotas.orgId,
          used: orgQuotas.used,
          quota: orgQuotas.quota,
          trafficUsed: orgQuotas.trafficUsed,
          trafficQuota: orgQuotas.trafficQuota,
        })
        .from(orgQuotas),
    ),
    queryStage(
      'storage',
      db.select({ id: storages.id, used: storages.used }).from(storages).where(eq(storages.status, 'active')),
    ),
    queryStage('inventory-base', inventoryGroups(db, now, 'base')),
    queryStage('inventory-type', inventoryGroups(db, now, 'file_type_group')),
    queryStage('inventory-size', inventoryGroups(db, now, 'size_bucket')),
    queryStage('inventory-age', inventoryGroups(db, now, 'age_bucket')),
    queryStage(
      'shares',
      db
        .select({
          orgId: shares.orgId,
          kind: shares.kind,
          status: shares.status,
          expiresAt: shares.expiresAt,
          downloadLimit: shares.downloadLimit,
          downloads: shares.downloads,
        })
        .from(shares),
    ),
    queryStage(
      'jobs',
      db
        .select({ orgId: backgroundJobs.orgId, type: backgroundJobs.type, status: backgroundJobs.status })
        .from(backgroundJobs)
        .where(inArray(backgroundJobs.status, ['queued', 'running'])),
    ),
    queryStage(
      'tasks',
      db
        .select({
          orgId: downloadTasks.orgId,
          downloaderId: downloadTasks.assignedDownloaderId,
          status: downloadTasks.status,
        })
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
        ),
    ),
    queryStage('downloaders', db.select({ id: downloaders.id, status: downloaders.status }).from(downloaders)),
  ])

  for (const row of quotaRows) {
    rollups.setGauge(M.storageUsed, row.orgId, 0, row.used)
    rollups.setGauge(M.storageQuota, row.orgId, 0, row.quota)
    rollups.setGauge(M.trafficQuotaUsed, row.orgId, 0, row.trafficUsed)
    rollups.setGauge(M.trafficQuota, row.orgId, 0, row.trafficQuota)
  }
  for (const row of storageRows) rollups.setGauge(M.storageUsed, '', 0, row.used, 'storage_id', row.id)
  for (const row of [...inventoryRows, ...inventoryByType, ...inventoryBySize, ...inventoryByAge]) {
    rollups.incrementGauge(M.storageInventory, row.orgId, row.files, row.bytes, row.dimensionKey, row.dimensionValue)
  }
  for (const row of shareRows) {
    const lifecycle = shareLifecycle(row, now)
    rollups.incrementGauge(M.shareInventory, row.orgId, 1, 0)
    rollups.incrementGauge(M.shareInventory, row.orgId, 1, 0, 'kind', row.kind)
    rollups.incrementGauge(M.shareInventory, row.orgId, 1, 0, 'lifecycle', lifecycle)
  }
  for (const row of jobRows) {
    rollups.incrementGauge(M.backgroundJobSnapshot, row.orgId, 1, 0)
    rollups.incrementGauge(M.backgroundJobSnapshot, row.orgId, 1, 0, 'job_type', row.type)
    rollups.incrementGauge(M.backgroundJobSnapshot, row.orgId, 1, 0, 'status', row.status)
  }
  for (const row of taskRows) {
    rollups.incrementGauge(M.remoteDownloadTaskSnapshot, row.orgId, 1, 0)
    if (row.downloaderId)
      rollups.incrementGauge(M.remoteDownloadTaskSnapshot, row.orgId, 1, 0, 'downloader_id', row.downloaderId)
    rollups.incrementGauge(M.remoteDownloadTaskSnapshot, row.orgId, 1, 0, 'status', row.status)
  }
  for (const row of downloaderRows) {
    rollups.incrementGauge(M.downloaderSnapshot, '', 1, 0)
    rollups.incrementGauge(M.downloaderSnapshot, '', 1, 0, 'downloader_id', row.id)
    rollups.incrementGauge(M.downloaderSnapshot, '', 1, 0, 'status', row.status)
  }
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

  addDistinct(metric: AdminStatsMetric, orgId: string, values: string[]): void {
    this.increment(metric, orgId, '', '', 0, 0, new Set(values).size, false)
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

function parseMetadata(value: string | null): Record<string, unknown> {
  if (!value) return {}
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function metadataString(metadata: Record<string, unknown>, keyValue: string): string | null {
  const value = metadata[keyValue]
  return typeof value === 'string' && value.length > 0 ? value : null
}

function metadataNumber(metadata: Record<string, unknown>, keyValue: string): number {
  const value = metadata[keyValue]
  return hasFiniteNumber(value) ? value : 0
}

function hasFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function needsBytes(action: string): boolean {
  return action === 'upload_confirm' || DOWNLOAD_ACTIONS.includes(action)
}

function fallbackDownloadSource(action: string): string {
  if (action === 'object_download') return 'object_download'
  if (action === 'image_hosting_download') return 'image_hosting'
  if (action === 'webdav_download') return 'webdav_download'
  return 'landing_share'
}

function shareLifecycle(
  share: { status: string; expiresAt: Date | null; downloadLimit: number | null; downloads: number },
  now: Date,
): string {
  if (share.status !== 'active') return 'revoked'
  if (share.expiresAt && share.expiresAt <= now) return 'expired'
  if (share.downloadLimit !== null && share.downloads >= share.downloadLimit) return 'download_limit_reached'
  return 'usable'
}

async function queryStage<T>(name: string, query: PromiseLike<T>): Promise<T> {
  try {
    return await query
  } catch (error) {
    throw new Error(`stats_rollup_query_failed:${name}`, { cause: error })
  }
}
