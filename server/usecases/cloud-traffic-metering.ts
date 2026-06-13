import { nanoid } from 'nanoid'
import { z } from 'zod'
import { hasFeature } from '../domain/licensing'
import { currentTrafficPeriod } from '../domain/quota'
import { loadBindingState } from './licensing'
import type {
  CloudTrafficReportRecord,
  CloudTrafficReportRepo,
  CloudTrafficReportStatus,
  LicenseBindingRepo,
  LicensingCloudGateway,
  TrafficReportSource,
} from './ports'

export type { TrafficReportSource } from './ports'

export type CloudTrafficMeteringDeps = {
  licenseBinding: LicenseBindingRepo
  licensingCloud: LicensingCloudGateway
  cloudTrafficReports: CloudTrafficReportRepo
}

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

export async function reportTrafficEgress(
  deps: CloudTrafficMeteringDeps,
  params: {
    cloudBaseUrl: string
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
  },
): Promise<{ status: CloudTrafficReportStatus; eventId: string; duplicate: boolean }> {
  const { orgId, bytes, source, sourceId, now = new Date() } = params
  if (bytes <= 0) return { status: 'reported', eventId: params.eventId ?? '', duplicate: false }
  if (!params.egressCreditBillingEnabled) return { status: 'reported', eventId: params.eventId ?? '', duplicate: false }
  if (!hasFeature('quota_store', await loadBindingState(deps))) {
    return { status: 'reported', eventId: params.eventId ?? '', duplicate: false }
  }
  if (!params.storageId || !params.egressCreditUnitBytes || !params.egressCreditPerUnit) {
    throw new Error('storage_egress_pricing_missing')
  }

  const eventId = params.eventId ?? `traffic_${nanoid()}`
  const existing = await deps.cloudTrafficReports.findByEventId(eventId)
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
      return { status: existing.status, eventId, duplicate: true }
    }
    if (existing.status === 'blocked') throw new CloudTrafficBlockedError()
  } else {
    await deps.cloudTrafficReports.insert({
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

  const binding = await deps.licenseBinding.loadActiveLicenseBinding()
  if (!binding?.refreshToken || !binding.cloudStoreId) {
    await deps.cloudTrafficReports.updateStatus(eventId, 'skipped_unbound', null, now)
    return { status: 'skipped_unbound', eventId, duplicate: false }
  }

  const status = await syncTrafficReport(deps, {
    cloudBaseUrl: params.cloudBaseUrl,
    refreshToken: binding.refreshToken,
    storeId: binding.cloudStoreId,
    report: (await deps.cloudTrafficReports.findByEventId(eventId))!,
    now,
  })
  if (status === 'blocked') throw new CloudTrafficBlockedError()
  return { status, eventId, duplicate: false }
}

export async function syncPendingCloudTrafficReports(
  deps: CloudTrafficMeteringDeps,
  params: { cloudBaseUrl: string; limit?: number; now?: Date },
): Promise<{ attempted: number; reported: number; blocked: number; failed: number }> {
  const { cloudBaseUrl, limit = 100, now = new Date() } = params
  if (!hasFeature('quota_store', await loadBindingState(deps)))
    return { attempted: 0, reported: 0, blocked: 0, failed: 0 }
  const binding = await deps.licenseBinding.loadActiveLicenseBinding()
  if (!binding?.refreshToken || !binding.cloudStoreId) return { attempted: 0, reported: 0, blocked: 0, failed: 0 }

  const reports = await deps.cloudTrafficReports.listPending(limit)

  const result = { attempted: reports.length, reported: 0, blocked: 0, failed: 0 }
  for (const report of reports) {
    const status = await syncTrafficReport(deps, {
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

async function syncTrafficReport(
  deps: CloudTrafficMeteringDeps,
  params: {
    cloudBaseUrl: string
    refreshToken: string
    storeId: string
    report: CloudTrafficReportRecord
    now: Date
  },
): Promise<'reported' | 'blocked' | 'failed'> {
  const { cloudBaseUrl, refreshToken, storeId, report, now } = params
  try {
    const client = deps.licensingCloud.createBoundCloudClient(cloudBaseUrl, refreshToken)
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
    const response = await deps.licensingCloud.requestCloudJson(
      client.stores[':storeId'].billing['usage-events'].$post({
        param: { storeId },
        json: payload as never,
      }),
      usageResponseSchema,
    )
    if (!response.accepted) throw new Error('cloud_usage_report_rejected')
    await deps.cloudTrafficReports.updateStatus(report.eventId, 'reported', null, now)
    return 'reported'
  } catch (error) {
    const message = error instanceof Error ? error.message : 'cloud_usage_report_failed'
    if (message === 'insufficient_credits' || message === 'overage_cap_exceeded') {
      await deps.cloudTrafficReports.updateStatus(report.eventId, 'blocked', message, now)
      return 'blocked'
    }
    await deps.cloudTrafficReports.updateStatus(report.eventId, 'failed', message, now)
    return 'failed'
  }
}

function assertSameReport(
  report: CloudTrafficReportRecord,
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
