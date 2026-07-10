import { isPersonalOrgLike } from '@shared/org-slugs'
import type {
  AdminDashboardGrowthStats,
  AdminDashboardOverviewStats,
  AdminDashboardRankingStats,
  AdminDashboardSharingStats,
  AdminDashboardStorageStats,
  AdminDashboardTrafficStats,
  AdminStatsDelta,
  AdminStorageByType,
  AdminTopShare,
} from '@shared/types'
import type { SQL } from 'drizzle-orm'
import { and, count, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm'
import type { SQLiteTable } from 'drizzle-orm/sqlite-core'
import { account, organization, session, user } from '../../db/auth-schema'
import { activityEvents, cloudTrafficReports, matters, orgQuotas, shares, statsRollupsDaily } from '../../db/schema'
import type { Database } from '../../platform/interface'
import type { AdminStatsDateRange, AdminStatsRepo } from '../../usecases/ports'

const DOWNLOAD_ACTIVITY_ACTIONS = ['share_download', 'object_download']
const AUDITED_DOWNLOAD_SOURCES = new Set(['landing_share', 'object_download'])
const STORAGE_USED_ROLLUP_METRIC = 'storage.used.bytes'
const GLOBAL_ROLLUP_ORG_ID = ''
const GLOBAL_ROLLUP_DIMENSION_KEY = ''
const GLOBAL_ROLLUP_DIMENSION_VALUE = ''

export function createAdminStatsRepo(db: Database): AdminStatsRepo {
  return {
    getDashboardOverviewStats: (now, range) => getDashboardOverviewStats(db, now, range),
    getDashboardGrowthStats: (now, range) => getDashboardGrowthStats(db, now, range),
    getDashboardStorageStats: (now, range) => getDashboardStorageStats(db, now, range),
    getDashboardTrafficStats: (now, range) => getDashboardTrafficStats(db, now, range),
    getDashboardSharingStats: (now, range) => getDashboardSharingStats(db, now, range),
    getDashboardRankingStats: (now, range) => getDashboardRankingStats(db, now, range),
  }
}

async function countRows(db: Database, table: typeof user): Promise<number> {
  const rows = await db.select({ value: count() }).from(table)
  return toNumber(rows[0]?.value)
}

async function countRowsWhere(db: Database, table: SQLiteTable, where: SQL | undefined): Promise<number> {
  const rows = await db.select({ value: count() }).from(table).where(where)
  return toNumber(rows[0]?.value)
}

async function getStorageByType(db: Database, range?: AdminStatsDateRange): Promise<AdminStorageByType[]> {
  const rows = await db
    .select({
      type: matters.type,
      files: count(),
      bytes: sql<number>`COALESCE(SUM(${matters.size}), 0)`,
    })
    .from(matters)
    .where(
      and(
        eq(matters.status, 'active'),
        eq(matters.dirtype, 0),
        range ? gte(matters.createdAt, range.from) : undefined,
        range ? lte(matters.createdAt, range.to) : undefined,
      ),
    )
    .groupBy(matters.type)
    .orderBy(desc(sql`COALESCE(SUM(${matters.size}), 0)`))
    .limit(8)

  return rows.map((row) => ({ type: row.type || 'unknown', files: toNumber(row.files), bytes: toNumber(row.bytes) }))
}

async function getDashboardOverviewStats(
  db: Database,
  now: Date,
  range: AdminStatsDateRange,
): Promise<AdminDashboardOverviewStats> {
  const previous = previousRange(range)
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
  ] = await Promise.all([
    countRows(db, user),
    countRowsWhere(db, user, and(gte(user.createdAt, range.from), lte(user.createdAt, range.to))),
    countRowsWhere(db, user, and(gte(user.createdAt, previous.from), lte(user.createdAt, previous.to))),
    countActiveUsers(db, range),
    countActiveUsers(db, previous),
    getQuotaTotals(db),
    getTrafficTotals(db, range),
    getTrafficTotals(db, previous),
    getSharingEventTotals(db, range),
  ])
  const [trendNewUsers, activeByDay, storageUsedByDay, uploadByDay, downloadByDay] = await Promise.all([
    getNewUsersByDay(db, range),
    getActiveUsersByDay(db, range),
    getStorageUsedByDay(db, range),
    getActivityBytesByDay(db, range, ['upload_confirm']),
    getDownloadBytesByDay(db, range),
  ])
  const trends = createDateBuckets(range).map((date) => {
    return {
      date,
      newUsers: trendNewUsers.get(date) ?? 0,
      activeUsers: activeByDay.get(date)?.size ?? 0,
      storageUsedBytes: storageUsedByDay.get(date) ?? 0,
      uploadBytes: uploadByDay.get(date) ?? 0,
      downloadBytes: downloadByDay.get(date) ?? 0,
    }
  })

  return {
    ...statsFrame(now, range),
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
      shareViews: delta(sharing.views, (await getSharingEventTotals(db, previous)).views),
      shareDownloads: delta(sharing.downloads, (await getSharingEventTotals(db, previous)).downloads),
    },
    trends,
  }
}

async function getDashboardGrowthStats(
  db: Database,
  now: Date,
  range: AdminStatsDateRange,
): Promise<AdminDashboardGrowthStats> {
  const previous = previousRange(range)
  const [usersRows, newUsers, previousNewUsers, activeUsers, previousActiveUsers, activeByDay, registrationSources] =
    await Promise.all([
      db
        .select({ id: user.id, emailVerified: user.emailVerified, banned: user.banned, createdAt: user.createdAt })
        .from(user),
      countRowsWhere(db, user, and(gte(user.createdAt, range.from), lte(user.createdAt, range.to))),
      countRowsWhere(db, user, and(gte(user.createdAt, previous.from), lte(user.createdAt, previous.to))),
      countActiveUsers(db, range),
      countActiveUsers(db, previous),
      getRollingActiveUserTrend(db, range),
      getRegistrationSources(db, range),
    ])
  const activeLast30 = await activeUserIds(db, { from: daysAgo(now, 30), to: now })
  const totalUsers = usersRows.length
  const verifiedUsers = usersRows.filter((row) => row.emailVerified).length
  const bannedUsers = usersRows.filter((row) => row.banned).length
  const unverifiedUsers = usersRows.filter((row) => !row.emailVerified && !row.banned).length
  const silentUsers = usersRows.filter((row) => row.emailVerified && !row.banned && !activeLast30.has(row.id)).length
  const normalUsers = Math.max(0, totalUsers - unverifiedUsers - bannedUsers - silentUsers)
  const newUsersByDay = await getNewUsersByDay(db, range)
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
  const [quotas, files, storageUsedByDay, typeBreakdown] = await Promise.all([
    getQuotaTotals(db),
    db
      .select({ id: matters.id, type: matters.type, size: matters.size, createdAt: matters.createdAt })
      .from(matters)
      .where(and(eq(matters.status, 'active'), eq(matters.dirtype, 0))),
    getStorageUsedByDay(db, range),
    getStorageByType(db, range),
  ])
  const fileItems = files.map((row) => ({ bytes: row.size ?? 0, createdAt: row.createdAt }))
  const rangeFileItems = fileItems.filter((row) => row.createdAt >= range.from && row.createdAt <= range.to)
  const previousFileItems = fileItems.filter((row) => row.createdAt >= previous.from && row.createdAt <= previous.to)
  const newFiles = rangeFileItems.length
  const previousNewFiles = previousFileItems.length
  const uploadBytes = sumRows(rangeFileItems, (row) => row.bytes)
  const previousUploadBytes = sumRows(previousFileItems, (row) => row.bytes)
  const matterCreatesByDay = matterCreateStatsByDay(rangeFileItems)
  const storageTrend = createDateBuckets(range).map((date) => {
    const created = matterCreatesByDay.get(date)
    return {
      date,
      usedBytes: storageUsedByDay.get(date) ?? 0,
      newBytes: created?.bytes ?? 0,
      newFiles: created?.files ?? 0,
    }
  })
  const coldCutoff = daysAgo(now, 90)
  const coldFileBytes = fileItems.filter((row) => row.createdAt < coldCutoff).reduce((sum, row) => sum + row.bytes, 0)

  return {
    ...statsFrame(now, range),
    summary: {
      storageUsedBytes: quotas.usedBytes,
      quotaBytes: quotas.quotaBytes,
      fileCount: files.length,
      newFiles: delta(newFiles, previousNewFiles),
      newBytes: delta(uploadBytes, previousUploadBytes),
      coldFileBytes,
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
  }
}

async function getDashboardTrafficStats(
  db: Database,
  now: Date,
  range: AdminStatsDateRange,
): Promise<AdminDashboardTrafficStats> {
  const previous = previousRange(range)
  const [
    traffic,
    previousTraffic,
    uploadByDay,
    downloadByDay,
    uploadRequestsByDay,
    downloadRequestsByDay,
    cloudRows,
    downloadRows,
  ] = await Promise.all([
    getTrafficTotals(db, range),
    getTrafficTotals(db, previous),
    getActivityBytesByDay(db, range, ['upload_confirm']),
    getDownloadBytesByDay(db, range),
    getActivityCountByDay(db, range, ['upload_confirm']),
    getDownloadRequestsByDay(db, range),
    getCloudTrafficRows(db, range),
    getDownloadIssueRows(db, range),
  ])
  const sourceRows = new Map<string, { name: string; bytes: number; requests: number }>()
  if (traffic.uploadBytes > 0 || traffic.uploadRequests > 0) {
    sourceRows.set('upload', { name: 'upload', bytes: traffic.uploadBytes, requests: traffic.uploadRequests })
  }
  for (const row of downloadRows) {
    const item = sourceRows.get(row.source) ?? { name: row.source, bytes: 0, requests: 0 }
    item.bytes += row.bytes
    item.requests += 1
    sourceRows.set(row.source, item)
  }
  for (const row of cloudRows) {
    if (isAuditedDownloadSource(row.source) || row.status === 'blocked') continue
    const item = sourceRows.get(row.source) ?? { name: row.source, bytes: 0, requests: 0 }
    item.bytes += row.bytes
    item.requests += 1
    sourceRows.set(row.source, item)
  }
  const statusRows = countBy(cloudRows, (row) => row.status)
  const downloadSuccessByDay = new Map<string, number>()
  const downloadFailuresByDay = new Map<string, number>()
  const failureReasonRows = new Map<string, { name: string; value: number }>()
  for (const row of downloadRows) incrementMap(downloadSuccessByDay, dayKey(row.createdAt), 1)
  for (const row of cloudRows) {
    const date = dayKey(row.createdAt)
    if (row.status === 'blocked') {
      incrementMap(downloadFailuresByDay, date, 1)
      const name = row.source || 'blocked'
      const item = failureReasonRows.get(name) ?? { name, value: 0 }
      item.value += 1
      failureReasonRows.set(name, item)
      continue
    }
    if (isAuditedDownloadSource(row.source)) continue
    incrementMap(downloadSuccessByDay, date, 1)
  }
  const trafficTrend = createDateBuckets(range).map((date) => ({
    date,
    uploadBytes: uploadByDay.get(date) ?? 0,
    downloadBytes: downloadByDay.get(date) ?? 0,
    requests: (uploadRequestsByDay.get(date) ?? 0) + (downloadRequestsByDay.get(date) ?? 0),
  }))
  const successTrend = createDateBuckets(range).map((date) => {
    const downloadSuccesses = downloadSuccessByDay.get(date) ?? 0
    const downloadFailures = downloadFailuresByDay.get(date) ?? 0
    const downloadRequests = downloadSuccesses + downloadFailures
    return {
      date,
      uploadSuccessRate: 100,
      downloadSuccessRate: downloadRequests > 0 ? percent(downloadSuccesses, downloadRequests) : 100,
    }
  })
  const totalRequests = traffic.uploadRequests + traffic.downloadRequests
  const blockedDownloads = cloudRows.filter((row) => row.status === 'blocked').length
  const issuedDownloads = Math.max(0, traffic.downloadRequests - blockedDownloads)

  return {
    ...statsFrame(now, range),
    summary: {
      totalBytes: delta(
        traffic.uploadBytes + traffic.downloadBytes,
        previousTraffic.uploadBytes + previousTraffic.downloadBytes,
      ),
      requestCount: delta(totalRequests, previousTraffic.uploadRequests + previousTraffic.downloadRequests),
      issuedDownloads,
      blockedDownloads,
      issueRate: percent(issuedDownloads, issuedDownloads + blockedDownloads),
      peakDailyBytes: Math.max(0, ...trafficTrend.map((row) => row.uploadBytes + row.downloadBytes)),
    },
    trafficTrend,
    sourceBreakdown: percentRows([...sourceRows.values()], (row) => row.bytes),
    issueStatus: percentRows(
      [...statusRows.entries()].map(([status, countValue]) => ({ status, name: status, value: countValue })),
    ).map(({ name, value, percent: pct }) => ({ status: name, count: value, percent: pct })),
    bandwidthTrend: trafficTrend.map((row) => ({ date: row.date, bytes: row.uploadBytes + row.downloadBytes })),
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
  const [sharing, previousSharing, shareRows, saveCount, previousSaveCount] = await Promise.all([
    getSharingEventTotals(db, range),
    getSharingEventTotals(db, previous),
    db.select({ kind: shares.kind, status: shares.status, createdAt: shares.createdAt }).from(shares),
    countActivityEvents(db, range, ['save_from_share']),
    countActivityEvents(db, previous, ['save_from_share']),
  ])
  const [viewsByDay, downloadsByDay, savesByDay] = await Promise.all([
    getActivityCountByDay(db, range, ['share_view']),
    getActivityCountByDay(db, range, ['share_download']),
    getActivityCountByDay(db, range, ['save_from_share']),
  ])
  const trend = createDateBuckets(range).map((date) => ({
    date,
    views: viewsByDay.get(date) ?? 0,
    downloads: downloadsByDay.get(date) ?? 0,
    saves: savesByDay.get(date) ?? 0,
  }))
  const createdInRange = shareRows.filter((row) => row.createdAt >= range.from && row.createdAt <= range.to).length
  const createdPrevious = shareRows.filter(
    (row) => row.createdAt >= previous.from && row.createdAt <= previous.to,
  ).length
  const activeShares = shareRows.filter((row) => row.status === 'active').length
  const typeCounts = countBy(
    shareRows.filter((row) => row.createdAt >= range.from && row.createdAt <= range.to),
    (row) => row.kind,
  )
  const topShares = await getTopSharesWithPercent(db, range, {
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
      downloadConversionRate: percent(sharing.downloads, sharing.views),
    },
    funnel: percentRows([
      { name: 'views', value: sharing.views },
      { name: 'password_passed', value: sharing.passwordPasses },
      { name: 'downloads', value: sharing.downloads },
      { name: 'saved_to_drive', value: saveCount },
    ]),
    trend,
    typeBreakdown: percentRows([...typeCounts.entries()].map(([name, value]) => ({ name, value }))),
    sourceBreakdown: percentRows([
      { name: 'landing_share', value: sharing.downloads },
      { name: 'save_to_drive', value: saveCount },
    ]),
    topShares,
  }
}

async function getDashboardRankingStats(
  db: Database,
  now: Date,
  range: AdminStatsDateRange,
): Promise<AdminDashboardRankingStats> {
  const [topShares, topSpaces, storageByType] = await Promise.all([
    getTopSharesWithPercent(db, range),
    getUsageBySpaceRows(db, range),
    getStorageByType(db, range),
  ])
  return {
    ...statsFrame(now, range),
    topShares,
    topSpaces,
    storageByType,
  }
}

function statsFrame(now: Date, range: AdminStatsDateRange) {
  return { generatedAt: now.toISOString(), from: range.from.toISOString(), to: range.to.toISOString() }
}

function previousRange(range: AdminStatsDateRange): AdminStatsDateRange {
  const durationMs = Math.max(0, range.to.getTime() - range.from.getTime())
  const to = new Date(range.from.getTime() - 1)
  return { from: new Date(to.getTime() - durationMs), to }
}

function delta(value: number, previousValue: number): AdminStatsDelta {
  return { value, previousValue, changePercent: percent(value - previousValue, previousValue) }
}

function createDateBuckets(range: AdminStatsDateRange): string[] {
  const start = startOfDay(range.from)
  const end = startOfDay(range.to)
  const dates: string[] = []
  for (const date = new Date(start); date <= end; date.setUTCDate(date.getUTCDate() + 1)) {
    dates.push(dayKey(date))
  }
  return dates
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
      .where(and(gte(activityEvents.createdAt, range.from), lte(activityEvents.createdAt, range.to))),
    db
      .select({ userId: session.userId })
      .from(session)
      .where(and(gte(session.updatedAt, range.from), lte(session.updatedAt, range.to))),
  ])
  const ids = new Set<string>()
  for (const row of activityRows) if (row.userId) ids.add(row.userId)
  for (const row of sessionRows) ids.add(row.userId)
  return ids
}

async function getNewUsersByDay(db: Database, range: AdminStatsDateRange): Promise<Map<string, number>> {
  const rows = await db
    .select({ createdAt: user.createdAt })
    .from(user)
    .where(and(gte(user.createdAt, range.from), lte(user.createdAt, range.to)))
  const byDay = new Map<string, number>()
  for (const row of rows) incrementMap(byDay, dayKey(row.createdAt), 1)
  return byDay
}

async function getActiveUsersByDay(db: Database, range: AdminStatsDateRange): Promise<Map<string, Set<string>>> {
  const [activityRows, sessionRows] = await Promise.all([
    db
      .select({ userId: activityEvents.userId, createdAt: activityEvents.createdAt })
      .from(activityEvents)
      .where(and(gte(activityEvents.createdAt, range.from), lte(activityEvents.createdAt, range.to))),
    db
      .select({ userId: session.userId, updatedAt: session.updatedAt })
      .from(session)
      .where(and(gte(session.updatedAt, range.from), lte(session.updatedAt, range.to))),
  ])
  const byDay = new Map<string, Set<string>>()
  for (const row of activityRows) {
    if (row.userId) addSetMap(byDay, dayKey(row.createdAt), row.userId)
  }
  for (const row of sessionRows) addSetMap(byDay, dayKey(row.updatedAt), row.userId)
  return byDay
}

async function getRollingActiveUserTrend(
  db: Database,
  range: AdminStatsDateRange,
): Promise<Array<{ date: string; dau: number; wau: number; mau: number }>> {
  const extendedRange = { from: daysAgo(range.from, 29), to: range.to }
  const [activityRows, sessionRows] = await Promise.all([
    db
      .select({ userId: activityEvents.userId, createdAt: activityEvents.createdAt })
      .from(activityEvents)
      .where(and(gte(activityEvents.createdAt, extendedRange.from), lte(activityEvents.createdAt, extendedRange.to))),
    db
      .select({ userId: session.userId, updatedAt: session.updatedAt })
      .from(session)
      .where(and(gte(session.updatedAt, extendedRange.from), lte(session.updatedAt, extendedRange.to))),
  ])
  const records: Array<{ userId: string; at: Date }> = []
  for (const row of activityRows) if (row.userId) records.push({ userId: row.userId, at: row.createdAt })
  for (const row of sessionRows) records.push({ userId: row.userId, at: row.updatedAt })
  return createDateBuckets(range).map((dateKeyValue) => {
    const dayEnd = new Date(`${dateKeyValue}T23:59:59.999Z`)
    const dauStart = new Date(`${dateKeyValue}T00:00:00.000Z`)
    const wauStart = daysAgo(dayEnd, 6)
    const mauStart = daysAgo(dayEnd, 29)
    return {
      date: dateKeyValue,
      dau: distinctUsersInWindow(records, dauStart, dayEnd),
      wau: distinctUsersInWindow(records, wauStart, dayEnd),
      mau: distinctUsersInWindow(records, mauStart, dayEnd),
    }
  })
}

async function getRegistrationSources(
  db: Database,
  range: AdminStatsDateRange,
): Promise<Array<{ name: string; value: number; percent: number }>> {
  const newUsers = await db
    .select({ id: user.id })
    .from(user)
    .where(and(gte(user.createdAt, range.from), lte(user.createdAt, range.to)))
  if (newUsers.length === 0) return []
  const userIds = newUsers.map((row) => row.id)
  const accounts = await db
    .select({ userId: account.userId, providerId: account.providerId })
    .from(account)
    .where(inArray(account.userId, userIds))
  const seen = new Set<string>()
  const counts = new Map<string, number>()
  for (const row of accounts) {
    if (seen.has(row.userId)) continue
    seen.add(row.userId)
    incrementMap(counts, row.providerId || 'unknown', 1)
  }
  const direct = userIds.length - seen.size
  if (direct > 0) counts.set('direct', direct)
  return percentRows([...counts.entries()].map(([name, value]) => ({ name, value })))
}

async function getActivityBytesTotal(db: Database, range: AdminStatsDateRange, actions: string[]): Promise<number> {
  const rows = await getActivityMetadataRows(db, range, actions)
  return rows.reduce((sum, row) => sum + metadataNumber(row.metadata, 'bytes'), 0)
}

async function getActivityBytesByDay(
  db: Database,
  range: AdminStatsDateRange,
  actions: string[],
): Promise<Map<string, number>> {
  const rows = await getActivityMetadataRows(db, range, actions)
  const byDay = new Map<string, number>()
  for (const row of rows) incrementMap(byDay, dayKey(row.createdAt), metadataNumber(row.metadata, 'bytes'))
  return byDay
}

async function getActivityCountByDay(
  db: Database,
  range: AdminStatsDateRange,
  actions: string[],
): Promise<Map<string, number>> {
  const rows = await getActivityMetadataRows(db, range, actions)
  const byDay = new Map<string, number>()
  for (const row of rows) incrementMap(byDay, dayKey(row.createdAt), 1)
  return byDay
}

async function countActivityEvents(db: Database, range: AdminStatsDateRange, actions: string[]): Promise<number> {
  if (actions.length === 0) return 0
  return countRowsWhere(
    db,
    activityEvents,
    and(
      inArray(activityEvents.action, actions),
      gte(activityEvents.createdAt, range.from),
      lte(activityEvents.createdAt, range.to),
    ),
  )
}

async function getActivityMetadataRows(db: Database, range: AdminStatsDateRange, actions: string[]) {
  if (actions.length === 0) return []
  return db
    .select({ action: activityEvents.action, metadata: activityEvents.metadata, createdAt: activityEvents.createdAt })
    .from(activityEvents)
    .where(
      and(
        inArray(activityEvents.action, actions),
        gte(activityEvents.createdAt, range.from),
        lte(activityEvents.createdAt, range.to),
      ),
    )
}

async function getStorageUsedByDay(db: Database, range: AdminStatsDateRange): Promise<Map<string, number>> {
  const buckets = createDateBuckets(range)
  if (buckets.length === 0) return new Map()

  const firstBucketStart = dateKeyStart(buckets[0])
  const lastBucketStart = dateKeyStart(buckets[buckets.length - 1])
  const rows = await db
    .select({
      bucketStart: statsRollupsDaily.bucketStart,
      bytes: statsRollupsDaily.bytes,
    })
    .from(statsRollupsDaily)
    .where(
      and(
        eq(statsRollupsDaily.metricKey, STORAGE_USED_ROLLUP_METRIC),
        eq(statsRollupsDaily.orgId, GLOBAL_ROLLUP_ORG_ID),
        eq(statsRollupsDaily.dimensionKey, GLOBAL_ROLLUP_DIMENSION_KEY),
        eq(statsRollupsDaily.dimensionValue, GLOBAL_ROLLUP_DIMENSION_VALUE),
        gte(statsRollupsDaily.bucketStart, firstBucketStart),
        lte(statsRollupsDaily.bucketStart, lastBucketStart),
      ),
    )

  const byDay = new Map(rows.map((row) => [dayKey(row.bucketStart), toNumber(row.bytes)]))
  const missingBuckets = buckets.filter((date) => !byDay.has(date))
  if (missingBuckets.length === 0) return byDay

  const computed = await computeStorageUsedByDayFromCurrentFiles(db, missingBuckets)
  for (const date of missingBuckets) byDay.set(date, computed.get(date) ?? 0)

  return byDay
}

async function computeStorageUsedByDayFromCurrentFiles(db: Database, buckets: string[]): Promise<Map<string, number>> {
  const sortedBuckets = [...buckets].sort()
  const lastDayEnd = endOfDateKey(sortedBuckets[sortedBuckets.length - 1])
  const files = await db
    .select({ size: matters.size, createdAt: matters.createdAt })
    .from(matters)
    .where(and(eq(matters.status, 'active'), eq(matters.dirtype, 0), lte(matters.createdAt, lastDayEnd)))
  const sortedFiles = files
    .map((row) => ({ bytes: row.size ?? 0, createdAt: row.createdAt }))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  const byDay = new Map<string, number>()
  let cursor = 0
  let runningBytes = 0
  for (const date of sortedBuckets) {
    const dayEnd = endOfDateKey(date)
    while (cursor < sortedFiles.length && sortedFiles[cursor].createdAt <= dayEnd) {
      runningBytes += sortedFiles[cursor].bytes
      cursor += 1
    }
    byDay.set(date, runningBytes)
  }
  return byDay
}

async function getCloudTrafficRows(db: Database, range: AdminStatsDateRange) {
  return db
    .select({
      source: cloudTrafficReports.source,
      bytes: cloudTrafficReports.bytes,
      status: cloudTrafficReports.status,
      createdAt: cloudTrafficReports.createdAt,
    })
    .from(cloudTrafficReports)
    .where(and(gte(cloudTrafficReports.createdAt, range.from), lte(cloudTrafficReports.createdAt, range.to)))
}

async function getDownloadIssueRows(
  db: Database,
  range: AdminStatsDateRange,
): Promise<Array<{ source: string; bytes: number; createdAt: Date }>> {
  const rows = await getActivityMetadataRows(db, range, DOWNLOAD_ACTIVITY_ACTIONS)
  return rows.map((row) => {
    const metadata = parseMetadata(row.metadata)
    return {
      source:
        typeof metadata.source === 'string'
          ? metadata.source
          : row.action === 'object_download'
            ? 'object_download'
            : 'landing_share',
      bytes: toNumber(metadata.bytes),
      createdAt: row.createdAt,
    }
  })
}

async function getDownloadBytesByDay(db: Database, range: AdminStatsDateRange): Promise<Map<string, number>> {
  const [activityRows, cloudRows] = await Promise.all([getDownloadIssueRows(db, range), getCloudTrafficRows(db, range)])
  const byDay = new Map<string, number>()
  for (const row of activityRows) incrementMap(byDay, dayKey(row.createdAt), row.bytes)
  for (const row of cloudRows) {
    if (isAuditedDownloadSource(row.source) || row.status === 'blocked') continue
    incrementMap(byDay, dayKey(row.createdAt), row.bytes)
  }
  return byDay
}

async function getDownloadRequestsByDay(db: Database, range: AdminStatsDateRange): Promise<Map<string, number>> {
  const [activityRows, cloudRows] = await Promise.all([getDownloadIssueRows(db, range), getCloudTrafficRows(db, range)])
  const byDay = new Map<string, number>()
  for (const row of activityRows) incrementMap(byDay, dayKey(row.createdAt), 1)
  for (const row of cloudRows) {
    if (isAuditedDownloadSource(row.source) && row.status !== 'blocked') continue
    incrementMap(byDay, dayKey(row.createdAt), 1)
  }
  return byDay
}

async function getTrafficTotals(
  db: Database,
  range: AdminStatsDateRange,
): Promise<{ uploadBytes: number; uploadRequests: number; downloadBytes: number; downloadRequests: number }> {
  const [uploadBytes, uploadRequests, activityDownloadRows, cloudRows] = await Promise.all([
    getActivityBytesTotal(db, range, ['upload_confirm']),
    countActivityEvents(db, range, ['upload_confirm']),
    getDownloadIssueRows(db, range),
    getCloudTrafficRows(db, range),
  ])
  const cloudDownloadRows = cloudRows.filter((row) => !isAuditedDownloadSource(row.source) && row.status !== 'blocked')
  const blockedDownloadRows = cloudRows.filter((row) => row.status === 'blocked')
  return {
    uploadBytes,
    uploadRequests,
    downloadBytes:
      activityDownloadRows.reduce((sum, row) => sum + row.bytes, 0) +
      cloudDownloadRows.reduce((sum, row) => sum + row.bytes, 0),
    downloadRequests: activityDownloadRows.length + cloudDownloadRows.length + blockedDownloadRows.length,
  }
}

function isAuditedDownloadSource(source: string): boolean {
  return AUDITED_DOWNLOAD_SOURCES.has(source)
}

async function getSharingEventTotals(
  db: Database,
  range: AdminStatsDateRange,
): Promise<{ activeShares: number; views: number; passwordPasses: number; downloads: number }> {
  const [activeShares, views, passwordPasses, downloads] = await Promise.all([
    countRowsWhere(db, shares, eq(shares.status, 'active')),
    countActivityEvents(db, range, ['share_view']),
    countActivityEvents(db, range, ['share_password_passed']),
    countActivityEvents(db, range, ['share_download']),
  ])
  return { activeShares, views, passwordPasses, downloads }
}

async function getTopSharesWithPercent(
  db: Database,
  range: AdminStatsDateRange,
  totals?: { totalViews: number; totalDownloads: number },
): Promise<Array<AdminTopShare & { viewPercent: number; downloadPercent: number }>> {
  const rows = await getTopSharesByActivity(db, range)
  const totalViews = totals?.totalViews ?? rows.reduce((sum, row) => sum + row.views, 0)
  const totalDownloads = totals?.totalDownloads ?? rows.reduce((sum, row) => sum + row.downloads, 0)
  return rows.map((row) => ({
    ...row,
    viewPercent: percent(row.views, totalViews),
    downloadPercent: percent(row.downloads, totalDownloads),
  }))
}

async function getTopSharesByActivity(db: Database, range: AdminStatsDateRange): Promise<AdminTopShare[]> {
  const activityRows = await db
    .select({ targetId: activityEvents.targetId, action: activityEvents.action })
    .from(activityEvents)
    .where(
      and(
        inArray(activityEvents.action, ['share_view', 'share_download']),
        gte(activityEvents.createdAt, range.from),
        lte(activityEvents.createdAt, range.to),
      ),
    )
  const counts = new Map<string, { views: number; downloads: number }>()
  for (const row of activityRows) {
    if (!row.targetId) continue
    const item = counts.get(row.targetId) ?? { views: 0, downloads: 0 }
    if (row.action === 'share_view') item.views += 1
    if (row.action === 'share_download') item.downloads += 1
    counts.set(row.targetId, item)
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

async function getUsageBySpaceRows(
  db: Database,
  range?: AdminStatsDateRange,
): Promise<AdminDashboardRankingStats['topSpaces']> {
  if (range) return getUsageBySpaceRowsForRange(db, range)
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
    .limit(8)
  return rows.map((row) => ({
    orgId: row.orgId,
    orgName: row.orgName ?? row.orgId,
    orgType: isPersonalOrgLike({ slug: row.slug ?? '', metadata: row.metadata ?? null }) ? 'personal' : 'team',
    usedBytes: row.usedBytes,
    quotaBytes: row.quotaBytes,
    utilization: percent(row.usedBytes, row.quotaBytes),
  }))
}

async function getUsageBySpaceRowsForRange(
  db: Database,
  range: AdminStatsDateRange,
): Promise<AdminDashboardRankingStats['topSpaces']> {
  const rows = await db
    .select({
      orgId: matters.orgId,
      usedBytes: sql<number>`COALESCE(SUM(${matters.size}), 0)`,
      quotaBytes: orgQuotas.quota,
      orgName: organization.name,
      slug: organization.slug,
      metadata: organization.metadata,
    })
    .from(matters)
    .leftJoin(orgQuotas, eq(orgQuotas.orgId, matters.orgId))
    .leftJoin(organization, eq(organization.id, matters.orgId))
    .where(
      and(
        eq(matters.status, 'active'),
        eq(matters.dirtype, 0),
        gte(matters.createdAt, range.from),
        lte(matters.createdAt, range.to),
      ),
    )
    .groupBy(matters.orgId, orgQuotas.quota, organization.name, organization.slug, organization.metadata)
    .orderBy(desc(sql`COALESCE(SUM(${matters.size}), 0)`))
    .limit(8)

  return rows.map((row) => {
    const usedBytes = toNumber(row.usedBytes)
    const quotaBytes = toNumber(row.quotaBytes)
    return {
      orgId: row.orgId,
      orgName: row.orgName ?? row.orgId,
      orgType: isPersonalOrgLike({ slug: row.slug ?? '', metadata: row.metadata ?? null }) ? 'personal' : 'team',
      usedBytes,
      quotaBytes,
      utilization: percent(usedBytes, quotaBytes),
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

function metadataNumber(metadata: string | null, key: string): number {
  const parsed = parseMetadata(metadata)
  return toNumber(parsed[key])
}

function parseMetadata(metadata: string | null): Record<string, unknown> {
  if (!metadata) return {}
  try {
    const parsed = JSON.parse(metadata)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function incrementMap(map: Map<string, number>, key: string, value: number): void {
  map.set(key, (map.get(key) ?? 0) + value)
}

function addSetMap(map: Map<string, Set<string>>, key: string, value: string): void {
  const set = map.get(key) ?? new Set<string>()
  set.add(value)
  map.set(key, set)
}

function matterCreateStatsByDay(
  files: Array<{ bytes: number; createdAt: Date }>,
): Map<string, { bytes: number; files: number }> {
  const byDay = new Map<string, { bytes: number; files: number }>()
  for (const file of files) {
    const key = dayKey(file.createdAt)
    const item = byDay.get(key) ?? { bytes: 0, files: 0 }
    item.bytes += file.bytes
    item.files += 1
    byDay.set(key, item)
  }
  return byDay
}

function sumRows<T>(rows: T[], getValue: (row: T) => number): number {
  return rows.reduce((sum, row) => sum + getValue(row), 0)
}

function countBy<T>(rows: T[], getKey: (row: T) => string): Map<string, number> {
  const map = new Map<string, number>()
  for (const row of rows) incrementMap(map, getKey(row), 1)
  return map
}

function distinctUsersInWindow(records: Array<{ userId: string; at: Date }>, from: Date, to: Date): number {
  const ids = new Set<string>()
  for (const record of records) {
    if (record.at >= from && record.at <= to) ids.add(record.userId)
  }
  return ids.size
}

function daysAgo(now: Date, days: number): Date {
  const date = new Date(now)
  date.setUTCDate(date.getUTCDate() - days)
  return date
}

function startOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

function endOfDateKey(date: string): Date {
  return new Date(`${date}T23:59:59.999Z`)
}

function dateKeyStart(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`)
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function percent(part: number, total: number): number {
  if (total <= 0) return 0
  return Math.round((part / total) * 1000) / 10
}

function toNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}
