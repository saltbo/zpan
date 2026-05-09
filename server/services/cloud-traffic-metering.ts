import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import { ZPAN_CLOUD_URL_DEFAULT } from '../../shared/constants'
import { cloudTrafficReports } from '../db/schema'
import { loadActiveLicenseBinding } from '../licensing/license-state'
import type { Platform } from '../platform/interface'
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
    if (existing.status === 'reported' || existing.status === 'skipped_unbound') {
      return { status: existing.status as ReportStatus, eventId, duplicate: true }
    }
    if (existing.status === 'blocked') throw new CloudTrafficBlockedError()
  } else {
    await insertTrafficReport(platform, { orgId, period, source, sourceId, eventId, bytes, status: 'pending', now })
  }

  const binding = await loadActiveLicenseBinding(platform.db)
  if (!binding?.refreshToken) {
    await updateTrafficReport(platform, eventId, 'skipped_unbound', null, now)
    return { status: 'skipped_unbound', eventId, duplicate: false }
  }

  try {
    const data = await postBoundCloudJson(
      platform.getEnv('ZPAN_CLOUD_URL') ?? ZPAN_CLOUD_URL_DEFAULT,
      '/api/usage-events',
      binding.refreshToken,
      {
        resource: 'traffic_egress',
        bytes,
        eventId,
        idempotencyKey: eventId,
        endUserId: orgId,
      },
    )
    const response = usageResponseSchema.parse(data)
    if (!response.accepted || response.eventId !== eventId) throw new Error('cloud_usage_report_rejected')
    await updateTrafficReport(platform, eventId, 'reported', null, now)
    return { status: 'reported', eventId, duplicate: false }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'cloud_usage_report_failed'
    if (message === 'overage_cap_exceeded') {
      await updateTrafficReport(platform, eventId, 'blocked', message, now)
      throw new CloudTrafficBlockedError()
    }
    await updateTrafficReport(platform, eventId, 'failed', message, now)
    throw error
  }
}

async function loadTrafficReport(db: Platform['db'], eventId: string) {
  const rows = await db.select().from(cloudTrafficReports).where(eq(cloudTrafficReports.eventId, eventId)).limit(1)
  return rows[0]
}

function assertSameReport(
  report: typeof cloudTrafficReports.$inferSelect,
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
  platform: Platform,
  eventId: string,
  status: ReportStatus,
  error: string | null,
  now: Date,
) {
  await platform.db
    .update(cloudTrafficReports)
    .set({ status, error, updatedAt: now })
    .where(eq(cloudTrafficReports.eventId, eventId))
}
