import { expect, test } from '@playwright/test'
import type { AdminDashboardGrowthStats, AdminOverview } from '@shared/types'
import { signInAsAdmin } from './helpers'

const completeCoverage = {
  status: 'complete',
  expectedBuckets: 48,
  completedBuckets: 48,
  lowerBoundBuckets: 0,
  quality: 'exact',
  dataThrough: '2026-07-21T23:00:00.000Z',
} as const

const overview: AdminOverview = {
  observedAt: '2026-07-22T00:00:00.000Z',
  users: {
    total: 42,
    active30Days: 18,
    new7Days: 5,
    activity: { total: 42, today: 3, last7Days: 5, last30Days: 10, inactive: 24 },
    trend: [
      { date: '2026-07-20', totalUsers: 40, activeUsers: 16, newUsers: 2 },
      { date: '2026-07-21', totalUsers: 42, activeUsers: 18, newUsers: 2 },
    ],
    topUsage: [],
  },
  storages: {
    total: 1,
    writable: 1,
    used: 500,
    capacity: 1000,
    unbounded: 0,
    trend: [
      { date: '2026-07-20', usedBytes: 400, writtenBytes: 120, releasedBytes: 20 },
      { date: '2026-07-21', usedBytes: 500, writtenBytes: 150, releasedBytes: 50 },
    ],
    items: [],
  },
  downloaders: {
    total: 0,
    online: 0,
    activeTasks: 0,
    totalSlots: 0,
    availableSlots: 0,
    downloadBps: 0,
    uploadBps: 0,
    items: [],
  },
}

const growth: AdminDashboardGrowthStats = {
  generatedAt: '2026-07-22T00:00:00.000Z',
  from: '2026-07-20T00:00:00.000Z',
  to: '2026-07-21T23:59:59.999Z',
  timeZone: 'UTC',
  coverage: completeCoverage,
  summary: {
    totalUsers: 42,
    newUsers: { value: 4, previousValue: 2, change: 2, changePercent: 100 },
    activeUsers: { value: 18, previousValue: 16, change: 2, changePercent: 12.5 },
    verifiedUsers: 38,
    bannedUsers: 1,
    silentUsers: 23,
    activeUserRate: 42.9,
    silentUserRate: 54.8,
  },
  userScaleTrend: [
    { date: '2026-07-20', newUsers: 2, totalUsers: 40 },
    { date: '2026-07-21', newUsers: 2, totalUsers: 42 },
  ],
  activeUserTrend: [
    { date: '2026-07-20', dau: 3, wau: 8, mau: 16 },
    { date: '2026-07-21', dau: 4, wau: 9, mau: 18 },
  ],
  userStatus: [
    { name: 'normal', value: 18, percent: 42.9 },
    { name: 'silent', value: 23, percent: 54.8 },
    { name: 'banned', value: 1, percent: 2.3 },
  ],
  registrationSources: [
    { name: 'credential', value: 30, percent: 71.4 },
    { name: 'github', value: 12, percent: 28.6 },
  ],
}

test('admin dashboard and analytics render chart geometry @desktop', async ({ page }) => {
  const invalidChartDimensions: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'warning' && message.text().includes('width(-1) and height(-1)')) {
      invalidChartDimensions.push(message.text())
    }
  })
  await page.route('**/api/site/overview', (route) => route.fulfill({ json: overview }))
  await page.route('**/api/site/licensing/status', (route) =>
    route.fulfill({
      json: { bound: true, active: true, edition: 'pro', license_id: 'test-license', features: ['analytics'] },
    }),
  )
  await page.route('**/api/site/stats/growth**', (route) => route.fulfill({ json: growth }))

  await signInAsAdmin(page)
  await page.goto('/admin/dashboard')

  await expect(page.locator('.recharts-line-curve')).toHaveCount(3)
  await expect(page.locator('.recharts-area-area')).toHaveCount(1)
  await expect(page.locator('.recharts-sector')).toHaveCount(6)

  await page.goto('/admin/analytics')
  await expect(page.getByText('用户规模趋势')).toBeVisible()

  await expect(page.locator('.recharts-line-curve')).toHaveCount(1)
  await expect(page.locator('.recharts-area-area')).toHaveCount(3)
  await expect(page.locator('.recharts-sector')).toHaveCount(3)
  expect(invalidChartDimensions).toEqual([])
})
