import { expect, type Page } from '@playwright/test'

/** Admin credentials seeded by global-setup.ts (CI) or db:reset (local dev) */
export const ADMIN_EMAIL = 'e2e-admin@test.local'
export const ADMIN_PASSWORD = 'password123456'

/** Sign in as admin and navigate to /admin/storages. */
export async function signInAsAdmin(page: Page) {
  await page.goto('/sign-in')
  await page.getByLabel('Email or Username').fill(ADMIN_EMAIL)
  await page.getByLabel('Password').fill(ADMIN_PASSWORD)
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/auth/sign-in')),
    page.getByRole('button', { name: /sign in/i }).click(),
  ])
  expect(resp.status()).toBe(200)
  await expect(page).toHaveURL(/files/, { timeout: 10000 })
  await page.waitForLoadState('networkidle')
  await page.goto('/admin/storages')
  await expect(page).toHaveURL(/admin\/storages/, { timeout: 10000 })
}

export async function expandSignUpForm(page: Page) {
  const usernameInput = page.getByLabel('Username')
  if (await usernameInput.isVisible().catch(() => false)) return
  const expandButton = page.getByRole('button', { name: /sign up with email/i })
  if (await expandButton.isVisible().catch(() => false)) await expandButton.click()
  await expect(usernameInput).toBeVisible()
}

/** Register a fresh user and land on /files. */
export async function signUpAndGoToFiles(page: Page) {
  await page.goto('/sign-up')
  await expandSignUpForm(page)
  await page.getByLabel('Email').fill(`e2e-${Date.now()}@example.com`)
  await page.getByLabel('Username').fill(`e2e${Date.now()}`)
  await page.getByLabel('Password').fill('password123456')
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/auth/sign-up')),
    page.getByRole('button', { name: 'Sign up' }).click(),
  ])
  expect(resp.status()).toBe(200)
  await expect(page).toHaveURL(/files/, { timeout: 10000 })
}

/**
 * Create a folder via the UI. Waits for the API response to confirm success.
 * Storage must be seeded by global-setup.ts before this can work.
 */
export async function createFolder(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: /new folder|folder/i }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('textbox').fill(name)

  const [apiResp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/objects') && r.request().method() === 'POST'),
    dialog.getByRole('button', { name: /create/i }).click(),
  ])

  expect(apiResp.ok(), `folder creation failed (${apiResp.status()}) — ensure storage is configured`).toBe(true)
  await expect(dialog).not.toBeVisible({ timeout: 10000 })
}
