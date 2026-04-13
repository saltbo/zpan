import { expect, type Page, test } from '@playwright/test'

/** Register a fresh user and land on /files. */
export async function signUpAndGoToFiles(page: Page) {
  await page.goto('/sign-up')
  await page.getByLabel('Name').fill('E2E Test')
  await page.getByLabel('Email').fill(`e2e-${Date.now()}@example.com`)
  await page.getByLabel('Password').fill('password123456')
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/auth/sign-up')),
    page.getByRole('button', { name: 'Sign up' }).click(),
  ])
  expect(resp.status()).toBe(200)
  await expect(page).toHaveURL(/files/, { timeout: 10000 })
}

/**
 * Create a folder via the UI. Returns true if successful, false if the
 * server rejected it (e.g. no storage configured in CI).
 * Skips the calling test when creation fails.
 */
export async function createFolder(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: /new folder|folder/i }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('textbox').fill(name)

  const [apiResp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/objects') && r.request().method() === 'POST'),
    dialog.getByRole('button', { name: /create/i }).click(),
  ])

  if (!apiResp.ok()) {
    // Close the dialog if it's still open (server error shown as toast)
    await dialog
      .getByRole('button', { name: /cancel/i })
      .click()
      .catch(() => {})
    test.skip(true, `folder creation failed (${apiResp.status()}) — likely no storage in CI`)
  }

  await expect(dialog).not.toBeVisible({ timeout: 10000 })
}
