import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { createApp } from './app'
import { createAuth } from './auth'
import { createLibsqlPlatform } from './platform/libsql'
import { createNodePlatform } from './platform/node'

const platform = process.env.TURSO_DATABASE_URL
  ? await createLibsqlPlatform({
      TURSO_DATABASE_URL: process.env.TURSO_DATABASE_URL,
      TURSO_AUTH_TOKEN: process.env.TURSO_AUTH_TOKEN,
    })
  : createNodePlatform()

const secret = process.env.BETTER_AUTH_SECRET
if (!secret) {
  throw new Error('BETTER_AUTH_SECRET is required. Set it in the environment before starting the server.')
}

const baseURL = process.env.BETTER_AUTH_URL || 'http://localhost:5173'
const trustedOrigins = process.env.TRUSTED_ORIGINS?.split(',')
  .map((o) => o.trim())
  .filter(Boolean) || ['http://localhost:5173']

const auth = await createAuth(platform.db, secret, baseURL, trustedOrigins)
const app = createApp(platform, auth)

const server = new Hono()
server.route('/', app)
server.use('/*', serveStatic({ root: './dist' }))
server.get('/*', serveStatic({ root: './dist', path: 'index.html' }))

const port = Number(process.env.PORT) || 8222
console.log(`ZPan server running on http://localhost:${port}`)
serve({ fetch: server.fetch, port })
