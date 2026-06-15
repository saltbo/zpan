import { timingSafeEqual } from 'node:crypto'
import type { Context } from 'hono'
import { Hono } from 'hono'
import { ZPAN_CLOUD_URL_DEFAULT } from '../../../shared/constants'
import type { BindingState } from '../../../shared/types'
import { originFromRequestUrl } from '../../domain/site-public-origin'
import { requireAdmin } from '../../middleware/auth'
import type { Env } from '../../middleware/platform'
import { syncPendingCloudTrafficReports } from '../../usecases/cloud-traffic-metering'
import { syncPendingRemoteDownloadUsageReports } from '../../usecases/downloads/remote-download-usage'
import { buildCloudInstanceInfo, runtimeInfo } from '../../usecases/site/instance-info'
import {
  initiatePairing,
  loadBindingState,
  normalizeHost,
  pollPairing,
  runLicensingRefresh,
  triggerRefresh,
  unbindLicense,
} from '../../usecases/site/licensing'
import { getSitePublicOrigin } from '../../usecases/site/public-origin'

function getCloudBaseUrl(c: Context<Env>): string {
  return c.get('platform').getEnv('ZPAN_CLOUD_URL') ?? ZPAN_CLOUD_URL_DEFAULT
}

async function getInstanceOrigin(c: Context<Env>): Promise<string | null> {
  return (await getSitePublicOrigin(c.get('deps'))) ?? originFromRequestUrl(c.req.url)
}

async function requireInstanceOrigin(c: Context<Env>): Promise<string> {
  return (await getInstanceOrigin(c)) ?? new URL(c.req.url).origin
}

async function configuredPublicHost(c: Context<Env>): Promise<string | null> {
  const origin = await getInstanceOrigin(c)
  return origin ? new URL(origin).host : null
}

async function getRequestHost(c: Context<Env>): Promise<string> {
  const configured = await getSitePublicOrigin(c.get('deps'))
  if (configured) return new URL(configured).host
  const forwardedHost = c.req.header('x-forwarded-host') ?? c.req.header('host')
  return normalizeHost(forwardedHost) ?? new URL(c.req.url).host
}

function cloudDashboardUrl(cloudBaseUrl: string): string {
  return `${cloudBaseUrl.replace(/\/$/, '')}/dashboard`
}

function secretsMatch(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) return false
  const enc = new TextEncoder()
  return timingSafeEqual(enc.encode(provided), enc.encode(expected))
}

function isAuthorizedCronRequest(c: Context<Env>) {
  const expectedSecret = c.get('platform').getEnv('REFRESH_CRON_SECRET')
  const provided = c.req.query('secret') ?? ''
  return Boolean(expectedSecret && secretsMatch(provided, expectedSecret))
}

// Public licensing surface — instance status plus cron-secret-authorized sync
// runs. /status is anonymous; the cron endpoints authenticate via REFRESH_CRON_SECRET.
export const licensing = new Hono<Env>()
  .get('/status', async (c) => {
    const cloudBaseUrl = getCloudBaseUrl(c)
    const currentHost =
      (await configuredPublicHost(c)) ??
      normalizeHost(c.req.header('x-forwarded-host') ?? c.req.header('host')) ??
      new URL(c.req.url).host
    const state = await loadBindingState(c.get('deps'), { currentHost, cloudBaseUrl })
    return c.json({ ...state, cloud_dashboard_url: cloudDashboardUrl(cloudBaseUrl) } satisfies BindingState)
  })

  // POST /api/site/licensing/refresh-cron?secret=<REFRESH_CRON_SECRET>
  // External schedulers (Vercel Cron, Netlify Scheduled Functions, etc.) call
  // this endpoint every 6 hours instead of running a native cron trigger.
  // Set REFRESH_CRON_SECRET to a random string (e.g. openssl rand -hex 32)
  // and pass it as the `secret` query parameter.
  .post('/refresh-cron', async (c) => {
    if (!isAuthorizedCronRequest(c)) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const cloudBaseUrl = getCloudBaseUrl(c)
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

    const cloudBaseUrl = getCloudBaseUrl(c)
    const [traffic, remoteDownload] = await Promise.all([
      syncPendingCloudTrafficReports(c.get('deps'), { cloudBaseUrl }),
      syncPendingRemoteDownloadUsageReports(c.get('deps'), { cloudBaseUrl }),
    ])

    return c.json({ ok: true, ...traffic, remoteDownload })
  })

// Admin licensing surface — the cloud pairing handshake, manual refresh, and
// unbinding. Every route requires an admin principal.
export const licensingAdmin = new Hono<Env>()
  .use(requireAdmin)

  .post('/pairings', async (c) => {
    const pairing = await initiatePairing(c.get('deps'), {
      baseUrl: getCloudBaseUrl(c),
      instanceUrl: await requireInstanceOrigin(c),
      runtime: runtimeInfo(c.get('platform')),
    })
    return c.json(pairing)
  })

  .get('/pairings/:code', async (c) => {
    const result = await pollPairing(c.get('deps'), {
      baseUrl: getCloudBaseUrl(c),
      code: c.req.param('code'),
      currentHost: await getRequestHost(c),
      userId: c.get('userId')!,
      orgId: c.get('orgId')!,
    })

    if (!result.ok) {
      return c.json(
        { error: 'invalid_certificate', reason: result.reason, cloud_unbind_error: result.cloudUnbindError },
        502,
      )
    }

    if (result.status === 'approved') {
      return c.json({ status: 'approved' as const, edition: result.edition, cloud_store_id: result.cloudStoreId })
    }

    return c.json({ status: result.status })
  })

  .post('/refresh-runs', async (c) => {
    const { lastRefreshAt } = await triggerRefresh(c.get('deps'), {
      baseUrl: getCloudBaseUrl(c),
      instanceUrl: await requireInstanceOrigin(c),
      runtime: runtimeInfo(c.get('platform')),
      userId: c.get('userId')!,
      orgId: c.get('orgId')!,
    })
    return c.json({ success: true, last_refresh_at: lastRefreshAt })
  })

  .delete('/binding', async (c) => {
    const { cloudUnbindError } = await unbindLicense(c.get('deps'), {
      baseUrl: getCloudBaseUrl(c),
      userId: c.get('userId')!,
      orgId: c.get('orgId')!,
    })
    return c.json({ deleted: true, cloud_unbind_error: cloudUnbindError })
  })
