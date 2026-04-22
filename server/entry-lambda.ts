import { existsSync, readFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { Hono } from 'hono'
import { handle } from 'hono/aws-lambda'
import { createBootstrap } from './bootstrap'
import { createLibsqlPlatform } from './platform/libsql'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.webp': 'image/webp',
}

// Initialized once per Lambda container; reused across warm invocations.
let cachedHandler: ReturnType<typeof handle> | undefined

async function init(): Promise<ReturnType<typeof handle>> {
  if (cachedHandler) return cachedHandler

  const platform = await createLibsqlPlatform({
    TURSO_DATABASE_URL: process.env.TURSO_DATABASE_URL!,
    TURSO_AUTH_TOKEN: process.env.TURSO_AUTH_TOKEN,
  })
  const app = await createBootstrap(platform)

  const server = new Hono()
  server.route('/', app)
  server.get('/*', (c) => {
    const filePath = join('./dist', c.req.path === '/' ? 'index.html' : c.req.path)
    if (existsSync(filePath)) {
      const content = readFileSync(filePath)
      const mime = MIME[extname(filePath)] ?? 'application/octet-stream'
      return c.body(content, 200, { 'Content-Type': mime })
    }
    return c.html(readFileSync('./dist/index.html', 'utf-8'))
  })

  cachedHandler = handle(server)
  return cachedHandler
}

// biome-ignore lint/suspicious/noExplicitAny: Lambda event/context types vary by invocation model
export const handler = async (event: any, context: any) => (await init())(event, context)
