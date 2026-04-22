import { handle } from 'hono/vercel'
import { createBootstrap } from './bootstrap'
import { createLibsqlPlatform } from './platform/libsql'

const tursoUrl = process.env.TURSO_DATABASE_URL
if (!tursoUrl) {
  throw new Error('TURSO_DATABASE_URL is required for Vercel deployment.')
}

const platform = await createLibsqlPlatform({
  TURSO_DATABASE_URL: tursoUrl,
  TURSO_AUTH_TOKEN: process.env.TURSO_AUTH_TOKEN,
})

const app = await createBootstrap(platform)

export const GET = handle(app)
export const POST = handle(app)
export const PUT = handle(app)
export const PATCH = handle(app)
export const DELETE = handle(app)
