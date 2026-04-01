import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { createApp } from './app'
import { createAuth } from './auth'
import { createNodePlatform } from './platform/node'

const platform = createNodePlatform()
const secret = process.env.BETTER_AUTH_SECRET || 'zpan-dev-secret-change-me-in-production'
const baseURL = process.env.BETTER_AUTH_URL || 'http://localhost:8222'
const trustedOrigins = process.env.TRUSTED_ORIGINS?.split(',') || ['http://localhost:5173']
const auth = createAuth(platform.db, secret, baseURL, trustedOrigins)

const api = createApp(platform, auth)

const app = new Hono()
app.route('/', api)
app.use('/*', serveStatic({ root: '../../dist' }))
app.get('/*', serveStatic({ root: '../../dist', path: 'index.html' }))

const port = Number(process.env.PORT) || 8222
console.log(`ZPan server running on http://localhost:${port}`)
serve({ fetch: app.fetch, port })
