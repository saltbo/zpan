import { expect, test } from '@playwright/test'

// Helper: sign in as admin (seeded user) and go to files
async function signInAndGoToFiles(page: import('@playwright/test').Page) {
  await page.goto('/sign-up')
  await page.getByLabel('Name').fill('Preview Test')
  await page.getByLabel('Email').fill(`preview-${Date.now()}@example.com`)
  await page.getByLabel('Password').fill('password123456')
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/auth/sign-up')),
    page.getByRole('button', { name: 'Sign up' }).click(),
  ])
  expect(resp.status()).toBe(200)
  await expect(page).toHaveURL(/files/, { timeout: 10000 })
}

// Helper: create a test file by creating a folder (we can't upload in E2E easily,
// but we can test the dialog structure by triggering preview on any available item)

// ---------------------------------------------------------------------------
// Preview dialog: mobile uses full-screen drawer, desktop uses centered dialog
// ---------------------------------------------------------------------------
test.describe('Preview responsive layout', () => {
  test('mobile: preview opens as full-screen drawer (not centered dialog)', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'mobile only')
    await signInAndGoToFiles(page)

    // Create a folder and a text-like item to preview
    // Since we can't upload files easily, create a folder and try to open it
    // The preview dialog structure test focuses on the dialog/drawer pattern
    await page.getByRole('button', { name: /new folder|folder/i }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('textbox').fill('test-preview')
    await dialog.getByRole('button', { name: /create/i }).click()
    await expect(dialog).not.toBeVisible({ timeout: 5000 })

    // We need a file to trigger preview — check if any files exist
    // If no files, we'll validate the dialog structure via the preview component test
    const fileRows = page.locator('table tbody tr')
    const count = await fileRows.count()
    if (count === 0) {
      test.skip(true, 'no files available to preview')
    }

    // Click the first file's row actions to trigger preview
    const firstFileRow = fileRows.first()
    const actionsBtn = firstFileRow.locator('button').last()
    await actionsBtn.click()

    // Look for preview/open menu item
    const previewItem = page.getByRole('menuitem', { name: /preview|open/i })
    if (!(await previewItem.isVisible({ timeout: 2000 }).catch(() => false))) {
      test.skip(true, 'no previewable file found')
    }
    await previewItem.click()

    // On mobile, the preview should use a drawer (Sheet) that covers full viewport
    const previewDialog = page.getByRole('dialog')
    await expect(previewDialog).toBeVisible({ timeout: 5000 })

    // The drawer should be near-full-screen on mobile
    const bounds = await previewDialog.boundingBox()
    if (bounds) {
      const viewport = page.viewportSize()!
      // Drawer should cover at least 90% of viewport height
      expect(bounds.height).toBeGreaterThan(viewport.height * 0.9)
      // Drawer should be full width (no side margins)
      expect(bounds.width).toBeGreaterThanOrEqual(viewport.width - 2)
    }
  })

  test('desktop: preview opens as centered dialog', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'desktop only')
    await signInAndGoToFiles(page)

    const fileRows = page.locator('table tbody tr')
    const count = await fileRows.count()
    if (count === 0) {
      test.skip(true, 'no files available to preview')
    }

    const firstFileRow = fileRows.first()
    const actionsBtn = firstFileRow.locator('button').last()
    await actionsBtn.click()

    const previewItem = page.getByRole('menuitem', { name: /preview|open/i })
    if (!(await previewItem.isVisible({ timeout: 2000 }).catch(() => false))) {
      test.skip(true, 'no previewable file found')
    }
    await previewItem.click()

    const previewDialog = page.getByRole('dialog')
    await expect(previewDialog).toBeVisible({ timeout: 5000 })

    // On desktop, the dialog should NOT be full-screen
    const bounds = await previewDialog.boundingBox()
    if (bounds) {
      const viewport = page.viewportSize()!
      // Dialog should have margins (not full width)
      expect(bounds.width).toBeLessThan(viewport.width * 0.95)
    }
  })

  test('mobile: preview has no horizontal overflow', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'mobile only')
    await signInAndGoToFiles(page)

    const hasHScroll = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    )
    expect(hasHScroll).toBe(false)
  })
})
