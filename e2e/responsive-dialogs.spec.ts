import { expect, test } from '@playwright/test'

// Helper: register and go to files
async function signUpAndGoToFiles(page: import('@playwright/test').Page) {
  await page.goto('/sign-up')
  await page.getByLabel('Name').fill('Dialog Test')
  await page.getByLabel('Email').fill(`dialog-${Date.now()}@example.com`)
  await page.getByLabel('Password').fill('password123456')
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/auth/sign-up')),
    page.getByRole('button', { name: 'Sign up' }).click(),
  ])
  expect(resp.status()).toBe(200)
  await expect(page).toHaveURL(/files/, { timeout: 10000 })
}

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

    // Create a folder to rename
    await page.getByRole('button', { name: /new folder|folder/i }).click()
    let dialog = page.getByRole('dialog')
    await dialog.getByRole('textbox').fill('rename-me')
    await dialog.getByRole('button', { name: /create/i }).click()
    await expect(dialog).not.toBeVisible({ timeout: 5000 })

    // Open context menu on the folder via long press or row actions
    const row = page.getByText('rename-me')
    await expect(row).toBeVisible({ timeout: 5000 })
    // Use the row actions dropdown (ellipsis button)
    const actionsBtn = page
      .locator('button')
      .filter({ has: page.locator('[class*="ellipsis"], [data-lucide="ellipsis-vertical"]') })
      .first()
    await actionsBtn.click()
    await page.getByRole('menuitem', { name: /rename/i }).click()

    // Rename dialog should be visible and usable
    dialog = page.getByRole('dialog')
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

    // Create a folder to move
    await page.getByRole('button', { name: /new folder|folder/i }).click()
    let dialog = page.getByRole('dialog')
    await dialog.getByRole('textbox').fill('move-me')
    await dialog.getByRole('button', { name: /create/i }).click()
    await expect(dialog).not.toBeVisible({ timeout: 5000 })

    // Open row actions dropdown
    const actionsBtn = page
      .locator('button')
      .filter({ has: page.locator('[class*="ellipsis"], [data-lucide="ellipsis-vertical"]') })
      .first()
    await expect(actionsBtn).toBeVisible({ timeout: 5000 })
    await actionsBtn.click()
    await page.getByRole('menuitem', { name: 'Move to', exact: true }).click()

    // Move dialog should be visible
    dialog = page.getByRole('dialog')
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
