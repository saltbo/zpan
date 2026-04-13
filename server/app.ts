import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Auth } from './auth'
import { authMiddleware } from './middleware/auth'
import { accessLog } from './middleware/logger'
import type { Env } from './middleware/platform'
import { platformMiddleware } from './middleware/platform'
import type { Platform } from './platform/interface'
import authProviders from './routes/auth-providers'
import emailConfig from './routes/email-config'
import { adminInviteCodes, publicInviteCodes } from './routes/invite-codes'
import objects from './routes/objects'
import { adminQuotas, userQuotas } from './routes/quotas'
import storages from './routes/storages'
import system from './routes/system'
import trash from './routes/trash'
import users from './routes/users'

export function createApp(platform: Platform, auth: Auth) {
  const app = new Hono<Env>()

  app.use('/*', platformMiddleware(platform, auth))
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

  app.use('/api/*', authMiddleware)

  // Mount routes separately to avoid deep type chain accumulation.
  // Each .route() call is independent — TypeScript doesn't stack types.
  app.route('/api/objects', objects)
  app.route('/api/recycle-bin', trash)
  app.route('/api/admin/storages', storages)
  app.route('/api/admin/users', users)
  app.route('/api/admin/email-config', emailConfig)
  app.route('/api/admin/invite-codes', adminInviteCodes)
  app.route('/api/invite-codes', publicInviteCodes)
  app.route('/api/admin/quotas', adminQuotas)
  app.route('/api/quotas', userQuotas)
  app.route('/api/system', system)
  app.route('/api/auth-providers', authProviders)

  app.get('/api/health', (c) => c.json({ status: 'ok' }))

  return app
}

export type AppType = ReturnType<typeof createApp>

// Sub-router types for RPC clients — avoids combined AppType OOM
export type ObjectsRoute = typeof objects
export type TrashRoute = typeof trash
export type StoragesRoute = typeof storages
export type UsersRoute = typeof users
export type AdminQuotasRoute = typeof adminQuotas
export type UserQuotasRoute = typeof userQuotas
export type SystemRoute = typeof system
export type EmailConfigRoute = typeof emailConfig
export type AdminInviteCodesRoute = typeof adminInviteCodes
export type PublicInviteCodesRoute = typeof publicInviteCodes
export type AuthProvidersRoute = typeof authProviders
