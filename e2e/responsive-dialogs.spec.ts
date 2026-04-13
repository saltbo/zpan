import { expect, test } from '@playwright/test'
import { createFolder, seedStorage, signUpAndGoToFiles } from './helpers'

// ---------------------------------------------------------------------------
// Dialogs responsive behavior
// ---------------------------------------------------------------------------
test.describe('File dialogs responsive', () => {
  test('mobile: new folder dialog is usable', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'mobile only')
    await signUpAndGoToFiles(page)

    // Open new folder dialog
    await page.getByRole('button', { name: /new folder|folder/i }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()

    // Input should be visible and fillable
    const input = dialog.getByRole('textbox')
    await expect(input).toBeVisible()
    await input.fill('test-mobile-folder')

    // Buttons should be visible
    await expect(dialog.getByRole('button', { name: /create/i })).toBeVisible()
    await expect(dialog.getByRole('button', { name: /cancel/i })).toBeVisible()

    // Dialog should not overflow viewport
    const overflows = await dialog.evaluate((el) => {
      const rect = el.getBoundingClientRect()
      return rect.right > window.innerWidth || rect.left < 0
    })
    expect(overflows).toBe(false)
  })

  test('tablet: new folder dialog is usable', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'tablet', 'tablet only')
    await signUpAndGoToFiles(page)

    await page.getByRole('button', { name: /new folder|folder/i }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()

    await expect(dialog.getByRole('textbox')).toBeVisible()
    await expect(dialog.getByRole('button', { name: /create/i })).toBeVisible()
  })

  test('mobile: rename dialog is usable', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'mobile only')
    await signUpAndGoToFiles(page)
    await seedStorage(page)
    await createFolder(page, 'rename-me')

    // Open row actions dropdown via the last button in the row
    const row = page.getByRole('row', { name: /rename-me/i })
    await expect(row).toBeVisible({ timeout: 5000 })
    await row.getByRole('button').last().click()
    await page.getByRole('menuitem', { name: /rename/i }).click()

    // Rename dialog should be visible and usable
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('textbox')).toBeVisible()
    await expect(dialog.getByRole('button', { name: /rename/i })).toBeVisible()
    await expect(dialog.getByRole('button', { name: /cancel/i })).toBeVisible()

    // Dialog should not overflow
    const overflows = await dialog.evaluate((el) => {
      const rect = el.getBoundingClientRect()
      return rect.right > window.innerWidth || rect.left < 0
    })
    expect(overflows).toBe(false)
  })

  test('mobile: move dialog is usable', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'mobile only')
    await signUpAndGoToFiles(page)
    await seedStorage(page)
    await createFolder(page, 'move-me')

    // Open row actions dropdown via the last button in the row
    const row = page.getByRole('row', { name: /move-me/i })
    await expect(row).toBeVisible({ timeout: 5000 })
    await row.getByRole('button').last().click()
    await page.getByRole('menuitem', { name: 'Move to', exact: true }).click()

    // Move dialog should be visible
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('button', { name: /cancel/i })).toBeVisible()

    // Dialog should not overflow
    const overflows = await dialog.evaluate((el) => {
      const rect = el.getBoundingClientRect()
      return rect.right > window.innerWidth || rect.left < 0
    })
    expect(overflows).toBe(false)
  })
})
