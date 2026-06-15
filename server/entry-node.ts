import { existsSync } from 'node:fs'
import { release as osRelease } from 'node:os'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { resolveAppCommit, resolveAppVersion } from '../scripts/app-version.mjs'
import { ZPAN_CLOUD_URL_DEFAULT } from '../shared/constants'
import { createQuotaRepo } from './adapters/repos/quota'
import { createBootstrap } from './bootstrap'
import { createDeps } from './composition'
import { createLibsqlPlatform } from './platform/libsql'
import { createNodePlatform } from './platform/node'
import { type DeployPlatform, setDeployPlatform } from './runtime-platform'
import { syncPendingCloudTrafficReports } from './usecases/cloud-traffic-metering'
import { syncPendingRemoteDownloadUsageReports } from './usecases/downloads/remote-download-usage'
import { purgeExpiredTrash, resolveTrashRetentionDays } from './usecases/purge'
import { buildCloudInstanceInfo, runtimeInfo } from './usecases/site/instance-info'
import { INSTANCE_TELEMETRY_CRON, reportInstanceTelemetry } from './usecases/site/instance-telemetry'
import { runLicensingRefresh } from './usecases/site/licensing'
import { getSitePublicOrigin } from './usecases/site/public-origin'

const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000 // 6 hours
const TRAFFIC_SYNC_INTERVAL_MS = 10 * 60 * 1000 // 10 minutes
const INSTANCE_TELEMETRY_INTERVAL_MS = 12 * 60 * 60 * 1000 // 12 hours
const QUOTA_RESET_INTERVAL_MS = 24 * 60 * 60 * 1000 // daily; idempotent, resets only stale periods
const TRASH_PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000 // daily; purges trash past the retention window
const appVersionGlobalKey = '__ZPAN_APP_VERSION__'
const appCommitGlobalKey = '__ZPAN_APP_COMMIT__'

// tsx runs this entry directly (dev + E2E) without the tsup build-time define,
// so resolve the version at runtime. In the built output the define inlines the
// constant, turning this condition into `if (false)`, so resolveAppVersion is
// never reached and git is never invoked in production. The assignment uses
// bracket access so the define does not rewrite it into an invalid literal LHS.
if (!globalThis.__ZPAN_APP_VERSION__) {
  globalThis[appVersionGlobalKey] = resolveAppVersion()
}
if (globalThis.__ZPAN_APP_COMMIT__ === undefined) {
  globalThis[appCommitGlobalKey] = resolveAppCommit()
}

// The Node entry serves Cloud Run, Docker, and bare Node. Cloud Run sets
// K_SERVICE; the Docker image sets ZPAN_RUNTIME=docker (falling back to the
// /.dockerenv marker); otherwise it is plain Node.
function detectNodePlatform(): DeployPlatform {
  if (process.env.K_SERVICE) return 'cloud-run'
  if (process.env.ZPAN_RUNTIME === 'docker' || existsSync('/.dockerenv')) return 'docker'
  return 'node'
}
setDeployPlatform(detectNodePlatform())

const platform = process.env.TURSO_DATABASE_URL
  ? await createLibsqlPlatform({
      TURSO_DATABASE_URL: process.env.TURSO_DATABASE_URL,
      TURSO_AUTH_TOKEN: process.env.TURSO_AUTH_TOKEN,
    })
  : createNodePlatform()

const deps = createDeps(platform)
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
    const instanceUrl = await getSitePublicOrigin(deps)
    const instance = instanceUrl
      ? await buildCloudInstanceInfo(deps, {
          url: instanceUrl,
          runtime: runtimeInfo(platform),
        })
      : undefined
    await runLicensingRefresh(deps, cloudBaseUrl, instance)
  })()
}, REFRESH_INTERVAL_MS)

console.log('traffic.sync.scheduler.started interval=10m')
setInterval(() => {
  void syncPendingCloudTrafficReports(deps, { cloudBaseUrl })
  void syncPendingRemoteDownloadUsageReports(deps, { cloudBaseUrl })
}, TRAFFIC_SYNC_INTERVAL_MS)

function reportNodeInstanceTelemetry(): void {
  if (isGitHubActionsE2E()) return

  void (async () => {
    try {
      await reportInstanceTelemetry(deps, {
        config: {
          allowIp: envAllowsIp(process.env.ZPAN_TELEMETRY_ALLOW_IP),
        },
        cron: INSTANCE_TELEMETRY_CRON,
        trigger: 'runtime',
        runtime: {
          runtime: 'node',
          platform: detectNodePlatform(),
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

console.log('quota.reset.scheduler.started interval=24h')
// Run once at boot to catch a month boundary crossed while the server was down.
void createQuotaRepo(platform.db).resetExpiredTrafficQuotas()
setInterval(() => {
  void createQuotaRepo(platform.db).resetExpiredTrafficQuotas()
}, QUOTA_RESET_INTERVAL_MS)

console.log('trash.purge.scheduler.started interval=24h')
function purgeExpiredTrashJob(): void {
  void (async () => {
    try {
      const purged = await purgeExpiredTrash(deps, resolveTrashRetentionDays(process.env.ZPAN_TRASH_RETENTION_DAYS))
      if (purged > 0) console.log(`trash.purge.done count=${purged}`)
    } catch (err) {
      console.error(`trash.purge.error code=${err instanceof Error ? err.message : String(err)}`)
    }
  })()
}
purgeExpiredTrashJob()
setInterval(purgeExpiredTrashJob, TRASH_PURGE_INTERVAL_MS)
