import { expect, test } from '@playwright/test'

// Helper: register and go to recycle bin
async function signUpAndGoToTrash(page: import('@playwright/test').Page) {
  await page.goto('/sign-up')
  await page.getByLabel('Username').fill(`trash${Date.now()}`)
  await page.getByLabel('Name', { exact: true }).fill('Trash Test')
  await page.getByLabel('Email').fill(`trash-${Date.now()}@example.com`)
  await page.getByLabel('Password').fill('password123456')
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/auth/sign-up')),
    page.getByRole('button', { name: 'Sign up' }).click(),
  ])
  expect(resp.status()).toBe(200)
  await expect(page).toHaveURL(/files/, { timeout: 10000 })
  await page.goto('/recycle-bin')
  await expect(page).toHaveURL(/recycle-bin/, { timeout: 10000 })
}

// ---------------------------------------------------------------------------
// Recycle bin page responsive
// ---------------------------------------------------------------------------
test.describe('Recycle bin responsive layout', () => {
  test('recycle bin has no horizontal overflow @all', async ({ page }) => {
    await signUpAndGoToTrash(page)

    const hasHScroll = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    )
    expect(hasHScroll).toBe(false)
  })

  test('mobile: trash toolbar buttons are accessible @mobile', async ({ page }) => {
    await signUpAndGoToTrash(page)

    // Empty trash button should be visible (icon + text or icon-only)
    await expect(page.getByRole('button', { name: /empty/i })).toBeVisible()

    // Toolbar should not overflow
    const toolbar = page.locator('[data-testid="trash-toolbar"]')
    await expect(toolbar).toBeVisible()
    const overflows = await toolbar.evaluate((el) => el.scrollWidth > el.clientWidth)
    expect(overflows).toBe(false)
  })
})
