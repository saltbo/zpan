import { asc, eq, inArray } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import { ZPAN_CLOUD_URL_DEFAULT } from '../../shared/constants'
import { remoteDownloadUsageReports } from '../db/schema'
import { hasFeature, loadBindingState } from '../licensing/has-feature'
import { loadActiveLicenseBinding } from '../licensing/license-state'
import type { Database, Platform } from '../platform/interface'
import { createBoundCloudClient, requestCloudJson } from './licensing-cloud'

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

type RemoteDownloadUsageStatus = 'pending' | 'reported' | 'skipped_unbound' | 'blocked' | 'failed'
type RemoteDownloadUsageReport = typeof remoteDownloadUsageReports.$inferSelect

export async function reportRemoteDownloadUnit(params: {
  platform: Platform
  orgId: string
  downloaderId: string
  taskId: string
  unitIndex: number
  unitBytes: number
  creditsPerUnit: number
  enabled: boolean
}): Promise<{ status: RemoteDownloadUsageStatus; eventId: string }> {
  if (!params.enabled) return { status: 'reported', eventId: '' }
  if (!hasFeature('quota_store', await loadBindingState(params.platform.db))) return { status: 'reported', eventId: '' }
  const eventId = `remote_download:${params.taskId}:${params.unitIndex}`
  const existing = await params.platform.db
    .select()
    .from(remoteDownloadUsageReports)
    .where(eq(remoteDownloadUsageReports.eventId, eventId))
    .limit(1)
  if (existing[0]?.status === 'reported') return { status: 'reported', eventId }
  if (existing[0]?.status === 'blocked') throw new RemoteDownloadBillingBlockedError()

  const now = new Date()
  if (!existing[0]) {
    await params.platform.db.insert(remoteDownloadUsageReports).values({
      id: nanoid(),
      orgId: params.orgId,
      downloaderId: params.downloaderId,
      taskId: params.taskId,
      eventId,
      unitIndex: params.unitIndex,
      unitBytes: params.unitBytes,
      creditsPerUnit: params.creditsPerUnit,
      status: 'pending',
      error: null,
      createdAt: now,
      updatedAt: now,
    })
  }

  const status = await syncRemoteDownloadUsageReport({
    db: params.platform.db,
    cloudBaseUrl: params.platform.getEnv('ZPAN_CLOUD_URL') ?? ZPAN_CLOUD_URL_DEFAULT,
    report: (await loadRemoteDownloadUsageReport(params.platform.db, eventId))!,
    now,
  })
  if (status === 'blocked') throw new RemoteDownloadBillingBlockedError()
  return { status, eventId }
}

export async function syncPendingRemoteDownloadUsageReports(params: {
  db: Database
  cloudBaseUrl: string
  limit?: number
  now?: Date
}): Promise<{ attempted: number; reported: number; blocked: number; failed: number }> {
  const { db, cloudBaseUrl, limit = 100, now = new Date() } = params
  if (!hasFeature('quota_store', await loadBindingState(db)))
    return { attempted: 0, reported: 0, blocked: 0, failed: 0 }
  const binding = await loadActiveLicenseBinding(db)
  if (!binding?.refreshToken || !binding.cloudStoreId) return { attempted: 0, reported: 0, blocked: 0, failed: 0 }

  const reports = await db
    .select()
    .from(remoteDownloadUsageReports)
    .where(inArray(remoteDownloadUsageReports.status, ['pending', 'failed']))
    .orderBy(asc(remoteDownloadUsageReports.createdAt))
    .limit(limit)

  const result = { attempted: reports.length, reported: 0, blocked: 0, failed: 0 }
  for (const report of reports) {
    const status = await syncRemoteDownloadUsageReport({ db, cloudBaseUrl, report, now })
    result[status] += 1
  }
  return result
}

async function syncRemoteDownloadUsageReport(params: {
  db: Database
  cloudBaseUrl: string
  report: RemoteDownloadUsageReport
  now: Date
}): Promise<'reported' | 'blocked' | 'failed'> {
  const { db, cloudBaseUrl, report, now } = params
  const binding = await loadActiveLicenseBinding(db)
  if (!binding?.refreshToken || !binding.cloudStoreId) {
    await mark(db, report.eventId, 'skipped_unbound', null, now)
    return 'reported'
  }

  try {
    const client = createBoundCloudClient(cloudBaseUrl, binding.refreshToken)
    const response = await requestCloudJson(
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
    await mark(db, report.eventId, 'reported', null, now)
    return 'reported'
  } catch (error) {
    const message = error instanceof Error ? error.message : 'cloud_usage_report_failed'
    if (message === 'insufficient_credits' || message === 'overage_cap_exceeded') {
      await mark(db, report.eventId, 'blocked', message, now)
      return 'blocked'
    }
    await mark(db, report.eventId, 'failed', message, now)
    return 'failed'
  }
}

async function loadRemoteDownloadUsageReport(db: Database, eventId: string) {
  const rows = await db
    .select()
    .from(remoteDownloadUsageReports)
    .where(eq(remoteDownloadUsageReports.eventId, eventId))
    .limit(1)
  return rows[0]
}

async function mark(db: Database, eventId: string, status: string, error: string | null, now: Date) {
  await db
    .update(remoteDownloadUsageReports)
    .set({ status, error, updatedAt: now })
    .where(eq(remoteDownloadUsageReports.eventId, eventId))
}
