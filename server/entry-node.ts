import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { ZPAN_CLOUD_URL_DEFAULT } from '../shared/constants'
import { createBootstrap } from './bootstrap'
import { createLibsqlPlatform } from './platform/libsql'
import { createNodePlatform } from './platform/node'
import { runLicensingRefresh } from './services/licensing-refresh-runner'

const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000 // 6 hours

const platform = process.env.TURSO_DATABASE_URL
  ? await createLibsqlPlatform({
      TURSO_DATABASE_URL: process.env.TURSO_DATABASE_URL,
      TURSO_AUTH_TOKEN: process.env.TURSO_AUTH_TOKEN,
    })
  : createNodePlatform()

const app = await createBootstrap(platform)

const server = new Hono()
server.route('/', app)
server.use('/*', serveStatic({ root: './dist' }))
server.get('/*', serveStatic({ root: './dist', path: 'index.html' }))

const port = Number(process.env.PORT) || 8222
console.log(`ZPan server running on http://localhost:${port}`)
serve({ fetch: server.fetch, port })

// Start licensing refresh background scheduler
const cloudBaseUrl = process.env.ZPAN_CLOUD_URL ?? ZPAN_CLOUD_URL_DEFAULT
console.log('licensing.refresh.scheduler.started interval=6h')
setInterval(() => {
  // runLicensingRefresh handles all errors internally and never rejects.
  void runLicensingRefresh(platform.db, cloudBaseUrl)
}, REFRESH_INTERVAL_MS)
