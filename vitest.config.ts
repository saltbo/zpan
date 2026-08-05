import path from 'node:path'
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers'
import react from '@vitejs/plugin-react-swc'
import { defineConfig } from 'vitest/config'

const aliases = {
  '@': path.resolve(__dirname, './src'),
  '@shared': path.resolve(__dirname, './shared'),
  '@server': path.resolve(__dirname, './server'),
}

const coverageConfig = {
  provider: 'v8' as const,
  include: [
    'server/**/*.ts',
    'shared/**/*.ts',
    'src/lib/**/*.ts',
    'src/i18n/**/*.ts',
    'src/routes/u/**/*.tsx',
    'src/routes/_authenticated/settings/**/*.tsx',
  ],
  exclude: [
    'server/entry-*.ts',
    'server/**/*.test.ts',
    'server/**/*.integration.test.ts',
    'server/**/*.cf-test.ts',
    'server/**/*.libsql-test.ts',
    'server/test/**',
    'server/platform/**',
    'server/db/**',
    'shared/**/*.test.ts',
    'src/**/*.test.ts',
    'src/**/*.integration.test.ts',
    'src/i18n/index.ts',
  ],
  reporter: ['text-summary', 'json'] as const,
}

const coverageGate =
  process.env.COVERAGE_ENFORCE === '1'
    ? {
        // Lock the merged CI baseline by maximum uncovered items. Unlike rounded
        // percentages, negative thresholds cannot hide a small coverage regression.
        thresholds: {
          statements: -2099,
          branches: -2869,
          functions: -1924,
          lines: -717,
        },
      }
    : {}

export default defineConfig({
  test: {
    globals: true,
    coverage: { ...coverageConfig, ...coverageGate },
    projects: [
      {
        plugins: [react()],
        resolve: { alias: aliases },
        test: {
          name: 'unit',
          environment: 'jsdom',
          include: [
            'server/**/*.test.ts',
            'shared/**/*.test.ts',
            'src/**/*.test.ts',
            'src/**/*.test.tsx',
            'scripts/**/*.test.mjs',
          ],
          exclude: ['**/*.integration.test.ts', '**/*.cf-test.ts', '**/e2e-*.test.ts'],
          setupFiles: ['./server/test/app-version.ts'],
        },
      },
      {
        resolve: { alias: aliases },
        test: {
          name: 'integration',
          include: ['server/**/*.integration.test.ts', 'src/**/*.integration.test.ts'],
          setupFiles: ['./server/test/app-version.ts'],
        },
      },
      {
        plugins: [
          cloudflareTest(async () => {
            const migrationsPath = path.join(__dirname, './migrations')
            const migrations = await readD1Migrations(migrationsPath)

            return {
              wrangler: { configPath: './wrangler.toml' },
              miniflare: {
                bindings: { TEST_MIGRATIONS: migrations },
              },
            }
          }),
        ],
        resolve: { alias: aliases },
        test: {
          name: 'cloudflare',
          globals: true,
          testTimeout: 15000,
          include: ['server/**/*.cf-test.ts', 'workers/**/*.cf-test.ts'],
          setupFiles: ['./server/test/app-version.ts', './server/test/apply-migrations.ts'],
        },
      },
      {
        resolve: { alias: aliases },
        test: {
          name: 'libsql',
          globals: true,
          testTimeout: 30_000,
          include: ['server/**/*.libsql-test.ts'],
          setupFiles: ['./server/test/app-version.ts'],
        },
      },
    ],
  },
})
