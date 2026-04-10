import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
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
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: [
    {
      command: 'tsx watch server/entry-node.ts',
      port: 8222,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'vite',
      port: 5173,
      reuseExistingServer: !process.env.CI,
    },
  ],
})
