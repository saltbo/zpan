import { isPersonalOrgLike } from '@shared/org-slugs'
import type {
  AdminDashboardGrowthStats,
  AdminDashboardOperationsStats,
  AdminDashboardOverviewStats,
  AdminDashboardSharingStats,
  AdminDashboardStorageStats,
  AdminDashboardTrafficStats,
  AdminStatsDelta,
  AdminTopShare,
  AdminTransferDataQuality,
} from '@shared/types'
import { and, eq, gte, inArray, lte } from 'drizzle-orm'
import { organization, user } from '../../db/auth-schema'
import { matters, shares, statsRollupsHourly } from '../../db/schema'
import {
  ADMIN_STATS_METRICS,
  type AdminStatsDimension,
  type AdminStatsMetric,
  parseAdminStatsRollupMetadata,
} from '../../domain/admin-stats-metrics'
import { addCalendarDays, statsDayKey as dayKey, utcDateStart } from '../../domain/admin-stats-time'
import type { Database } from '../../platform/interface'
import type { AdminStatsDateRange, AdminStatsRepo } from '../../usecases/ports'
import { AdminStatsHourlyReader } from './admin-stats-hourly'
import { rebuildAdminStatsHour } from './admin-stats-rollup'

const DOWNLOAD_ACTIVITY_ACTIONS = ['share_download', 'object_download', 'image_hosting_download', 'webdav_download']
const DOWNLOAD_FAILURE_ACTION = 'download_failed'
export function createAdminStatsRepo(db: Database): AdminStatsRepo {
  return {
    refreshHourlyRollups: (now) => refreshHourlyRollups(db, now),
    getDashboardOverviewStats: (now, range) => getDashboardOverviewStats(db, now, range),
    getDashboardOperationsStats: (now, range) => getDashboardOperationsStats(db, now, range),
    getDashboardGrowthStats: (now, range) => getDashboardGrowthStats(db, now, range),
    getDashboardStorageStats: (now, range) => getDashboardStorageStats(db, now, range),
    getDashboardTrafficStats: (now, range) => getDashboardTrafficStats(db, now, range),
    getDashboardSharingStats: (now, range) => getDashboardSharingStats(db, now, range),
  }
}

async function refreshHourlyRollups(db: Database, now: Date) {
  const latestClosedHour = new Date(startOfHour(now).getTime() - 3_600_000)
  const repairFrom = new Date(latestClosedHour.getTime() - 47 * 3_600_000)
  const markers = await db
    .select({ bucketStart: statsRollupsHourly.bucketStart, metadata: statsRollupsHourly.metadata })
    .from(statsRollupsHourly)
    .where(
      and(
        eq(statsRollupsHourly.metricKey, ADMIN_STATS_METRICS.statsRollupRun),
        eq(statsRollupsHourly.orgId, ''),
        eq(statsRollupsHourly.dimensionKey, ''),
        gte(statsRollupsHourly.bucketStart, repairFrom),
        lte(statsRollupsHourly.bucketStart, latestClosedHour),
      ),
    )
  const completed = new Set(
    markers
      .filter((row) => parseAdminStatsRollupMetadata(row.metadata) !== null)
      .map((row) => row.bucketStart.getTime()),
  )
  const repairTargets: Date[] = []
  for (let at = repairFrom.getTime(); at < latestClosedHour.getTime(); at += 3_600_000) {
    if (!completed.has(at)) repairTargets.push(new Date(at))
    if (repairTargets.length === 3) break
  }
  const latest = await rebuildAdminStatsHour(db, latestClosedHour, now, true)
  const repaired = []
  for (const bucketStart of repairTargets) repaired.push(await rebuildAdminStatsHour(db, bucketStart, now, false))
  return [latest, ...repaired]
}

async function getDashboardOverviewStats(
  db: Database,
  now: Date,
  range: AdminStatsDateRange,
): Promise<AdminDashboardOverviewStats> {
  const previous = previousRange(range)
  const reader = new AdminStatsHourlyReader(db, range, now)
  const previousReader = new AdminStatsHourlyReader(db, previous, now)
  const [
    users,
    newUsers,
    previousNewUsers,
    activeUsers,
    previousActiveUsers,
    quotas,
    traffic,
    previousTraffic,
    sharing,
    previousSharing,
    dataQuality,
    coverage,
    comparisonCoverage,
  ] = await Promise.all([
    getUserInventory(reader),
    getSignupTotal(reader),
    getSignupTotal(previousReader),
    getActiveUserSnapshot(reader),
    getActiveUserSnapshot(previousReader),
    getQuotaTotals(reader),
    getTrafficTotals(reader),
    getTrafficTotals(previousReader),
    getSharingEventTotals(reader),
    getSharingComparisonTotals(previousReader),
    getTransferDataQuality(reader, previousReader),
    reader.coverage(),
    previousReader.coverage(),
  ])
  const [trendNewUsers, activeByDay, storageUsedByDay, uploadByDay, downloadByDay] = await Promise.all([
    getSignupsByDay(reader),
    getActiveUsersByDay(reader),
    getStorageUsedByDay(reader),
    getActivityMetricByDay(reader, metricSpec(['upload_confirm']), 'bytes'),
    getActivityMetricByDay(reader, metricSpec(DOWNLOAD_ACTIVITY_ACTIONS), 'bytes'),
  ])
  const trends = createDateBuckets(range).map((date) => {
    return {
      date,
      newUsers: trendNewUsers.get(date) ?? 0,
      activeUsers: activeByDay.get(date) ?? 0,
      storageUsedBytes: storageUsedByDay.get(date) ?? null,
      uploadBytes: uploadByDay.get(date) ?? 0,
      downloadBytes: downloadByDay.get(date) ?? 0,
    }
  })

  return {
    ...statsFrame(now, range, coverage, comparisonCoverage),
    dataQuality,
    totals: {
      users: users.total,
      newUsers: delta(newUsers, previousNewUsers),
      activeUsers: delta(activeUsers.mau, previousActiveUsers.mau),
      activeUserRate: nullablePercent(activeUsers.mau, users.total),
      storageUsedBytes: quotas.usedBytes,
      storageQuotaBytes: quotas.quotaBytes,
      storageUtilization: nullablePercent(quotas.usedBytes, quotas.quotaBytes),
      trafficBytes: delta(
        traffic.uploadBytes + traffic.downloadBytes,
        previousTraffic.uploadBytes + previousTraffic.downloadBytes,
      ),
      uploadBytes: delta(traffic.uploadBytes, previousTraffic.uploadBytes),
      downloadBytes: delta(traffic.downloadBytes, previousTraffic.downloadBytes),
      activeShares: sharing.activeShares,
      shareViews: delta(sharing.views, previousSharing.views),
      shareDownloads: delta(sharing.downloads, previousSharing.downloads),
    },
    trends,
  }
}

async function getDashboardOperationsStats(
  db: Database,
  now: Date,
  range: AdminStatsDateRange,
): Promise<AdminDashboardOperationsStats> {
  const reader = new AdminStatsHourlyReader(db, range, now)
  const [
    activeBackgroundJobs,
    activeRemoteDownloads,
    downloaderStatus,
    cloudReportBacklog,
    webhookFailures,
    backgroundJobOutcomes,
    remoteDownloadOutcomes,
    cloudReportStatus,
    backgroundJobsByDay,
    remoteDownloadsByDay,
    coverage,
  ] = await Promise.all([
    getLatestGaugeTotal(reader, ADMIN_STATS_METRICS.backgroundJobSnapshot),
    getLatestGaugeTotal(reader, ADMIN_STATS_METRICS.remoteDownloadTaskSnapshot),
    getLatestGaugeDimensions(reader, ADMIN_STATS_METRICS.downloaderSnapshot, 'status'),
    getLatestGaugeDimensionSum(reader, ADMIN_STATS_METRICS.trafficReportSnapshot, 'status', ['pending', 'failed']),
    getLatestGaugeDimensionSum(reader, ADMIN_STATS_METRICS.webhookSnapshot, 'status', ['failed']),
    getOperationalOutcomes(reader, 'background_job'),
    getOperationalOutcomes(reader, 'remote_download'),
    getCloudReportOutcomes(reader),
    getOperationalOutcomesByDay(reader, 'background_job'),
    getOperationalOutcomesByDay(reader, 'remote_download'),
    reader.coverage(),
  ])
  const completedJobs = backgroundJobOutcomes.get('completed') ?? 0
  const failedJobs = backgroundJobOutcomes.get('failed') ?? 0
  const completedRemoteDownloads = remoteDownloadOutcomes.get('completed') ?? 0
  const failedRemoteDownloads = remoteDownloadOutcomes.get('failed') ?? 0

  return {
    ...statsFrame(now, range, coverage),
    summary: {
      activeBackgroundJobs,
      activeRemoteDownloads,
      onlineDownloaders: downloaderStatus.get('online') ?? 0,
      offlineDownloaders: (downloaderStatus.get('offline') ?? 0) + (downloaderStatus.get('disabled') ?? 0),
      backgroundJobFailureRate: nullablePercent(failedJobs, completedJobs + failedJobs),
      remoteDownloadSuccessRate: nullablePercent(
        completedRemoteDownloads,
        completedRemoteDownloads + failedRemoteDownloads,
      ),
      cloudReportBacklog,
      webhookFailures,
      alertCount: cloudReportBacklog + webhookFailures,
    },
    trend: createDateBuckets(range).map((date) => ({
      date,
      completedJobs: backgroundJobsByDay.get(date)?.get('completed') ?? 0,
      failedJobs: backgroundJobsByDay.get(date)?.get('failed') ?? 0,
      completedRemoteDownloads: remoteDownloadsByDay.get(date)?.get('completed') ?? 0,
      failedRemoteDownloads: remoteDownloadsByDay.get(date)?.get('failed') ?? 0,
    })),
    backgroundJobOutcomes: percentRows([...backgroundJobOutcomes].map(([name, value]) => ({ name, value }))),
    remoteDownloadOutcomes: percentRows([...remoteDownloadOutcomes].map(([name, value]) => ({ name, value }))),
    downloaderStatus: percentRows([...downloaderStatus].map(([name, value]) => ({ name, value }))),
    cloudReportStatus: percentRows([...cloudReportStatus].map(([name, value]) => ({ name, value }))),
  }
}

async function getDashboardGrowthStats(
  db: Database,
  now: Date,
  range: AdminStatsDateRange,
): Promise<AdminDashboardGrowthStats> {
  const previous = previousRange(range)
  const reader = new AdminStatsHourlyReader(db, range, now)
  const previousReader = new AdminStatsHourlyReader(db, previous, now)
  const [
    users,
    newUsers,
    previousNewUsers,
    activeUsers,
    previousActiveUsers,
    activeByDay,
    registrationSources,
    totalsByDay,
    coverage,
    comparisonCoverage,
  ] = await Promise.all([
    getUserInventory(reader),
    getSignupTotal(reader),
    getSignupTotal(previousReader),
    getActiveUserSnapshot(reader),
    getActiveUserSnapshot(previousReader),
    getRollingActiveUserTrend(reader, range),
    getRegistrationSources(reader),
    getUserTotalsByDay(reader),
    reader.coverage(),
    previousReader.coverage(),
  ])
  const newUsersByDay = await getSignupsByDay(reader)
  const userScaleTrend = createDateBuckets(range).map((date) => ({
    date,
    newUsers: newUsersByDay.get(date) ?? 0,
    totalUsers: totalsByDay.get(date) ?? 0,
  }))

  return {
    ...statsFrame(now, range, coverage, comparisonCoverage),
    summary: {
      totalUsers: users.total,
      newUsers: delta(newUsers, previousNewUsers),
      activeUsers: delta(activeUsers.mau, previousActiveUsers.mau),
      verifiedUsers: users.verified,
      bannedUsers: users.banned,
      silentUsers: users.silent,
      activeUserRate: nullablePercent(activeUsers.mau, users.total),
      silentUserRate: nullablePercent(users.silent, users.total),
    },
    userScaleTrend,
    activeUserTrend: activeByDay,
    userStatus: percentRows([
      { name: 'normal', value: users.normal },
      { name: 'unverified', value: users.unverified },
      { name: 'banned', value: users.banned },
      { name: 'silent', value: users.silent },
    ]),
    registrationSources,
  }
}

async function getDashboardStorageStats(
  db: Database,
  now: Date,
  range: AdminStatsDateRange,
): Promise<AdminDashboardStorageStats> {
  const previous = previousRange(range)
  const reader = new AdminStatsHourlyReader(db, range, now)
  const previousReader = new AdminStatsHourlyReader(db, previous, now)
  const [
    quotas,
    inventory,
    storageUsedByDay,
    typeBreakdown,
    newFiles,
    previousNewFiles,
    uploadBytes,
    previousUploadBytes,
    uploadsByDay,
    uploadFilesByDay,
    dataQuality,
    spaceUsage,
    quotaPressure,
    sizeBreakdown,
    ageBreakdown,
    coverage,
    comparisonCoverage,
  ] = await Promise.all([
    getQuotaTotals(reader),
    getStorageInventory(reader),
    getStorageUsedByDay(reader),
    getLatestInventoryBreakdown(reader, 'file_type_group'),
    getActivityMetricTotal(reader, metricSpec(['upload_confirm']), 'count'),
    getActivityMetricTotal(previousReader, metricSpec(['upload_confirm']), 'count'),
    getActivityMetricTotal(reader, metricSpec(['upload_confirm']), 'bytes'),
    getActivityMetricTotal(previousReader, metricSpec(['upload_confirm']), 'bytes'),
    getActivityMetricByDay(reader, metricSpec(['upload_confirm']), 'bytes'),
    getActivityMetricByDay(reader, metricSpec(['upload_confirm']), 'count'),
    getTransferDataQuality(reader, previousReader),
    getUsageBySpaceRows(db, reader),
    getLatestGaugeDimensions(reader, ADMIN_STATS_METRICS.storageQuota, 'status'),
    getLatestInventoryBreakdown(reader, 'size_bucket'),
    getLatestInventoryBreakdown(reader, 'age_bucket'),
    reader.coverage(),
    previousReader.coverage('counters'),
  ])
  const storageTrend = createDateBuckets(range).map((date) => {
    return {
      date,
      usedBytes: storageUsedByDay.get(date) ?? null,
      newBytes: uploadsByDay.get(date) ?? 0,
      newFiles: uploadFilesByDay.get(date) ?? 0,
    }
  })
  const coldFileBytes = ['90-180d', '>180d'].reduce(
    (total, bucket) => total + (ageBreakdown.find((row) => row.name === bucket)?.bytes ?? 0),
    0,
  )

  return {
    ...statsFrame(now, range, coverage, comparisonCoverage),
    dataQuality,
    summary: {
      storageUsedBytes: quotas.usedBytes,
      quotaBytes: quotas.quotaBytes,
      fileCount: inventory.files,
      newFiles: delta(newFiles, previousNewFiles),
      newBytes: delta(uploadBytes, previousUploadBytes),
      coldFileBytes,
      storageUtilization: nullablePercent(quotas.usedBytes, quotas.quotaBytes),
      coldFilePercent: nullablePercent(coldFileBytes, quotas.usedBytes),
      nearQuotaSpaces: quotaPressure.get('near') ?? 0,
      overQuotaSpaces: quotaPressure.get('over') ?? 0,
    },
    storageTrend,
    typeBreakdown: typeBreakdown.map(({ name, ...row }) => ({
      type: name,
      ...row,
    })),
    sizeBreakdown,
    ageBreakdown,
    topSpaces: spaceUsage.slice(0, 8),
  }
}

async function getDashboardTrafficStats(
  db: Database,
  now: Date,
  range: AdminStatsDateRange,
): Promise<AdminDashboardTrafficStats> {
  const previous = previousRange(range)
  const reader = new AdminStatsHourlyReader(db, range, now)
  const previousReader = new AdminStatsHourlyReader(db, previous, now)
  const [
    traffic,
    previousTraffic,
    uploadByDay,
    downloadByDay,
    uploadRequestsByDay,
    downloadRequestsByDay,
    downloadSourceBytes,
    downloadSourceRequests,
    uploadSuccessByDay,
    uploadFailureByDay,
    downloadSuccessByDay,
    downloadFailuresByDay,
    downloadFailureReasons,
    uploadFailureReasons,
    dataQuality,
    coverage,
    comparisonCoverage,
  ] = await Promise.all([
    getTrafficTotals(reader),
    getTrafficTotals(previousReader),
    getActivityMetricByDay(reader, metricSpec(['upload_confirm']), 'bytes'),
    getActivityMetricByDay(reader, metricSpec(DOWNLOAD_ACTIVITY_ACTIONS), 'bytes'),
    getActivityMetricByDay(reader, metricSpec(['upload_confirm', 'upload_cancel', 'upload_failed']), 'count'),
    getDownloadRequestsByDay(reader),
    getActivityMetricDimensionTotals(reader, metricSpec(DOWNLOAD_ACTIVITY_ACTIONS), 'source', 'bytes'),
    getActivityMetricDimensionTotals(reader, metricSpec(DOWNLOAD_ACTIVITY_ACTIONS), 'source', 'count'),
    getActivityMetricByDay(reader, metricSpec(['upload_confirm']), 'count'),
    getActivityMetricByDay(reader, metricSpec(['upload_cancel', 'upload_failed']), 'count'),
    getActivityMetricByDay(reader, metricSpec(DOWNLOAD_ACTIVITY_ACTIONS), 'count'),
    getActivityMetricByDay(reader, metricSpec([DOWNLOAD_FAILURE_ACTION]), 'count'),
    getActivityMetricDimensionTotals(reader, metricSpec([DOWNLOAD_FAILURE_ACTION]), 'reason', 'count'),
    getActivityMetricDimensionTotals(reader, metricSpec(['upload_cancel', 'upload_failed']), 'reason', 'count'),
    getTransferDataQuality(reader, previousReader),
    reader.coverage('counters'),
    previousReader.coverage('counters'),
  ])
  const sourceRows = new Map<string, { name: string; bytes: number; requests: number }>()
  if (traffic.uploadBytes > 0 || traffic.uploadRequests > 0) {
    sourceRows.set('upload', { name: 'upload', bytes: traffic.uploadBytes, requests: traffic.uploadRequests })
  }
  for (const [source, bytes] of downloadSourceBytes) {
    sourceRows.set(source, { name: source, bytes, requests: downloadSourceRequests.get(source) ?? 0 })
  }
  const statusRows = new Map<string, number>([
    [
      'issued',
      Math.max(
        0,
        traffic.downloadRequests - [...downloadFailureReasons.values()].reduce((sum, value) => sum + value, 0),
      ),
    ],
    ['failed', [...downloadFailureReasons.values()].reduce((sum, value) => sum + value, 0)],
  ])
  const failureReasonRows = new Map<string, { name: string; value: number }>()
  for (const [reason, value] of [...uploadFailureReasons, ...downloadFailureReasons]) {
    const item = failureReasonRows.get(reason) ?? { name: reason, value: 0 }
    item.value += value
    failureReasonRows.set(reason, item)
  }
  const trafficTrend = createDateBuckets(range).map((date) => ({
    date,
    uploadBytes: uploadByDay.get(date) ?? 0,
    downloadBytes: downloadByDay.get(date) ?? 0,
    requests: (uploadRequestsByDay.get(date) ?? 0) + (downloadRequestsByDay.get(date) ?? 0),
  }))
  const successTrend = createDateBuckets(range).map((date) => {
    const uploadSuccesses = uploadSuccessByDay.get(date) ?? 0
    const uploadFailures = uploadFailureByDay.get(date) ?? 0
    const uploadRequests = uploadSuccesses + uploadFailures
    const downloadSuccesses = downloadSuccessByDay.get(date) ?? 0
    const downloadFailures = downloadFailuresByDay.get(date) ?? 0
    const downloadRequests = downloadSuccesses + downloadFailures
    return {
      date,
      uploadSuccessRate: uploadRequests > 0 ? percent(uploadSuccesses, uploadRequests) : null,
      downloadSuccessRate: downloadRequests > 0 ? percent(downloadSuccesses, downloadRequests) : null,
    }
  })
  const totalRequests = traffic.uploadRequests + traffic.downloadRequests
  const blockedDownloads = [...downloadFailureReasons.values()].reduce((sum, value) => sum + value, 0)
  const issuedDownloads = Math.max(0, traffic.downloadRequests - blockedDownloads)

  return {
    ...statsFrame(now, range, coverage, comparisonCoverage),
    dataQuality,
    summary: {
      totalBytes: delta(
        traffic.uploadBytes + traffic.downloadBytes,
        previousTraffic.uploadBytes + previousTraffic.downloadBytes,
      ),
      requestCount: delta(totalRequests, previousTraffic.uploadRequests + previousTraffic.downloadRequests),
      issuedDownloads,
      blockedDownloads,
      downloadIssueSuccessRate: nullablePercent(issuedDownloads, issuedDownloads + blockedDownloads),
      peakDailyBytes: Math.max(0, ...trafficTrend.map((row) => row.uploadBytes + row.downloadBytes)),
    },
    trafficTrend,
    sourceBreakdown: percentRows([...sourceRows.values()], (row) => row.bytes),
    issueStatus: percentRows(
      [...statusRows.entries()].map(([status, countValue]) => ({ status, name: status, value: countValue })),
    ).map(({ name, value, percent: pct }) => ({ status: name, count: value, percent: pct })),
    successTrend,
    failureReasons: percentRows([...failureReasonRows.values()]),
  }
}

async function getDashboardSharingStats(
  db: Database,
  now: Date,
  range: AdminStatsDateRange,
): Promise<AdminDashboardSharingStats> {
  const previous = previousRange(range)
  const reader = new AdminStatsHourlyReader(db, range, now)
  const previousReader = new AdminStatsHourlyReader(db, previous, now)
  const [
    sharing,
    previousSharing,
    createdInRange,
    createdPrevious,
    typeCounts,
    saveCount,
    previousSaveCount,
    downloadSources,
    coverage,
    comparisonCoverage,
  ] = await Promise.all([
    getSharingEventTotals(reader),
    getSharingComparisonTotals(previousReader),
    getShareCreatedTotal(reader),
    getShareCreatedTotal(previousReader),
    getShareCreatedKinds(reader),
    getActivityMetricTotal(reader, metricSpec(['save_from_share']), 'count'),
    getActivityMetricTotal(previousReader, metricSpec(['save_from_share']), 'count'),
    getActivityMetricDimensionTotals(reader, metricSpec(['share_download']), 'source', 'count'),
    reader.coverage(),
    previousReader.coverage('counters'),
  ])
  const landingDownloads = downloadSources.get('landing_share') ?? 0
  const directDownloads = downloadSources.get('direct_share') ?? 0
  const [viewsByDay, downloadsByDay, savesByDay] = await Promise.all([
    getActivityMetricByDay(reader, metricSpec(['share_view']), 'count'),
    getActivityMetricByDay(reader, metricSpec(['share_download']), 'count'),
    getActivityMetricByDay(reader, metricSpec(['save_from_share']), 'count'),
  ])
  const trend = createDateBuckets(range).map((date) => ({
    date,
    views: viewsByDay.get(date) ?? 0,
    downloads: downloadsByDay.get(date) ?? 0,
    saves: savesByDay.get(date) ?? 0,
  }))
  const topShares = await getTopSharesWithPercent(db, reader, {
    totalViews: sharing.views,
    totalDownloads: sharing.downloads,
  })

  return {
    ...statsFrame(now, range, coverage, comparisonCoverage),
    summary: {
      activeShares: sharing.activeShares,
      createdShares: delta(createdInRange, createdPrevious),
      views: delta(sharing.views, previousSharing.views),
      downloads: delta(sharing.downloads, previousSharing.downloads),
      saves: delta(saveCount, previousSaveCount),
      downloadsPer100Views: nullablePercent(landingDownloads, sharing.views),
      savesPer100Views: nullablePercent(saveCount, sharing.views),
      passwordPasses: sharing.passwordPasses,
    },
    trend,
    typeBreakdown: percentRows([...typeCounts.entries()].map(([name, value]) => ({ name, value }))),
    sourceBreakdown: percentRows([
      { name: 'landing_share', value: landingDownloads },
      { name: 'direct_share', value: directDownloads },
      { name: 'save_to_drive', value: saveCount },
    ]),
    topShares,
  }
}

async function getShareCreatedTotal(reader: AdminStatsHourlyReader): Promise<number> {
  const rows = await reader.rows(ADMIN_STATS_METRICS.shareCreated)
  return rows.filter((row) => row.dimensionKey === '').reduce((sum, row) => sum + row.count, 0)
}

async function getShareCreatedKinds(reader: AdminStatsHourlyReader): Promise<Map<string, number>> {
  const rows = await reader.rows(ADMIN_STATS_METRICS.shareCreated, ['kind'])
  const result = new Map<string, number>()
  for (const row of rows) {
    if (row.dimensionKey === 'kind') incrementMap(result, row.dimensionValue, row.count)
  }
  return result
}

function statsFrame(
  now: Date,
  range: AdminStatsDateRange,
  coverage: Awaited<ReturnType<AdminStatsHourlyReader['coverage']>>,
  comparisonCoverage?: Awaited<ReturnType<AdminStatsHourlyReader['coverage']>>,
) {
  return {
    generatedAt: now.toISOString(),
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    timeZone: 'UTC' as const,
    coverage,
    comparisonCoverage,
  }
}

function previousRange(range: AdminStatsDateRange): AdminStatsDateRange {
  const firstDate = dayKey(range.from)
  const lastDate = dayKey(range.to)
  const localStart = utcDateStart(firstDate)
  const localEnd = new Date(utcDateStart(addCalendarDays(lastDate, 1)).getTime() - 1)
  if (localStart.getTime() === range.from.getTime() && localEnd.getTime() === range.to.getTime()) {
    const days = Math.floor((dateOrdinal(lastDate) - dateOrdinal(firstDate)) / 86_400_000) + 1
    const previousStartDate = addCalendarDays(firstDate, -days)
    return {
      from: utcDateStart(previousStartDate),
      to: new Date(utcDateStart(firstDate).getTime() - 1),
      timeZone: range.timeZone,
    }
  }
  const durationMs = Math.max(0, range.to.getTime() - range.from.getTime())
  const to = new Date(range.from.getTime() - 1)
  return { from: new Date(to.getTime() - durationMs), to, timeZone: range.timeZone }
}

function delta(value: number, previousValue: number): AdminStatsDelta {
  return {
    value,
    previousValue,
    change: value - previousValue,
    changePercent: nullablePercent(value - previousValue, previousValue),
  }
}

function createDateBuckets(range: AdminStatsDateRange): string[] {
  const dates = new Set<string>()
  for (let timestamp = range.from.getTime(); timestamp <= range.to.getTime(); timestamp += 6 * 60 * 60 * 1000) {
    dates.add(dayKey(new Date(timestamp)))
  }
  dates.add(dayKey(range.to))
  return [...dates]
}

async function getLatestGaugeTotal(reader: AdminStatsHourlyReader, metric: AdminStatsMetric): Promise<number> {
  const rows = await reader.latestRows(metric)
  return rows.find((row) => row.orgId === '' && row.dimensionKey === '')?.count ?? 0
}

async function getLatestGaugeDimensions(
  reader: AdminStatsHourlyReader,
  metric: AdminStatsMetric,
  dimensionKey: AdminStatsDimension,
  field: 'count' | 'bytes' = 'count',
): Promise<Map<string, number>> {
  const result = new Map<string, number>()
  for (const row of await reader.latestRows(metric, [dimensionKey])) {
    if (row.orgId === '' && row.dimensionKey === dimensionKey) incrementMap(result, row.dimensionValue, row[field])
  }
  return result
}

async function getLatestGaugeDimensionSum(
  reader: AdminStatsHourlyReader,
  metric: AdminStatsMetric,
  dimensionKey: AdminStatsDimension,
  values: string[],
): Promise<number> {
  const dimensions = await getLatestGaugeDimensions(reader, metric, dimensionKey)
  return values.reduce((sum, value) => sum + (dimensions.get(value) ?? 0), 0)
}

async function getQuotaTotals(reader: AdminStatsHourlyReader): Promise<{ usedBytes: number; quotaBytes: number }> {
  const [usedRows, quotaRows] = await Promise.all([
    reader.latestRows(ADMIN_STATS_METRICS.storageUsed),
    reader.latestRows(ADMIN_STATS_METRICS.storageQuota),
  ])
  return {
    usedBytes: usedRows.find((row) => row.orgId === '' && row.dimensionKey === '')?.bytes ?? 0,
    quotaBytes: quotaRows.find((row) => row.orgId === '' && row.dimensionKey === '')?.bytes ?? 0,
  }
}

type UserInventory = {
  total: number
  normal: number
  unverified: number
  banned: number
  silent: number
  verified: number
}

async function getUserInventory(reader: AdminStatsHourlyReader): Promise<UserInventory> {
  const rows = await reader.latestRows(ADMIN_STATS_METRICS.userInventory, ['', 'status'])
  const dimensions = new Map(
    rows.filter((row) => row.dimensionKey === 'status').map((row) => [row.dimensionValue, row.count]),
  )
  return {
    total: rows.find((row) => row.dimensionKey === '')?.count ?? 0,
    normal: dimensions.get('normal') ?? 0,
    unverified: dimensions.get('unverified') ?? 0,
    banned: dimensions.get('banned') ?? 0,
    silent: dimensions.get('silent') ?? 0,
    verified: dimensions.get('verified') ?? 0,
  }
}

type ActiveUserSnapshot = { dau: number; wau: number; mau: number }

async function getActiveUserSnapshot(reader: AdminStatsHourlyReader): Promise<ActiveUserSnapshot> {
  const dimensions = await getLatestGaugeDimensions(reader, ADMIN_STATS_METRICS.userActiveSnapshot, 'window')
  return { dau: dimensions.get('dau') ?? 0, wau: dimensions.get('wau') ?? 0, mau: dimensions.get('mau') ?? 0 }
}

async function getActiveUsersByDay(reader: AdminStatsHourlyReader): Promise<Map<string, number>> {
  return getLatestGaugeValueByDay(reader, ADMIN_STATS_METRICS.userActiveSnapshot, 'count', 'window', 'dau')
}

async function getUserTotalsByDay(reader: AdminStatsHourlyReader): Promise<Map<string, number>> {
  return getLatestGaugeValueByDay(reader, ADMIN_STATS_METRICS.userInventory, 'count', '', '')
}

async function getRollingActiveUserTrend(
  reader: AdminStatsHourlyReader,
  range: AdminStatsDateRange,
): Promise<Array<{ date: string; dau: number; wau: number; mau: number }>> {
  const [dau, wau, mau] = await Promise.all([
    getLatestGaugeValueByDay(reader, ADMIN_STATS_METRICS.userActiveSnapshot, 'count', 'window', 'dau'),
    getLatestGaugeValueByDay(reader, ADMIN_STATS_METRICS.userActiveSnapshot, 'count', 'window', 'wau'),
    getLatestGaugeValueByDay(reader, ADMIN_STATS_METRICS.userActiveSnapshot, 'count', 'window', 'mau'),
  ])
  return createDateBuckets(range).map((date) => ({
    date,
    dau: dau.get(date) ?? 0,
    wau: wau.get(date) ?? 0,
    mau: mau.get(date) ?? 0,
  }))
}

async function getLatestGaugeValueByDay(
  reader: AdminStatsHourlyReader,
  metric: AdminStatsMetric,
  field: 'count' | 'bytes',
  dimensionKey: AdminStatsDimension | '',
  dimensionValue: string,
): Promise<Map<string, number>> {
  const byHour = new Map<number, number>()
  for (const row of await reader.rows(metric, [dimensionKey])) {
    if (row.orgId !== '' || row.dimensionKey !== dimensionKey || row.dimensionValue !== dimensionValue) continue
    const at = row.bucketStart.getTime()
    byHour.set(at, (byHour.get(at) ?? 0) + row[field])
  }
  const latestByDay = new Map<string, { at: number; value: number }>()
  for (const [at, value] of byHour) {
    const date = reader.dayKey(new Date(at))
    const current = latestByDay.get(date)
    if (!current || at > current.at) latestByDay.set(date, { at, value })
  }
  return new Map([...latestByDay].map(([date, value]) => [date, value.value]))
}

async function getRegistrationSources(
  reader: AdminStatsHourlyReader,
): Promise<Array<{ name: string; value: number; percent: number }>> {
  const counts = new Map<string, number>()
  const rows = await reader.rows(ADMIN_STATS_METRICS.userSignup, ['provider'])
  for (const row of rows) {
    if (row.dimensionKey === 'provider') incrementMap(counts, row.dimensionValue, row.count)
  }
  return percentRows([...counts.entries()].map(([name, value]) => ({ name, value })))
}

async function getSignupTotal(reader: AdminStatsHourlyReader): Promise<number> {
  const rows = await reader.rows(ADMIN_STATS_METRICS.userSignup)
  return rows.filter((row) => row.dimensionKey === '').reduce((sum, row) => sum + row.count, 0)
}

async function getSignupsByDay(reader: AdminStatsHourlyReader): Promise<Map<string, number>> {
  const rows = await reader.rows(ADMIN_STATS_METRICS.userSignup)
  const result = new Map<string, number>()
  for (const row of rows) {
    if (row.dimensionKey === '') incrementMap(result, reader.dayKey(row.bucketStart), row.count)
  }
  return result
}

type ActivityMetricSpec = {
  metric: (typeof ADMIN_STATS_METRICS)[keyof typeof ADMIN_STATS_METRICS]
  actions: string[]
  dimensionKey?: AdminStatsDimension
  dimensionValues?: string[]
}

export function metricSpec(actions: string[]): ActivityMetricSpec {
  const key = [...actions].sort().join(',')
  if (key === 'upload_confirm') {
    return { metric: ADMIN_STATS_METRICS.transferUpload, actions, dimensionKey: 'status', dimensionValues: ['success'] }
  }
  if (key === 'upload_cancel,upload_failed') {
    return {
      metric: ADMIN_STATS_METRICS.transferUpload,
      actions,
      dimensionKey: 'status',
      dimensionValues: ['canceled', 'failed'],
    }
  }
  if (key === 'upload_cancel,upload_confirm,upload_failed') {
    return { metric: ADMIN_STATS_METRICS.transferUpload, actions }
  }
  if (key === [...DOWNLOAD_ACTIVITY_ACTIONS].sort().join(',')) {
    return { metric: ADMIN_STATS_METRICS.transferDownloadIssued, actions }
  }
  if (key === 'download_failed') return { metric: ADMIN_STATS_METRICS.transferDownloadFailed, actions }
  if (key === 'share_download') return { metric: ADMIN_STATS_METRICS.shareDownloadIssued, actions }
  if (key === 'share_password_passed') return { metric: ADMIN_STATS_METRICS.sharePasswordPassed, actions }
  if (key === 'share_view') return { metric: ADMIN_STATS_METRICS.shareView, actions }
  if (key === 'save_from_share') return { metric: ADMIN_STATS_METRICS.shareSaved, actions }
  throw new Error(`Unsupported hourly activity metric: ${key}`)
}

type OperationalSource = 'background_job' | 'remote_download'

async function getOperationalOutcomes(
  reader: AdminStatsHourlyReader,
  source: OperationalSource,
): Promise<Map<string, number>> {
  const metric =
    source === 'background_job'
      ? ADMIN_STATS_METRICS.backgroundJobFinished
      : ADMIN_STATS_METRICS.remoteDownloadTaskFinished
  return getActivityMetricDimensionTotalsFromRollup(reader, metric, 'outcome', 'count')
}

async function getOperationalOutcomesByDay(
  reader: AdminStatsHourlyReader,
  source: OperationalSource,
): Promise<Map<string, Map<string, number>>> {
  const metric =
    source === 'background_job'
      ? ADMIN_STATS_METRICS.backgroundJobFinished
      : ADMIN_STATS_METRICS.remoteDownloadTaskFinished
  const rows = await reader.rows(metric, ['outcome'])
  const result = new Map<string, Map<string, number>>()
  for (const row of rows) {
    if (row.dimensionKey !== 'outcome') continue
    incrementNestedMap(result, reader.dayKey(row.bucketStart), row.dimensionValue, row.count)
  }
  return result
}

async function getActivityMetricDimensionTotalsFromRollup(
  reader: AdminStatsHourlyReader,
  metric: (typeof ADMIN_STATS_METRICS)[keyof typeof ADMIN_STATS_METRICS],
  dimensionKey: AdminStatsDimension,
  field: 'count' | 'bytes',
): Promise<Map<string, number>> {
  const rows = await reader.rows(metric, [dimensionKey])
  const result = new Map<string, number>()
  for (const row of rows) {
    if (row.dimensionKey === dimensionKey) incrementMap(result, row.dimensionValue, row[field])
  }
  return result
}

async function getCloudReportOutcomes(reader: AdminStatsHourlyReader): Promise<Map<string, number>> {
  return getLatestGaugeDimensions(reader, ADMIN_STATS_METRICS.trafficReportSnapshot, 'status')
}

async function getActivityMetricTotal(
  reader: AdminStatsHourlyReader,
  spec: ActivityMetricSpec,
  field: 'count' | 'bytes',
): Promise<number> {
  const rows = await reader.rows(spec.metric, [spec.dimensionKey ?? ''])
  return filterMetricRows(rows, spec).reduce((sum, row) => sum + row[field], 0)
}

async function getActivityMetricByDay(
  reader: AdminStatsHourlyReader,
  spec: ActivityMetricSpec,
  field: 'count' | 'bytes',
): Promise<Map<string, number>> {
  const rows = await reader.rows(spec.metric, [spec.dimensionKey ?? ''])
  const result = new Map<string, number>()
  for (const row of filterMetricRows(rows, spec)) {
    incrementMap(result, reader.dayKey(row.bucketStart), row[field])
  }
  return result
}

async function getActivityMetricDimensionTotals(
  reader: AdminStatsHourlyReader,
  spec: ActivityMetricSpec,
  dimensionKey: AdminStatsDimension,
  field: 'count' | 'bytes',
): Promise<Map<string, number>> {
  const rows = await reader.rows(spec.metric, [dimensionKey])
  const result = new Map<string, number>()
  for (const row of rows) {
    if (row.dimensionKey === dimensionKey) incrementMap(result, row.dimensionValue, row[field])
  }
  return result
}

function filterMetricRows(rows: Awaited<ReturnType<AdminStatsHourlyReader['rows']>>, spec: ActivityMetricSpec) {
  if (!spec.dimensionKey) return rows.filter((row) => row.dimensionKey === '')
  const values = new Set(spec.dimensionValues ?? [])
  return rows.filter(
    (row) => row.dimensionKey === spec.dimensionKey && (values.size === 0 || values.has(row.dimensionValue)),
  )
}

async function getTransferDataQuality(
  reader: AdminStatsHourlyReader,
  previousReader: AdminStatsHourlyReader,
): Promise<AdminTransferDataQuality> {
  const [current, previousCounts] = await Promise.all([
    getMissingTransferBytes(reader),
    getMissingTransferBytes(previousReader),
  ])
  return {
    missingUploadBytesEvents: current.upload,
    previousMissingUploadBytesEvents: previousCounts.upload,
    missingDownloadBytesEvents: current.download,
    previousMissingDownloadBytesEvents: previousCounts.download,
    missingBytesEvents: current.upload + current.download,
    previousMissingBytesEvents: previousCounts.upload + previousCounts.download,
  }
}

async function getMissingTransferBytes(reader: AdminStatsHourlyReader): Promise<{ upload: number; download: number }> {
  const rows = await reader.rows(ADMIN_STATS_METRICS.statsMissingBytes, ['direction'])
  const result = { upload: 0, download: 0 }
  for (const row of rows) {
    if (row.dimensionKey !== 'direction') continue
    if (row.dimensionValue === 'upload') result.upload += row.count
    if (row.dimensionValue === 'download') result.download += row.count
  }
  return result
}

async function getStorageUsedByDay(reader: AdminStatsHourlyReader): Promise<Map<string, number>> {
  return getLatestGaugeValueByDay(reader, ADMIN_STATS_METRICS.storageUsed, 'bytes', '', '')
}

async function getStorageInventory(reader: AdminStatsHourlyReader): Promise<{ files: number; bytes: number }> {
  const rows = await reader.latestRows(ADMIN_STATS_METRICS.storageInventory)
  return rows
    .filter((row) => row.orgId === '' && row.dimensionKey === '')
    .reduce((total, row) => ({ files: total.files + row.count, bytes: total.bytes + row.bytes }), {
      files: 0,
      bytes: 0,
    })
}

async function getLatestInventoryBreakdown(
  reader: AdminStatsHourlyReader,
  dimensionKey: 'file_type_group' | 'size_bucket' | 'age_bucket',
): Promise<Array<{ name: string; bytes: number; files: number; percent: number }>> {
  const values = new Map<string, { name: string; bytes: number; files: number }>()
  for (const row of await reader.latestRows(ADMIN_STATS_METRICS.storageInventory, [dimensionKey])) {
    if (row.orgId !== '' || row.dimensionKey !== dimensionKey) continue
    const value = values.get(row.dimensionValue) ?? { name: row.dimensionValue, bytes: 0, files: 0 }
    value.bytes += row.bytes
    value.files += row.count
    values.set(row.dimensionValue, value)
  }
  return percentByBytes([...values.values()].sort((a, b) => b.bytes - a.bytes))
}

async function getDownloadRequestsByDay(reader: AdminStatsHourlyReader): Promise<Map<string, number>> {
  const [issued, failed] = await Promise.all([
    getActivityMetricByDay(reader, metricSpec(DOWNLOAD_ACTIVITY_ACTIONS), 'count'),
    getActivityMetricByDay(reader, metricSpec([DOWNLOAD_FAILURE_ACTION]), 'count'),
  ])
  const result = new Map(issued)
  for (const [date, value] of failed) incrementMap(result, date, value)
  return result
}

async function getTrafficTotals(
  reader: AdminStatsHourlyReader,
): Promise<{ uploadBytes: number; uploadRequests: number; downloadBytes: number; downloadRequests: number }> {
  const [uploadBytes, uploadRequests, downloadBytes, issuedDownloads, failedDownloads] = await Promise.all([
    getActivityMetricTotal(reader, metricSpec(['upload_confirm']), 'bytes'),
    getActivityMetricTotal(reader, metricSpec(['upload_confirm', 'upload_cancel', 'upload_failed']), 'count'),
    getActivityMetricTotal(reader, metricSpec(DOWNLOAD_ACTIVITY_ACTIONS), 'bytes'),
    getActivityMetricTotal(reader, metricSpec(DOWNLOAD_ACTIVITY_ACTIONS), 'count'),
    getActivityMetricTotal(reader, metricSpec([DOWNLOAD_FAILURE_ACTION]), 'count'),
  ])
  return {
    uploadBytes,
    uploadRequests,
    downloadBytes,
    downloadRequests: issuedDownloads + failedDownloads,
  }
}

async function getSharingEventTotals(
  reader: AdminStatsHourlyReader,
): Promise<{ activeShares: number; views: number; passwordPasses: number; downloads: number }> {
  const [activeShares, views, passwordPasses, downloads] = await Promise.all([
    getLatestGaugeDimensionSum(reader, ADMIN_STATS_METRICS.shareInventory, 'lifecycle', ['usable']),
    getActivityMetricTotal(reader, metricSpec(['share_view']), 'count'),
    getActivityMetricTotal(reader, metricSpec(['share_password_passed']), 'count'),
    getActivityMetricTotal(reader, metricSpec(['share_download']), 'count'),
  ])
  return { activeShares, views, passwordPasses, downloads }
}

async function getSharingComparisonTotals(
  reader: AdminStatsHourlyReader,
): Promise<{ views: number; downloads: number }> {
  const [views, downloads] = await Promise.all([
    getActivityMetricTotal(reader, metricSpec(['share_view']), 'count'),
    getActivityMetricTotal(reader, metricSpec(['share_download']), 'count'),
  ])
  return { views, downloads }
}

async function getTopSharesWithPercent(
  db: Database,
  reader: AdminStatsHourlyReader,
  totals?: { totalViews: number; totalDownloads: number },
): Promise<Array<AdminTopShare & { viewPercent: number; downloadPercent: number }>> {
  const rows = await getTopSharesByActivity(db, reader)
  const [totalViews, totalDownloads] = totals
    ? [totals.totalViews, totals.totalDownloads]
    : await Promise.all([
        getActivityMetricTotal(reader, metricSpec(['share_view']), 'count'),
        getActivityMetricTotal(reader, metricSpec(['share_download']), 'count'),
      ])
  return rows.map((row) => ({
    ...row,
    viewPercent: percent(row.views, totalViews),
    downloadPercent: percent(row.downloads, totalDownloads),
  }))
}

async function getTopSharesByActivity(db: Database, reader: AdminStatsHourlyReader): Promise<AdminTopShare[]> {
  const activity = await reader.topShareActivity()
  const topIds = activity.map((row) => row.shareId)
  if (topIds.length === 0) return []

  const shareRows = await db
    .select({
      id: shares.id,
      token: shares.token,
      name: matters.name,
      creatorId: shares.creatorId,
      creatorName: user.name,
      status: shares.status,
    })
    .from(shares)
    .leftJoin(matters, eq(matters.id, shares.matterId))
    .leftJoin(user, eq(user.id, shares.creatorId))
    .where(inArray(shares.id, topIds))
  const shareById = new Map(shareRows.map((row) => [row.id, row]))
  const activityById = new Map(activity.map((row) => [row.shareId, row]))

  return topIds.flatMap((id) => {
    const row = shareById.get(id)
    const countValue = activityById.get(id)
    if (!row || !countValue) return []
    return {
      id: row.id,
      token: row.token,
      name: row.name ?? row.token,
      creatorId: row.creatorId,
      creatorName: row.creatorName ?? row.creatorId,
      views: countValue.views,
      downloads: countValue.downloads,
      status: row.status,
    }
  })
}

async function getUsageBySpaceRows(
  db: Database,
  reader: AdminStatsHourlyReader,
): Promise<AdminDashboardStorageStats['topSpaces']> {
  const topUsage = await reader.topSpaceUsage()
  const topIds = topUsage.map((row) => row.orgId)
  const orgRows =
    topIds.length === 0
      ? []
      : await db
          .select({
            id: organization.id,
            name: organization.name,
            slug: organization.slug,
            metadata: organization.metadata,
          })
          .from(organization)
          .where(inArray(organization.id, topIds))
  const orgById = new Map(orgRows.map((row) => [row.id, row]))
  return topUsage.map((row) => {
    const org = orgById.get(row.orgId)
    return {
      ...row,
      orgName: org?.name ?? row.orgId,
      orgType: org && isPersonalOrgLike({ slug: org.slug, metadata: org.metadata }) ? 'personal' : 'team',
      utilization: percent(row.usedBytes, row.quotaBytes),
    }
  })
}

function percentRows<T extends { name: string }>(
  rows: T[],
  getValue: (row: T) => number = (row) => ('value' in row ? toNumber(row.value) : 0),
): Array<T & { value: number; percent: number }> {
  const total = rows.reduce((sum, row) => sum + getValue(row), 0)
  return rows.map((row) => {
    const value = getValue(row)
    return { ...row, value, percent: percent(value, total) }
  })
}

function percentByBytes<T extends { name: string; bytes: number }>(rows: T[]): Array<T & { percent: number }> {
  const total = rows.reduce((sum, row) => sum + row.bytes, 0)
  return rows.map((row) => ({ ...row, percent: percent(row.bytes, total) }))
}

function incrementMap(map: Map<string, number>, key: string, value: number): void {
  map.set(key, (map.get(key) ?? 0) + value)
}

function incrementNestedMap(
  map: Map<string, Map<string, number>>,
  outerKey: string,
  innerKey: string,
  value: number,
): void {
  const inner = map.get(outerKey) ?? new Map<string, number>()
  incrementMap(inner, innerKey, value)
  map.set(outerKey, inner)
}

function dateOrdinal(date: string): number {
  return Date.parse(`${date}T00:00:00.000Z`)
}

function startOfHour(date: Date): Date {
  return new Date(Math.floor(date.getTime() / 3_600_000) * 3_600_000)
}

function percent(part: number, total: number): number {
  if (total <= 0) return 0
  return Math.round((part / total) * 1000) / 10
}

function nullablePercent(part: number, total: number): number | null {
  return total > 0 ? percent(part, total) : null
}

function toNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}
