import path from 'node:path'
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers'
import react from '@vitejs/plugin-react-swc'
import { defineConfig } from 'vitest/config'

const aliases = {
  '@': path.resolve(__dirname, './src'),
  '@shared': path.resolve(__dirname, './shared'),
  '@server': path.resolve(__dirname, './server'),
}

const backendCoverageIncludes = ['server/**/*.ts', 'shared/**/*.ts']
const frontendCoverageIncludes = [
  'src/lib/**/*.ts',
  'src/i18n/**/*.ts',
  'src/routes/u/**/*.tsx',
  'src/routes/_authenticated/settings/**/*.tsx',
]
const coverageIncludes =
  process.env.COVERAGE_SCOPE === 'backend'
    ? backendCoverageIncludes
    : process.env.COVERAGE_SCOPE === 'frontend'
      ? frontendCoverageIncludes
      : [...backendCoverageIncludes, ...frontendCoverageIncludes]

const coverageConfig = {
  provider: 'v8' as const,
  include: coverageIncludes,
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

function createCloudflarePlugin() {
  return cloudflareTest(async () => {
    const migrationsPath = path.join(__dirname, './migrations')
    const migrations = await readD1Migrations(migrationsPath)

    return {
      wrangler: { configPath: './wrangler.toml' },
      miniflare: {
        bindings: { TEST_MIGRATIONS: migrations },
      },
    }
  })
}

const isolatedCloudflareTests = [
  'server/http/objects.cf-test.ts',
  'server/http/site/storages.cf-test.ts',
  'server/http/site/system.cf-test.ts',
  'workers/bootstrap-image-domain.cf-test.ts',
  'workers/bootstrap.cf-test.ts',
]

export default defineConfig({
  test: {
    globals: true,
    coverage: { ...coverageConfig, ...coverageGate },
    projects: [
      {
        resolve: { alias: aliases },
        test: {
          name: 'backend-unit',
          environment: 'node',
          include: [
            'server/**/*.test.ts',
            'shared/**/*.test.ts',
            'scripts/**/*.test.mjs',
          ],
          exclude: ['**/*.integration.test.ts', '**/*.cf-test.ts', '**/e2e-*.test.ts'],
          setupFiles: ['./server/test/app-version.ts'],
        },
      },
      {
        plugins: [react()],
        resolve: { alias: aliases },
        test: {
          name: 'frontend-unit',
          environment: 'jsdom',
          include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
          exclude: ['**/*.integration.test.ts'],
        },
      },
      {
        resolve: { alias: aliases },
        test: {
          name: 'backend-integration',
          include: ['server/**/*.integration.test.ts'],
          testTimeout: 15_000,
          setupFiles: ['./server/test/app-version.ts'],
        },
      },
      {
        plugins: [createCloudflarePlugin()],
        resolve: { alias: aliases },
        test: {
          name: 'cloudflare-contract',
          globals: true,
          // These D1-focused contracts use unique fixture identifiers and scoped
          // assertions, so sharing one migrated database avoids replaying the
          // complete migration history for every file.
          isolate: false,
          maxWorkers: 1,
          sequence: { groupOrder: 1 },
          testTimeout: 15000,
          include: ['server/**/*.cf-test.ts', 'workers/**/*.cf-test.ts'],
          exclude: isolatedCloudflareTests,
          setupFiles: ['./server/test/app-version.ts', './server/test/apply-migrations.ts'],
        },
      },
      {
        plugins: [createCloudflarePlugin()],
        resolve: { alias: aliases },
        test: {
          name: 'cloudflare-isolated',
          globals: true,
          sequence: { groupOrder: 2 },
          testTimeout: 15000,
          include: isolatedCloudflareTests,
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
