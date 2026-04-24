// CF Workers scheduled() handler — invoked by the cron trigger every 6 hours.
// Delegates to the shared licensing refresh runner.

import { createCloudflarePlatform } from '../server/platform/cloudflare'
import { runLicensingRefresh } from '../server/services/licensing-refresh-runner'
import { ZPAN_CLOUD_URL_DEFAULT } from '../shared/constants'

// Subset of the worker Env used by the scheduled handler.
// The full Env is defined in bootstrap.ts; this avoids circular imports.
export interface ScheduledEnv {
  DB: D1Database
  ZPAN_CLOUD_URL?: string
  [key: string]: unknown
}

export async function handleScheduled(env: ScheduledEnv): Promise<void> {
  const platform = createCloudflarePlatform(env)
  const cloudBaseUrl = env.ZPAN_CLOUD_URL ?? ZPAN_CLOUD_URL_DEFAULT
  await runLicensingRefresh(platform.db, cloudBaseUrl)
}
