import { timingSafeEqual } from 'node:crypto'
import type { Context } from 'hono'
import { Hono } from 'hono'
import { ZPAN_CLOUD_URL_DEFAULT } from '../../shared/constants'
import type { BindingState } from '../../shared/types'
import { originFromRequestUrl } from '../domain/site-public-origin'
import type { Env } from '../middleware/platform'
import { syncPendingCloudTrafficReports } from '../usecases/cloud-traffic-metering'
import { buildCloudInstanceInfo, runtimeInfo } from '../usecases/instance-info'
import { loadBindingState, normalizeHost, runLicensingRefresh } from '../usecases/licensing'
import { syncPendingRemoteDownloadUsageReports } from '../usecases/remote-download-usage'
import { getSitePublicOrigin } from '../usecases/site-public-origin'

async function configuredPublicHost(c: Context<Env>): Promise<string | null> {
  const origin = await getInstanceOrigin(c)
  return origin ? new URL(origin).host : null
}

async function getInstanceOrigin(c: Context<Env>): Promise<string | null> {
  return (await getSitePublicOrigin(c.get('deps'))) ?? originFromRequestUrl(c.req.url)
}

function cloudDashboardUrl(cloudBaseUrl: string): string {
  return `${cloudBaseUrl.replace(/\/$/, '')}/dashboard`
}

function secretsMatch(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) return false
  const enc = new TextEncoder()
  return timingSafeEqual(enc.encode(provided), enc.encode(expected))
}

const app = new Hono<Env>()
  .get('/status', async (c) => {
    const cloudBaseUrl = c.get('platform').getEnv('ZPAN_CLOUD_URL') ?? ZPAN_CLOUD_URL_DEFAULT
    const currentHost =
      (await configuredPublicHost(c)) ??
      normalizeHost(c.req.header('x-forwarded-host') ?? c.req.header('host')) ??
      new URL(c.req.url).host
    const state = await loadBindingState(c.get('deps'), { currentHost, cloudBaseUrl })
    return c.json({ ...state, cloud_dashboard_url: cloudDashboardUrl(cloudBaseUrl) } satisfies BindingState)
  })

  // POST /api/licensing/refresh-cron?secret=<REFRESH_CRON_SECRET>
  // External schedulers (Vercel Cron, Netlify Scheduled Functions, etc.) call
  // this endpoint every 6 hours instead of running a native cron trigger.
  // Set REFRESH_CRON_SECRET to a random string (e.g. openssl rand -hex 32)
  // and pass it as the `secret` query parameter.
  .post('/refresh-cron', async (c) => {
    if (!isAuthorizedCronRequest(c)) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const cloudBaseUrl = c.get('platform').getEnv('ZPAN_CLOUD_URL') ?? ZPAN_CLOUD_URL_DEFAULT
    const origin = await getInstanceOrigin(c)
    const instance = origin
      ? await buildCloudInstanceInfo(c.get('deps'), {
          url: origin,
          runtime: runtimeInfo(c.get('platform')),
        })
      : undefined
    await runLicensingRefresh(c.get('deps'), cloudBaseUrl, instance)

    return c.json({ ok: true })
  })

  .post('/traffic-sync-runs', async (c) => {
    if (!isAuthorizedCronRequest(c)) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const cloudBaseUrl = c.get('platform').getEnv('ZPAN_CLOUD_URL') ?? ZPAN_CLOUD_URL_DEFAULT
    const [traffic, remoteDownload] = await Promise.all([
      syncPendingCloudTrafficReports(c.get('deps'), { cloudBaseUrl }),
      syncPendingRemoteDownloadUsageReports(c.get('deps'), { cloudBaseUrl }),
    ])

    return c.json({ ok: true, ...traffic, remoteDownload })
  })

export default app

function isAuthorizedCronRequest(c: Context<Env>) {
  const expectedSecret = c.get('platform').getEnv('REFRESH_CRON_SECRET')
  const provided = c.req.query('secret') ?? ''
  return Boolean(expectedSecret && secretsMatch(provided, expectedSecret))
}
