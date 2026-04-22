import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { handle } from 'hono/netlify'
import { createBootstrap } from './bootstrap'
import * as authSchema from './db/auth-schema'
import * as schema from './db/schema'
import type { Platform } from './platform/interface'

// Migrations are applied by the deploy workflow before function deployment.
// The function connects to Turso directly — no local SQLite fallback on Netlify.

const TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL
if (!TURSO_DATABASE_URL) {
  throw new Error('TURSO_DATABASE_URL is required for Netlify deployment.')
}

const client = createClient({
  url: TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
})

const db = drizzle(client, { schema: { ...schema, ...authSchema } })

const platform: Platform = {
  db,
  getEnv: (key) => process.env[key],
}

const app = await createBootstrap(platform)

export default handle(app)

// Route all API and redirect paths to this function.
// The SPA fallback (/* → /index.html) in netlify.toml covers everything else.
export const config = {
  path: ['/api/*', '/r/*'],
}
