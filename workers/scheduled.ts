// CF Workers scheduled() handler.

import { createCloudflarePlatform } from '../server/platform/cloudflare'
import { syncPendingCloudTrafficReports } from '../server/services/cloud-traffic-metering'
import { runLicensingRefresh } from '../server/services/licensing-refresh-runner'
import { syncPendingRemoteDownloadUsageReports } from '../server/services/remote-download-usage'
import { ZPAN_CLOUD_URL_DEFAULT } from '../shared/constants'

// Subset of the worker Env used by the scheduled handler.
// The full Env is defined in bootstrap.ts; this avoids circular imports.
export interface ScheduledEnv {
  DB: D1Database
  ZPAN_CLOUD_URL?: string
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

  await runLicensingRefresh(platform.db, cloudBaseUrl)
}
