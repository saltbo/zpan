import { expect, type Page } from '@playwright/test'

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
 * Create a folder via the UI. Waits for the API response to confirm success.
 * If the API returns an error the test fails with a descriptive message.
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

/**
 * Seed a dummy storage backend via the admin API.
 * The first registered user is admin, so this must be called
 * after the first signUp in the test suite. The storage doesn't
 * need real S3 credentials — folder creation only needs a DB record.
 */
export async function seedStorage(page: Page): Promise<void> {
  const resp = await page.request.post('/api/admin/storages', {
    data: {
      title: 'E2E Test Storage',
      mode: 'private',
      bucket: 'e2e-test',
      endpoint: 'https://localhost',
      region: 'auto',
      accessKey: 'fake-key',
      secretKey: 'fake-secret',
    },
  })
  // Ignore 401/403 (non-admin user) — storage may already exist from a prior test
  if (resp.status() === 401 || resp.status() === 403) return
  expect(resp.ok(), `seed storage failed (${resp.status()})`).toBe(true)
}
