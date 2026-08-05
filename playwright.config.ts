import { defineConfig, devices } from '@playwright/test'

const isCF = process.env.E2E_RUNTIME === 'cf'
const envFile = process.env.CI ? '' : '--env-file-if-exists=.dev.vars'
const chromeHostResolverRules = process.env.E2E_CHROME_HOST_RESOLVER_RULES
const appPort = Number(process.env.E2E_APP_PORT ?? 5185)
const apiPort = Number(process.env.E2E_API_PORT ?? 8222)
const s3MockPort = Number(process.env.E2E_S3_MOCK_PORT ?? 9191)
const cloudFakePort = Number(process.env.E2E_CLOUD_FAKE_PORT ?? 9292)
const artifactSuffix = process.env.E2E_ARTIFACT_SUFFIX ?? 'run'
const nodeCommand = JSON.stringify(process.execPath)

const s3MockServer = process.env.E2E_S3_MOCK
  ? [
      {
        command: `node scripts/s3-mock.mjs`,
        port: s3MockPort,
        reuseExistingServer: false,
      },
    ]
  : []

const cloudFakeServer = process.env.E2E_CLOUD_FAKE
  ? [
      {
        command: `node scripts/zpan-cloud-fake.mjs`,
        url: `http://127.0.0.1:${cloudFakePort}/health`,
        reuseExistingServer: false,
      },
    ]
  : []

const nodeServers = [
  ...s3MockServer,
  ...cloudFakeServer,
  {
    command: `PORT=${apiPort} ${nodeCommand} ${envFile} node_modules/tsx/dist/cli.mjs server/entry-node.ts`,
    port: apiPort,
    reuseExistingServer: false,
  },
  {
    command: `${nodeCommand} ${envFile} node_modules/vite/bin/vite.js --mode node --host 127.0.0.1 --port ${appPort} --strictPort`,
    port: appPort,
    reuseExistingServer: false,
  },
]

const cfServers = [
  ...s3MockServer,
  ...cloudFakeServer,
  {
    command: `vite dev --host 127.0.0.1 --port ${appPort} --strictPort`,
    port: appPort,
    reuseExistingServer: false,
  },
]

export default defineConfig({
  testDir: './e2e',
  outputDir: `test-results/${artifactSuffix}`,
  timeout: 30_000,
  workers: 1,
  retries: 0,
  reporter: process.env.CI
    ? [
        ['github'],
        ['html', { open: 'never', outputFolder: `playwright-report/${artifactSuffix}` }],
        ['junit', { outputFile: `test-results/${artifactSuffix}/e2e-junit.xml` }],
      ]
    : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5185',
    headless: true,
    channel: process.env.CI ? 'chrome' : undefined,
    launchOptions: chromeHostResolverRules
      ? { args: [`--host-resolver-rules=${chromeHostResolverRules}`] }
      : undefined,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
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
