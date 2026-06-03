import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { ZPAN_CLOUD_URL_DEFAULT } from '../../shared/constants'
import { remoteDownloadUsageReports } from '../db/schema'
import { loadActiveLicenseBinding } from '../licensing/license-state'
import type { Platform } from '../platform/interface'
import { postBoundCloudJson } from './licensing-cloud'

export class RemoteDownloadBillingBlockedError extends Error {
  constructor() {
    super('insufficient_credits')
    this.name = 'RemoteDownloadBillingBlockedError'
  }
}

export async function reportRemoteDownloadUnit(params: {
  platform: Platform
  orgId: string
  downloaderId: string
  taskId: string
  unitIndex: number
  unitBytes: number
  creditsPerUnit: number
  enabled: boolean
}): Promise<void> {
  if (!params.enabled) return
  const eventId = `remote_download:${params.taskId}:${params.unitIndex}`
  const existing = await params.platform.db
    .select()
    .from(remoteDownloadUsageReports)
    .where(eq(remoteDownloadUsageReports.eventId, eventId))
    .limit(1)
  if (existing[0]?.status === 'reported') return
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

  const binding = await loadActiveLicenseBinding(params.platform.db)
  if (!binding?.refreshToken || !binding.cloudStoreId) {
    await mark(params.platform, eventId, 'reported', null)
    return
  }

  try {
    const response = (await postBoundCloudJson(
      params.platform.getEnv('ZPAN_CLOUD_URL') ?? ZPAN_CLOUD_URL_DEFAULT,
      `/api/stores/${encodeURIComponent(binding.cloudStoreId)}/billing/usage-events`,
      binding.refreshToken,
      {
        resource: 'remote_download',
        unit: 'byte',
        bytes: params.unitBytes,
        eventId,
        idempotencyKey: eventId,
        customerId: params.orgId,
        source: 'remote_download',
        sourceId: params.taskId,
        usageContext: { downloaderId: params.downloaderId },
        pricing: { unitQuantity: params.unitBytes, creditsPerUnit: params.creditsPerUnit },
      },
    )) as { accepted?: boolean; eventId?: string; error?: { code?: string } }
    if (!response.accepted || response.eventId !== eventId) throw new Error('cloud_usage_report_rejected')
    await mark(params.platform, eventId, 'reported', null)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'cloud_usage_report_failed'
    if (message === 'insufficient_credits' || message === 'overage_cap_exceeded') {
      await mark(params.platform, eventId, 'blocked', message)
      throw new RemoteDownloadBillingBlockedError()
    }
    await mark(params.platform, eventId, 'failed', message)
    throw error
  }
}

async function mark(platform: Platform, eventId: string, status: string, error: string | null) {
  await platform.db
    .update(remoteDownloadUsageReports)
    .set({ status, error, updatedAt: new Date() })
    .where(eq(remoteDownloadUsageReports.eventId, eventId))
}
