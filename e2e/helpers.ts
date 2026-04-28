import { expect, type Page } from '@playwright/test'

/** Admin credentials seeded by global-setup.ts (CI) or db:reset (local dev) */
export const ADMIN_EMAIL = 'e2e-admin@test.local'
export const ADMIN_PASSWORD = 'password123456'

const ADMIN_FALLBACKS = [
  { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  { email: 'admin@zpan.dev', password: 'adminadmin' },
]

/** Sign in as admin and navigate to /admin/storages. */
export async function signInAsAdmin(page: Page) {
  for (const cred of ADMIN_FALLBACKS) {
    await page.goto('/sign-in')
    await page.getByLabel('Email or Username').fill(cred.email)
    await page.getByLabel('Password').fill(cred.password)
    const [resp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/auth/sign-in')),
      page.getByRole('button', { name: /sign in/i }).click(),
    ])
    if (resp.status() === 200) {
      await expect(page).toHaveURL(/files/, { timeout: 10000 })
      await page.waitForLoadState('networkidle')
      await page.goto('/admin/storages')
      await expect(page).toHaveURL(/admin\/storages/, { timeout: 10000 })
      return
    }
  }
  throw new Error('could not sign in as admin with any known credentials')
}

/** Register a fresh user and land on /files. */
export async function signUpAndGoToFiles(page: Page) {
  await page.goto('/sign-up')
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
