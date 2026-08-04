import { release as osRelease } from 'node:os'
import { OpenAPIHono } from '@hono/zod-openapi'
import { Scalar } from '@scalar/hono-api-reference'
import { AuthorizationScope } from '@shared/authorization'
import { OAUTH_RESOURCE_SCOPES, OAUTH_SCOPE_DESCRIPTIONS } from '@shared/oauth'
import type { Context } from 'hono'
import { cors } from 'hono/cors'
import type { Auth } from './auth'
import { addOAuthClientRegistrationManagementOpenApi } from './auth/oauth-client-registration-management'
import { cacheServerTiming, runWithCacheEvents } from './cache/context'
import { createDeps } from './composition'
import { isPotentialWebDavPublicRequest, isWebDavPublicRequest } from './domain/webdav-public-url'
import { adminOverview } from './http/admin-overview'
import { adminStats } from './http/admin-stats'
import { ARAZZO_DOCUMENT_PATH, ARAZZO_MEDIA_TYPE, createArazzoDocument } from './http/arazzo'
import { serveAvatarBlob } from './http/avatar-blobs'
import backgroundJobs from './http/background-jobs'
import { addRegisteredBetterAuthOpenApiOperations, DOWNLOADER_DEVICE_FLOW_TAG } from './http/better-auth-openapi'
import { configz } from './http/configz'
import downloadTasks, { downloaderTasksRoute } from './http/downloads/download-tasks'
import downloaders, { downloaderSelfRoute } from './http/downloads/downloaders'
import { events } from './http/events'
import ihostConfig from './http/image-hosting/config'
import ihost from './http/image-hosting/images'
import internal from './http/internal'
import { notifications } from './http/notifications'
import { oauthAuthorizationDetails } from './http/oauth-authorization-details'
import { oauthGrants } from './http/oauth-grants'
import objects from './http/objects'
import { addRequestIdOpenApi } from './http/openapi'
import { adminQuotas, userQuotas } from './http/quotas'
import redirect from './http/redirect'
import { authedShares, publicShares } from './http/shares'
import { announcements } from './http/site/announcements'
import { adminAudit } from './http/site/audit'
import { authProviders } from './http/site/auth-providers'
import { brandingAdmin } from './http/site/branding'
import emailConfig from './http/site/email-config'
import imageDomainProvider from './http/site/image-domain-provider'
import { adminSiteInvitations, publicSiteInvitations } from './http/site/invitations'
import { adminInviteCodes, publicInviteCodes } from './http/site/invite-codes'
import { licensing, licensingAdmin } from './http/site/licensing'
import { siteSettings } from './http/site/settings'
import storages from './http/site/storages'
import system from './http/site/system'
import storageUsage from './http/storage-usage'
import { cloudStore, cloudStoreWebhooks } from './http/store'
import { adminTeams, publicTeams, teams } from './http/teams'
import trash from './http/trash'
import { users } from './http/users'
import webdav from './http/webdav'
import { formatError } from './lib/errors'
import { auditMiddleware } from './middleware/audit'
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
import { getSiteRoutingConfig } from './usecases/site/routing-config'

export function createApp(platform: Platform, auth: Auth, deps: Deps = createDeps(platform)) {
  const app = new OpenAPIHono<Env>()
  const corsOrigins = getCorsOrigins(platform)

  app.use('/*', platformMiddleware(platform, auth))
  app.use('/*', async (c, next) => {
    // An SSE connection outlives the response setup by minutes. Keeping request
    // diagnostics attached would retain its AsyncLocalStorage store for the
    // whole stream even though the polling loop does not use the cache.
    if (c.req.path === '/api/events' || c.req.path === '/api/events/') {
      await next()
      return
    }
    await runWithCacheEvents(async () => {
      await next()
      const serverTiming = cacheServerTiming()
      if (serverTiming) c.res.headers.append('Server-Timing', serverTiming)
    })
  })
  app.use('/*', async (c, next) => {
    c.set('deps', deps)
    await next()
  })
  app.use('/*', async (c, next) => {
    if (isPotentialWebDavPublicRequest(c.req.url)) {
      const routing = await getSiteRoutingConfig(deps)
      c.set('webDavEnabled', routing.webDavEnabled)
      c.set('webDavDomain', routing.webDavDomain)
      const routingOrigin = routing.publicOrigin ?? (routing.webDavDomain ? new URL(c.req.url).origin : null)
      if (routing.webDavEnabled && isWebDavPublicRequest(c.req.url, routingOrigin, routing.webDavDomain)) {
        c.set('sitePublicOrigin', routingOrigin)
        c.set('webDavMountPath', '')
        await next()
        return
      }
    }
    const result = await ensureSitePublicOrigin(deps, c.req.url).catch((err) => {
      console.error(`site.public_origin.detect.error code=${formatError(err)}`)
      return { origin: null, created: false }
    })
    c.set('sitePublicOrigin', result.origin)

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
      exposeHeaders: ['Request-Id'],
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      credentials: true,
    }),
  )

  app.route('/api/auth/oauth2/authorization-details/catalog', oauthAuthorizationDetails)

  app.on(['POST', 'GET', 'HEAD', 'PUT', 'DELETE'], '/api/auth/*', async (c) => {
    const a = c.get('auth')
    const revokeRequest = c.req.path === '/api/auth/oauth2/revoke' ? c.req.raw.clone() : null
    const response = await a.handler(c.req.raw)
    if (revokeRequest && response.status === 400) {
      const error = (await response
        .clone()
        .json()
        .catch(() => null)) as { error?: string } | null
      if (error?.error === 'unsupported_token_type') {
        const token = (await revokeRequest.formData()).get('token')
        if (typeof token === 'string') {
          await c.get('deps').oauth.revokeJwtAccessToken(c.get('platform').db, token)
          return new Response(null, {
            status: 200,
            headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' },
          })
        }
      }
    }
    return response
  })

  app.on(['GET', 'HEAD'], '/.well-known/oauth-authorization-server/api/auth', async (c) => {
    const response = await c.get('auth').handler(c.req.raw)
    if (c.req.method === 'HEAD' || !response.ok) return response
    const metadata = (await response.json()) as Record<string, unknown>
    const authOrigin = new URL((await c.get('auth').$context).baseURL).origin
    return c.json({
      ...metadata,
      authorization_details_catalog_endpoint: `${authOrigin}/api/auth/oauth2/authorization-details/catalog`,
      authorization_details_catalog_scope: AuthorizationScope.WORKSPACES_DISCOVER,
      authorization_details_catalog_version: 1,
    })
  })

  app.on(['GET', 'HEAD'], '/.well-known/openid-configuration/api/auth', async (c) => {
    const url = new URL(c.req.url)
    url.pathname = '/api/auth/.well-known/openid-configuration'
    const response = await c.get('auth').handler(new Request(url, c.req.raw))
    if (c.req.method === 'HEAD' || !response.ok) return response
    const metadata = (await response.json()) as Record<string, unknown>
    const authOrigin = new URL((await c.get('auth').$context).baseURL).origin
    return c.json({
      ...metadata,
      authorization_details_catalog_endpoint: `${authOrigin}/api/auth/oauth2/authorization-details/catalog`,
      authorization_details_catalog_scope: AuthorizationScope.WORKSPACES_DISCOVER,
      authorization_details_catalog_version: 1,
    })
  })

  app.on(['GET', 'HEAD'], '/.well-known/oauth-protected-resource/api', async (c) => {
    const origin = new URL(c.req.url).origin
    const authorizationServer = (await c.get('auth').$context).baseURL
    return c.json({
      resource: `${origin}/api`,
      authorization_servers: [authorizationServer],
      bearer_methods_supported: ['header'],
      scopes_supported: OAUTH_RESOURCE_SCOPES,
      dpop_signing_alg_values_supported: ['ES256', 'EdDSA'],
      resource_name: 'ZPan API',
    })
  })

  app.get('/api', (c) => {
    c.header(
      'Link',
      [
        '</api/openapi.json>; rel="service-desc"; type="application/openapi+json"',
        `<${ARAZZO_DOCUMENT_PATH}>; rel="describedby"; type="application/vnd.oai.workflows+json"`,
      ].join(', '),
    )
    return c.json({ name: 'ZPan API', openapi: '/api/openapi.json', workflows: ARAZZO_DOCUMENT_PATH })
  })

  app.on(['GET', 'HEAD'], ARAZZO_DOCUMENT_PATH, (c) => {
    const headers = {
      'Cache-Control': 'public, max-age=300',
      'Content-Type': ARAZZO_MEDIA_TYPE,
    }
    if (c.req.method === 'HEAD') return c.newResponse(null, 200, headers)
    return c.newResponse(JSON.stringify(createArazzoDocument(new URL(c.req.url).origin)), 200, headers)
  })

  // Global OpenAPI document. ZPan routes defined with `.openapi()` are
  // aggregated across all mounted sub-apps. Better Auth documents its complete
  // runtime surface separately at /api/auth/reference; only the Downloader
  // Device Flow protocol is explicitly admitted to this product contract.
  app.get('/api/openapi.json', async (c) => {
    const doc = app.getOpenAPIDocument({
      openapi: '3.1.0',
      info: { title: 'ZPan API', version: '0.1.0' },
      servers: [{ url: '/', description: 'Current ZPan origin' }],
      externalDocs: {
        description: 'Machine-readable API workflows (Arazzo 1.1)',
        url: ARAZZO_DOCUMENT_PATH,
      },
      // Top-level tag order + descriptions; Scalar groups operations by these.
      tags: [
        { name: 'Objects', description: 'Files and folders, including S3 multipart upload sessions' },
        { name: 'Events', description: 'Multiplexed server-sent event stream' },
        { name: 'Download Tasks', description: 'Remote download tasks' },
        { name: 'Downloaders', description: 'Download agents and their heartbeats' },
        {
          name: DOWNLOADER_DEVICE_FLOW_TAG,
          description: 'Public device authorization protocol used by downloader clients',
        },
      ],
    })

    doc.components ??= {}
    doc.components.securitySchemes = {
      ...(doc.components.securitySchemes ?? {}),
      cookieAuth: { type: 'apiKey', in: 'cookie', name: 'zp.session_token' },
      bearerAuth: { type: 'http', scheme: 'bearer' },
      oauth2: {
        type: 'oauth2',
        flows: {
          authorizationCode: {
            authorizationUrl: '/api/auth/oauth2/authorize',
            tokenUrl: '/api/auth/oauth2/token',
            refreshUrl: '/api/auth/oauth2/token',
            scopes: {
              ...agentScopeDescriptions(),
            },
          },
        },
      },
    }
    addOAuthClientRegistrationManagementOpenApi(doc)

    // Better Auth owns the runtime routes and its complete reference schema.
    // The product contract imports only operations whose path, method, public
    // identity, tags, security, and any narrow correction are registered
    // explicitly. Reachable components are copied transitively; everything
    // else remains private by default.
    const authDoc = await c.get('auth').api.generateOpenAPISchema()
    addRegisteredBetterAuthOpenApiOperations(doc, authDoc)
    Object.assign(doc, {
      'x-zpan-discovery': {
        oauthAuthorizationServer: '/.well-known/oauth-authorization-server/api/auth',
        oauthProtectedResource: '/.well-known/oauth-protected-resource/api',
      },
      'x-cli-config': {
        profiles: {
          default: {
            credentials: {
              oauth2: {
                auth: {
                  type: 'api-key',
                  params: {
                    in: 'header',
                    name: 'Authorization',
                    value: 'DPoP',
                    provider: 'realmroot-target',
                    scopes: OAUTH_RESOURCE_SCOPES.join(' '),
                  },
                },
              },
            },
          },
        },
      },
    })
    addRequestIdOpenApi(doc)

    return c.json(doc)
  })

  // Scalar interactive API reference for the global document above. Our own
  // resources live here; better-auth serves its own reference at /api/auth/reference.
  app.get('/api/docs', Scalar({ url: '/api/openapi.json', title: 'ZPan API' }))

  app.route('/dav', webdav)

  // Resolve the caller's principal for API routes that can use it. Public,
  // identity-independent health/config responses skip session resolution so
  // their hot path does not touch auth tables.
  const skipsPrincipalResolution = (path: string) =>
    path === '/api/configz' || path === '/api/configz/' || path === '/api/health'

  // authMiddleware is soft-fail: it resolves the protocol-specific credential
  // into a principal and protocol-neutral authorization context. Each authRoute
  // declaration then performs the runtime authorization, so one router can mix
  // public and protected endpoints without a second guard mapping.
  app.use('/api/*', async (c, next) => {
    if (skipsPrincipalResolution(c.req.path)) {
      await next()
      return
    }
    await authMiddleware(c, next)
  })
  app.use('/api/*', async (c, next) => {
    if (skipsPrincipalResolution(c.req.path)) {
      await next()
      return
    }
    await auditMiddleware(c, next)
  })

  // Public routes — no per-route auth guard.
  // /api/shares/:token endpoints are covered by run_worker_first=["/api/*"] in wrangler.toml.
  // /r/* is listed separately in run_worker_first.
  // /s/:token is intentionally left for the SPA landing page.
  app.route('/api/shares', publicShares)
  app.route('/api/configz', configz)
  // Self-hosted avatar blobs (CF + AVATARS R2 binding, no AVATARS_PUBLIC_URL). Public.
  app.get('/api/avatar-blobs/:scope/:id', serveAvatarBlob)
  app.route('/r', redirect)
  app.route('/api/teams', publicTeams)
  app.route('/api/site/invitations', publicSiteInvitations)
  app.route('/api/store', cloudStoreWebhooks)
  app.route('/api/internal', internal)

  app.route('/api/users', users)
  app.route('/api/site/announcements', announcements)
  app.route('/api/site/licensing', licensing)

  // Mount routes separately to avoid deep type chain accumulation.
  // Each .route() call is independent — TypeScript doesn't stack types.
  // Authorization comes from each authRoute declaration, so a single resource
  // path can serve public, user, and admin callers.
  app.route('/api/objects', objects)
  app.route('/api/shares', authedShares)
  app.route('/api/trash', trash)
  app.route('/api', oauthGrants)
  app.route('/api/teams', teams)
  app.route('/api/teams', adminTeams)
  app.route('/api/site/storages', storages)
  app.route('/api/site/settings', siteSettings)
  app.route('/api/site/settings/email', emailConfig)
  app.route('/api/site/settings/image-domains', imageDomainProvider)
  app.route('/api/site/auth-providers', authProviders)
  // Public/user routes mount before admin routes on this shared path to preserve
  // route matching order.
  app.route('/api/site/invite-codes', publicInviteCodes)
  app.route('/api/site/invite-codes', adminInviteCodes)
  app.route('/api/site/invitations', adminSiteInvitations)
  app.route('/api/quotas', userQuotas)
  app.route('/api/quotas', adminQuotas)
  app.route('/api/storage', storageUsage)
  app.route('/api/store', cloudStore)
  app.route('/api/site', system)
  app.route('/api/notifications', notifications)
  app.route('/api/background-jobs', backgroundJobs)
  app.route('/api/downloads/tasks', downloadTasks)
  app.route('/api/events', events)
  app.route('/api/downloads/downloaders', downloaderSelfRoute)
  app.route('/api/downloads/downloaders', downloaderTasksRoute)
  app.route('/api/image-hosting', ihost)
  app.route('/api/image-hosting/config', ihostConfig)
  app.route('/api/site/licensing', licensingAdmin)
  app.route('/api/site/settings/branding', brandingAdmin)
  app.route('/api/site/audit-events', adminAudit)
  app.route('/api/site/analytics', adminOverview)
  app.route('/api/site/analytics', adminStats)
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

function agentScopeDescriptions(): Record<string, string> {
  return { ...OAUTH_SCOPE_DESCRIPTIONS }
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
export type ConfigzRoute = typeof configz
export type SiteSettingsRoute = typeof siteSettings
export type EmailConfigRoute = typeof emailConfig
export type ImageDomainProviderRoute = typeof imageDomainProvider
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
export type DownloaderTasksRoute = typeof downloaderTasksRoute
export type IhostRoute = typeof ihost
export type IhostConfigRoute = typeof ihostConfig
export type AnnouncementsRoute = typeof announcements
export type LicensingRoute = typeof licensing
export type LicensingAdminRoute = typeof licensingAdmin
export type BrandingAdminRoute = typeof brandingAdmin
export type AdminAuditRoute = typeof adminAudit
export type AdminOverviewRoute = typeof adminOverview
export type AdminStatsRoute = typeof adminStats
export type StorageUsageRoute = typeof storageUsage
export type OAuthGrantsRoute = typeof oauthGrants
