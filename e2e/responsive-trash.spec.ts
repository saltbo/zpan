import { expect, test } from '@playwright/test'

// Helper: register and go to recycle bin
async function signUpAndGoToTrash(page: import('@playwright/test').Page) {
  await page.goto('/sign-up')
  await page.getByLabel('Email').fill(`trash-${Date.now()}@example.com`)
  await page.getByLabel('Username').fill(`trash${Date.now()}`)
  await page.getByLabel('Password').fill('password123456')
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/auth/sign-up')),
    page.getByRole('button', { name: 'Sign up' }).click(),
  ])
  expect(resp.status()).toBe(200)
  await expect(page).toHaveURL(/files/, { timeout: 10000 })
  await page.goto('/trash')
  await expect(page).toHaveURL(/trash/, { timeout: 10000 })
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

  test('mobile: empty trash action is accessible @mobile', async ({ page }) => {
    await signUpAndGoToTrash(page)

    await expect(page.getByRole('button', { name: /empty/i })).toBeVisible()
  })
})
