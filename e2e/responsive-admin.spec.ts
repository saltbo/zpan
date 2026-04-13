import { expect, test } from '@playwright/test'
import { signInAsAdmin } from './helpers'

// ---------------------------------------------------------------------------
// Admin sidebar
// ---------------------------------------------------------------------------
test.describe('Admin sidebar responsive', () => {
  test('desktop: admin sidebar is visible @desktop', async ({ page }) => {
    await signInAsAdmin(page)

    const sidebar = page.locator('[data-slot="sidebar"]')
    await expect(sidebar).toBeVisible()
  })

  test('mobile: admin sidebar opens via trigger @mobile', async ({ page }) => {
    await signInAsAdmin(page)

    const sidebar = page.locator('[data-slot="sidebar"]')
    await expect(sidebar).not.toBeInViewport()

    const trigger = page.locator('button[data-sidebar="trigger"]')
    await expect(trigger).toBeVisible()
    await trigger.click()
    await expect(sidebar).toBeVisible()
  })
})

// ---------------------------------------------------------------------------
// Admin storages page
// ---------------------------------------------------------------------------
test.describe('Admin storages page responsive', () => {
  test('storages page has no horizontal overflow @all', async ({ page }) => {
    await signInAsAdmin(page)

    const hasHScroll = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    )
    expect(hasHScroll).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Admin users page
// ---------------------------------------------------------------------------
test.describe('Admin users page responsive', () => {
  test('mobile: users page has no horizontal overflow @mobile', async ({ page }) => {
    await signInAsAdmin(page)
    await page.goto('/admin/users')
    await page.waitForURL(/admin\/users/, { timeout: 10000 })

    const hasHScroll = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    )
    expect(hasHScroll).toBe(false)
  })

  test('mobile: secondary user columns are hidden @mobile', async ({ page }) => {
    await signInAsAdmin(page)
    await page.goto('/admin/users')
    await page.waitForURL(/admin\/users/, { timeout: 10000 })

    const table = page.locator('table')
    await expect(table.locator('th', { hasText: /email/i })).not.toBeVisible()
    await expect(table.locator('th', { hasText: /quota/i })).not.toBeVisible()
    await expect(table.locator('th', { hasText: /created/i })).not.toBeVisible()
  })
})
