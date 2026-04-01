import path from 'node:path'
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      const migrationsPath = path.join(__dirname, 'drizzle')
      const migrations = await readD1Migrations(migrationsPath)

      return {
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          bindings: { TEST_MIGRATIONS: migrations },
        },
      }
    }),
  ],
  test: {
    globals: true,
    testTimeout: 15000,
    include: ['src/**/*.cf-test.ts'],
    setupFiles: ['./src/test/apply-migrations.ts'],
  },
})
