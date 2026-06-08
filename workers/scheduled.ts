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
  ZPAN_PUBLIC_ORIGIN?: string
  ZPAN_CLOUD_URL?: string
  ZPAN_INSTANCE_ID?: string
  ZPAN_POSTHOG_HOST?: string
  ZPAN_POSTHOG_PROJECT_TOKEN?: string
  [key: string]: unknown
}

const TRAFFIC_SYNC_CRON = '*/10 * * * *'
type ScheduledTrigger = Pick<ScheduledEvent, 'cron'>

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
        posthogHost: env.ZPAN_POSTHOG_HOST,
        posthogProjectToken: env.ZPAN_POSTHOG_PROJECT_TOKEN,
        configuredInstanceId: env.ZPAN_INSTANCE_ID,
      },
      cron: event.cron,
      runtime: {
        target: 'cloudflare-worker',
        hostname: configuredHostname(env),
      },
    })
    return
  }

  await runLicensingRefresh(platform.db, cloudBaseUrl)
}

function configuredHostname(env: ScheduledEnv): string | undefined {
  const value = env.ZPAN_PUBLIC_ORIGIN ?? env.BETTER_AUTH_URL
  if (!value) return undefined
  try {
    return new URL(value).hostname
  } catch {
    return undefined
  }
}
