import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Env } from './middleware/platform'
import { platformMiddleware } from './middleware/platform'
import { authMiddleware } from './middleware/auth'
import type { Platform } from './platform/interface'
import type { Auth } from './auth'
import objects from './routes/objects'
import storages from './routes/storages'
import users from './routes/users'
import system, { seedSystemOptions } from './routes/system'

export function createApp(platform: Platform, auth: Auth) {
  seedSystemOptions(platform.db).catch(() => {})

  const app = new Hono<Env>()

  app.use('/*', platformMiddleware(platform, auth))

  app.use(
    '/api/*',
    cors({
      origin: (origin) => origin || '*',
      allowHeaders: ['Content-Type', 'Authorization'],
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      credentials: true,
    }),
  )

  app.on(['POST', 'GET'], '/api/auth/**', async (c) => {
    const a = c.get('auth')
    return a.handler(c.req.raw)
  })

  app.use('/api/*', authMiddleware)

  const routes = app
    .route('/api/objects', objects)
    .route('/api/storages', storages)
    .route('/api/users', users)
    .route('/api/system', system)

  app.get('/api/health', (c) => c.json({ status: 'ok' }))

  return routes
}

export type AppType = ReturnType<typeof createApp>
