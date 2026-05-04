import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Auth } from './auth'
import { inviteCodes as inviteCodesTable } from './db/schema'
import { authMiddleware } from './middleware/auth'
import { imageHostingDomain } from './middleware/image-hosting-domain'
import { accessLog } from './middleware/logger'
import type { Env } from './middleware/platform'
import { platformMiddleware } from './middleware/platform'
import type { Platform } from './platform/interface'
import { adminAnnouncements, announcements } from './routes/announcements'
import { adminAudit } from './routes/audit'
import { adminAuthProviders, publicAuthProviders } from './routes/auth-providers'
import { brandingAdmin, publicBranding } from './routes/branding'
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
import { adminSiteInvitations, publicSiteInvitations } from './routes/site-invitations'
import storages from './routes/storages'
import system from './routes/system'
import { publicTeams, teams } from './routes/teams'
import trash from './routes/trash'
import users from './routes/users'
import { recordActivity } from './services/activity'
import { findPersonalOrg } from './services/org'

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
    const db = c.get('platform').db

    // Intercept sign-up to record audit events using the fresh per-request db.
    // The cached auth instance's db (from first isolate request) may not guarantee
    // read-your-writes for INSERT operations in CF Workers D1, so we record here
    // instead of in user.create.after. Audit failure is logged but non-fatal:
    // the auth transaction has already committed and sending a 500 would confuse
    // a user who is already signed in.
    const url = new URL(c.req.url)
    const isSignUp = c.req.method === 'POST' && url.pathname === '/api/auth/sign-up/email'

    let signUpBody: { email?: string; inviteCode?: string; siteInvitationToken?: string } | null = null
    if (isSignUp) {
      try {
        signUpBody = await c.req.raw.clone().json()
      } catch {
        // non-JSON or empty body — no body info available for audit
      }
    }

    const response = await a.handler(c.req.raw)

    if (isSignUp && response.ok) {
      try {
        const body = (await response.clone().json()) as {
          user?: { id?: string; email?: string }
          token?: string | null
        }
        const userId = body?.user?.id
        if (userId) {
          const orgId = await findPersonalOrg(db, userId)
          if (orgId) {
            await recordActivity(db, {
              orgId,
              userId,
              action: 'sign_up',
              targetType: 'auth',
              targetName: body.user?.email ?? userId,
            })

            // If an invite code was redeemed, record it using the code's row ID (never the raw code).
            if (signUpBody?.inviteCode) {
              const [codeRow] = await db
                .select({ id: inviteCodesTable.id })
                .from(inviteCodesTable)
                .where(eq(inviteCodesTable.usedBy, userId))
                .limit(1)
              if (codeRow) {
                await recordActivity(db, {
                  orgId,
                  userId,
                  action: 'invite_code_redeem',
                  targetType: 'invite_code',
                  targetId: codeRow.id,
                  targetName: 'invite code',
                })
              }
            }

            // If a site invitation was accepted during sign-up, record it.
            if (signUpBody?.siteInvitationToken) {
              await recordActivity(db, {
                orgId,
                userId,
                action: 'site_invitation_accept',
                targetType: 'site_invitation',
                targetName: body.user?.email ?? userId,
              })
            }
          }
        }
      } catch (err) {
        // Audit recording failed after auth committed — log for observability.
        // Cannot surface to client: session cookie is already set in `response`.
        console.error('[audit] Failed to record sign-up audit events:', err)
      }
    }

    return response
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
  app.route('/api/branding', publicBranding)
  app.route('/api/site-invitations', publicSiteInvitations)

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
  app.route('/api/quotas', userQuotas)
  app.route('/api/system', system)
  app.route('/api/admin/auth-providers', adminAuthProviders)
  app.route('/api/notifications', notifications)
  app.route('/api/ihost', ihost)
  app.route('/api/ihost/config', ihostConfig)
  app.route('/api/licensing', licensingAdmin)
  app.route('/api/admin/branding', brandingAdmin)
  app.route('/api/admin/announcements', adminAnnouncements)
  app.route('/api/admin/audit', adminAudit)

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
export type AdminSiteInvitationsRoute = typeof adminSiteInvitations
export type PublicSiteInvitationsRoute = typeof publicSiteInvitations
export type AuthProvidersRoute = typeof publicAuthProviders
export type AdminAuthProvidersRoute = typeof adminAuthProviders
export type ProfileRoute = typeof profile
export type TeamsRoute = typeof teams
export type PublicTeamsRoute = typeof publicTeams
export type NotificationsRoute = typeof notifications
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
