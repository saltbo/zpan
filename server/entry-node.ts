import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { createBootstrap } from './bootstrap'
import { createLibsqlPlatform } from './platform/libsql'
import { createNodePlatform } from './platform/node'

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
