import { defineConfig, devices } from '@playwright/test'

const isCF = process.env.E2E_RUNTIME === 'cf'
const envFile = process.env.CI ? '' : '--env-file=.dev.vars'

const nodeServers = [
  {
    command: `node ${envFile} node_modules/.bin/tsx server/entry-node.ts`,
    port: 8222,
    reuseExistingServer: !process.env.CI,
  },
  {
    command: `node ${envFile} node_modules/.bin/vite --mode node --strictPort`,
    port: 5173,
    reuseExistingServer: !process.env.CI,
  },
]

const cfServers = [
  {
    command: 'vite dev',
    port: 5173,
    reuseExistingServer: !process.env.CI,
  },
]

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  // The suite shares one local dev server pair and one SQLite database. Keep
  // execution serial to avoid flaky connection resets and cross-test bleed.
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
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
