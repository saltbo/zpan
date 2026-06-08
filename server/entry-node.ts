import { release as osRelease } from 'node:os'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { ZPAN_CLOUD_URL_DEFAULT } from '../shared/constants'
import { createBootstrap } from './bootstrap'
import { buildCloudInstanceInfo } from './licensing/instance-info'
import { createLibsqlPlatform } from './platform/libsql'
import { createNodePlatform } from './platform/node'
import { syncPendingCloudTrafficReports } from './services/cloud-traffic-metering'
import { INSTANCE_TELEMETRY_CRON, reportInstanceTelemetry } from './services/instance-telemetry'
import { runLicensingRefresh } from './services/licensing-refresh-runner'
import { syncPendingRemoteDownloadUsageReports } from './services/remote-download-usage'

const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000 // 6 hours
const TRAFFIC_SYNC_INTERVAL_MS = 10 * 60 * 1000 // 10 minutes
const INSTANCE_TELEMETRY_INTERVAL_MS = 12 * 60 * 60 * 1000 // 12 hours

const platform = process.env.TURSO_DATABASE_URL
  ? await createLibsqlPlatform({
      TURSO_DATABASE_URL: process.env.TURSO_DATABASE_URL,
      TURSO_AUTH_TOKEN: process.env.TURSO_AUTH_TOKEN,
    })
  : createNodePlatform()

const app = await createBootstrap(platform)

const server = new Hono()
server.route('/', app)
server.use('/*', serveStatic({ root: './dist' }))
server.get('/*', serveStatic({ root: './dist', path: 'index.html' }))

const port = Number(process.env.PORT) || 8222
console.log(`ZPan server running on http://localhost:${port}`)
serve({ fetch: server.fetch, port })

// Start licensing refresh background scheduler
const cloudBaseUrl = process.env.ZPAN_CLOUD_URL ?? ZPAN_CLOUD_URL_DEFAULT

function configuredPublicOrigin(): string | null {
  const value = process.env.ZPAN_PUBLIC_ORIGIN ?? process.env.BETTER_AUTH_URL
  if (!value) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.origin
  } catch {
    return null
  }
}

console.log('licensing.refresh.scheduler.started interval=6h')
setInterval(() => {
  // runLicensingRefresh handles all errors internally and never rejects.
  void (async () => {
    const instanceUrl = configuredPublicOrigin()
    const instance = instanceUrl
      ? await buildCloudInstanceInfo(platform.db, {
          configuredInstanceId: process.env.ZPAN_INSTANCE_ID,
          url: instanceUrl,
        })
      : undefined
    await runLicensingRefresh(platform.db, cloudBaseUrl, instance)
  })()
}, REFRESH_INTERVAL_MS)

console.log('traffic.sync.scheduler.started interval=10m')
setInterval(() => {
  void syncPendingCloudTrafficReports({ db: platform.db, cloudBaseUrl })
  void syncPendingRemoteDownloadUsageReports({ db: platform.db, cloudBaseUrl })
}, TRAFFIC_SYNC_INTERVAL_MS)

console.log('instance.telemetry.scheduler.started interval=12h')
setInterval(() => {
  void (async () => {
    try {
      await reportInstanceTelemetry({
        db: platform.db,
        config: {
          posthogHost: process.env.ZPAN_POSTHOG_HOST,
          posthogProjectToken: process.env.ZPAN_POSTHOG_PROJECT_TOKEN,
          configuredInstanceId: process.env.ZPAN_INSTANCE_ID,
        },
        cron: INSTANCE_TELEMETRY_CRON,
        runtime: {
          target: 'node/docker',
          hostname: configuredTelemetryHostname(),
          osPlatform: process.platform,
          osArch: process.arch,
          osRelease: osRelease(),
        },
      })
    } catch (err) {
      const code = err instanceof Error ? err.message : String(err)
      console.error(`instance.telemetry.error code=${code}`)
    }
  })()
}, INSTANCE_TELEMETRY_INTERVAL_MS)

function configuredTelemetryHostname(): string | undefined {
  const instanceUrl = configuredPublicOrigin()
  if (instanceUrl) return new URL(instanceUrl).hostname
  return process.env.HOSTNAME
}
