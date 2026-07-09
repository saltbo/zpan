import { isPersonalOrgLike } from '@shared/org-slugs'
import type { AdminStatsPoint } from '@shared/types'
import type { SQL } from 'drizzle-orm'
import { and, count, desc, eq, gt, gte, inArray, isNull, sql } from 'drizzle-orm'
import type { SQLiteTable } from 'drizzle-orm/sqlite-core'
import { organization, user } from '../../db/auth-schema'
import {
  activityEvents,
  backgroundJobs,
  cloudTrafficReports,
  downloaders,
  downloadTasks,
  matters,
  shares,
  siteInvitations,
  storages,
  webhookEvents,
} from '../../db/schema'
import type { Database } from '../../platform/interface'
import type { AdminCoreStatsBase, AdminDetailedStatsBase, AdminStatsRepo } from '../../usecases/ports'

const RUNNING_DOWNLOAD_STATUSES = ['queued', 'assigned', 'running', 'downloading', 'ingesting']

export function createAdminStatsRepo(db: Database): AdminStatsRepo {
  return {
    getCoreStatsBase: (now) => getCoreStatsBase(db, now),
    getDetailedStatsBase: (now, periodDays) => getDetailedStatsBase(db, now, periodDays),
  }
}

async function getCoreStatsBase(db: Database, now: Date): Promise<AdminCoreStatsBase> {
  const last7Days = daysAgo(now, 7)
  const last30Days = daysAgo(now, 30)

  const [
    users,
    admins,
    newUsers,
    activeUsers,
    orgs,
    storageBackends,
    sharing,
    pendingInvitations,
    failedBackgroundJobs,
    offlineDownloaders,
    runningDownloadTasks,
  ] = await Promise.all([
    countRows(db, user),
    countRowsWhere(db, user, eq(user.role, 'admin')),
    countRowsWhere(db, user, gte(user.createdAt, last7Days)),
    distinctCount(db, activityEvents.userId, gte(activityEvents.createdAt, last30Days)),
    listSpaces(db, last30Days),
    getStorageBackends(db),
    getSharingStats(db),
    countRowsWhere(
      db,
      siteInvitations,
      and(isNull(siteInvitations.acceptedAt), isNull(siteInvitations.revokedAt), gt(siteInvitations.expiresAt, now)),
    ),
    countRowsWhere(db, backgroundJobs, eq(backgroundJobs.status, 'failed')),
    countRowsWhere(db, downloaders, eq(downloaders.status, 'offline')),
    countRowsWhere(db, downloadTasks, inArray(downloadTasks.status, RUNNING_DOWNLOAD_STATUSES)),
  ])

  return {
    users: {
      total: users,
      admins,
      activeLast30Days: activeUsers,
      newLast7Days: newUsers,
    },
    spaces: orgs,
    storageBackends,
    sharing,
    operations: {
      pendingInvitations,
      failedBackgroundJobs,
      offlineDownloaders,
      runningDownloadTasks,
    },
  }
}

async function getDetailedStatsBase(db: Database, now: Date, periodDays: number): Promise<AdminDetailedStatsBase> {
  const start = startOfDay(daysAgo(now, periodDays - 1))
  const [
    trends,
    storageByType,
    topShares,
    sharing,
    downloadTotals,
    downloadStatus,
    failureReasons,
    byDownloader,
    jobTotals,
    jobStatus,
    jobFailures,
    cloudReports,
  ] = await Promise.all([
    buildTrends(db, start, now, periodDays),
    getStorageByType(db),
    getTopShares(db),
    getDetailedSharing(db, now),
    getDownloadTotals(db, start),
    getDownloadStatus(db, start),
    getDownloadFailureReasons(db, start),
    getDownloaderHealth(db, start),
    getBackgroundJobTotals(db, start),
    getBackgroundJobStatus(db, start),
    getBackgroundJobFailures(db, start),
    getCloudReportReliability(db),
  ])

  return {
    trends,
    storageByType,
    topShares,
    sharing,
    remoteDownloads: {
      ...downloadTotals,
      byStatus: downloadStatus,
      failureReasons,
      byDownloader,
    },
    backgroundJobs: {
      ...jobTotals,
      byStatus: jobStatus,
      failures: jobFailures,
    },
    cloudTrafficReports: cloudReports,
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

async function distinctCount(
  db: Database,
  column: typeof activityEvents.userId,
  where: ReturnType<typeof gte>,
): Promise<number> {
  const rows = await db
    .select({ value: sql<number>`COUNT(DISTINCT ${column})` })
    .from(activityEvents)
    .where(where)
  return toNumber(rows[0]?.value)
}

async function listSpaces(db: Database, last30Days: Date): Promise<AdminCoreStatsBase['spaces']> {
  const rows = await db
    .select({
      slug: organization.slug,
      metadata: organization.metadata,
      createdAt: organization.createdAt,
    })
    .from(organization)

  let personal = 0
  let team = 0
  let newLast30Days = 0
  for (const row of rows) {
    if (isPersonalOrgLike(row)) personal += 1
    else team += 1
    if (row.createdAt && row.createdAt >= last30Days) newLast30Days += 1
  }

  return { total: rows.length, personal, team, newLast30Days }
}

async function getStorageBackends(db: Database): Promise<AdminCoreStatsBase['storageBackends']> {
  const rows = await db
    .select({
      backendCount: count(),
      activeBackendCount: sql<number>`SUM(CASE WHEN ${storages.status} = 'active' THEN 1 ELSE 0 END)`,
      capacityBytes: sql<number>`COALESCE(SUM(${storages.capacity}), 0)`,
    })
    .from(storages)
  return {
    backendCount: toNumber(rows[0]?.backendCount),
    activeBackendCount: toNumber(rows[0]?.activeBackendCount),
    capacityBytes: toNumber(rows[0]?.capacityBytes),
  }
}

async function getSharingStats(db: Database): Promise<AdminCoreStatsBase['sharing']> {
  const rows = await db
    .select({
      totalShares: count(),
      activeShares: sql<number>`SUM(CASE WHEN ${shares.status} = 'active' THEN 1 ELSE 0 END)`,
      views: sql<number>`COALESCE(SUM(${shares.views}), 0)`,
      downloads: sql<number>`COALESCE(SUM(${shares.downloads}), 0)`,
    })
    .from(shares)
  return {
    totalShares: toNumber(rows[0]?.totalShares),
    activeShares: toNumber(rows[0]?.activeShares),
    views: toNumber(rows[0]?.views),
    downloads: toNumber(rows[0]?.downloads),
  }
}

async function buildTrends(db: Database, start: Date, now: Date, periodDays: number): Promise<AdminStatsPoint[]> {
  const buckets = createTrendBuckets(start, periodDays)
  const [usersRows, activityRows, shareRows, taskRows, jobRows] = await Promise.all([
    db.select({ createdAt: user.createdAt }).from(user).where(gte(user.createdAt, start)),
    db
      .select({ userId: activityEvents.userId, createdAt: activityEvents.createdAt })
      .from(activityEvents)
      .where(gte(activityEvents.createdAt, start)),
    db
      .select({ createdAt: shares.createdAt, views: shares.views, downloads: shares.downloads })
      .from(shares)
      .where(gte(shares.createdAt, start)),
    db.select({ createdAt: downloadTasks.createdAt }).from(downloadTasks).where(gte(downloadTasks.createdAt, start)),
    db
      .select({ createdAt: backgroundJobs.createdAt, status: backgroundJobs.status })
      .from(backgroundJobs)
      .where(gte(backgroundJobs.createdAt, start)),
  ])

  for (const row of usersRows) {
    const bucket = buckets.get(dayKey(row.createdAt))
    if (bucket) bucket.signups += 1
  }

  const activeUsersByDay = new Map<string, Set<string>>()
  for (const row of activityRows) {
    const key = dayKey(row.createdAt)
    if (!buckets.has(key)) continue
    const set = activeUsersByDay.get(key) ?? new Set<string>()
    set.add(row.userId)
    activeUsersByDay.set(key, set)
  }
  for (const [key, usersForDay] of activeUsersByDay.entries()) {
    const bucket = buckets.get(key)
    if (bucket) bucket.activeUsers = usersForDay.size
  }

  for (const row of shareRows) {
    const bucket = buckets.get(dayKey(row.createdAt))
    if (!bucket) continue
    bucket.shareViews += row.views
    bucket.shareDownloads += row.downloads
  }

  for (const row of taskRows) {
    const bucket = buckets.get(dayKey(row.createdAt))
    if (bucket) bucket.remoteTasks += 1
  }

  for (const row of jobRows) {
    const bucket = buckets.get(dayKey(row.createdAt))
    if (bucket && row.status === 'failed') bucket.failedJobs += 1
  }

  const todayKey = dayKey(now)
  return [...buckets.values()].filter((point) => point.date <= todayKey)
}

async function getStorageByType(db: Database): Promise<AdminDetailedStatsBase['storageByType']> {
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
    .limit(8)

  return rows.map((row) => ({ type: row.type || 'unknown', files: toNumber(row.files), bytes: toNumber(row.bytes) }))
}

async function getTopShares(db: Database): Promise<AdminDetailedStatsBase['topShares']> {
  const rows = await db
    .select({
      id: shares.id,
      token: shares.token,
      name: matters.name,
      creatorId: shares.creatorId,
      creatorName: user.name,
      views: shares.views,
      downloads: shares.downloads,
      status: shares.status,
    })
    .from(shares)
    .leftJoin(matters, eq(matters.id, shares.matterId))
    .leftJoin(user, eq(user.id, shares.creatorId))
    .orderBy(desc(sql`${shares.views} + ${shares.downloads}`))
    .limit(8)

  return rows.map((row) => ({
    id: row.id,
    token: row.token,
    name: row.name ?? row.token,
    creatorId: row.creatorId,
    creatorName: row.creatorName ?? row.creatorId,
    views: row.views,
    downloads: row.downloads,
    status: row.status,
  }))
}

async function getDetailedSharing(db: Database, now: Date): Promise<AdminDetailedStatsBase['sharing']> {
  const nowSec = unixSeconds(now)
  const rows = await db
    .select({
      expiredShares: sql<number>`SUM(CASE WHEN ${shares.expiresAt} IS NOT NULL AND ${shares.expiresAt} <= ${nowSec} THEN 1 ELSE 0 END)`,
      revokedShares: sql<number>`SUM(CASE WHEN ${shares.status} = 'revoked' THEN 1 ELSE 0 END)`,
      downloadLimitHitShares: sql<number>`SUM(CASE WHEN ${shares.downloadLimit} IS NOT NULL AND ${shares.downloads} >= ${shares.downloadLimit} THEN 1 ELSE 0 END)`,
      views: sql<number>`COALESCE(SUM(${shares.views}), 0)`,
      downloads: sql<number>`COALESCE(SUM(${shares.downloads}), 0)`,
    })
    .from(shares)
  const views = toNumber(rows[0]?.views)
  const downloads = toNumber(rows[0]?.downloads)
  return {
    expiredShares: toNumber(rows[0]?.expiredShares),
    revokedShares: toNumber(rows[0]?.revokedShares),
    downloadLimitHitShares: toNumber(rows[0]?.downloadLimitHitShares),
    conversionRate: percent(downloads, views),
  }
}

async function getDownloadTotals(
  db: Database,
  start: Date,
): Promise<
  Omit<AdminDetailedStatsBase['remoteDownloads'], 'successRate' | 'byStatus' | 'failureReasons' | 'byDownloader'>
> {
  const rows = await db
    .select({
      total: count(),
      completed: sql<number>`SUM(CASE WHEN ${downloadTasks.status} = 'completed' THEN 1 ELSE 0 END)`,
      failed: sql<number>`SUM(CASE WHEN ${downloadTasks.status} = 'failed' THEN 1 ELSE 0 END)`,
      running: sql<number>`SUM(CASE WHEN ${downloadTasks.status} IN (${RUNNING_DOWNLOAD_STATUSES[0]}, ${RUNNING_DOWNLOAD_STATUSES[1]}, ${RUNNING_DOWNLOAD_STATUSES[2]}, ${RUNNING_DOWNLOAD_STATUSES[3]}, ${RUNNING_DOWNLOAD_STATUSES[4]}) THEN 1 ELSE 0 END)`,
    })
    .from(downloadTasks)
    .where(gte(downloadTasks.createdAt, start))

  return {
    total: toNumber(rows[0]?.total),
    completed: toNumber(rows[0]?.completed),
    failed: toNumber(rows[0]?.failed),
    running: toNumber(rows[0]?.running),
  }
}

async function getDownloadStatus(
  db: Database,
  start: Date,
): Promise<AdminDetailedStatsBase['remoteDownloads']['byStatus']> {
  const rows = await db
    .select({ status: downloadTasks.status, count: count() })
    .from(downloadTasks)
    .where(gte(downloadTasks.createdAt, start))
    .groupBy(downloadTasks.status)
    .orderBy(desc(count()))
  return rows.map((row) => ({ status: row.status, count: toNumber(row.count) }))
}

async function getDownloadFailureReasons(
  db: Database,
  start: Date,
): Promise<AdminDetailedStatsBase['remoteDownloads']['failureReasons']> {
  const rows = await db
    .select({
      reason: sql<string>`COALESCE(${downloadTasks.errorCode}, ${downloadTasks.errorMessage}, 'unknown')`,
      count: count(),
    })
    .from(downloadTasks)
    .where(and(gte(downloadTasks.createdAt, start), eq(downloadTasks.status, 'failed')))
    .groupBy(sql`COALESCE(${downloadTasks.errorCode}, ${downloadTasks.errorMessage}, 'unknown')`)
    .orderBy(desc(count()))
    .limit(8)

  return rows.map((row) => ({ reason: row.reason, count: toNumber(row.count) }))
}

async function getDownloaderHealth(
  db: Database,
  start: Date,
): Promise<AdminDetailedStatsBase['remoteDownloads']['byDownloader']> {
  const rows = await db
    .select({
      downloaderId: downloaders.id,
      name: downloaders.name,
      status: downloaders.status,
      lastHeartbeatAt: downloaders.lastHeartbeatAt,
      tasks: sql<number>`COUNT(${downloadTasks.id})`,
      failedTasks: sql<number>`SUM(CASE WHEN ${downloadTasks.status} = 'failed' THEN 1 ELSE 0 END)`,
    })
    .from(downloaders)
    .leftJoin(
      downloadTasks,
      and(eq(downloadTasks.assignedDownloaderId, downloaders.id), gte(downloadTasks.createdAt, start)),
    )
    .groupBy(downloaders.id)
    .orderBy(desc(sql`COUNT(${downloadTasks.id})`))
    .limit(8)

  return rows.map((row) => ({
    downloaderId: row.downloaderId,
    name: row.name,
    status: row.status,
    tasks: toNumber(row.tasks),
    failedTasks: toNumber(row.failedTasks),
    lastHeartbeatAt: row.lastHeartbeatAt?.toISOString() ?? null,
  }))
}

async function getBackgroundJobTotals(
  db: Database,
  start: Date,
): Promise<Pick<AdminDetailedStatsBase['backgroundJobs'], 'total' | 'failed'>> {
  const rows = await db
    .select({
      total: count(),
      failed: sql<number>`SUM(CASE WHEN ${backgroundJobs.status} = 'failed' THEN 1 ELSE 0 END)`,
    })
    .from(backgroundJobs)
    .where(gte(backgroundJobs.createdAt, start))
  return { total: toNumber(rows[0]?.total), failed: toNumber(rows[0]?.failed) }
}

async function getBackgroundJobStatus(
  db: Database,
  start: Date,
): Promise<AdminDetailedStatsBase['backgroundJobs']['byStatus']> {
  const rows = await db
    .select({ status: backgroundJobs.status, count: count() })
    .from(backgroundJobs)
    .where(gte(backgroundJobs.createdAt, start))
    .groupBy(backgroundJobs.status)
    .orderBy(desc(count()))
  return rows.map((row) => ({ status: row.status, count: toNumber(row.count) }))
}

async function getBackgroundJobFailures(
  db: Database,
  start: Date,
): Promise<AdminDetailedStatsBase['backgroundJobs']['failures']> {
  const rows = await db
    .select({
      id: backgroundJobs.id,
      type: backgroundJobs.type,
      errorMessage: backgroundJobs.errorMessage,
      createdAt: backgroundJobs.createdAt,
    })
    .from(backgroundJobs)
    .where(and(gte(backgroundJobs.createdAt, start), eq(backgroundJobs.status, 'failed')))
    .orderBy(desc(backgroundJobs.createdAt))
    .limit(6)

  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString(),
  }))
}

async function getCloudReportReliability(db: Database): Promise<AdminDetailedStatsBase['cloudTrafficReports']> {
  const [trafficPending, trafficFailed, webhookPending, webhookFailed] = await Promise.all([
    countRowsWhere(db, cloudTrafficReports, eq(cloudTrafficReports.status, 'pending')),
    countRowsWhere(db, cloudTrafficReports, eq(cloudTrafficReports.status, 'failed')),
    countRowsWhere(db, webhookEvents, eq(webhookEvents.status, 'pending')),
    countRowsWhere(db, webhookEvents, eq(webhookEvents.status, 'failed')),
  ])
  return {
    pending: trafficPending + webhookPending,
    failed: trafficFailed + webhookFailed,
  }
}

function createTrendBuckets(start: Date, periodDays: number): Map<string, AdminStatsPoint> {
  const buckets = new Map<string, AdminStatsPoint>()
  for (let i = 0; i < periodDays; i += 1) {
    const date = new Date(start)
    date.setUTCDate(start.getUTCDate() + i)
    const key = dayKey(date)
    buckets.set(key, {
      date: key,
      signups: 0,
      activeUsers: 0,
      shareViews: 0,
      shareDownloads: 0,
      remoteTasks: 0,
      failedJobs: 0,
    })
  }
  return buckets
}

function daysAgo(now: Date, days: number): Date {
  const date = new Date(now)
  date.setUTCDate(date.getUTCDate() - days)
  return date
}

function startOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function unixSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000)
}

function percent(part: number, total: number): number {
  if (total <= 0) return 0
  return Math.round((part / total) * 1000) / 10
}

function toNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}
