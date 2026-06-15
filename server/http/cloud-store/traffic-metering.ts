import type { Context } from 'hono'
import { ZPAN_CLOUD_URL_DEFAULT } from '../../../shared/constants'
import type { Env } from '../../middleware/platform'
import {
  type DownloadTrafficOutcome,
  type DownloadTrafficStorage,
  meterDownloadTraffic,
  reportDownloadEgress,
  type TrafficReportSource,
} from '../../usecases/cloud-traffic-metering'

// Thin http adapters over the download-metering usecase: resolve the cloud base
// URL from the request, call the usecase (deps passed whole), and render the
// quota (422) / credit (402) responses. The metering decision lives in the
// usecase; these only translate its outcome to a Response.

interface DownloadTrafficParams {
  orgId: string
  bytes: number
  storage: DownloadTrafficStorage
  source: TrafficReportSource
  sourceId: string
  /** Renders the 422 response when the traffic quota is exceeded (JSON vs text varies by route). */
  quotaExceeded: () => Response
  /** Compensating action run if traffic is rejected at either the quota or the egress-report step. */
  onRejected?: () => Promise<void>
}

const cloudBaseUrl = (c: Context<Env>) => c.get('platform').getEnv('ZPAN_CLOUD_URL') ?? ZPAN_CLOUD_URL_DEFAULT

function insufficientCredits(c: Context<Env>): Response {
  return c.json({ error: 'insufficient_credits', code: 'insufficient_credits', resource: 'storage_egress' }, 402)
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
  const outcome = await meterDownloadTraffic(c.get('deps'), {
    cloudBaseUrl: cloudBaseUrl(c),
    orgId: params.orgId,
    bytes: params.bytes,
    storage: params.storage,
    source: params.source,
    sourceId: params.sourceId,
    onRejected: params.onRejected,
  })
  if (outcome.ok) return null
  return outcome.reason === 'quota_exceeded' ? params.quotaExceeded() : insufficientCredits(c)
}

export async function reportTrafficForDownload(
  c: Context<Env>,
  params: {
    orgId: string
    bytes: number
    storage: DownloadTrafficStorage
    source: TrafficReportSource
    sourceId: string
    onRejected?: () => Promise<void>
  },
): Promise<Response | null> {
  const outcome: DownloadTrafficOutcome = await reportDownloadEgress(c.get('deps'), {
    cloudBaseUrl: cloudBaseUrl(c),
    orgId: params.orgId,
    bytes: params.bytes,
    storage: params.storage,
    source: params.source,
    sourceId: params.sourceId,
    onRejected: params.onRejected,
  })
  // reportDownloadEgress never consumes quota, so it cannot return quota_exceeded.
  return outcome.ok ? null : insufficientCredits(c)
}
