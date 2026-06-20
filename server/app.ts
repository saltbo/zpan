import { release as osRelease } from 'node:os'
import { OpenAPIHono } from '@hono/zod-openapi'
import { Scalar } from '@scalar/hono-api-reference'
import type { Context } from 'hono'
import { cors } from 'hono/cors'
import type { Auth } from './auth'
import { createDeps } from './composition'
import { serveAvatarBlob } from './http/avatar-blobs'
import backgroundJobs from './http/background-jobs'
import downloadTasks from './http/downloads/download-tasks'
import downloaders, { downloaderSelfRoute } from './http/downloads/downloaders'
import { events } from './http/events'
import ihostConfig from './http/image-hosting/config'
import ihost from './http/image-hosting/images'
import internal from './http/internal'
import { notifications } from './http/notifications'
import objects from './http/objects'
import { adminQuotas, userQuotas } from './http/quotas'
import redirect from './http/redirect'
import { authedShares, publicShares } from './http/shares'
import { announcements } from './http/site/announcements'
import { adminAudit } from './http/site/audit'
import { authProviders } from './http/site/auth-providers'
import { brandingAdmin, publicBranding } from './http/site/branding'
import emailConfig from './http/site/email-config'
import { adminSiteInvitations, publicSiteInvitations } from './http/site/invitations'
import { adminInviteCodes, publicInviteCodes } from './http/site/invite-codes'
import { licensing, licensingAdmin } from './http/site/licensing'
import storages from './http/site/storages'
import system from './http/site/system'
import { cloudStore, cloudStoreWebhooks } from './http/store'
import { adminTeams, publicTeams, teams } from './http/teams'
import trash from './http/trash'
import { users } from './http/users'
import webdav from './http/webdav'
import { formatError } from './lib/errors'
import { authMiddleware } from './middleware/auth'
import { isHandledError, jsonError } from './middleware/error-handler'
import { imageHostingDomain } from './middleware/image-hosting-domain'
import { accessLog } from './middleware/logger'
import type { Env } from './middleware/platform'
import { platformMiddleware } from './middleware/platform'
import type { Platform } from './platform/interface'
import { getDeployPlatform } from './runtime-platform'
import type { Deps } from './usecases/deps'
import { INSTANCE_TELEMETRY_CRON, reportInstanceTelemetry } from './usecases/site/instance-telemetry'
import { ensureSitePublicOrigin } from './usecases/site/public-origin'

export function createApp(platform: Platform, auth: Auth, deps: Deps = createDeps(platform)) {
  const app = new OpenAPIHono<Env>()
  const corsOrigins = getCorsOrigins(platform)

  app.use('/*', platformMiddleware(platform, auth))
  app.use('/*', async (c, next) => {
    c.set('deps', deps)
    await next()
  })
  app.use('/*', async (c, next) => {
    const result = await ensureSitePublicOrigin(deps, c.req.url).catch((err) => {
      console.error(`site.public_origin.detect.error code=${formatError(err)}`)
      return { origin: null, created: false }
    })

    if (result.created && result.origin && shouldReportInitialTelemetry(c.req.url)) {
      const task = reportInstanceTelemetry(deps, {
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

  // Global OpenAPI document. Aggregates every route defined with `.openapi()`
  // across all mounted sub-apps — a route appears here as soon as its resource is
  // converted to OpenAPIHono, no curation needed. better-auth endpoints (incl. the
  // device flow) document themselves separately at /api/auth/reference.
  app.get('/api/openapi.json', async (c) => {
    const doc = app.getOpenAPIDocument({
      openapi: '3.1.0',
      info: { title: 'ZPan API', version: '0.1.0' },
      // Top-level tag order + descriptions; Scalar groups operations by these.
      tags: [
        { name: 'Objects', description: 'Files and folders, including S3 multipart upload sessions' },
        { name: 'Events', description: 'Multiplexed server-sent event stream' },
        { name: 'Download Tasks', description: 'Remote download tasks' },
        { name: 'Downloaders', description: 'Download agents and their heartbeats' },
      ],
    })

    // Merge better-auth's own auto-generated schema (sign-in/up, organization,
    // the device-authorization flow, …) into the same document. Both halves are
    // generated — nothing here is a hand-maintained endpoint definition; new
    // better-auth endpoints appear automatically. Its paths are relative to the
    // /api/auth mount, so prefix them.
    const authDoc = (await c.get('auth').api.generateOpenAPISchema()) as {
      paths?: Record<string, unknown>
      components?: { schemas?: Record<string, unknown> }
    }
    for (const [path, item] of Object.entries(authDoc.paths ?? {})) {
      doc.paths[`/api/auth${path}`] = item as (typeof doc.paths)[string]
    }
    doc.components ??= {}
    doc.components.schemas = {
      ...(authDoc.components?.schemas as typeof doc.components.schemas),
      ...doc.components.schemas,
    }

    // better-auth's device-authorization plugin advertises POST /device/token as
    // returning { session, user }, but its handler actually returns the OAuth
    // device token { access_token, token_type, expires_in } (see better-auth's
    // device-authorization/routes.mjs). Correct that one wrong response so the
    // document — and the generated downloader client — match the real wire shape.
    const deviceTokenJson = (
      doc.paths['/api/auth/device/token'] as
        | { post?: { responses?: Record<string, { content?: Record<string, { schema?: unknown }> }> } }
        | undefined
    )?.post?.responses?.['200']?.content?.['application/json']
    if (deviceTokenJson) {
      deviceTokenJson.schema = {
        type: 'object',
        properties: {
          access_token: { type: 'string' },
          token_type: { type: 'string' },
          expires_in: { type: 'integer' },
          scope: { type: 'string' },
        },
        required: ['access_token', 'token_type', 'expires_in'],
      }
    }

    return c.json(doc)
  })

  // Scalar interactive API reference for the global document above. Our own
  // resources live here; better-auth serves its own reference at /api/auth/reference.
  app.get('/api/docs', Scalar({ url: '/api/openapi.json', title: 'ZPan API' }))

  app.all('/dav', (c) => c.redirect('/dav/', 308))
  app.route('/dav', webdav)

  // Resolve the caller's principal for every /api/* route. authMiddleware is
  // soft-fail: it populates userId/orgId/principal (or null) and never rejects an
  // anonymous caller — per-route guards (requireAuth/requireAdmin/requireTeamRole,
  // or a shared-secret/signature check) do the gating. Running it ahead of every
  // /api route lets one router per resource mix public and authed endpoints.
  app.use('/api/*', authMiddleware)

  // Public routes — no per-route auth guard.
  // /api/shares/:token endpoints are covered by run_worker_first=["/api/*"] in wrangler.toml.
  // /r/* is listed separately in run_worker_first.
  // /s/:token is intentionally left for the SPA landing page.
  app.route('/api/shares', publicShares)
  // Self-hosted avatar blobs (CF + AVATARS R2 binding, no AVATARS_PUBLIC_URL). Public.
  app.get('/api/avatar-blobs/:scope/:id', serveAvatarBlob)
  app.route('/r', redirect)
  app.route('/api/teams', publicTeams)
  app.route('/api/site/auth-providers', authProviders)
  app.route('/api/site/licensing', licensing)
  app.route('/api/site/branding', publicBranding)
  app.route('/api/site/invitations', publicSiteInvitations)
  app.route('/api/store', cloudStoreWebhooks)
  app.route('/api/internal', internal)

  app.route('/api/users', users)
  app.route('/api/site/announcements', announcements)

  // Mount routes separately to avoid deep type chain accumulation.
  // Each .route() call is independent — TypeScript doesn't stack types.
  // Authorization is per-route (requireAuth/requireAdmin/requireTeamRole), so a
  // single resource path serves both public/user and admin callers.
  app.route('/api/objects', objects)
  app.route('/api/shares', authedShares)
  app.route('/api/trash', trash)
  app.route('/api/teams', teams)
  app.route('/api/teams', adminTeams)
  app.route('/api/site/storages', storages)
  app.route('/api/site/email', emailConfig)
  // Public/user router mounts BEFORE the admin router on a shared path: a sub-app's
  // blanket `.use(requireAdmin)` becomes prefix-wide middleware, so mounting admin
  // first would gate the public routes too.
  app.route('/api/site/invite-codes', publicInviteCodes)
  app.route('/api/site/invite-codes', adminInviteCodes)
  app.route('/api/site/invitations', adminSiteInvitations)
  app.route('/api/quotas', userQuotas)
  app.route('/api/quotas', adminQuotas)
  app.route('/api/store', cloudStore)
  app.route('/api/site', system)
  app.route('/api/notifications', notifications)
  app.route('/api/background-jobs', backgroundJobs)
  app.route('/api/downloads/tasks', downloadTasks)
  app.route('/api/events', events)
  app.route('/api/downloads/downloaders', downloaderSelfRoute)
  app.route('/api/image-hosting', ihost)
  app.route('/api/image-hosting/config', ihostConfig)
  app.route('/api/site/licensing', licensingAdmin)
  app.route('/api/site/branding', brandingAdmin)
  app.route('/api/site/audit-events', adminAudit)
  app.route('/api/downloads/downloaders', downloaders)

  app.get('/api/health', (c) => c.json({ status: 'ok' }))

  // Backstop for errors thrown outside the accessLog boundary (earlier middleware,
  // or routes without accessLog like /r). For /api and /dav, accessLog already
  // catches and renders via the same `jsonError`, so this rarely fires there.
  // Genuinely unhandled errors are logged here since those routes aren't access-
  // logged; AppError/mapped cases are already carried by their access-log line.
  app.onError((err, c) => {
    if (!isHandledError(err)) console.error(`http.unhandled_error code=${formatError(err)}`)
    return jsonError(c, err)
  })

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
export type AuthProvidersRoute = typeof authProviders
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
export type AnnouncementsRoute = typeof announcements
export type LicensingRoute = typeof licensing
export type LicensingAdminRoute = typeof licensingAdmin
export type PublicBrandingRoute = typeof publicBranding
export type BrandingAdminRoute = typeof brandingAdmin
export type AdminAuditRoute = typeof adminAudit
