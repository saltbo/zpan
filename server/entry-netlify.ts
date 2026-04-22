import { handle } from 'hono/netlify'
import { createBootstrap } from './bootstrap'
import { createLibsqlPlatform } from './platform/libsql'

// Migrations are applied by the deploy workflow (drizzle-kit migrate) before
// function deployment. createLibsqlPlatform also runs migrate() at cold start —
// it's idempotent (~50–100ms round-trip against __drizzle_migrations) and serves
// as a safety net if a deployment ever skips the workflow migration step.

const platform = await createLibsqlPlatform({
  TURSO_DATABASE_URL: process.env.TURSO_DATABASE_URL!,
  TURSO_AUTH_TOKEN: process.env.TURSO_AUTH_TOKEN,
})

const app = await createBootstrap(platform)

export default handle(app)

// Route all API and redirect paths to this function.
// The SPA fallback (/* → /index.html) in netlify.toml covers everything else.
export const config = {
  path: ['/api/*', '/r/*'],
}
