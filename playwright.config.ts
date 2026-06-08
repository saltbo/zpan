import { defineConfig, devices } from '@playwright/test'

const isCF = process.env.E2E_RUNTIME === 'cf'
const envFile = process.env.CI ? '' : '--env-file=.dev.vars'
const chromeHostResolverRules = process.env.E2E_CHROME_HOST_RESOLVER_RULES
const appPort = Number(process.env.E2E_APP_PORT ?? 5185)
const apiPort = Number(process.env.E2E_API_PORT ?? 8222)
const s3MockPort = Number(process.env.E2E_S3_MOCK_PORT ?? 9191)
const nodeCommand = JSON.stringify(process.execPath)

const s3MockServer = process.env.E2E_S3_MOCK
  ? [
      {
        command: `node scripts/s3-mock.mjs`,
        port: s3MockPort,
        reuseExistingServer: !process.env.CI,
      },
    ]
  : []

const nodeServers = [
  ...s3MockServer,
  {
    command: `PORT=${apiPort} ${nodeCommand} ${envFile} node_modules/tsx/dist/cli.mjs server/entry-node.ts`,
    port: apiPort,
    reuseExistingServer: !process.env.CI,
  },
  {
    command: `${nodeCommand} ${envFile} node_modules/vite/bin/vite.js --mode node --host 127.0.0.1 --port ${appPort} --strictPort`,
    port: appPort,
    reuseExistingServer: !process.env.CI,
  },
]

const cfServers = [
  ...s3MockServer,
  {
    command: `vite dev --host 127.0.0.1 --port ${appPort} --strictPort`,
    port: appPort,
    reuseExistingServer: !process.env.CI,
  },
]

export default defineConfig({
  testDir: './e2e',
  timeout: process.env.CI ? 180000 : 30000,
  // The suite shares one local dev server pair and one SQLite database. Keep
  // execution serial to avoid flaky connection resets and cross-test bleed.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5185',
    headless: true,
    channel: process.env.CI ? 'chrome' : undefined,
    launchOptions: chromeHostResolverRules
      ? { args: [`--host-resolver-rules=${chromeHostResolverRules}`] }
      : undefined,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'setup',
      testMatch: /global-setup\.ts/,
    },
    {
      name: 'desktop',
      grep: /@desktop|@all/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'tablet',
      grep: /@tablet|@all/,
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 768, height: 1024 },
      },
    },
    {
      name: 'mobile',
      grep: /@mobile|@all/,
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        isMobile: true,
      },
    },
  ],
  webServer: isCF ? cfServers : nodeServers,
})
