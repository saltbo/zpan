import { release as osRelease } from 'node:os'
import { type Context, Hono } from 'hono'
import { ZPAN_CLOUD_URL_DEFAULT } from '../../shared/constants'
import { originFromRequestUrl } from '../domain/site-public-origin'
import { constantTimeEqual } from '../lib/constant-time'
import type { Env } from '../middleware/platform'
import { getDeployPlatform } from '../runtime-platform'
import { syncPendingRemoteDownloadUsageReports } from '../usecases/downloads/remote-download-usage'
import { notFound, unauthorized } from '../usecases/ports'
import { buildCloudInstanceInfo, runtimeInfo } from '../usecases/site/instance-info'
import { INSTANCE_TELEMETRY_CRON, reportInstanceTelemetry } from '../usecases/site/instance-telemetry'
import { runLicensingRefresh } from '../usecases/site/licensing'
import { getSitePublicOrigin } from '../usecases/site/public-origin'
import { syncPendingCloudTrafficReports } from '../usecases/store/traffic-metering'

const INTERNAL_API_TOKEN_ENV = 'ZPAN_INTERNAL_API_TOKEN'
const REFRESH_TOKEN_ENV = 'REFRESH_CRON_SECRET'

const internal = new Hono<Env>()

function envAllowsIp(value: string | undefined): boolean {
  return !['0', 'false', 'no', 'off'].includes(value?.trim().toLowerCase() ?? '')
}

function requireBearerToken(c: Context<Env>, envName: string) {
  const token = c.get('platform').getEnv(envName)?.trim()
  if (!token) throw unauthorized()
  if (!constantTimeEqual(c.req.header('authorization') ?? '', `Bearer ${token}`)) throw unauthorized()
}

internal.post('/instance-telemetry/report', async (c) => {
  const platform = c.get('platform')
  const token = platform.getEnv(INTERNAL_API_TOKEN_ENV)?.trim()
  if (!token) throw notFound()

  const auth = c.req.header('authorization') ?? ''
  if (!constantTimeEqual(auth, `Bearer ${token}`)) throw unauthorized()

  const runtime = platform.getBinding('DB')
    ? {
        runtime: 'workerd' as const,
        platform: 'cloudflare-workers' as const,
      }
    : {
        runtime: 'node' as const,
        platform: getDeployPlatform() ?? 'node',
        osPlatform: process.platform,
        osArch: process.arch,
        osRelease: osRelease(),
        nodeVersion: process.version,
      }

  const result = await reportInstanceTelemetry(c.get('deps'), {
    config: {
      allowIp: envAllowsIp(platform.getEnv('ZPAN_TELEMETRY_ALLOW_IP')),
    },
    cron: INSTANCE_TELEMETRY_CRON,
    trigger: 'deploy',
    runtime,
  })

  return c.json(result)
})

internal.post('/licensing/refresh-runs', async (c) => {
  requireBearerToken(c, REFRESH_TOKEN_ENV)
  const cloudBaseUrl = c.get('platform').getEnv('ZPAN_CLOUD_URL') ?? ZPAN_CLOUD_URL_DEFAULT
  const origin = (await getSitePublicOrigin(c.get('deps'))) ?? originFromRequestUrl(c.req.url)
  const instance = origin
    ? await buildCloudInstanceInfo(c.get('deps'), { url: origin, runtime: runtimeInfo(c.get('platform')) })
    : undefined
  await runLicensingRefresh(c.get('deps'), cloudBaseUrl, instance)
  return c.json({ ok: true })
})

internal.post('/traffic-sync-runs', async (c) => {
  requireBearerToken(c, REFRESH_TOKEN_ENV)
  const cloudBaseUrl = c.get('platform').getEnv('ZPAN_CLOUD_URL') ?? ZPAN_CLOUD_URL_DEFAULT
  const [traffic, remoteDownload] = await Promise.all([
    syncPendingCloudTrafficReports(c.get('deps'), { cloudBaseUrl }),
    syncPendingRemoteDownloadUsageReports(c.get('deps'), { cloudBaseUrl }),
  ])
  return c.json({ ok: true, ...traffic, remoteDownload })
})

export default internal
