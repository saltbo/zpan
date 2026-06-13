import { asc, eq, inArray } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import { ZPAN_CLOUD_URL_DEFAULT } from '../../shared/constants'
import { createLicenseBindingRepo } from '../adapters/repos/license-binding'
import { cloudTrafficReports } from '../db/schema'
import { hasFeature } from '../domain/licensing'
import { currentTrafficPeriod } from '../domain/quota'
import type { Database, Platform } from '../platform/interface'
import { loadBindingState } from '../usecases/licensing'
import { createBoundCloudClient, requestCloudJson } from './licensing-cloud'

export type TrafficReportSource =
  | 'object_download'
  | 'direct_share'
  | 'landing_share'
  | 'image_hosting'
  | 'custom_domain_image'
  | 'webdav_download'

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
  storageId?: string | null
  egressCreditBillingEnabled?: boolean
  egressCreditUnitBytes?: number | null
  egressCreditPerUnit?: number | null
  source: TrafficReportSource
  sourceId: string
  eventId?: string
  now?: Date
}): Promise<{ status: ReportStatus; eventId: string; duplicate: boolean }> {
  const { platform, orgId, bytes, source, sourceId, now = new Date() } = params
  if (bytes <= 0) return { status: 'reported', eventId: params.eventId ?? '', duplicate: false }
  if (!params.egressCreditBillingEnabled) return { status: 'reported', eventId: params.eventId ?? '', duplicate: false }
  if (!hasFeature('quota_store', await loadBindingState({ licenseBinding: createLicenseBindingRepo(platform.db) }))) {
    return { status: 'reported', eventId: params.eventId ?? '', duplicate: false }
  }
  if (!params.storageId || !params.egressCreditUnitBytes || !params.egressCreditPerUnit) {
    throw new Error('storage_egress_pricing_missing')
  }

  const eventId = params.eventId ?? `traffic_${nanoid()}`
  const existing = await loadTrafficReport(platform.db, eventId)
  const period = existing?.period ?? currentTrafficPeriod(now)
  if (existing) {
    assertSameReport(existing, {
      orgId,
      period,
      source,
      sourceId,
      bytes,
      storageId: params.storageId,
      unitBytes: params.egressCreditUnitBytes,
      creditsPerUnit: params.egressCreditPerUnit,
    })
    if (existing.status !== 'blocked') {
      return { status: existing.status as ReportStatus, eventId, duplicate: true }
    }
    if (existing.status === 'blocked') throw new CloudTrafficBlockedError()
  } else {
    await insertTrafficReport(platform, {
      orgId,
      period,
      source,
      sourceId,
      eventId,
      bytes,
      storageId: params.storageId,
      unitBytes: params.egressCreditUnitBytes,
      creditsPerUnit: params.egressCreditPerUnit,
      status: 'pending',
      now,
    })
  }

  const binding = await createLicenseBindingRepo(platform.db).loadActiveLicenseBinding()
  if (!binding?.refreshToken || !binding.cloudStoreId) {
    await updateTrafficReport(platform.db, eventId, 'skipped_unbound', null, now)
    return { status: 'skipped_unbound', eventId, duplicate: false }
  }

  const status = await syncTrafficReport({
    db: platform.db,
    cloudBaseUrl: platform.getEnv('ZPAN_CLOUD_URL') ?? ZPAN_CLOUD_URL_DEFAULT,
    refreshToken: binding.refreshToken,
    storeId: binding.cloudStoreId,
    report: (await loadTrafficReport(platform.db, eventId))!,
    now,
  })
  if (status === 'blocked') throw new CloudTrafficBlockedError()
  return { status, eventId, duplicate: false }
}

export async function syncPendingCloudTrafficReports(params: {
  db: Database
  cloudBaseUrl: string
  limit?: number
  now?: Date
}): Promise<{ attempted: number; reported: number; blocked: number; failed: number }> {
  const { db, cloudBaseUrl, limit = 100, now = new Date() } = params
  if (!hasFeature('quota_store', await loadBindingState({ licenseBinding: createLicenseBindingRepo(db) })))
    return { attempted: 0, reported: 0, blocked: 0, failed: 0 }
  const binding = await createLicenseBindingRepo(db).loadActiveLicenseBinding()
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
    const client = createBoundCloudClient(cloudBaseUrl, refreshToken)
    const isStorageEgress = Boolean(report.storageId && report.unitBytes && report.creditsPerUnit)
    const payload = isStorageEgress
      ? {
          resource: 'storage_egress',
          unit: 'byte',
          bytes: report.bytes,
          eventId: report.eventId,
          idempotencyKey: report.eventId,
          customerId: report.orgId,
          source: report.source,
          sourceId: report.sourceId,
          usageContext: { storageId: report.storageId },
          pricing: { unitQuantity: report.unitBytes!, creditsPerUnit: report.creditsPerUnit! },
        }
      : {
          resource: 'traffic_egress',
          bytes: report.bytes,
          eventId: report.eventId,
          idempotencyKey: report.eventId,
          customerId: report.orgId,
        }
    const response = await requestCloudJson(
      client.stores[':storeId'].billing['usage-events'].$post({
        param: { storeId },
        json: payload as never,
      }),
      usageResponseSchema,
    )
    if (!response.accepted) throw new Error('cloud_usage_report_rejected')
    await updateTrafficReport(db, report.eventId, 'reported', null, now)
    return 'reported'
  } catch (error) {
    const message = error instanceof Error ? error.message : 'cloud_usage_report_failed'
    if (message === 'insufficient_credits' || message === 'overage_cap_exceeded') {
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
  params: {
    orgId: string
    period: string
    source: TrafficReportSource
    sourceId: string
    bytes: number
    storageId: string
    unitBytes: number
    creditsPerUnit: number
  },
) {
  if (
    report.orgId !== params.orgId ||
    report.period !== params.period ||
    report.source !== params.source ||
    report.sourceId !== params.sourceId ||
    report.bytes !== params.bytes ||
    report.storageId !== params.storageId ||
    report.unitBytes !== params.unitBytes ||
    report.creditsPerUnit !== params.creditsPerUnit
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
    storageId: string
    unitBytes: number
    creditsPerUnit: number
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
    storageId: params.storageId,
    unitBytes: params.unitBytes,
    creditsPerUnit: params.creditsPerUnit,
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
