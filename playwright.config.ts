import { defineConfig, devices } from '@playwright/test'

const isCF = process.env.E2E_RUNTIME === 'cf'
const envFile = process.env.CI ? '' : '--env-file=.dev.vars'

const nodeServers = [
  {
    command: `node ${envFile} node_modules/.bin/tsx watch server/entry-node.ts`,
    port: 8222,
    reuseExistingServer: !process.env.CI,
  },
  {
    command: `node ${envFile} node_modules/.bin/vite --mode node`,
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
  globalSetup: './e2e/global-setup.ts',
  testDir: './e2e',
  timeout: 30000,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'tablet',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 768, height: 1024 },
      },
    },
    {
      name: 'mobile',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        isMobile: true,
      },
    },
  ],
  webServer: isCF ? cfServers : nodeServers,
})
