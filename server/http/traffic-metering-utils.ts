import type { Context } from 'hono'
import { ZPAN_CLOUD_URL_DEFAULT } from '../../shared/constants'
import type { Env } from '../middleware/platform'
import {
  CloudTrafficBlockedError,
  reportTrafficEgress,
  type TrafficReportSource,
} from '../usecases/cloud-traffic-metering'

interface DownloadTrafficParams {
  orgId: string
  bytes: number
  storage: {
    id: string
    egressCreditBillingEnabled: boolean
    egressCreditUnitBytes: number
    egressCreditPerUnit: number
  }
  source: TrafficReportSource
  sourceId: string
  /** Renders the 422 response when the traffic quota is exceeded (JSON vs text varies by route). */
  quotaExceeded: () => Response
  /** Compensating action run if traffic is rejected at either the quota or the egress-report step. */
  onRejected?: () => Promise<void>
}

/**
 * Meters a download end to end: consume traffic quota (422 on exceed), then
 * report egress to Cloud (402 on insufficient credits, refunding the quota).
 * Returns a Response to send back, or null when metering succeeded and the
 * caller should proceed to presign the object.
 */
export async function consumeAndReportDownloadTraffic(
  c: Context<Env>,
  params: DownloadTrafficParams,
): Promise<Response | null> {
  const allowed = await c.get('deps').quota.consumeTrafficIfQuotaAllows(params.orgId, params.bytes)
  if (!allowed) {
    await params.onRejected?.()
    return params.quotaExceeded()
  }
  return reportTrafficForDownload(c, {
    orgId: params.orgId,
    bytes: params.bytes,
    storage: params.storage,
    source: params.source,
    sourceId: params.sourceId,
    onRejected: params.onRejected,
  })
}

export async function reportTrafficForDownload(
  c: Context<Env>,
  params: {
    orgId: string
    bytes: number
    storage: {
      id: string
      egressCreditBillingEnabled: boolean
      egressCreditUnitBytes: number
      egressCreditPerUnit: number
    }
    source: TrafficReportSource
    sourceId: string
    onRejected?: () => Promise<void>
  },
): Promise<Response | null> {
  try {
    await reportTrafficEgress(c.get('deps'), {
      cloudBaseUrl: c.get('platform').getEnv('ZPAN_CLOUD_URL') ?? ZPAN_CLOUD_URL_DEFAULT,
      orgId: params.orgId,
      bytes: params.bytes,
      storageId: params.storage.id,
      egressCreditBillingEnabled: params.storage.egressCreditBillingEnabled,
      egressCreditUnitBytes: params.storage.egressCreditUnitBytes,
      egressCreditPerUnit: params.storage.egressCreditPerUnit,
      source: params.source,
      sourceId: params.sourceId,
    })
    return null
  } catch (error) {
    await c.get('deps').quota.refundTraffic(params.orgId, params.bytes)
    await params.onRejected?.()
    if (error instanceof CloudTrafficBlockedError) {
      return c.json({ error: 'insufficient_credits', code: 'insufficient_credits', resource: 'storage_egress' }, 402)
    }
    throw error
  }
}
