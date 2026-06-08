import { timingSafeEqual } from 'node:crypto'
import { release as osRelease } from 'node:os'
import type { Context } from 'hono'
import { Hono } from 'hono'
import { ZPAN_CLOUD_URL_DEFAULT } from '../../shared/constants'
import type { BindingState } from '../../shared/types'
import { loadBindingState } from '../licensing/has-feature'
import { buildCloudInstanceInfo } from '../licensing/instance-info'
import { normalizeHost } from '../licensing/verify'
import type { Env } from '../middleware/platform'
import { syncPendingCloudTrafficReports } from '../services/cloud-traffic-metering'
import { runLicensingRefresh } from '../services/licensing-refresh-runner'
import { syncPendingRemoteDownloadUsageReports } from '../services/remote-download-usage'

function configuredPublicHost(c: Context<Env>): string | null {
  const origin = configuredPublicOrigin(c)
  return origin ? new URL(origin).host : null
}

function configuredPublicOrigin(c: Context<Env>): string | null {
  const value = c.get('platform').getEnv('ZPAN_PUBLIC_ORIGIN') ?? c.get('platform').getEnv('BETTER_AUTH_URL')
  if (!value) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.origin
  } catch {
    return null
  }
}

function configuredInstanceId(c: Context<Env>): string | undefined {
  return c.get('platform').getEnv('ZPAN_INSTANCE_ID')
}

function runtimeInfo(c: Context<Env>) {
  if (c.get('platform').getBinding('DB')) {
    return { runtime: { provider: 'cloudflare' as const, target: 'cloudflare-worker' as const } }
  }
  return {
    runtime: { provider: 'node' as const, target: 'node/docker' as const },
    server: { os: { platform: process.platform, arch: process.arch, release: osRelease() } },
    node: { version: process.version },
  }
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
    const db = c.get('platform').db
    const cloudBaseUrl = c.get('platform').getEnv('ZPAN_CLOUD_URL') ?? ZPAN_CLOUD_URL_DEFAULT
    const currentHost =
      configuredPublicHost(c) ??
      normalizeHost(c.req.header('x-forwarded-host') ?? c.req.header('host')) ??
      new URL(c.req.url).host
    const state = await loadBindingState(db, { currentHost, cloudBaseUrl })
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

    const db = c.get('platform').db
    const cloudBaseUrl = c.get('platform').getEnv('ZPAN_CLOUD_URL') ?? ZPAN_CLOUD_URL_DEFAULT
    const origin = configuredPublicOrigin(c)
    const instance = origin
      ? await buildCloudInstanceInfo(db, {
          configuredInstanceId: configuredInstanceId(c),
          url: origin,
          runtime: runtimeInfo(c),
        })
      : undefined
    await runLicensingRefresh(db, cloudBaseUrl, instance)

    return c.json({ ok: true })
  })

  .post('/traffic-sync-runs', async (c) => {
    if (!isAuthorizedCronRequest(c)) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const db = c.get('platform').db
    const cloudBaseUrl = c.get('platform').getEnv('ZPAN_CLOUD_URL') ?? ZPAN_CLOUD_URL_DEFAULT
    const [traffic, remoteDownload] = await Promise.all([
      syncPendingCloudTrafficReports({ db, cloudBaseUrl }),
      syncPendingRemoteDownloadUsageReports({ db, cloudBaseUrl }),
    ])

    return c.json({ ok: true, ...traffic, remoteDownload })
  })

export default app

function isAuthorizedCronRequest(c: Context<Env>) {
  const expectedSecret = c.get('platform').getEnv('REFRESH_CRON_SECRET')
  const provided = c.req.query('secret') ?? ''
  return Boolean(expectedSecret && secretsMatch(provided, expectedSecret))
}
