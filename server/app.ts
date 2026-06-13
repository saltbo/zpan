import { release as osRelease } from 'node:os'
import type { Context } from 'hono'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Auth } from './auth'
import { createDeps } from './composition'
import { adminAnnouncements, announcements } from './http/announcements'
import { adminAudit } from './http/audit'
import { adminAuthProviders, publicAuthProviders } from './http/auth-providers'
import backgroundJobs from './http/background-jobs'
import { brandingAdmin, publicBranding } from './http/branding'
import { cloudStore, cloudStoreWebhooks } from './http/cloud-store'
import downloadTasks from './http/download-tasks'
import downloaders, { downloaderSelfRoute } from './http/downloaders'
import emailConfig from './http/email-config'
import { events } from './http/events'
import ihost from './http/ihost'
import ihostConfig from './http/ihost-config'
import internal from './http/internal'
import { adminInviteCodes, publicInviteCodes } from './http/invite-codes'
import licensing from './http/licensing'
import licensingAdmin from './http/licensing-admin'
import { me } from './http/me'
import { notifications } from './http/notifications'
import objects from './http/objects'
import profile from './http/profile'
import { adminQuotas, userQuotas } from './http/quotas'
import redirect from './http/redirect'
import { authedShares, publicShares } from './http/shares'
import { adminSiteInvitations, publicSiteInvitations } from './http/site-invitations'
import storages from './http/storages'
import system from './http/system'
import { publicTeams, teams } from './http/teams'
import { adminTeams } from './http/teams-admin'
import trash from './http/trash'
import users from './http/users'
import webdav from './http/webdav'
import { formatError } from './lib/errors'
import { authMiddleware } from './middleware/auth'
import { imageHostingDomain } from './middleware/image-hosting-domain'
import { accessLog } from './middleware/logger'
import type { Env } from './middleware/platform'
import { platformMiddleware } from './middleware/platform'
import { downloaderOpenAPIDocument } from './openapi/downloader'
import type { Platform } from './platform/interface'
import { getDeployPlatform } from './runtime-platform'
import { INSTANCE_TELEMETRY_CRON, reportInstanceTelemetry } from './services/instance-telemetry'
import { ensureSitePublicOrigin } from './services/site-public-origin'
import type { Deps } from './usecases/deps'

export function createApp(platform: Platform, auth: Auth, deps: Deps = createDeps(platform)) {
  const app = new Hono<Env>()
  const corsOrigins = getCorsOrigins(platform)

  app.use('/*', platformMiddleware(platform, auth))
  app.use('/*', async (c, next) => {
    c.set('deps', deps)
    await next()
  })
  app.use('/*', async (c, next) => {
    const result = await ensureSitePublicOrigin(platform.db, c.req.url).catch((err) => {
      console.error(`site.public_origin.detect.error code=${formatError(err)}`)
      return { origin: null, created: false }
    })

    if (result.created && result.origin && shouldReportInitialTelemetry(c.req.url)) {
      const task = reportInstanceTelemetry({
        db: platform.db,
        config: {
          siteUrl: result.origin,
          allowIp: envAllowsIp(platform.getEnv('ZPAN_TELEMETRY_ALLOW_IP')),
        },
        cron: INSTANCE_TELEMETRY_CRON,
        trigger: 'runtime',
        runtime: instanceTelemetryRuntime(platform),
      }).catch((err) => {
        console.error(`instance.telemetry.initial_report.error code=${formatError(err)}`)
      })
      waitUntil(c, task)
    }

    await next()
  })
  app.use('/*', imageHostingDomain)
  app.use('/api/*', accessLog)
  app.use('/dav', accessLog)
  app.use('/dav/*', accessLog)

  app.use(
    '/api/*',
    cors({
      origin: (origin) => (origin && corsOrigins.has(origin) ? origin : null),
      allowHeaders: ['Content-Type', 'Authorization'],
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      credentials: true,
    }),
  )

  app.on(['POST', 'GET'], '/api/auth/*', async (c) => {
    const a = c.get('auth')
    return a.handler(c.req.raw)
  })

  app.get('/api/openapi/downloader.json', (c) => c.json(downloaderOpenAPIDocument()))

  app.all('/dav', (c) => c.redirect('/dav/', 308))
  app.route('/dav', webdav)

  // Public routes — no auth required; mount before authMiddleware.
  // /api/shares/:token endpoints are covered by run_worker_first=["/api/*"] in wrangler.toml.
  // /r/* is listed separately in run_worker_first.
  // /s/:token is intentionally left for the SPA landing page.
  app.route('/api/shares', publicShares)
  app.route('/r', redirect)
  app.route('/api/profiles', profile)
  app.route('/api/teams', publicTeams)
  app.route('/api/auth-providers', publicAuthProviders)
  app.route('/api/licensing', licensing)
  app.route('/api/branding', publicBranding)
  app.route('/api/site-invitations', publicSiteInvitations)
  app.route('/api/store', cloudStoreWebhooks)
  app.route('/api/internal', internal)

  app.use('/api/*', authMiddleware)

  app.route('/api/me', me)
  app.route('/api/announcements', announcements)

  // Mount routes separately to avoid deep type chain accumulation.
  // Each .route() call is independent — TypeScript doesn't stack types.
  app.route('/api/objects', objects)
  app.route('/api/shares', authedShares)
  app.route('/api/trash', trash)
  app.route('/api/teams', teams)
  app.route('/api/admin/storages', storages)
  app.route('/api/admin/users', users)
  app.route('/api/admin/email-config', emailConfig)
  app.route('/api/admin/invite-codes', adminInviteCodes)
  app.route('/api/invite-codes', publicInviteCodes)
  app.route('/api/admin/site-invitations', adminSiteInvitations)
  app.route('/api/admin/quotas', adminQuotas)
  app.route('/api/admin/teams', adminTeams)
  app.route('/api/quotas', userQuotas)
  app.route('/api/store', cloudStore)
  app.route('/api/system', system)
  app.route('/api/admin/auth-providers', adminAuthProviders)
  app.route('/api/notifications', notifications)
  app.route('/api/background-jobs', backgroundJobs)
  app.route('/api/download-tasks', downloadTasks)
  app.route('/api/events', events)
  app.route('/api/downloader', downloaderSelfRoute)
  app.route('/api/ihost', ihost)
  app.route('/api/ihost/config', ihostConfig)
  app.route('/api/licensing', licensingAdmin)
  app.route('/api/admin/branding', brandingAdmin)
  app.route('/api/admin/announcements', adminAnnouncements)
  app.route('/api/admin/audit', adminAudit)
  app.route('/api/admin/downloaders', downloaders)

  app.get('/api/health', (c) => c.json({ status: 'ok' }))

  return app
}

function envAllowsIp(value: string | undefined): boolean {
  return !['0', 'false', 'no', 'off'].includes(value?.trim().toLowerCase() ?? '')
}

function instanceTelemetryRuntime(platform: Platform) {
  if (platform.getBinding('DB')) {
    return {
      runtime: 'workerd' as const,
      platform: 'cloudflare-workers' as const,
    }
  }

  return {
    runtime: 'node' as const,
    platform: getDeployPlatform() ?? 'node',
    osPlatform: process.platform,
    osArch: process.arch,
    osRelease: osRelease(),
    nodeVersion: process.version,
  }
}

function waitUntil(c: Context, task: Promise<unknown>): void {
  try {
    c.executionCtx.waitUntil(task)
    return
  } catch {
    void task
  }
}

function shouldReportInitialTelemetry(requestUrl: string): boolean {
  const url = new URL(requestUrl)
  if (url.pathname === '/api/internal/instance-telemetry/report') return false
  return !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
}

function getCorsOrigins(platform: Platform): Set<string> {
  const origins = new Set<string>()
  const addOrigin = (value: string | undefined) => {
    if (!value) return
    try {
      origins.add(new URL(value).origin)
    } catch {
      origins.add(value)
    }
  }

  addOrigin(platform.getEnv('BETTER_AUTH_URL'))
  for (const origin of platform.getEnv('TRUSTED_ORIGINS')?.split(',') ?? []) {
    addOrigin(origin.trim())
  }

  return origins
}

export type AppType = ReturnType<typeof createApp>

// Sub-router types for RPC clients — avoids combined AppType OOM
export type ObjectsRoute = typeof objects
export type PublicSharesRoute = typeof publicShares
export type AuthedSharesRoute = typeof authedShares
export type TrashRoute = typeof trash
export type StoragesRoute = typeof storages
export type UsersRoute = typeof users
export type AdminQuotasRoute = typeof adminQuotas
export type AdminTeamsRoute = typeof adminTeams
export type UserQuotasRoute = typeof userQuotas
export type SystemRoute = typeof system
export type EmailConfigRoute = typeof emailConfig
export type AdminInviteCodesRoute = typeof adminInviteCodes
export type PublicInviteCodesRoute = typeof publicInviteCodes
export type AdminSiteInvitationsRoute = typeof adminSiteInvitations
export type PublicSiteInvitationsRoute = typeof publicSiteInvitations
export type AuthProvidersRoute = typeof publicAuthProviders
export type AdminAuthProvidersRoute = typeof adminAuthProviders
export type ProfileRoute = typeof profile
export type CloudStoreRoute = typeof cloudStore
export type CloudStoreWebhooksRoute = typeof cloudStoreWebhooks
export type TeamsRoute = typeof teams
export type PublicTeamsRoute = typeof publicTeams
export type NotificationsRoute = typeof notifications
export type BackgroundJobsRoute = typeof backgroundJobs
export type DownloadTasksRoute = typeof downloadTasks
export type EventsRoute = typeof events
export type DownloadersRoute = typeof downloaders
export type DownloaderSelfRoute = typeof downloaderSelfRoute
export type IhostRoute = typeof ihost
export type IhostConfigRoute = typeof ihostConfig
export type MeRoute = typeof me
export type AnnouncementsRoute = typeof announcements
export type AdminAnnouncementsRoute = typeof adminAnnouncements
export type LicensingRoute = typeof licensing
export type LicensingAdminRoute = typeof licensingAdmin
export type PublicBrandingRoute = typeof publicBranding
export type BrandingAdminRoute = typeof brandingAdmin
export type AdminAuditRoute = typeof adminAudit
