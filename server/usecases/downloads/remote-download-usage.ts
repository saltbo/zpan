import { z } from 'zod'
import { hasFeature } from '../../domain/licensing'
import type {
  LicenseBindingRepo,
  LicensingCloudGateway,
  RemoteDownloadUsageRepo,
  RemoteDownloadUsageReportRecord,
  RemoteDownloadUsageStatus,
} from '../ports'
import { loadBindingState } from '../site/licensing'

export type RemoteDownloadUsageDeps = {
  licenseBinding: LicenseBindingRepo
  licensingCloud: LicensingCloudGateway
  remoteDownloadUsage: RemoteDownloadUsageRepo
}

export class RemoteDownloadBillingBlockedError extends Error {
  constructor() {
    super('insufficient_credits')
    this.name = 'RemoteDownloadBillingBlockedError'
  }
}

const usageResponseSchema = z.object({
  accepted: z.boolean(),
  duplicate: z.boolean().optional(),
  eventId: z.string().min(1),
})

export async function reportRemoteDownloadUnit(
  deps: RemoteDownloadUsageDeps,
  params: {
    cloudBaseUrl: string
    orgId: string
    downloaderId: string
    taskId: string
    unitIndex: number
    unitBytes: number
    creditsPerUnit: number
    enabled: boolean
  },
): Promise<{ status: RemoteDownloadUsageStatus; eventId: string }> {
  if (!params.enabled) return { status: 'reported', eventId: '' }
  if (!hasFeature('quota_store', await loadBindingState(deps))) return { status: 'reported', eventId: '' }
  const eventId = `remote_download:${params.taskId}:${params.unitIndex}`
  const existing = await deps.remoteDownloadUsage.findByEventId(eventId)
  if (existing?.status === 'reported') return { status: 'reported', eventId }
  // A previously 'blocked' unit is NOT terminal: re-sync it below so a credit
  // top-up since the block takes effect. Short-circuiting here would wedge the
  // task in 'suspended' forever, even after the user recharges.

  const now = new Date()
  if (!existing) {
    await deps.remoteDownloadUsage.insert({
      orgId: params.orgId,
      downloaderId: params.downloaderId,
      taskId: params.taskId,
      eventId,
      unitIndex: params.unitIndex,
      unitBytes: params.unitBytes,
      creditsPerUnit: params.creditsPerUnit,
      now,
    })
  }

  const status = await syncRemoteDownloadUsageReport(deps, {
    cloudBaseUrl: params.cloudBaseUrl,
    report: (await deps.remoteDownloadUsage.findByEventId(eventId))!,
    now,
  })
  if (status === 'blocked') throw new RemoteDownloadBillingBlockedError()
  return { status, eventId }
}

export async function syncPendingRemoteDownloadUsageReports(
  deps: RemoteDownloadUsageDeps,
  params: { cloudBaseUrl: string; limit?: number; now?: Date },
): Promise<{ attempted: number; reported: number; blocked: number; failed: number }> {
  const { cloudBaseUrl, limit = 100, now = new Date() } = params
  if (!hasFeature('quota_store', await loadBindingState(deps)))
    return { attempted: 0, reported: 0, blocked: 0, failed: 0 }
  const binding = await deps.licenseBinding.loadActiveLicenseBinding()
  if (!binding?.refreshToken || !binding.cloudStoreId) return { attempted: 0, reported: 0, blocked: 0, failed: 0 }

  const reports = await deps.remoteDownloadUsage.listPending(limit)

  const result = { attempted: reports.length, reported: 0, blocked: 0, failed: 0 }
  for (const report of reports) {
    const status = await syncRemoteDownloadUsageReport(deps, { cloudBaseUrl, report, now })
    result[status] += 1
  }
  return result
}

async function syncRemoteDownloadUsageReport(
  deps: RemoteDownloadUsageDeps,
  params: { cloudBaseUrl: string; report: RemoteDownloadUsageReportRecord; now: Date },
): Promise<'reported' | 'blocked' | 'failed'> {
  const { cloudBaseUrl, report, now } = params
  const binding = await deps.licenseBinding.loadActiveLicenseBinding()
  if (!binding?.refreshToken || !binding.cloudStoreId) {
    await deps.remoteDownloadUsage.updateStatus(report.eventId, 'skipped_unbound', null, now)
    return 'reported'
  }

  try {
    const client = deps.licensingCloud.createBoundCloudClient(cloudBaseUrl, binding.refreshToken)
    const response = await deps.licensingCloud.requestCloudJson(
      client.stores[':storeId'].billing['usage-events'].$post({
        param: { storeId: binding.cloudStoreId },
        json: {
          resource: 'remote_download',
          unit: 'byte',
          bytes: report.unitBytes,
          eventId: report.eventId,
          idempotencyKey: report.eventId,
          customerId: report.orgId,
          source: 'remote_download',
          sourceId: report.taskId,
          usageContext: { downloaderId: report.downloaderId },
          pricing: { unitQuantity: report.unitBytes, creditsPerUnit: report.creditsPerUnit },
        } as never,
      }),
      usageResponseSchema,
    )
    if (!response.accepted) throw new Error('cloud_usage_report_rejected')
    await deps.remoteDownloadUsage.updateStatus(report.eventId, 'reported', null, now)
    return 'reported'
  } catch (error) {
    const message = error instanceof Error ? error.message : 'cloud_usage_report_failed'
    if (message === 'insufficient_credits' || message === 'overage_cap_exceeded') {
      await deps.remoteDownloadUsage.updateStatus(report.eventId, 'blocked', message, now)
      return 'blocked'
    }
    await deps.remoteDownloadUsage.updateStatus(report.eventId, 'failed', message, now)
    return 'failed'
  }
}
