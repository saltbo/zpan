import { isPersonalOrgLike } from '@shared/org-slugs'
import type {
  AdminDashboardGrowthStats,
  AdminDashboardOperationsStats,
  AdminDashboardOverviewStats,
  AdminDashboardSharingStats,
  AdminDashboardStorageStats,
  AdminDashboardTrafficStats,
  AdminOverviewStatistics,
  AdminSharingDataQuality,
  AdminStatsDelta,
  AdminStorageDataQuality,
  AdminTopShare,
  AdminTransferDataQuality,
} from '@shared/types'
import { and, eq, gte, inArray, lte } from 'drizzle-orm'
import { member, organization, user } from '../../db/auth-schema'
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
import { captureAdminStatsSnapshot, rebuildAdminStatsHour } from './admin-stats-rollup'
import { createCloudTrafficReportRepo, trafficLedgerExactFrom } from './cloud-traffic-report'
import { getStorageUsageLedgerOpening, storageUsageLedgerExactFrom } from './storage-usage-ledger'

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
    getOverviewStatistics: (now, range) => getOverviewStatistics(db, now, range),
  }
}

async function getOverviewStatistics(
  db: Database,
  now: Date,
  range: AdminStatsDateRange,
): Promise<AdminOverviewStatistics> {
  const effective = effectiveRange(range, now)
  const reader = new AdminStatsHourlyReader(db, effective, now)
  const [
    inventory,
    active,
    newUsersByDay,
    totalUsersByDay,
    activeByDay,
    storageUsedByDay,
    storageChangesByDay,
    storageLedgerOpening,
    topUsage,
    storageDataQuality,
  ] = await Promise.all([
    getUserInventory(reader),
    getActiveUserSnapshot(reader),
    getSignupsByDay(reader),
    getUserTotalsByDay(reader),
    getRollingActiveUserTrend(reader, effective),
    getStorageUsedByDay(reader),
    getStorageLedgerChangesByDay(reader),
    getStorageUsageLedgerOpening(db),
    getTopPersonalUsage(db, reader),
    getStorageDataQuality(reader),
  ])
  const dates = createDateBuckets(effective)
  const activeByDate = new Map(activeByDay.map((row) => [row.date, row]))
  const dau = active?.dau ?? null
  const wau = active?.wau ?? null
  const mau = active?.mau ?? null
  const recentSignups = dates.slice(-7).map((date) => (newUsersByDay.has(date) ? (newUsersByDay.get(date) ?? null) : 0))
  const exactUsage = storageDataQuality.usageDriftSpaces === null || storageDataQuality.usageDriftSpaces === 0
  const exactLedger = storageDataQuality.ledgerDriftSpaces === null || storageDataQuality.ledgerDriftSpaces === 0
  const storageChangesExactFrom = fullStorageChangeDayFrom(storageLedgerOpening)

  return {
    users: {
      total: inventory?.total ?? null,
      active30Days: mau,
      new7Days: recentSignups.some((value) => value === null)
        ? null
        : recentSignups.reduce<number>((total, value) => total + (value ?? 0), 0),
      activity: {
        today: dau,
        last7Days: dau === null || wau === null ? null : Math.max(0, wau - dau),
        last30Days: wau === null || mau === null ? null : Math.max(0, mau - wau),
        inactive: inventory === null || mau === null ? null : Math.max(0, inventory.total - mau),
      },
      trend: dates.map((date) => ({
        date,
        totalUsers: totalUsersByDay.get(date) ?? null,
        activeUsers: activeByDate.get(date)?.mau ?? null,
        newUsers: newUsersByDay.has(date) ? (newUsersByDay.get(date) ?? null) : 0,
      })),
      topUsage: exactUsage ? topUsage : [],
    },
    storageTrend: dates.map((date) => {
      const changes = storageChangesByDay.get(date)
      const exactChanges =
        storageChangesExactFrom !== null && date >= storageChangesExactFrom && changes?.exact !== false
      return {
        date,
        usedBytes: exactLedger ? (storageUsedByDay.get(date) ?? null) : null,
        writtenBytes: exactChanges ? (changes?.writtenBytes ?? 0) : null,
        releasedBytes: exactChanges ? (changes?.releasedBytes ?? 0) : null,
      }
    }),
  }
}

async function getTopPersonalUsage(
  db: Database,
  reader: AdminStatsHourlyReader,
): Promise<AdminOverviewStatistics['users']['topUsage']> {
  const usage = await reader.topSpaceUsage({ limit: 10, personalOnly: true })
  if (usage.length === 0) return []

  const owners = await db
    .select({ orgId: organization.id, userId: user.id, name: user.name, email: user.email })
    .from(organization)
    .innerJoin(member, and(eq(member.organizationId, organization.id), eq(member.role, 'owner')))
    .innerJoin(user, eq(user.id, member.userId))
    .where(
      inArray(
        organization.id,
        usage.map((row) => row.orgId),
      ),
    )
  const ownerByOrg = new Map(owners.map((owner) => [owner.orgId, owner]))

  return usage.flatMap((row) => {
    const owner = ownerByOrg.get(row.orgId)
    if (!owner) return []
    return {
      userId: owner.userId,
      name: owner.name || owner.email,
      email: owner.email,
      usedBytes: row.usedBytes,
      quotaBytes: row.quotaBytes,
      utilization: row.quotaBytes > 0 ? percent(row.usedBytes, row.quotaBytes) : null,
    }
  })
}

async function refreshHourlyRollups(db: Database, now: Date) {
  const currentHour = startOfHour(now)
  const latestClosedHour = new Date(currentHour.getTime() - 3_600_000)
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
      .filter((row) => {
        const scope = parseAdminStatsRollupMetadata(row.metadata)?.scope
        return scope === 'counters' || scope === 'full'
      })
      .map((row) => row.bucketStart.getTime()),
  )
  const repairTargets: Date[] = []
  for (let at = repairFrom.getTime(); at < latestClosedHour.getTime(); at += 3_600_000) {
    if (!completed.has(at)) repairTargets.push(new Date(at))
    if (repairTargets.length === 3) break
  }
  const latest = await rebuildAdminStatsHour(db, latestClosedHour, now)
  const repaired = []
  for (const bucketStart of repairTargets) repaired.push(await rebuildAdminStatsHour(db, bucketStart, now))
  const snapshot = await captureAdminStatsSnapshot(db, currentHour, now)
  return [latest, ...repaired, snapshot]
}

async function getDashboardOverviewStats(
  db: Database,
  now: Date,
  range: AdminStatsDateRange,
): Promise<AdminDashboardOverviewStats> {
  const effective = effectiveRange(range, now)
  const previous = previousRange(effective)
  const reader = new AdminStatsHourlyReader(db, effective, now)
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
    sharingDataQuality,
    previousSharingDataQuality,
    dataQuality,
    coverage,
    comparisonCoverage,
    snapshotCoverage,
    comparisonSnapshotCoverage,
    trafficLedgerComplete,
    previousTrafficLedgerComplete,
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
    getSharingDataQuality(reader),
    getSharingDataQuality(previousReader),
    getTransferDataQuality(reader, previousReader),
    reader.coverage('counters'),
    previousReader.coverage('counters'),
    reader.coverage('snapshots'),
    previousReader.coverage('snapshots'),
    trafficLedgerCoversRange(db, effective),
    trafficLedgerCoversRange(db, previous),
  ])
  const [trendNewUsers, activeByDay, storageUsedByDay, uploadByDay, downloadByDay, missingBytesByDay] =
    await Promise.all([
      getSignupsByDay(reader),
      getActiveUsersByDay(reader),
      getStorageUsedByDay(reader),
      getActivityMetricByDay(reader, metricSpec(['upload_confirm']), 'bytes'),
      getActivityMetricByDay(reader, metricSpec(DOWNLOAD_ACTIVITY_ACTIONS), 'bytes'),
      getMissingTransferBytesByDay(reader),
    ])
  const trends = createDateBuckets(effective).map((date) => {
    const missingBytes = missingBytesByDay.get(date)
    return {
      date,
      newUsers: trendNewUsers.has(date) ? (trendNewUsers.get(date) ?? null) : 0,
      activeUsers: activeByDay.get(date) ?? null,
      storageUsedBytes: storageUsedByDay.get(date) ?? null,
      uploadBytes: missingBytes?.upload ? null : (uploadByDay.get(date) ?? 0),
      downloadBytes: !trafficLedgerComplete || missingBytes?.download ? null : (downloadByDay.get(date) ?? 0),
    }
  })
  const sharingComparable =
    comparable(coverage, comparisonCoverage) &&
    hasExactSharingHistory(sharingDataQuality) &&
    hasExactSharingHistory(previousSharingDataQuality)
  const exactSharing = hasExactSharingHistory(sharingDataQuality)
  const exactPreviousSharing = hasExactSharingHistory(previousSharingDataQuality)
  const validQuotaBytes = quotas && quotas.invalidQuotaSpaces === 0 ? quotas.quotaBytes : null
  const currentUploadBytes = dataQuality.missingUploadBytesEvents === 0 ? traffic.uploadBytes : null
  const previousUploadBytes = dataQuality.previousMissingUploadBytesEvents === 0 ? previousTraffic.uploadBytes : null
  const currentDownloadBytes =
    trafficLedgerComplete && dataQuality.missingDownloadBytesEvents === 0 ? traffic.downloadBytes : null
  const previousDownloadBytes =
    previousTrafficLedgerComplete && dataQuality.previousMissingDownloadBytesEvents === 0
      ? previousTraffic.downloadBytes
      : null
  const currentTrafficBytes =
    currentUploadBytes === null || currentDownloadBytes === null ? null : currentUploadBytes + currentDownloadBytes
  const previousTrafficBytes =
    previousUploadBytes === null || previousDownloadBytes === null ? null : previousUploadBytes + previousDownloadBytes

  return {
    ...statsFrame(now, effective, coverage, comparisonCoverage, snapshotCoverage, comparisonSnapshotCoverage),
    dataQuality,
    totals: {
      users: users?.total ?? null,
      newUsers: delta(newUsers, previousNewUsers, comparable(coverage, comparisonCoverage)),
      activeUsers: delta(
        activeUsers?.mau ?? null,
        previousActiveUsers?.mau ?? null,
        comparable(snapshotCoverage, comparisonSnapshotCoverage),
      ),
      activeUserRate: nullablePercent(activeUsers?.mau ?? null, users?.total ?? null),
      storageUsedBytes: quotas?.usedBytes ?? null,
      storageQuotaBytes: validQuotaBytes,
      storageUtilization: nullablePercent(quotas?.usedBytes ?? null, validQuotaBytes),
      trafficBytes: delta(currentTrafficBytes, previousTrafficBytes, comparable(coverage, comparisonCoverage)),
      uploadBytes: delta(currentUploadBytes, previousUploadBytes, comparable(coverage, comparisonCoverage)),
      downloadBytes: delta(currentDownloadBytes, previousDownloadBytes, comparable(coverage, comparisonCoverage)),
      activeShares: sharing.activeShares,
      shareViews: delta(
        exactSharing ? sharing.views : null,
        exactPreviousSharing ? previousSharing.views : null,
        sharingComparable,
      ),
      shareDownloads: delta(
        exactSharing ? sharing.downloads : null,
        exactPreviousSharing ? previousSharing.downloads : null,
        sharingComparable,
      ),
    },
    trends,
  }
}

async function getDashboardOperationsStats(
  db: Database,
  now: Date,
  range: AdminStatsDateRange,
): Promise<AdminDashboardOperationsStats> {
  const effective = effectiveRange(range, now)
  const reader = new AdminStatsHourlyReader(db, effective, now)
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
    snapshotCoverage,
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
    reader.coverage('counters'),
    reader.coverage('snapshots'),
  ])
  const completedJobs = backgroundJobOutcomes.get('completed') ?? 0
  const failedJobs = backgroundJobOutcomes.get('failed') ?? 0
  const completedRemoteDownloads = remoteDownloadOutcomes.get('completed') ?? 0
  const failedRemoteDownloads = remoteDownloadOutcomes.get('failed') ?? 0

  return {
    ...statsFrame(now, effective, coverage, undefined, snapshotCoverage),
    summary: {
      activeBackgroundJobs,
      activeRemoteDownloads,
      onlineDownloaders: downloaderStatus?.get('online') ?? null,
      offlineDownloaders: downloaderStatus
        ? (downloaderStatus.get('offline') ?? 0) + (downloaderStatus.get('disabled') ?? 0)
        : null,
      backgroundJobFailureRate: nullablePercent(failedJobs, completedJobs + failedJobs),
      remoteDownloadSuccessRate: nullablePercent(
        completedRemoteDownloads,
        completedRemoteDownloads + failedRemoteDownloads,
      ),
      cloudReportBacklog,
      webhookFailures,
      cloudReportDeadLetters: cloudReportStatus?.get('dead_letter') ?? null,
      alertCount:
        cloudReportBacklog === null || webhookFailures === null
          ? null
          : cloudReportBacklog + webhookFailures + (cloudReportStatus?.get('dead_letter') ?? 0),
    },
    trend: createDateBuckets(effective).map((date) => ({
      date,
      completedJobs: backgroundJobsByDay.get(date)?.get('completed') ?? 0,
      failedJobs: backgroundJobsByDay.get(date)?.get('failed') ?? 0,
      completedRemoteDownloads: remoteDownloadsByDay.get(date)?.get('completed') ?? 0,
      failedRemoteDownloads: remoteDownloadsByDay.get(date)?.get('failed') ?? 0,
    })),
    backgroundJobOutcomes: percentRows([...backgroundJobOutcomes].map(([name, value]) => ({ name, value }))),
    remoteDownloadOutcomes: percentRows([...remoteDownloadOutcomes].map(([name, value]) => ({ name, value }))),
    downloaderStatus: percentRows([...(downloaderStatus ?? new Map())].map(([name, value]) => ({ name, value }))),
    cloudReportStatus: percentRows([...(cloudReportStatus ?? new Map())].map(([name, value]) => ({ name, value }))),
  }
}

async function getDashboardGrowthStats(
  db: Database,
  now: Date,
  range: AdminStatsDateRange,
): Promise<AdminDashboardGrowthStats> {
  const effective = effectiveRange(range, now)
  const previous = previousRange(effective)
  const reader = new AdminStatsHourlyReader(db, effective, now)
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
    snapshotCoverage,
    comparisonSnapshotCoverage,
  ] = await Promise.all([
    getUserInventory(reader),
    getSignupTotal(reader),
    getSignupTotal(previousReader),
    getActiveUserSnapshot(reader),
    getActiveUserSnapshot(previousReader),
    getRollingActiveUserTrend(reader, effective),
    getRegistrationSources(reader),
    getUserTotalsByDay(reader),
    reader.coverage('counters'),
    previousReader.coverage('counters'),
    reader.coverage('snapshots'),
    previousReader.coverage('snapshots'),
  ])
  const newUsersByDay = await getSignupsByDay(reader)
  const userScaleTrend = createDateBuckets(effective).map((date) => ({
    date,
    newUsers: newUsersByDay.has(date) ? (newUsersByDay.get(date) ?? null) : 0,
    totalUsers: totalsByDay.get(date) ?? null,
  }))

  return {
    ...statsFrame(now, effective, coverage, comparisonCoverage, snapshotCoverage, comparisonSnapshotCoverage),
    summary: {
      totalUsers: users?.total ?? null,
      newUsers: delta(newUsers, previousNewUsers, comparable(coverage, comparisonCoverage)),
      activeUsers: delta(
        activeUsers?.mau ?? null,
        previousActiveUsers?.mau ?? null,
        comparable(snapshotCoverage, comparisonSnapshotCoverage),
      ),
      verifiedUsers: users?.verified ?? null,
      bannedUsers: users?.banned ?? null,
      silentUsers: users?.silent ?? null,
      activeUserRate: nullablePercent(activeUsers?.mau ?? null, users?.total ?? null),
      silentUserRate: nullablePercent(users?.silent ?? null, users?.total ?? null),
    },
    userScaleTrend,
    activeUserTrend: activeByDay,
    userStatus: users
      ? percentRows([
          { name: 'normal', value: users.normal },
          { name: 'unverified', value: users.unverified },
          { name: 'banned', value: users.banned },
          { name: 'silent', value: users.silent },
        ])
      : [],
    registrationSources,
  }
}

async function getDashboardStorageStats(
  db: Database,
  now: Date,
  range: AdminStatsDateRange,
): Promise<AdminDashboardStorageStats> {
  const effective = effectiveRange(range, now)
  const previous = previousRange(effective)
  const reader = new AdminStatsHourlyReader(db, effective, now)
  const previousReader = new AdminStatsHourlyReader(db, previous, now)
  const [
    quotas,
    inventory,
    trashInventory,
    storageUsedByDay,
    typeBreakdown,
    newFiles,
    previousNewFiles,
    uploadBytes,
    previousUploadBytes,
    uploadsByDay,
    uploadFilesByDay,
    transferDataQuality,
    storageDataQuality,
    spaceUsage,
    quotaPressure,
    sizeBreakdown,
    ageBreakdown,
    coverage,
    comparisonCoverage,
    snapshotCoverage,
    comparisonSnapshotCoverage,
    missingBytesByDay,
  ] = await Promise.all([
    getQuotaTotals(reader),
    getStorageInventory(reader),
    getStorageTrashInventory(reader),
    getStorageUsedByDay(reader),
    getLatestInventoryBreakdown(reader, 'file_type_group'),
    getActivityMetricTotal(reader, metricSpec(['upload_confirm']), 'count'),
    getActivityMetricTotal(previousReader, metricSpec(['upload_confirm']), 'count'),
    getActivityMetricTotal(reader, metricSpec(['upload_confirm']), 'bytes'),
    getActivityMetricTotal(previousReader, metricSpec(['upload_confirm']), 'bytes'),
    getActivityMetricByDay(reader, metricSpec(['upload_confirm']), 'bytes'),
    getActivityMetricByDay(reader, metricSpec(['upload_confirm']), 'count'),
    getTransferDataQuality(reader, previousReader),
    getStorageDataQuality(reader),
    getUsageBySpaceRows(db, reader),
    getLatestGaugeDimensions(reader, ADMIN_STATS_METRICS.storageQuota, 'status'),
    getLatestInventoryBreakdown(reader, 'size_bucket'),
    getLatestInventoryBreakdown(reader, 'age_bucket'),
    reader.coverage('counters'),
    previousReader.coverage('counters'),
    reader.coverage('snapshots'),
    previousReader.coverage('snapshots'),
    getMissingTransferBytesByDay(reader),
  ])
  const exactUsage = storageDataQuality.usageDriftSpaces === null || storageDataQuality.usageDriftSpaces === 0
  const exactLedger = storageDataQuality.ledgerDriftSpaces === null || storageDataQuality.ledgerDriftSpaces === 0
  const storageTrend = createDateBuckets(effective).map((date) => {
    return {
      date,
      usedBytes: exactLedger ? (storageUsedByDay.get(date) ?? null) : null,
      newBytes: missingBytesByDay.get(date)?.upload ? null : (uploadsByDay.get(date) ?? 0),
      newFiles: uploadFilesByDay.get(date) ?? 0,
    }
  })
  const coldFileBytes = inventory
    ? ['90-180d', '>180d'].reduce(
        (total, bucket) => total + (ageBreakdown.find((row) => row.name === bucket)?.bytes ?? 0),
        0,
      )
    : null
  const validQuotaBytes = quotas && quotas.invalidQuotaSpaces === 0 ? quotas.quotaBytes : null

  return {
    ...statsFrame(now, effective, coverage, comparisonCoverage, snapshotCoverage, comparisonSnapshotCoverage),
    dataQuality: { ...transferDataQuality, ...storageDataQuality },
    summary: {
      storageUsedBytes: exactUsage ? (quotas?.usedBytes ?? null) : null,
      quotaBytes: validQuotaBytes,
      fileCount: inventory?.files ?? null,
      trashFileCount: trashInventory?.files ?? null,
      trashBytes: trashInventory?.bytes ?? null,
      newFiles: delta(newFiles, previousNewFiles, comparable(coverage, comparisonCoverage)),
      newBytes: delta(
        transferDataQuality.missingUploadBytesEvents === 0 ? uploadBytes : null,
        transferDataQuality.previousMissingUploadBytesEvents === 0 ? previousUploadBytes : null,
        comparable(coverage, comparisonCoverage),
      ),
      coldFileBytes,
      storageUtilization: nullablePercent(exactUsage ? (quotas?.usedBytes ?? null) : null, validQuotaBytes),
      coldFilePercent: nullablePercent(coldFileBytes, inventory?.bytes ?? null),
      nearQuotaSpaces: exactUsage ? (quotaPressure?.get('near') ?? null) : null,
      overQuotaSpaces: exactUsage ? (quotaPressure?.get('over') ?? null) : null,
      invalidQuotaSpaces: exactUsage ? (quotaPressure?.get('invalid') ?? null) : null,
    },
    storageTrend,
    typeBreakdown: typeBreakdown.map(({ name, ...row }) => ({
      type: name,
      ...row,
    })),
    sizeBreakdown,
    ageBreakdown,
    topSpaces: exactUsage ? spaceUsage.slice(0, 8) : [],
  }
}

async function getDashboardTrafficStats(
  db: Database,
  now: Date,
  range: AdminStatsDateRange,
): Promise<AdminDashboardTrafficStats> {
  const effective = effectiveRange(range, now)
  const previous = previousRange(effective)
  const reader = new AdminStatsHourlyReader(db, effective, now)
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
    missingBytesByDay,
    trafficLedgerComplete,
    previousTrafficLedgerComplete,
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
    getMissingTransferBytesByDay(reader),
    trafficLedgerCoversRange(db, effective),
    trafficLedgerCoversRange(db, previous),
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
  const trafficTrend = createDateBuckets(effective).map((date) => ({
    date,
    uploadBytes: missingBytesByDay.get(date)?.upload ? null : (uploadByDay.get(date) ?? 0),
    downloadBytes:
      !trafficLedgerComplete || missingBytesByDay.get(date)?.download ? null : (downloadByDay.get(date) ?? 0),
    requests: trafficLedgerComplete
      ? (uploadRequestsByDay.get(date) ?? 0) + (downloadRequestsByDay.get(date) ?? 0)
      : null,
  }))
  const successTrend = createDateBuckets(effective).map((date) => {
    const uploadSuccesses = uploadSuccessByDay.get(date) ?? 0
    const uploadFailures = uploadFailureByDay.get(date) ?? 0
    const uploadRequests = uploadSuccesses + uploadFailures
    const downloadSuccesses = downloadSuccessByDay.get(date) ?? 0
    const downloadFailures = downloadFailuresByDay.get(date) ?? 0
    const downloadRequests = downloadSuccesses + downloadFailures
    return {
      date,
      uploadSuccessRate: uploadRequests > 0 ? percent(uploadSuccesses, uploadRequests) : null,
      downloadSuccessRate:
        trafficLedgerComplete && downloadRequests > 0 ? percent(downloadSuccesses, downloadRequests) : null,
    }
  })
  const totalRequests = traffic.uploadRequests + traffic.downloadRequests
  const blockedDownloads = [...downloadFailureReasons.values()].reduce((sum, value) => sum + value, 0)
  const issuedDownloads = Math.max(0, traffic.downloadRequests - blockedDownloads)
  const exactCurrentBytes = trafficLedgerComplete && dataQuality.missingBytesEvents === 0
  const exactPreviousBytes = previousTrafficLedgerComplete && dataQuality.previousMissingBytesEvents === 0

  return {
    ...statsFrame(now, effective, coverage, comparisonCoverage),
    dataQuality,
    summary: {
      totalBytes: delta(
        exactCurrentBytes ? traffic.uploadBytes + traffic.downloadBytes : null,
        exactPreviousBytes ? previousTraffic.uploadBytes + previousTraffic.downloadBytes : null,
        comparable(coverage, comparisonCoverage),
      ),
      requestCount: delta(
        trafficLedgerComplete ? totalRequests : null,
        previousTrafficLedgerComplete ? previousTraffic.uploadRequests + previousTraffic.downloadRequests : null,
        comparable(coverage, comparisonCoverage),
      ),
      issuedDownloads: trafficLedgerComplete ? issuedDownloads : null,
      blockedDownloads: trafficLedgerComplete ? blockedDownloads : null,
      downloadIssueSuccessRate: trafficLedgerComplete
        ? nullablePercent(issuedDownloads, issuedDownloads + blockedDownloads)
        : null,
      peakDailyBytes: exactCurrentBytes
        ? Math.max(0, ...trafficTrend.map((row) => (row.uploadBytes ?? 0) + (row.downloadBytes ?? 0)))
        : null,
    },
    trafficTrend,
    sourceBreakdown: exactCurrentBytes ? percentRows([...sourceRows.values()], (row) => row.bytes) : [],
    issueStatus: trafficLedgerComplete
      ? percentRows(
          [...statusRows.entries()].map(([status, countValue]) => ({ status, name: status, value: countValue })),
        ).map(({ name, value, percent: pct }) => ({ status: name, count: value, percent: pct }))
      : [],
    successTrend,
    failureReasons: trafficLedgerComplete ? percentRows([...failureReasonRows.values()]) : [],
  }
}

async function getDashboardSharingStats(
  db: Database,
  now: Date,
  range: AdminStatsDateRange,
): Promise<AdminDashboardSharingStats> {
  const effective = effectiveRange(range, now)
  const previous = previousRange(effective)
  const reader = new AdminStatsHourlyReader(db, effective, now)
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
    dataQuality,
    previousDataQuality,
    coverage,
    comparisonCoverage,
    snapshotCoverage,
    comparisonSnapshotCoverage,
  ] = await Promise.all([
    getSharingEventTotals(reader),
    getSharingComparisonTotals(previousReader),
    getShareCreatedTotal(reader),
    getShareCreatedTotal(previousReader),
    getShareCreatedKinds(reader),
    getActivityMetricTotal(reader, metricSpec(['save_from_share']), 'count'),
    getActivityMetricTotal(previousReader, metricSpec(['save_from_share']), 'count'),
    getActivityMetricDimensionTotals(reader, metricSpec(['share_download']), 'source', 'count'),
    getSharingDataQuality(reader),
    getSharingDataQuality(previousReader),
    reader.coverage('counters'),
    previousReader.coverage('counters'),
    reader.coverage('snapshots'),
    previousReader.coverage('snapshots'),
  ])
  const landingDownloads = downloadSources.get('landing_share') ?? 0
  const directDownloads = downloadSources.get('direct_share') ?? 0
  const exactSharing = hasExactSharingHistory(dataQuality)
  const exactPreviousSharing = hasExactSharingHistory(previousDataQuality)
  const exactCurrentSharing = exactSharing
  const sharingComparable = comparable(coverage, comparisonCoverage) && exactSharing && exactPreviousSharing
  const [viewsByDay, downloadsByDay, savesByDay] = await Promise.all([
    getActivityMetricByDay(reader, metricSpec(['share_view']), 'count'),
    getActivityMetricByDay(reader, metricSpec(['share_download']), 'count'),
    getActivityMetricByDay(reader, metricSpec(['save_from_share']), 'count'),
  ])
  const trend = createDateBuckets(effective).map((date) => ({
    date,
    views: exactCurrentSharing ? (viewsByDay.get(date) ?? 0) : null,
    downloads: exactCurrentSharing ? (downloadsByDay.get(date) ?? 0) : null,
    saves: savesByDay.get(date) ?? 0,
  }))
  const topShares = exactCurrentSharing
    ? await getTopSharesWithPercent(db, reader, {
        totalViews: sharing.views,
        totalDownloads: sharing.downloads,
      })
    : []

  return {
    ...statsFrame(now, effective, coverage, comparisonCoverage, snapshotCoverage, comparisonSnapshotCoverage),
    dataQuality,
    summary: {
      activeShares: sharing.activeShares,
      createdShares: delta(createdInRange, createdPrevious, comparable(coverage, comparisonCoverage)),
      views: delta(
        exactCurrentSharing ? sharing.views : null,
        exactPreviousSharing ? previousSharing.views : null,
        sharingComparable,
      ),
      downloads: delta(
        exactCurrentSharing ? sharing.downloads : null,
        exactPreviousSharing ? previousSharing.downloads : null,
        sharingComparable,
      ),
      saves: delta(saveCount, previousSaveCount, comparable(coverage, comparisonCoverage)),
      downloadsPer100Views: exactCurrentSharing ? nullablePercent(landingDownloads, sharing.views) : null,
      savesPer100Views: exactCurrentSharing ? nullablePercent(saveCount, sharing.views) : null,
      passwordPasses: sharing.passwordPasses,
    },
    trend,
    typeBreakdown: percentRows([...typeCounts.entries()].map(([name, value]) => ({ name, value }))),
    sourceBreakdown: exactCurrentSharing
      ? percentRows([
          { name: 'landing_share', value: landingDownloads },
          { name: 'direct_share', value: directDownloads },
          { name: 'save_to_drive', value: saveCount },
        ])
      : [],
    topShares,
  }
}

async function getShareCreatedTotal(reader: AdminStatsHourlyReader): Promise<number | null> {
  const rows = await reader.rows(ADMIN_STATS_METRICS.shareCreated)
  const totals = rows.filter((row) => row.dimensionKey === '')
  return totals.some((row) => row.lowerBound) ? null : totals.reduce((sum, row) => sum + row.count, 0)
}

async function getShareCreatedKinds(reader: AdminStatsHourlyReader): Promise<Map<string, number>> {
  const rows = await reader.rows(ADMIN_STATS_METRICS.shareCreated, ['kind'])
  if (rows.some((row) => row.lowerBound)) return new Map()
  const result = new Map<string, number>()
  for (const row of rows) {
    if (row.dimensionKey === 'kind') incrementMap(result, row.dimensionValue, row.count)
  }
  return result
}

async function getSharingDataQuality(reader: AdminStatsHourlyReader): Promise<AdminSharingDataQuality> {
  const dimensions = await getLatestGaugeDimensions(reader, ADMIN_STATS_METRICS.statsDataQualitySnapshot, 'kind')
  if (!dimensions) return { unlocatedViews: null, unlocatedDownloads: null, unlocatedEvents: null }
  const unlocatedViews = dimensions.get('share_views') ?? 0
  const unlocatedDownloads = dimensions.get('share_downloads') ?? 0
  return {
    unlocatedViews,
    unlocatedDownloads,
    unlocatedEvents: unlocatedViews + unlocatedDownloads,
  }
}

function hasExactSharingHistory(quality: AdminSharingDataQuality): boolean {
  return quality.unlocatedEvents === 0
}

function statsFrame(
  now: Date,
  range: AdminStatsDateRange,
  coverage: Awaited<ReturnType<AdminStatsHourlyReader['coverage']>>,
  comparisonCoverage?: Awaited<ReturnType<AdminStatsHourlyReader['coverage']>>,
  snapshotCoverage?: Awaited<ReturnType<AdminStatsHourlyReader['coverage']>>,
  comparisonSnapshotCoverage?: Awaited<ReturnType<AdminStatsHourlyReader['coverage']>>,
) {
  return {
    generatedAt: now.toISOString(),
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    timeZone: 'UTC' as const,
    coverage,
    comparisonCoverage,
    snapshotCoverage,
    comparisonSnapshotCoverage,
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

function effectiveRange(range: AdminStatsDateRange, now: Date): AdminStatsDateRange {
  const closedToExclusive = Math.min(range.to.getTime() + 1, startOfHour(now).getTime())
  return {
    from: range.from,
    to: new Date(Math.max(range.from.getTime(), closedToExclusive) - 1),
    timeZone: range.timeZone,
  }
}

async function trafficLedgerCoversRange(db: Database, range: AdminStatsDateRange): Promise<boolean> {
  const opening = await createCloudTrafficReportRepo(db).getLedgerOpening()
  return opening !== null && range.from >= trafficLedgerExactFrom(opening)
}

function delta(value: number | null, previousValue: number | null, canCompare = true): AdminStatsDelta {
  if (value === null || previousValue === null || !canCompare) {
    return { value, previousValue: canCompare ? previousValue : null, change: null, changePercent: null }
  }
  return {
    value,
    previousValue,
    change: value - previousValue,
    changePercent: nullablePercent(value - previousValue, previousValue),
  }
}

function comparable(current: { status: string }, previous: { status: string }): boolean {
  return current.status === 'complete' && previous.status === 'complete'
}

function createDateBuckets(range: AdminStatsDateRange): string[] {
  const dates = new Set<string>()
  for (let timestamp = range.from.getTime(); timestamp <= range.to.getTime(); timestamp += 6 * 60 * 60 * 1000) {
    dates.add(dayKey(new Date(timestamp)))
  }
  dates.add(dayKey(range.to))
  return [...dates]
}

async function getLatestGaugeTotal(reader: AdminStatsHourlyReader, metric: AdminStatsMetric): Promise<number | null> {
  const rows = await reader.latestRows(metric)
  return rows.find((row) => row.orgId === '' && row.dimensionKey === '')?.count ?? null
}

async function getLatestGaugeDimensions(
  reader: AdminStatsHourlyReader,
  metric: AdminStatsMetric,
  dimensionKey: AdminStatsDimension,
  field: 'count' | 'bytes' = 'count',
): Promise<Map<string, number> | null> {
  const baseRows = await reader.latestRows(metric)
  if (!baseRows.some((row) => row.orgId === '' && row.dimensionKey === '')) return null
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
): Promise<number | null> {
  const dimensions = await getLatestGaugeDimensions(reader, metric, dimensionKey)
  if (!dimensions) return null
  return values.reduce((sum, value) => sum + (dimensions.get(value) ?? 0), 0)
}

async function getQuotaTotals(
  reader: AdminStatsHourlyReader,
): Promise<{ usedBytes: number; quotaBytes: number; invalidQuotaSpaces: number } | null> {
  const [usedRows, quotaRows] = await Promise.all([
    reader.latestRows(ADMIN_STATS_METRICS.storageUsed),
    reader.latestRows(ADMIN_STATS_METRICS.storageQuota, ['', 'status']),
  ])
  const usedBytes = usedRows.find((row) => row.orgId === '' && row.dimensionKey === '')?.bytes
  const quotaBytes = quotaRows.find((row) => row.orgId === '' && row.dimensionKey === '')?.bytes
  const invalidQuotaSpaces = quotaRows.find(
    (row) => row.orgId === '' && row.dimensionKey === 'status' && row.dimensionValue === 'invalid',
  )?.count
  return usedBytes === undefined || quotaBytes === undefined
    ? null
    : { usedBytes, quotaBytes, invalidQuotaSpaces: invalidQuotaSpaces ?? 0 }
}

type UserInventory = {
  total: number
  normal: number
  unverified: number
  banned: number
  silent: number
  verified: number
}

async function getUserInventory(reader: AdminStatsHourlyReader): Promise<UserInventory | null> {
  const rows = await reader.latestRows(ADMIN_STATS_METRICS.userInventory, ['', 'status'])
  const total = rows.find((row) => row.dimensionKey === '')?.count
  if (total === undefined) return null
  const dimensions = new Map(
    rows.filter((row) => row.dimensionKey === 'status').map((row) => [row.dimensionValue, row.count]),
  )
  return {
    total,
    normal: dimensions.get('normal') ?? 0,
    unverified: dimensions.get('unverified') ?? 0,
    banned: dimensions.get('banned') ?? 0,
    silent: dimensions.get('silent') ?? 0,
    verified: dimensions.get('verified') ?? 0,
  }
}

type ActiveUserSnapshot = { dau: number; wau: number; mau: number }

async function getActiveUserSnapshot(reader: AdminStatsHourlyReader): Promise<ActiveUserSnapshot | null> {
  const dimensions = await getLatestGaugeDimensions(reader, ADMIN_STATS_METRICS.userActiveSnapshot, 'window')
  if (!dimensions) return null
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
): Promise<Array<{ date: string; dau: number | null; wau: number | null; mau: number | null }>> {
  const [dau, wau, mau] = await Promise.all([
    getLatestGaugeValueByDay(reader, ADMIN_STATS_METRICS.userActiveSnapshot, 'count', 'window', 'dau'),
    getLatestGaugeValueByDay(reader, ADMIN_STATS_METRICS.userActiveSnapshot, 'count', 'window', 'wau'),
    getLatestGaugeValueByDay(reader, ADMIN_STATS_METRICS.userActiveSnapshot, 'count', 'window', 'mau'),
  ])
  return createDateBuckets(range).map((date) => ({
    date,
    dau: dau.get(date) ?? null,
    wau: wau.get(date) ?? null,
    mau: mau.get(date) ?? null,
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
  if (rows.some((row) => row.lowerBound)) return []
  for (const row of rows) {
    if (row.dimensionKey === 'provider') incrementMap(counts, row.dimensionValue, row.count)
  }
  return percentRows([...counts.entries()].map(([name, value]) => ({ name, value })))
}

async function getSignupTotal(reader: AdminStatsHourlyReader): Promise<number | null> {
  const rows = await reader.rows(ADMIN_STATS_METRICS.userSignup)
  const totals = rows.filter((row) => row.dimensionKey === '')
  return totals.some((row) => row.lowerBound) ? null : totals.reduce((sum, row) => sum + row.count, 0)
}

async function getSignupsByDay(reader: AdminStatsHourlyReader): Promise<Map<string, number | null>> {
  const rows = await reader.rows(ADMIN_STATS_METRICS.userSignup)
  const result = new Map<string, number | null>()
  for (const row of rows) {
    if (row.dimensionKey !== '') continue
    const date = reader.dayKey(row.bucketStart)
    if (row.lowerBound) {
      result.set(date, null)
      continue
    }
    const current = result.get(date)
    if (current !== null) result.set(date, (current ?? 0) + row.count)
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

async function getCloudReportOutcomes(reader: AdminStatsHourlyReader): Promise<Map<string, number> | null> {
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

async function getMissingTransferBytesByDay(
  reader: AdminStatsHourlyReader,
): Promise<Map<string, { upload: number; download: number }>> {
  const rows = await reader.rows(ADMIN_STATS_METRICS.statsMissingBytes, ['direction'])
  const result = new Map<string, { upload: number; download: number }>()
  for (const row of rows) {
    if (row.dimensionKey !== 'direction') continue
    const date = reader.dayKey(row.bucketStart)
    const counts = result.get(date) ?? { upload: 0, download: 0 }
    if (row.dimensionValue === 'upload') counts.upload += row.count
    if (row.dimensionValue === 'download') counts.download += row.count
    result.set(date, counts)
  }
  return result
}

async function getStorageUsedByDay(reader: AdminStatsHourlyReader): Promise<Map<string, number>> {
  return getLatestGaugeValueByDay(reader, ADMIN_STATS_METRICS.storageLedgerBalance, 'bytes', '', '')
}

async function getStorageLedgerChangesByDay(
  reader: AdminStatsHourlyReader,
): Promise<Map<string, { writtenBytes: number; releasedBytes: number; exact: boolean }>> {
  const result = new Map<string, { writtenBytes: number; releasedBytes: number; exact: boolean }>()
  for (const row of await reader.rows(ADMIN_STATS_METRICS.storageLedgerChange, ['direction'])) {
    if (row.dimensionKey !== 'direction') continue
    const date = reader.dayKey(row.bucketStart)
    const values = result.get(date) ?? { writtenBytes: 0, releasedBytes: 0, exact: true }
    if (row.dimensionValue === 'written') values.writtenBytes += row.bytes
    if (row.dimensionValue === 'released') values.releasedBytes += row.bytes
    values.exact &&= !row.lowerBound
    result.set(date, values)
  }
  return result
}

function fullStorageChangeDayFrom(opening: Date | null): string | null {
  if (!opening) return null
  const exactFrom = storageUsageLedgerExactFrom(opening)
  const exactDay = dayKey(exactFrom)
  return exactFrom.getTime() === utcDateStart(exactDay).getTime() ? exactDay : addCalendarDays(exactDay, 1)
}

async function getStorageInventory(reader: AdminStatsHourlyReader): Promise<{ files: number; bytes: number } | null> {
  const rows = await reader.latestRows(ADMIN_STATS_METRICS.storageInventory)
  const row = rows.find((value) => value.orgId === '' && value.dimensionKey === '')
  return row ? { files: row.count, bytes: row.bytes } : null
}

async function getStorageTrashInventory(
  reader: AdminStatsHourlyReader,
): Promise<{ files: number; bytes: number } | null> {
  const rows = await reader.latestRows(ADMIN_STATS_METRICS.storageTrashSnapshot)
  const row = rows.find((value) => value.orgId === '' && value.dimensionKey === '')
  return row ? { files: row.count, bytes: row.bytes } : null
}

async function getStorageDataQuality(
  reader: AdminStatsHourlyReader,
): Promise<
  Pick<AdminStorageDataQuality, 'usageDriftSpaces' | 'usageDriftBytes' | 'ledgerDriftSpaces' | 'ledgerDriftBytes'>
> {
  const rows = await reader.latestRows(ADMIN_STATS_METRICS.statsDataQualitySnapshot, ['', 'kind'])
  if (!rows.some((row) => row.orgId === '' && row.dimensionKey === '')) {
    return { usageDriftSpaces: null, usageDriftBytes: null, ledgerDriftSpaces: null, ledgerDriftBytes: null }
  }
  const usageDrift = rows.find(
    (row) => row.orgId === '' && row.dimensionKey === 'kind' && row.dimensionValue === 'storage_usage_drift',
  )
  const ledgerDrift = rows.find(
    (row) => row.orgId === '' && row.dimensionKey === 'kind' && row.dimensionValue === 'storage_ledger_drift',
  )
  return {
    usageDriftSpaces: usageDrift?.count ?? 0,
    usageDriftBytes: usageDrift?.bytes ?? 0,
    ledgerDriftSpaces: ledgerDrift?.count ?? 0,
    ledgerDriftBytes: ledgerDrift?.bytes ?? 0,
  }
}

async function getLatestInventoryBreakdown(
  reader: AdminStatsHourlyReader,
  dimensionKey: 'file_type_group' | 'size_bucket' | 'age_bucket',
): Promise<Array<{ name: string; bytes: number; files: number; percent: number }>> {
  const values = new Map<string, { name: string; bytes: number; files: number }>()
  const rows = await reader.latestRows(ADMIN_STATS_METRICS.storageInventory, ['', dimensionKey])
  if (!rows.some((row) => row.orgId === '' && row.dimensionKey === '')) return []
  for (const row of rows) {
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
): Promise<{ activeShares: number | null; views: number; passwordPasses: number; downloads: number }> {
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
    if (!countValue) return []
    if (!row) {
      return {
        id,
        token: '',
        name: '已删除的分享',
        creatorId: '',
        creatorName: '已删除用户',
        views: countValue.views,
        downloads: countValue.downloads,
        status: 'deleted',
      }
    }
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
      utilization: row.quotaBytes > 0 ? percent(row.usedBytes, row.quotaBytes) : null,
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

function nullablePercent(part: number | null, total: number | null): number | null {
  return part !== null && total !== null && total > 0 ? percent(part, total) : null
}

function toNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}
