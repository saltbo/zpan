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
import { getSitePublicOrigin } from './services/site-public-origin'

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

function envAllowsIp(value: string | undefined): boolean {
  return !['0', 'false', 'no', 'off'].includes(value?.trim().toLowerCase() ?? '')
}

function isGitHubActionsE2E(): boolean {
  return process.env.GITHUB_ACTIONS === 'true' && process.env.BETTER_AUTH_URL === 'http://localhost:5185'
}

console.log('licensing.refresh.scheduler.started interval=6h')
setInterval(() => {
  // runLicensingRefresh handles all errors internally and never rejects.
  void (async () => {
    const instanceUrl = await getSitePublicOrigin(platform.db)
    const instance = instanceUrl
      ? await buildCloudInstanceInfo(platform.db, {
          url: instanceUrl,
          runtime: {
            runtime: { provider: 'node', target: 'node/docker' },
            server: { os: { platform: process.platform, arch: process.arch, release: osRelease() } },
            node: { version: process.version },
          },
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

function reportNodeInstanceTelemetry(): void {
  if (isGitHubActionsE2E()) return

  void (async () => {
    try {
      await reportInstanceTelemetry({
        db: platform.db,
        config: {
          allowIp: envAllowsIp(process.env.ZPAN_TELEMETRY_ALLOW_IP),
        },
        cron: INSTANCE_TELEMETRY_CRON,
        trigger: 'runtime',
        runtime: {
          target: 'node/docker',
          provider: 'node',
          osPlatform: process.platform,
          osArch: process.arch,
          osRelease: osRelease(),
          nodeVersion: process.version,
        },
      })
    } catch (err) {
      const code = err instanceof Error ? err.message : String(err)
      console.error(`instance.telemetry.error code=${code}`)
    }
  })()
}

console.log('instance.telemetry.scheduler.started interval=12h')
reportNodeInstanceTelemetry()
setInterval(reportNodeInstanceTelemetry, INSTANCE_TELEMETRY_INTERVAL_MS)
