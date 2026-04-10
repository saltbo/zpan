import { applyD1Migrations } from 'cloudflare:test'
import { env } from 'cloudflare:workers'

declare module 'cloudflare:workers' {
  interface ProvidedEnv {
    DB: D1Database
    BETTER_AUTH_SECRET: string
    TEST_MIGRATIONS: D1Migration[]
  }
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
})
