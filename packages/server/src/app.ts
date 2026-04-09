import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Auth } from './auth'
import { authMiddleware } from './middleware/auth'
import { accessLog } from './middleware/logger'
import type { Env } from './middleware/platform'
import { platformMiddleware } from './middleware/platform'
import type { Platform } from './platform/interface'
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

  const routes = app
    .route('/api/objects', objects)
    .route('/api/recycle-bin', trash)
    .route('/api/admin/storages', storages)
    .route('/api/admin/users', users)
    .route('/api/admin/quotas', adminQuotas)
    .route('/api/quotas', userQuotas)
    .route('/api/system', system)

  app.get('/api/health', (c) => c.json({ status: 'ok' }))

  return routes
}

export type AppType = ReturnType<typeof createApp>
