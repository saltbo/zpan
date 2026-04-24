import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Auth } from './auth'
import { authMiddleware } from './middleware/auth'
import { imageHostingDomain } from './middleware/image-hosting-domain'
import { accessLog } from './middleware/logger'
import type { Env } from './middleware/platform'
import { platformMiddleware } from './middleware/platform'
import type { Platform } from './platform/interface'
import { adminAuthProviders, publicAuthProviders } from './routes/auth-providers'
import emailConfig from './routes/email-config'
import ihost from './routes/ihost'
import ihostConfig from './routes/ihost-config'
import { adminInviteCodes, publicInviteCodes } from './routes/invite-codes'
import licensing from './routes/licensing'
import licensingAdmin from './routes/licensing-admin'
import { me } from './routes/me'
import { notifications } from './routes/notifications'
import objects from './routes/objects'
import profile from './routes/profile'
import { adminQuotas, userQuotas } from './routes/quotas'
import redirect from './routes/redirect'
import { authedShares, publicShares } from './routes/shares'
import storages from './routes/storages'
import system from './routes/system'
import { publicTeams, teams } from './routes/teams'
import trash from './routes/trash'
import users from './routes/users'

export function createApp(platform: Platform, auth: Auth) {
  const app = new Hono<Env>()

  app.use('/*', platformMiddleware(platform, auth))
  app.use('/*', imageHostingDomain)
  app.use('/api/*', accessLog)

  app.use(
    '/api/*',
    cors({
      origin: (origin) => origin || '*',
      allowHeaders: ['Content-Type', 'Authorization'],
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      credentials: true,
    }),
  )

  app.on(['POST', 'GET'], '/api/auth/*', async (c) => {
    const a = c.get('auth')
    return a.handler(c.req.raw)
  })

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

  app.use('/api/*', authMiddleware)

  app.route('/api/me', me)

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
  app.route('/api/admin/quotas', adminQuotas)
  app.route('/api/quotas', userQuotas)
  app.route('/api/system', system)
  app.route('/api/admin/auth-providers', adminAuthProviders)
  app.route('/api/notifications', notifications)
  app.route('/api/ihost', ihost)
  app.route('/api/ihost/config', ihostConfig)
  app.route('/api/licensing', licensingAdmin)

  app.get('/api/health', (c) => c.json({ status: 'ok' }))

  return app
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
export type UserQuotasRoute = typeof userQuotas
export type SystemRoute = typeof system
export type EmailConfigRoute = typeof emailConfig
export type AdminInviteCodesRoute = typeof adminInviteCodes
export type PublicInviteCodesRoute = typeof publicInviteCodes
export type AuthProvidersRoute = typeof publicAuthProviders
export type AdminAuthProvidersRoute = typeof adminAuthProviders
export type ProfileRoute = typeof profile
export type TeamsRoute = typeof teams
export type PublicTeamsRoute = typeof publicTeams
export type NotificationsRoute = typeof notifications
export type IhostRoute = typeof ihost
export type IhostConfigRoute = typeof ihostConfig
export type MeRoute = typeof me
export type LicensingRoute = typeof licensing
export type LicensingAdminRoute = typeof licensingAdmin
