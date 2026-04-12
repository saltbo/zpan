import path from 'node:path'
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      const migrationsPath = path.join(__dirname, './migrations')
      const migrations = await readD1Migrations(migrationsPath)

      return {
        // D1 and vars live under [env.production] in wrangler.toml; tell the
        // pool which environment to apply so env.DB resolves at test time.
        wrangler: { configPath: './wrangler.toml', environment: 'production' },
        miniflare: {
          bindings: { TEST_MIGRATIONS: migrations },
        },
      }
    }),
  ],
  test: {
    globals: true,
    testTimeout: 15000,
    include: ['server/**/*.cf-test.ts', 'workers/**/*.cf-test.ts'],
    setupFiles: ['./server/test/apply-migrations.ts'],
  },
})
