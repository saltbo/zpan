import type { Context } from 'hono'
import type { Env } from '../middleware/platform'
import {
  CloudTrafficBlockedError,
  reportTrafficEgress,
  type TrafficReportSource,
} from '../services/cloud-traffic-metering'
import { refundTraffic } from '../services/effective-quota'

export async function reportTrafficForDownload(
  c: Context<Env>,
  params: {
    orgId: string
    bytes: number
    source: TrafficReportSource
    sourceId: string
    onRejected?: () => Promise<void>
  },
): Promise<Response | null> {
  try {
    await reportTrafficEgress({
      platform: c.get('platform'),
      orgId: params.orgId,
      bytes: params.bytes,
      source: params.source,
      sourceId: params.sourceId,
    })
    return null
  } catch (error) {
    await refundTraffic(c.get('platform').db, params.orgId, params.bytes)
    await params.onRejected?.()
    if (error instanceof CloudTrafficBlockedError) {
      return c.json({ error: 'insufficient_credits', code: 'insufficient_credits', resource: 'traffic_egress' }, 402)
    }
    throw error
  }
}
