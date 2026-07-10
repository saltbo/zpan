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
import type { SQL } from 'drizzle-orm'
import { and, count, desc, eq, gt, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm'
import type { SQLiteTable } from 'drizzle-orm/sqlite-core'
import { organization, session, user } from '../../db/auth-schema'
import {
  activityEvents,
  backgroundJobs,
  cloudTrafficReports,
  downloaders,
  downloadTasks,
  matters,
  orgQuotas,
  shares,
  statsRollupsHourly,
  webhookEvents,
} from '../../db/schema'
import { ADMIN_STATS_METRICS } from '../../domain/admin-stats-metrics'
import { addCalendarDays, statsDayKey as dayKey, localDateStart } from '../../domain/admin-stats-time'
import type { Database } from '../../platform/interface'
import type { AdminStatsDateRange, AdminStatsRepo } from '../../usecases/ports'
import { AdminStatsHourlyReader } from './admin-stats-hourly'
import { rebuildAdminStatsHour } from './admin-stats-rollup'

const DOWNLOAD_ACTIVITY_ACTIONS = ['share_download', 'object_download', 'image_hosting_download', 'webdav_download']
const DOWNLOAD_FAILURE_ACTION = 'download_failed'
const STORAGE_USED_ROLLUP_METRIC = ADMIN_STATS_METRICS.storageUsed
const GLOBAL_ROLLUP_DIMENSION_KEY = ''
const GLOBAL_ROLLUP_DIMENSION_VALUE = ''

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
  const currentHour = startOfHour(now)
  const previousHour = new Date(currentHour.getTime() - 3_600_000)
  const finalizePreviousSnapshot = now.getUTCMinutes() < 10
  const previous = await rebuildAdminStatsHour(db, previousHour, now, finalizePreviousSnapshot)
  const current = await rebuildAdminStatsHour(db, currentHour, now, true)
  return [previous, current]
}

async function countRows(db: Database, table: typeof user): Promise<number> {
  const rows = await db.select({ value: count() }).from(table)
  return toNumber(rows[0]?.value)
}

async function countRowsWhere(db: Database, table: SQLiteTable, where: SQL | undefined): Promise<number> {
  const rows = await db.select({ value: count() }).from(table).where(where)
  return toNumber(rows[0]?.value)
}

async function getStorageByType(db: Database): Promise<Array<{ type: string; bytes: number; files: number }>> {
  const rows = await db
    .select({
      type: matters.type,
      files: count(),
      bytes: sql<number>`COALESCE(SUM(${matters.size}), 0)`,
    })
    .from(matters)
    .where(and(eq(matters.status, 'active'), eq(matters.dirtype, 0)))
    .groupBy(matters.type)
    .orderBy(desc(sql`COALESCE(SUM(${matters.size}), 0)`))

  const result = rows.map((row) => ({
    type: row.type || 'unknown',
    files: toNumber(row.files),
    bytes: toNumber(row.bytes),
  }))
  if (result.length <= 8) return result
  const other = result
    .slice(8)
    .reduce((total, row) => ({ type: 'other', files: total.files + row.files, bytes: total.bytes + row.bytes }), {
      type: 'other',
      files: 0,
      bytes: 0,
    })
  return [...result.slice(0, 8), other]
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
    totalUsers,
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
  ] = await Promise.all([
    countRows(db, user),
    getSignupTotal(reader),
    getSignupTotal(previousReader),
    countActiveUsers(db, range),
    countActiveUsers(db, previous),
    getQuotaTotals(db),
    getTrafficTotals(reader),
    getTrafficTotals(previousReader),
    getSharingEventTotals(db, now, reader),
    getSharingEventTotals(db, now, previousReader),
    getTransferDataQuality(db, range, now),
  ])
  const [trendNewUsers, activeByDay, storageUsedByDay, uploadByDay, downloadByDay] = await Promise.all([
    getSignupsByDay(reader),
    getActiveUsersByDay(db, range),
    getStorageUsedByDay(db, range),
    getActivityMetricByDay(reader, metricSpec(['upload_confirm']), 'bytes'),
    getActivityMetricByDay(reader, metricSpec(DOWNLOAD_ACTIVITY_ACTIONS), 'bytes'),
  ])
  const trends = createDateBuckets(range).map((date) => {
    return {
      date,
      newUsers: trendNewUsers.get(date) ?? 0,
      activeUsers: activeByDay.get(date)?.size ?? 0,
      storageUsedBytes: storageUsedByDay.get(date) ?? null,
      uploadBytes: uploadByDay.get(date) ?? 0,
      downloadBytes: downloadByDay.get(date) ?? 0,
    }
  })

  return {
    ...statsFrame(now, range),
    dataQuality,
    totals: {
      users: totalUsers,
      newUsers: delta(newUsers, previousNewUsers),
      activeUsers: delta(activeUsers, previousActiveUsers),
      storageUsedBytes: quotas.usedBytes,
      storageQuotaBytes: quotas.quotaBytes,
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
  const activeTaskStatuses = ['queued', 'assigned', 'downloading', 'uploading', 'suspended', 'paused', 'interrupted']
  const [
    activeBackgroundJobs,
    activeRemoteDownloads,
    downloaderRows,
    cloudReportBacklog,
    webhookFailures,
    backgroundJobOutcomes,
    remoteDownloadOutcomes,
    cloudReportStatus,
    backgroundJobsByDay,
    remoteDownloadsByDay,
  ] = await Promise.all([
    countRowsWhere(db, backgroundJobs, inArray(backgroundJobs.status, ['queued', 'running'])),
    countRowsWhere(db, downloadTasks, inArray(downloadTasks.status, activeTaskStatuses)),
    db.select({ status: downloaders.status }).from(downloaders),
    countRowsWhere(db, cloudTrafficReports, inArray(cloudTrafficReports.status, ['pending', 'failed'])),
    countRowsWhere(db, webhookEvents, eq(webhookEvents.status, 'failed')),
    getOperationalOutcomes(reader, 'background_job'),
    getOperationalOutcomes(reader, 'remote_download'),
    getCloudReportOutcomes(reader),
    getOperationalOutcomesByDay(reader, 'background_job'),
    getOperationalOutcomesByDay(reader, 'remote_download'),
  ])
  const downloaderStatus = countBy(downloaderRows, (row) => row.status)
  const completedJobs = backgroundJobOutcomes.get('completed') ?? 0
  const failedJobs = backgroundJobOutcomes.get('failed') ?? 0
  const completedRemoteDownloads = remoteDownloadOutcomes.get('completed') ?? 0
  const failedRemoteDownloads = remoteDownloadOutcomes.get('failed') ?? 0

  return {
    ...statsFrame(now, range),
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
  const [usersRows, newUsers, previousNewUsers, activeUsers, previousActiveUsers, activeByDay, registrationSources] =
    await Promise.all([
      db
        .select({ id: user.id, emailVerified: user.emailVerified, banned: user.banned, createdAt: user.createdAt })
        .from(user),
      getSignupTotal(reader),
      getSignupTotal(previousReader),
      countActiveUsers(db, range),
      countActiveUsers(db, previous),
      getRollingActiveUserTrend(db, range),
      getRegistrationSources(reader),
    ])
  const activeLast30 = await activeUserIds(db, { from: daysAgo(now, 30), to: now, timeZone: range.timeZone })
  const totalUsers = usersRows.length
  const verifiedUsers = usersRows.filter((row) => row.emailVerified).length
  const bannedUsers = usersRows.filter((row) => row.banned).length
  const unverifiedUsers = usersRows.filter((row) => !row.emailVerified && !row.banned).length
  const silentUsers = usersRows.filter((row) => row.emailVerified && !row.banned && !activeLast30.has(row.id)).length
  const normalUsers = Math.max(0, totalUsers - unverifiedUsers - bannedUsers - silentUsers)
  const newUsersByDay = await getSignupsByDay(reader)
  let totalAtStart = usersRows.filter((row) => row.createdAt < range.from).length
  const userScaleTrend = createDateBuckets(range).map((date) => {
    const dailyNew = newUsersByDay.get(date) ?? 0
    totalAtStart += dailyNew
    return { date, newUsers: dailyNew, totalUsers: totalAtStart }
  })

  return {
    ...statsFrame(now, range),
    summary: {
      totalUsers,
      newUsers: delta(newUsers, previousNewUsers),
      activeUsers: delta(activeUsers, previousActiveUsers),
      verifiedUsers,
      bannedUsers,
      silentUsers,
    },
    userScaleTrend,
    activeUserTrend: activeByDay,
    userStatus: percentRows([
      { name: 'normal', value: normalUsers },
      { name: 'unverified', value: unverifiedUsers },
      { name: 'banned', value: bannedUsers },
      { name: 'silent', value: silentUsers },
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
    files,
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
  ] = await Promise.all([
    getQuotaTotals(db),
    db
      .select({ id: matters.id, type: matters.type, size: matters.size, createdAt: matters.createdAt })
      .from(matters)
      .where(and(eq(matters.status, 'active'), eq(matters.dirtype, 0))),
    getStorageUsedByDay(db, range),
    getStorageByType(db),
    getActivityMetricTotal(reader, metricSpec(['upload_confirm']), 'count'),
    getActivityMetricTotal(previousReader, metricSpec(['upload_confirm']), 'count'),
    getActivityMetricTotal(reader, metricSpec(['upload_confirm']), 'bytes'),
    getActivityMetricTotal(previousReader, metricSpec(['upload_confirm']), 'bytes'),
    getActivityMetricByDay(reader, metricSpec(['upload_confirm']), 'bytes'),
    getActivityMetricByDay(reader, metricSpec(['upload_confirm']), 'count'),
    getTransferDataQuality(db, range, now),
    getUsageBySpaceRows(db),
  ])
  const fileItems = files.map((row) => ({ bytes: row.size ?? 0, createdAt: row.createdAt }))
  const storageTrend = createDateBuckets(range).map((date) => {
    return {
      date,
      usedBytes: storageUsedByDay.get(date) ?? null,
      newBytes: uploadsByDay.get(date) ?? 0,
      newFiles: uploadFilesByDay.get(date) ?? 0,
    }
  })
  const coldCutoff = daysAgo(now, 90)
  const coldFileBytes = fileItems.filter((row) => row.createdAt < coldCutoff).reduce((sum, row) => sum + row.bytes, 0)

  return {
    ...statsFrame(now, range),
    dataQuality,
    summary: {
      storageUsedBytes: quotas.usedBytes,
      quotaBytes: quotas.quotaBytes,
      fileCount: files.length,
      newFiles: delta(newFiles, previousNewFiles),
      newBytes: delta(uploadBytes, previousUploadBytes),
      coldFileBytes,
      nearQuotaSpaces: spaceUsage.filter((space) => space.utilization >= 80 && space.utilization < 100).length,
      overQuotaSpaces: spaceUsage.filter((space) => space.utilization >= 100).length,
    },
    storageTrend,
    typeBreakdown: percentByBytes(
      typeBreakdown.map((row) => ({ name: row.type, bytes: row.bytes, files: row.files })),
    ).map(({ name, ...row }) => ({
      type: name,
      ...row,
    })),
    sizeBreakdown: fileBucketBreakdown(fileItems, [
      { name: '<10MB', max: 10 * 1024 * 1024 },
      { name: '10-100MB', max: 100 * 1024 * 1024 },
      { name: '100MB-1GB', max: 1024 * 1024 * 1024 },
      { name: '>1GB', max: Number.POSITIVE_INFINITY },
    ]),
    ageBreakdown: ageBucketBreakdown(fileItems, now),
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
    getTransferDataQuality(db, range, now),
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
    ...statsFrame(now, range),
    dataQuality,
    summary: {
      totalBytes: delta(
        traffic.uploadBytes + traffic.downloadBytes,
        previousTraffic.uploadBytes + previousTraffic.downloadBytes,
      ),
      requestCount: delta(totalRequests, previousTraffic.uploadRequests + previousTraffic.downloadRequests),
      issuedDownloads,
      blockedDownloads,
      issueRate: nullablePercent(issuedDownloads, issuedDownloads + blockedDownloads),
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
    shareRows,
    createdInRange,
    createdPrevious,
    typeCounts,
    saveCount,
    previousSaveCount,
    downloadSources,
  ] = await Promise.all([
    getSharingEventTotals(db, now, reader),
    getSharingEventTotals(db, now, previousReader),
    db
      .select({
        kind: shares.kind,
        status: shares.status,
        expiresAt: shares.expiresAt,
        downloadLimit: shares.downloadLimit,
        downloads: shares.downloads,
      })
      .from(shares),
    getShareCreatedTotal(reader),
    getShareCreatedTotal(previousReader),
    getShareCreatedKinds(reader),
    getActivityMetricTotal(reader, metricSpec(['save_from_share']), 'count'),
    getActivityMetricTotal(previousReader, metricSpec(['save_from_share']), 'count'),
    getActivityMetricDimensionTotals(reader, metricSpec(['share_download']), 'source', 'count'),
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
  const activeShares = shareRows.filter((row) => isShareActive(row, now)).length
  const topShares = await getTopSharesWithPercent(db, reader, {
    totalViews: sharing.views,
    totalDownloads: sharing.downloads,
  })

  return {
    ...statsFrame(now, range),
    summary: {
      activeShares,
      createdShares: delta(createdInRange, createdPrevious),
      views: delta(sharing.views, previousSharing.views),
      downloads: delta(sharing.downloads, previousSharing.downloads),
      saves: delta(saveCount, previousSaveCount),
      downloadConversionRate: nullablePercent(landingDownloads, sharing.views),
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
  const rows = await reader.rows(ADMIN_STATS_METRICS.shareCreated)
  const result = new Map<string, number>()
  for (const row of rows) {
    if (row.dimensionKey === 'kind') incrementMap(result, row.dimensionValue, row.count)
  }
  return result
}

function statsFrame(now: Date, range: AdminStatsDateRange) {
  return { generatedAt: now.toISOString(), from: range.from.toISOString(), to: range.to.toISOString() }
}

function previousRange(range: AdminStatsDateRange): AdminStatsDateRange {
  const firstDate = dayKey(range.from, range.timeZone)
  const lastDate = dayKey(range.to, range.timeZone)
  const localStart = localDateStart(firstDate, range.timeZone)
  const localEnd = new Date(localDateStart(addCalendarDays(lastDate, 1), range.timeZone).getTime() - 1)
  if (localStart.getTime() === range.from.getTime() && localEnd.getTime() === range.to.getTime()) {
    const days = Math.floor((dateOrdinal(lastDate) - dateOrdinal(firstDate)) / 86_400_000) + 1
    const previousStartDate = addCalendarDays(firstDate, -days)
    return {
      from: localDateStart(previousStartDate, range.timeZone),
      to: new Date(localDateStart(firstDate, range.timeZone).getTime() - 1),
      timeZone: range.timeZone,
    }
  }
  const durationMs = Math.max(0, range.to.getTime() - range.from.getTime())
  const to = new Date(range.from.getTime() - 1)
  return { from: new Date(to.getTime() - durationMs), to, timeZone: range.timeZone }
}

function delta(value: number, previousValue: number): AdminStatsDelta {
  return { value, previousValue, changePercent: nullablePercent(value - previousValue, previousValue) }
}

function createDateBuckets(range: AdminStatsDateRange): string[] {
  const dates = new Set<string>()
  for (let timestamp = range.from.getTime(); timestamp <= range.to.getTime(); timestamp += 6 * 60 * 60 * 1000) {
    dates.add(dayKey(new Date(timestamp), range.timeZone))
  }
  dates.add(dayKey(range.to, range.timeZone))
  return [...dates]
}

async function getQuotaTotals(db: Database): Promise<{ usedBytes: number; quotaBytes: number }> {
  const rows = await db
    .select({
      usedBytes: sql<number>`COALESCE(SUM(${orgQuotas.used}), 0)`,
      quotaBytes: sql<number>`COALESCE(SUM(${orgQuotas.quota}), 0)`,
    })
    .from(orgQuotas)
  return { usedBytes: toNumber(rows[0]?.usedBytes), quotaBytes: toNumber(rows[0]?.quotaBytes) }
}

async function countActiveUsers(db: Database, range: AdminStatsDateRange): Promise<number> {
  return (await activeUserIds(db, range)).size
}

async function activeUserIds(db: Database, range: AdminStatsDateRange): Promise<Set<string>> {
  const [activityRows, sessionRows] = await Promise.all([
    db
      .select({ userId: activityEvents.userId })
      .from(activityEvents)
      .innerJoin(user, eq(activityEvents.userId, user.id))
      .where(and(gte(activityEvents.createdAt, range.from), lte(activityEvents.createdAt, range.to)))
      .groupBy(activityEvents.userId),
    db
      .select({ userId: session.userId })
      .from(session)
      .innerJoin(user, eq(session.userId, user.id))
      .where(and(gte(session.createdAt, range.from), lte(session.createdAt, range.to)))
      .groupBy(session.userId),
  ])
  const ids = new Set<string>()
  for (const row of activityRows) if (row.userId) ids.add(row.userId)
  for (const row of sessionRows) ids.add(row.userId)
  return ids
}

async function getActiveUsersByDay(db: Database, range: AdminStatsDateRange): Promise<Map<string, Set<string>>> {
  const [activityRows, sessionRows] = await Promise.all([
    db
      .select({ userId: activityEvents.userId, createdAt: activityEvents.createdAt })
      .from(activityEvents)
      .innerJoin(user, eq(activityEvents.userId, user.id))
      .where(and(gte(activityEvents.createdAt, range.from), lte(activityEvents.createdAt, range.to))),
    db
      .select({ userId: session.userId, createdAt: session.createdAt })
      .from(session)
      .innerJoin(user, eq(session.userId, user.id))
      .where(and(gte(session.createdAt, range.from), lte(session.createdAt, range.to))),
  ])
  const byDay = new Map<string, Set<string>>()
  for (const row of activityRows) {
    if (row.userId) addSetMap(byDay, dayKey(row.createdAt, range.timeZone), row.userId)
  }
  for (const row of sessionRows) addSetMap(byDay, dayKey(row.createdAt, range.timeZone), row.userId)
  return byDay
}

async function getRollingActiveUserTrend(
  db: Database,
  range: AdminStatsDateRange,
): Promise<Array<{ date: string; dau: number; wau: number; mau: number }>> {
  // Query one extra UTC day so a 30-day calendar window is complete across DST boundaries.
  const extendedRange = { from: daysAgo(range.from, 30), to: range.to }
  const [activityRows, sessionRows] = await Promise.all([
    db
      .select({ userId: activityEvents.userId, createdAt: activityEvents.createdAt })
      .from(activityEvents)
      .innerJoin(user, eq(activityEvents.userId, user.id))
      .where(and(gte(activityEvents.createdAt, extendedRange.from), lte(activityEvents.createdAt, extendedRange.to))),
    db
      .select({ userId: session.userId, createdAt: session.createdAt })
      .from(session)
      .innerJoin(user, eq(session.userId, user.id))
      .where(and(gte(session.createdAt, extendedRange.from), lte(session.createdAt, extendedRange.to))),
  ])
  const records: Array<{ userId: string; at: Date }> = []
  for (const row of activityRows) if (row.userId) records.push({ userId: row.userId, at: row.createdAt })
  for (const row of sessionRows) records.push({ userId: row.userId, at: row.createdAt })
  return createDateBuckets(range).map((dateKeyValue) => {
    return {
      date: dateKeyValue,
      dau: distinctUsersInCalendarWindow(records, dateKeyValue, 1, range.timeZone),
      wau: distinctUsersInCalendarWindow(records, dateKeyValue, 7, range.timeZone),
      mau: distinctUsersInCalendarWindow(records, dateKeyValue, 30, range.timeZone),
    }
  })
}

async function getRegistrationSources(
  reader: AdminStatsHourlyReader,
): Promise<Array<{ name: string; value: number; percent: number }>> {
  const counts = new Map<string, number>()
  const rows = await reader.rows(ADMIN_STATS_METRICS.userSignup)
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
  dimensionKey?: string
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
  const rows = await reader.rows(metric)
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
  dimensionKey: string,
  field: 'count' | 'bytes',
): Promise<Map<string, number>> {
  const rows = await reader.rows(metric)
  const result = new Map<string, number>()
  for (const row of rows) {
    if (row.dimensionKey === dimensionKey) incrementMap(result, row.dimensionValue, row[field])
  }
  return result
}

async function getCloudReportOutcomes(reader: AdminStatsHourlyReader): Promise<Map<string, number>> {
  return getActivityMetricDimensionTotalsFromRollup(reader, ADMIN_STATS_METRICS.trafficReportSync, 'status', 'count')
}

async function getActivityMetricTotal(
  reader: AdminStatsHourlyReader,
  spec: ActivityMetricSpec,
  field: 'count' | 'bytes',
): Promise<number> {
  const rows = await reader.rows(spec.metric)
  return filterMetricRows(rows, spec).reduce((sum, row) => sum + row[field], 0)
}

async function getActivityMetricByDay(
  reader: AdminStatsHourlyReader,
  spec: ActivityMetricSpec,
  field: 'count' | 'bytes',
): Promise<Map<string, number>> {
  const rows = await reader.rows(spec.metric)
  const result = new Map<string, number>()
  for (const row of filterMetricRows(rows, spec)) {
    incrementMap(result, reader.dayKey(row.bucketStart), row[field])
  }
  return result
}

async function getActivityMetricDimensionTotals(
  reader: AdminStatsHourlyReader,
  spec: ActivityMetricSpec,
  dimensionKey: string,
  field: 'count' | 'bytes',
): Promise<Map<string, number>> {
  const rows = await reader.rows(spec.metric)
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
  db: Database,
  range: AdminStatsDateRange,
  now: Date,
): Promise<AdminTransferDataQuality> {
  const previous = previousRange(range)
  const [current, previousCounts] = await Promise.all([
    getMissingTransferBytes(new AdminStatsHourlyReader(db, range, now)),
    getMissingTransferBytes(new AdminStatsHourlyReader(db, previous, now)),
  ])
  return {
    missingUploadBytesEvents: current.upload,
    previousMissingUploadBytesEvents: previousCounts.upload,
    missingDownloadBytesEvents: current.download,
    previousMissingDownloadBytesEvents: previousCounts.download,
  }
}

async function getMissingTransferBytes(reader: AdminStatsHourlyReader): Promise<{ upload: number; download: number }> {
  const rows = await reader.rows(ADMIN_STATS_METRICS.statsMissingBytes)
  const result = { upload: 0, download: 0 }
  for (const row of rows) {
    if (row.dimensionKey !== 'direction') continue
    if (row.dimensionValue === 'upload') result.upload += row.count
    if (row.dimensionValue === 'download') result.download += row.count
  }
  return result
}

async function getStorageUsedByDay(db: Database, range: AdminStatsDateRange): Promise<Map<string, number>> {
  const buckets = createDateBuckets(range)
  if (buckets.length === 0) return new Map()

  const firstBucketStart = dateKeyStart(buckets[0])
  const lastBucketStart = dateKeyStart(buckets[buckets.length - 1])
  const rows = await db
    .select({
      bucketStart: statsRollupsHourly.bucketStart,
      orgId: statsRollupsHourly.orgId,
      bytes: statsRollupsHourly.bytes,
    })
    .from(statsRollupsHourly)
    .where(
      and(
        eq(statsRollupsHourly.metricKey, STORAGE_USED_ROLLUP_METRIC),
        eq(statsRollupsHourly.dimensionKey, GLOBAL_ROLLUP_DIMENSION_KEY),
        eq(statsRollupsHourly.dimensionValue, GLOBAL_ROLLUP_DIMENSION_VALUE),
        gte(statsRollupsHourly.bucketStart, daysAgo(firstBucketStart, 1)),
        lte(statsRollupsHourly.bucketStart, daysAgo(lastBucketStart, -1)),
      ),
    )

  const byBucket = new Map<number, number>()
  for (const row of rows) {
    const at = row.bucketStart.getTime()
    byBucket.set(at, (byBucket.get(at) ?? 0) + toNumber(row.bytes))
  }
  const byDay = new Map<string, { at: number; bytes: number }>()
  for (const [at, bytes] of byBucket) {
    const date = dayKey(new Date(at), range.timeZone)
    const current = byDay.get(date)
    if (!current || at > current.at) byDay.set(date, { at, bytes })
  }
  return new Map([...byDay].map(([date, value]) => [date, value.bytes]))
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
  db: Database,
  now: Date,
  reader: AdminStatsHourlyReader,
): Promise<{ activeShares: number; views: number; passwordPasses: number; downloads: number }> {
  const [activeShares, views, passwordPasses, downloads] = await Promise.all([
    countRowsWhere(
      db,
      shares,
      and(
        eq(shares.status, 'active'),
        or(isNull(shares.expiresAt), gt(shares.expiresAt, now)),
        or(isNull(shares.downloadLimit), sql`${shares.downloads} < ${shares.downloadLimit}`),
      ),
    ),
    getActivityMetricTotal(reader, metricSpec(['share_view']), 'count'),
    getActivityMetricTotal(reader, metricSpec(['share_password_passed']), 'count'),
    getActivityMetricTotal(reader, metricSpec(['share_download']), 'count'),
  ])
  return { activeShares, views, passwordPasses, downloads }
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
  const [viewCounts, downloadCounts] = await Promise.all([
    getActivityMetricDimensionTotals(reader, metricSpec(['share_view']), 'share_id', 'count'),
    getActivityMetricDimensionTotals(reader, metricSpec(['share_download']), 'share_id', 'count'),
  ])
  const counts = new Map<string, { views: number; downloads: number }>()
  for (const [shareId, views] of viewCounts) counts.set(shareId, { views, downloads: 0 })
  for (const [shareId, downloads] of downloadCounts) {
    const item = counts.get(shareId) ?? { views: 0, downloads: 0 }
    item.downloads = downloads
    counts.set(shareId, item)
  }
  const topIds = [...counts.entries()]
    .sort((a, b) => b[1].views - a[1].views || b[1].downloads - a[1].downloads)
    .slice(0, 8)
    .map(([id]) => id)
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

  return topIds.flatMap((id) => {
    const row = shareById.get(id)
    const countValue = counts.get(id)
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

async function getUsageBySpaceRows(db: Database): Promise<AdminDashboardStorageStats['topSpaces']> {
  const rows = await db
    .select({
      orgId: orgQuotas.orgId,
      usedBytes: orgQuotas.used,
      quotaBytes: orgQuotas.quota,
      orgName: organization.name,
      slug: organization.slug,
      metadata: organization.metadata,
    })
    .from(orgQuotas)
    .leftJoin(organization, eq(organization.id, orgQuotas.orgId))
    .orderBy(desc(orgQuotas.used))
  return rows.map((row) => ({
    orgId: row.orgId,
    orgName: row.orgName ?? row.orgId,
    orgType: isPersonalOrgLike({ slug: row.slug ?? '', metadata: row.metadata ?? null }) ? 'personal' : 'team',
    usedBytes: row.usedBytes,
    quotaBytes: row.quotaBytes,
    utilization: percent(row.usedBytes, row.quotaBytes),
  }))
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

function isShareActive(
  share: { status: string; expiresAt: Date | null; downloadLimit: number | null; downloads: number },
  now: Date,
): boolean {
  return (
    share.status === 'active' &&
    (!share.expiresAt || share.expiresAt > now) &&
    (share.downloadLimit === null || share.downloads < share.downloadLimit)
  )
}

function percentByBytes<T extends { name: string; bytes: number }>(rows: T[]): Array<T & { percent: number }> {
  const total = rows.reduce((sum, row) => sum + row.bytes, 0)
  return rows.map((row) => ({ ...row, percent: percent(row.bytes, total) }))
}

function fileBucketBreakdown(
  files: Array<{ bytes: number }>,
  buckets: Array<{ name: string; max: number }>,
): Array<{ name: string; bytes: number; files: number; percent: number }> {
  const rows = buckets.map((bucket) => ({ name: bucket.name, bytes: 0, files: 0, max: bucket.max }))
  for (const file of files) {
    const bucket = rows.find((row, index) => file.bytes <= row.max && (index === 0 || file.bytes > rows[index - 1].max))
    if (!bucket) continue
    bucket.files += 1
    bucket.bytes += file.bytes
  }
  return percentByBytes(rows.map(({ max: _max, ...row }) => row))
}

function ageBucketBreakdown(
  files: Array<{ bytes: number; createdAt: Date }>,
  now: Date,
): Array<{ name: string; bytes: number; files: number; percent: number }> {
  const rows = [
    { name: '<30d', bytes: 0, files: 0 },
    { name: '30-90d', bytes: 0, files: 0 },
    { name: '90-180d', bytes: 0, files: 0 },
    { name: '>180d', bytes: 0, files: 0 },
  ]
  for (const file of files) {
    const ageDays = Math.floor((now.getTime() - file.createdAt.getTime()) / 86_400_000)
    const bucket = ageDays < 30 ? rows[0] : ageDays < 90 ? rows[1] : ageDays < 180 ? rows[2] : rows[3]
    bucket.files += 1
    bucket.bytes += file.bytes
  }
  return percentByBytes(rows)
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

function addSetMap(map: Map<string, Set<string>>, key: string, value: string): void {
  const set = map.get(key) ?? new Set<string>()
  set.add(value)
  map.set(key, set)
}

function countBy<T>(rows: T[], getKey: (row: T) => string): Map<string, number> {
  const map = new Map<string, number>()
  for (const row of rows) incrementMap(map, getKey(row), 1)
  return map
}

function distinctUsersInCalendarWindow(
  records: Array<{ userId: string; at: Date }>,
  endDate: string,
  days: number,
  timeZone: string,
): number {
  const endOrdinal = dateOrdinal(endDate)
  const startOrdinal = endOrdinal - (days - 1) * 86_400_000
  const ids = new Set<string>()
  for (const record of records) {
    const ordinal = dateOrdinal(dayKey(record.at, timeZone))
    if (ordinal >= startOrdinal && ordinal <= endOrdinal) ids.add(record.userId)
  }
  return ids.size
}

function dateOrdinal(date: string): number {
  return Date.parse(`${date}T00:00:00.000Z`)
}

function daysAgo(now: Date, days: number): Date {
  const date = new Date(now)
  date.setUTCDate(date.getUTCDate() - days)
  return date
}

function startOfHour(date: Date): Date {
  return new Date(Math.floor(date.getTime() / 3_600_000) * 3_600_000)
}

function dateKeyStart(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`)
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
