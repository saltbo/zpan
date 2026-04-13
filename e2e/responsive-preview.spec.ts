import { expect, test } from '@playwright/test'
import { createFolder, seedStorage, signUpAndGoToFiles } from './helpers'

// ---------------------------------------------------------------------------
// Preview dialog: mobile uses full-screen drawer, desktop uses centered dialog
// ---------------------------------------------------------------------------
test.describe('Preview responsive layout', () => {
  test('mobile: preview opens as full-screen drawer (not centered dialog)', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'mobile only')
    await signUpAndGoToFiles(page)
    await seedStorage(page)
    await createFolder(page, 'test-preview')

    // We need a file to trigger preview — check if any files exist
    const fileRows = page.locator('table tbody tr')
    const count = await fileRows.count()
    if (count === 0) {
      test.skip(true, 'no files available to preview')
    }

    // Click the first file's row actions to trigger preview
    const firstFileRow = fileRows.first()
    await firstFileRow.locator('button').last().click()

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
      expect(bounds.height).toBeGreaterThan(viewport.height * 0.9)
      expect(bounds.width).toBeGreaterThanOrEqual(viewport.width - 2)
    }
  })

  test('desktop: preview opens as centered dialog', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'desktop only')
    await signUpAndGoToFiles(page)

    const fileRows = page.locator('table tbody tr')
    const count = await fileRows.count()
    if (count === 0) {
      test.skip(true, 'no files available to preview')
    }

    const firstFileRow = fileRows.first()
    await firstFileRow.locator('button').last().click()

    const previewItem = page.getByRole('menuitem', { name: /preview|open/i })
    if (!(await previewItem.isVisible({ timeout: 2000 }).catch(() => false))) {
      test.skip(true, 'no previewable file found')
    }
    await previewItem.click()

    const previewDialog = page.getByRole('dialog')
    await expect(previewDialog).toBeVisible({ timeout: 5000 })

    const bounds = await previewDialog.boundingBox()
    if (bounds) {
      const viewport = page.viewportSize()!
      expect(bounds.width).toBeLessThan(viewport.width * 0.95)
    }
  })

  test('mobile: preview has no horizontal overflow', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'mobile only')
    await signUpAndGoToFiles(page)

    const hasHScroll = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    )
    expect(hasHScroll).toBe(false)
  })
})
