import { expect, test } from '@playwright/test'

// Helper: register a fresh user and land on /files
async function signUpAndGoToFiles(page: import('@playwright/test').Page) {
  await page.goto('/sign-up')
  await page.getByLabel('Name').fill('Responsive Test')
  await page.getByLabel('Email').fill(`resp-${Date.now()}@example.com`)
  await page.getByLabel('Password').fill('password123456')
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/auth/sign-up')),
    page.getByRole('button', { name: 'Sign up' }).click(),
  ])
  expect(resp.status()).toBe(200)
  await expect(page).toHaveURL(/files/, { timeout: 10000 })
}

// ---------------------------------------------------------------------------
// Sidebar behavior per device
// ---------------------------------------------------------------------------
test.describe('Sidebar responsive behavior', () => {
  test('desktop: sidebar is visible by default', async ({ page, browserName }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'desktop only')
    await signUpAndGoToFiles(page)

    const sidebar = page.locator('[data-slot="sidebar"]')
    await expect(sidebar).toBeVisible()
  })

  test('tablet: sidebar is visible by default', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'tablet', 'tablet only')
    await signUpAndGoToFiles(page)

    const sidebar = page.locator('[data-slot="sidebar"]')
    await expect(sidebar).toBeVisible()
  })

  test('mobile: sidebar is hidden, opens as sheet via trigger', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'mobile only')
    await signUpAndGoToFiles(page)

    // Sidebar should not be visible initially on mobile
    const sidebar = page.locator('[data-slot="sidebar"]')
    await expect(sidebar).not.toBeInViewport()

    // Trigger button should be visible
    const trigger = page.locator('button[data-sidebar="trigger"]')
    await expect(trigger).toBeVisible()

    // Click trigger to open sheet sidebar
    await trigger.click()
    await expect(sidebar).toBeVisible()
  })
})

// ---------------------------------------------------------------------------
// Toolbar: no horizontal overflow, key buttons accessible
// ---------------------------------------------------------------------------
test.describe('Toolbar responsive layout', () => {
  test('desktop: all toolbar buttons visible in one row', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'desktop only')
    await signUpAndGoToFiles(page)

    const toolbar = page.locator('[data-testid="files-toolbar"]')
    await expect(toolbar).toBeVisible()

    // All action buttons should be visible with text labels
    await expect(page.getByRole('button', { name: /Upload/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /New Folder/i })).toBeVisible()
    await expect(page.getByLabel('List view')).toBeVisible()
    await expect(page.getByLabel('Grid view')).toBeVisible()

    // Search input should be visible
    await expect(page.getByPlaceholder(/search/i)).toBeVisible()
  })

  test('tablet: toolbar does not overflow horizontally', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'tablet', 'tablet only')
    await signUpAndGoToFiles(page)

    const toolbar = page.locator('[data-testid="files-toolbar"]')
    await expect(toolbar).toBeVisible()

    // Toolbar should not cause horizontal scroll
    const overflows = await toolbar.evaluate((el) => el.scrollWidth > el.clientWidth)
    expect(overflows).toBe(false)

    // Upload button must be accessible
    await expect(page.getByRole('button', { name: 'Upload' })).toBeVisible()
  })

  test('mobile: toolbar does not overflow, upload button accessible', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'mobile only')
    await signUpAndGoToFiles(page)

    const toolbar = page.locator('[data-testid="files-toolbar"]')
    await expect(toolbar).toBeVisible()

    // Toolbar should not cause horizontal scroll
    const overflows = await toolbar.evaluate((el) => el.scrollWidth > el.clientWidth)
    expect(overflows).toBe(false)

    // Upload and New Folder buttons must be accessible (icon-only with aria-label)
    await expect(page.getByRole('button', { name: /upload/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /new folder|folder/i })).toBeVisible()
  })
})

// ---------------------------------------------------------------------------
// Table: secondary columns hidden on small screens
// ---------------------------------------------------------------------------
test.describe('File table responsive columns', () => {
  test('desktop: all columns visible (name, size, modified, actions)', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'desktop only')
    await signUpAndGoToFiles(page)

    // Create a folder so table renders
    await page.getByRole('button', { name: 'New Folder' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('textbox').fill('test-folder')
    await dialog.getByRole('button', { name: /create/i }).click()
    await expect(dialog).not.toBeVisible({ timeout: 10000 })

    // All columns should be visible
    await expect(page.getByRole('columnheader', { name: /size/i })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: /modified/i })).toBeVisible()
  })

  test('mobile: size and modified columns are hidden', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'mobile only')
    await signUpAndGoToFiles(page)

    // Create a folder so table renders (icon-only button on mobile, matched by aria-label)
    await page.getByRole('button', { name: /new folder|folder/i }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('textbox').fill('test-folder')
    await dialog.getByRole('button', { name: /create/i }).click()
    await expect(dialog).not.toBeVisible({ timeout: 10000 })

    // Size and modified columns should be hidden on mobile
    await expect(page.getByRole('columnheader', { name: /size/i })).not.toBeVisible()
    await expect(page.getByRole('columnheader', { name: /modified/i })).not.toBeVisible()

    // Name and actions should still be visible
    await expect(page.getByRole('columnheader', { name: /name/i })).toBeVisible()
  })
})

// ---------------------------------------------------------------------------
// Page-level: no horizontal scroll on any device
// ---------------------------------------------------------------------------
test.describe('No horizontal overflow', () => {
  for (const device of ['desktop', 'tablet', 'mobile']) {
    test(`${device}: page has no horizontal scrollbar`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== device, `${device} only`)
      await signUpAndGoToFiles(page)

      const hasHScroll = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      )
      expect(hasHScroll).toBe(false)
    })
  }
})
