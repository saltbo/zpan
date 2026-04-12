import { expect, test } from '@playwright/test'

// Register a new user and navigate to admin storages.
// If the user is not admin (not the first registered), skip the test.
async function signUpAndGoToAdmin(page: import('@playwright/test').Page) {
  await page.goto('/sign-up')
  await page.getByLabel('Name').fill('Admin Resp')
  await page.getByLabel('Email').fill(`admin-resp-${Date.now()}@example.com`)
  await page.getByLabel('Password').fill('password123456')
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/auth/sign-up')),
    page.getByRole('button', { name: 'Sign up' }).click(),
  ])
  expect(resp.status()).toBe(200)
  await expect(page).toHaveURL(/files/, { timeout: 10000 })

  // Try to access admin — non-admins get redirected to /files by the SPA router
  await page.goto('/admin/storages')
  // Wait for the SPA router to settle (either stay on admin or redirect to files)
  await page.waitForLoadState('networkidle')
  if (!page.url().includes('/admin')) {
    test.skip(true, 'user is not admin — another test registered first')
  }
}

// ---------------------------------------------------------------------------
// Admin sidebar
// ---------------------------------------------------------------------------
test.describe('Admin sidebar responsive', () => {
  test('desktop: admin sidebar is visible', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'desktop only')
    await signUpAndGoToAdmin(page)

    const sidebar = page.locator('[data-slot="sidebar"]')
    await expect(sidebar).toBeVisible()
  })

  test('mobile: admin sidebar opens via trigger', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'mobile only')
    await signUpAndGoToAdmin(page)

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
  test('desktop: all storage table columns visible', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'desktop only')
    await signUpAndGoToAdmin(page)

    const table = page.locator('table')
    await expect(table).toBeVisible({ timeout: 10000 })
    await expect(table.locator('th', { hasText: /bucket/i })).toBeVisible()
    await expect(table.locator('th', { hasText: /endpoint/i })).toBeVisible()
  })

  test('mobile: storage page has no horizontal overflow', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'mobile only')
    await signUpAndGoToAdmin(page)

    const hasHScroll = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    )
    expect(hasHScroll).toBe(false)
  })

  test('mobile: secondary storage columns are hidden', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'mobile only')
    await signUpAndGoToAdmin(page)

    const table = page.locator('table')
    await expect(table.locator('th', { hasText: /bucket/i })).not.toBeVisible()
    await expect(table.locator('th', { hasText: /endpoint/i })).not.toBeVisible()
    await expect(table.locator('th', { hasText: /title/i })).toBeVisible()
  })

  test('tablet: storage page has no horizontal overflow', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'tablet', 'tablet only')
    await signUpAndGoToAdmin(page)

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
  test('mobile: users page has no horizontal overflow', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'mobile only')
    await signUpAndGoToAdmin(page)
    await page.goto('/admin/users')
    await page.waitForURL(/admin\/users/, { timeout: 10000 })

    const hasHScroll = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    )
    expect(hasHScroll).toBe(false)
  })

  test('mobile: secondary user columns are hidden', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'mobile only')
    await signUpAndGoToAdmin(page)
    await page.goto('/admin/users')
    await page.waitForURL(/admin\/users/, { timeout: 10000 })

    const table = page.locator('table')
    await expect(table.locator('th', { hasText: /email/i })).not.toBeVisible()
    await expect(table.locator('th', { hasText: /quota/i })).not.toBeVisible()
    await expect(table.locator('th', { hasText: /created/i })).not.toBeVisible()
  })
})

// ---------------------------------------------------------------------------
// Admin settings page
// ---------------------------------------------------------------------------
test.describe('Admin settings page responsive', () => {
  for (const device of ['desktop', 'tablet', 'mobile']) {
    test(`${device}: settings page has no horizontal overflow`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== device, `${device} only`)
      await signUpAndGoToAdmin(page)
      await page.goto('/admin/settings')
      await page.waitForLoadState('networkidle')
      if (!page.url().includes('/admin')) {
        test.skip(true, 'user is not admin')
      }

      const hasHScroll = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      )
      expect(hasHScroll).toBe(false)
    })
  }

  test('mobile: settings form fields are usable', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'mobile only')
    await signUpAndGoToAdmin(page)
    await page.goto('/admin/settings')
    await page.waitForLoadState('networkidle')
    if (!page.url().includes('/admin')) {
      test.skip(true, 'user is not admin')
    }

    await expect(page.getByLabel(/site name/i)).toBeVisible()
    await expect(page.getByRole('button', { name: /save/i })).toBeVisible()

    const formOverflows = await page.evaluate(() => {
      const form = document.querySelector('form')
      return form ? form.scrollWidth > form.clientWidth : false
    })
    expect(formOverflows).toBe(false)
  })
})
