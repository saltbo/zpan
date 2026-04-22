import type { HttpRequest, InvocationContext } from '@azure/functions'
import { app } from '@azure/functions'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { createBootstrap } from './bootstrap'
import { createLibsqlPlatform } from './platform/libsql'

const TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL
if (!TURSO_DATABASE_URL) {
  throw new Error('TURSO_DATABASE_URL is required for the Azure Functions deployment.')
}

const platform = await createLibsqlPlatform({
  TURSO_DATABASE_URL,
  TURSO_AUTH_TOKEN: process.env.TURSO_AUTH_TOKEN,
})

const apiApp = await createBootstrap(platform)

const server = new Hono()
server.route('/', apiApp)
server.use('/*', serveStatic({ root: './dist' }))
server.get('/*', serveStatic({ root: './dist', path: 'index.html' }))

app.http('zpan', {
  methods: ['DELETE', 'GET', 'HEAD', 'OPTIONS', 'PATCH', 'POST', 'PUT'],
  authLevel: 'anonymous',
  route: '{*path}',
  handler: async (request: HttpRequest, _context: InvocationContext): Promise<Response> => {
    return server.fetch(request as unknown as Request)
  },
})
