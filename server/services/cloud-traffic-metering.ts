import { asc, eq, inArray } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import { cloudTrafficReports } from '../db/schema'
import { loadActiveLicenseBinding } from '../licensing/license-state'
import type { Database, Platform } from '../platform/interface'
import { currentTrafficPeriod } from './effective-quota'
import { postBoundCloudJson } from './licensing-cloud'

export type TrafficReportSource =
  | 'object_download'
  | 'direct_share'
  | 'landing_share'
  | 'image_hosting'
  | 'custom_domain_image'

export class CloudTrafficBlockedError extends Error {
  constructor() {
    super('cloud_traffic_blocked')
    this.name = 'CloudTrafficBlockedError'
  }
}

const usageResponseSchema = z.object({
  accepted: z.boolean(),
  duplicate: z.boolean(),
  eventId: z.string().min(1),
})

type ReportStatus = 'pending' | 'reported' | 'skipped_unbound' | 'blocked' | 'failed'
type TrafficReport = typeof cloudTrafficReports.$inferSelect

export async function reportTrafficEgress(params: {
  platform: Platform
  orgId: string
  bytes: number
  source: TrafficReportSource
  sourceId: string
  eventId?: string
  now?: Date
}): Promise<{ status: ReportStatus; eventId: string; duplicate: boolean }> {
  const { platform, orgId, bytes, source, sourceId, now = new Date() } = params
  if (bytes <= 0) return { status: 'reported', eventId: params.eventId ?? '', duplicate: false }

  const eventId = params.eventId ?? `traffic_${nanoid()}`
  const existing = await loadTrafficReport(platform.db, eventId)
  const period = existing?.period ?? currentTrafficPeriod(now)
  if (existing) {
    assertSameReport(existing, { orgId, period, source, sourceId, bytes })
    if (existing.status !== 'blocked') {
      return { status: existing.status as ReportStatus, eventId, duplicate: true }
    }
    if (existing.status === 'blocked') throw new CloudTrafficBlockedError()
  } else {
    await insertTrafficReport(platform, { orgId, period, source, sourceId, eventId, bytes, status: 'pending', now })
  }

  const binding = await loadActiveLicenseBinding(platform.db)
  if (!binding?.refreshToken) {
    await updateTrafficReport(platform.db, eventId, 'skipped_unbound', null, now)
    return { status: 'skipped_unbound', eventId, duplicate: false }
  }

  return { status: 'pending', eventId, duplicate: false }
}

export async function syncPendingCloudTrafficReports(params: {
  db: Database
  cloudBaseUrl: string
  limit?: number
  now?: Date
}): Promise<{ attempted: number; reported: number; blocked: number; failed: number }> {
  const { db, cloudBaseUrl, limit = 100, now = new Date() } = params
  const binding = await loadActiveLicenseBinding(db)
  if (!binding?.refreshToken || !binding.cloudStoreId) return { attempted: 0, reported: 0, blocked: 0, failed: 0 }

  const reports = await db
    .select()
    .from(cloudTrafficReports)
    .where(inArray(cloudTrafficReports.status, ['pending', 'failed']))
    .orderBy(asc(cloudTrafficReports.createdAt))
    .limit(limit)

  const result = { attempted: reports.length, reported: 0, blocked: 0, failed: 0 }
  for (const report of reports) {
    const status = await syncTrafficReport({
      db,
      cloudBaseUrl,
      refreshToken: binding.refreshToken,
      storeId: binding.cloudStoreId,
      report,
      now,
    })
    result[status] += 1
  }
  return result
}

async function syncTrafficReport(params: {
  db: Database
  cloudBaseUrl: string
  refreshToken: string
  storeId: string
  report: TrafficReport
  now: Date
}): Promise<'reported' | 'blocked' | 'failed'> {
  const { db, cloudBaseUrl, refreshToken, storeId, report, now } = params
  try {
    const data = await postBoundCloudJson(
      cloudBaseUrl,
      `/api/stores/${encodeURIComponent(storeId)}/usage-events`,
      refreshToken,
      {
        resource: 'traffic_egress',
        bytes: report.bytes,
        eventId: report.eventId,
        idempotencyKey: report.eventId,
        customerId: report.orgId,
      },
    )
    const response = usageResponseSchema.parse(data)
    if (!response.accepted || response.eventId !== report.eventId) throw new Error('cloud_usage_report_rejected')
    await updateTrafficReport(db, report.eventId, 'reported', null, now)
    return 'reported'
  } catch (error) {
    const message = error instanceof Error ? error.message : 'cloud_usage_report_failed'
    if (message === 'overage_cap_exceeded') {
      await updateTrafficReport(db, report.eventId, 'blocked', message, now)
      return 'blocked'
    }
    await updateTrafficReport(db, report.eventId, 'failed', message, now)
    return 'failed'
  }
}

async function loadTrafficReport(db: Database, eventId: string) {
  const rows = await db.select().from(cloudTrafficReports).where(eq(cloudTrafficReports.eventId, eventId)).limit(1)
  return rows[0]
}

function assertSameReport(
  report: TrafficReport,
  params: { orgId: string; period: string; source: TrafficReportSource; sourceId: string; bytes: number },
) {
  if (
    report.orgId !== params.orgId ||
    report.period !== params.period ||
    report.source !== params.source ||
    report.sourceId !== params.sourceId ||
    report.bytes !== params.bytes
  ) {
    throw new Error('traffic_report_idempotency_conflict')
  }
}

async function insertTrafficReport(
  platform: Platform,
  params: {
    orgId: string
    period: string
    source: TrafficReportSource
    sourceId: string
    eventId: string
    bytes: number
    status: ReportStatus
    now: Date
  },
) {
  await platform.db.insert(cloudTrafficReports).values({
    id: nanoid(),
    orgId: params.orgId,
    period: params.period,
    source: params.source,
    sourceId: params.sourceId,
    eventId: params.eventId,
    bytes: params.bytes,
    status: params.status,
    error: null,
    createdAt: params.now,
    updatedAt: params.now,
  })
}

async function updateTrafficReport(
  db: Database,
  eventId: string,
  status: ReportStatus,
  error: string | null,
  now: Date,
) {
  await db
    .update(cloudTrafficReports)
    .set({ status, error, updatedAt: now })
    .where(eq(cloudTrafficReports.eventId, eventId))
}
