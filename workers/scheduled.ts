// CF Workers scheduled() handler.

import { createCloudflarePlatform } from '../server/platform/cloudflare'
import { syncPendingCloudTrafficReports } from '../server/services/cloud-traffic-metering'
import { INSTANCE_TELEMETRY_CRON, reportInstanceTelemetry } from '../server/services/instance-telemetry'
import { runLicensingRefresh } from '../server/services/licensing-refresh-runner'
import { syncPendingRemoteDownloadUsageReports } from '../server/services/remote-download-usage'
import { ZPAN_CLOUD_URL_DEFAULT } from '../shared/constants'

// Subset of the worker Env used by the scheduled handler.
// The full Env is defined in bootstrap.ts; this avoids circular imports.
export interface ScheduledEnv {
  DB: D1Database
  BETTER_AUTH_URL?: string
  ZPAN_CLOUD_URL?: string
  ZPAN_PUBLIC_ORIGIN?: string
  ZPAN_INSTANCE_ID?: string
  ZPAN_TELEMETRY_ALLOW_IP?: string
  [key: string]: unknown
}

const TRAFFIC_SYNC_CRON = '*/10 * * * *'
type ScheduledTrigger = Pick<ScheduledEvent, 'cron'>

function envAllowsIp(value: string | undefined): boolean {
  return !['0', 'false', 'no', 'off'].includes(value?.trim().toLowerCase() ?? '')
}

export async function handleScheduled(event: ScheduledTrigger, env: ScheduledEnv): Promise<void> {
  const platform = createCloudflarePlatform(env)
  const cloudBaseUrl = env.ZPAN_CLOUD_URL ?? ZPAN_CLOUD_URL_DEFAULT
  if (event.cron === TRAFFIC_SYNC_CRON) {
    await syncPendingCloudTrafficReports({ db: platform.db, cloudBaseUrl })
    await syncPendingRemoteDownloadUsageReports({ db: platform.db, cloudBaseUrl })
    return
  }

  if (event.cron === INSTANCE_TELEMETRY_CRON) {
    await reportInstanceTelemetry({
      db: platform.db,
      config: {
        configuredInstanceId: env.ZPAN_INSTANCE_ID,
        siteUrl: env.ZPAN_PUBLIC_ORIGIN ?? env.BETTER_AUTH_URL,
        allowIp: envAllowsIp(env.ZPAN_TELEMETRY_ALLOW_IP),
      },
      cron: event.cron,
      trigger: 'scheduled',
      runtime: {
        target: 'cloudflare-worker',
        provider: 'cloudflare',
      },
    })
    return
  }

  await runLicensingRefresh(platform.db, cloudBaseUrl)
}
