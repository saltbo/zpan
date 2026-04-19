import { expect, test } from '@playwright/test'
import { createFolder, signUpAndGoToFiles } from './helpers'

// Acceptance coverage for the name-conflict dialog. Single consolidated test
// because each sign-up costs a full round trip — reusing one session keeps the
// flow tight and avoids hitting first-request cold-start on the dev server.

test.describe('Name conflict — folders @all', () => {
  // Warm the dev server so the sign-up that starts the test isn't the first
  // POST hitting a freshly-spawned tsx-watch process.
  test.beforeAll(async ({ request }) => {
    for (let i = 0; i < 30; i++) {
      try {
        const res = await request.get('/api/health', { timeout: 3000 })
        if (res.ok()) return
      } catch {
        // retry
      }
      await new Promise((r) => setTimeout(r, 1000))
    }
  })

  test('409 on duplicate folder, Keep Both auto-renames, case-insensitive match', async ({ page }) => {
    test.slow()
    await signUpAndGoToFiles(page)
    await createFolder(page, 'reports')

    // --- 1. Duplicate name → 409 with NAME_CONFLICT body ---
    await page.getByRole('button', { name: /new folder|folder/i }).click()
    const newFolderDialog = page.getByRole('dialog')
    await newFolderDialog.getByRole('textbox').fill('reports')

    const [firstResp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/objects') && r.request().method() === 'POST'),
      newFolderDialog.getByRole('button', { name: /create/i }).click(),
    ])
    expect(firstResp.status()).toBe(409)
    const body = await firstResp.json()
    expect(body.code).toBe('NAME_CONFLICT')

    // --- 2. Conflict dialog: no Replace for folders, click Keep Both → rename ---
    const conflictDialog = page.getByRole('dialog').filter({ hasText: /already/i })
    await expect(conflictDialog).toBeVisible()
    await expect(conflictDialog.getByRole('button', { name: /^replace$/i })).toHaveCount(0)

    const [retryResp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/objects') && r.request().method() === 'POST'),
      conflictDialog.getByRole('button', { name: /keep both/i }).click(),
    ])
    expect(retryResp.ok()).toBe(true)
    await expect(page.getByRole('cell', { name: 'reports', exact: true })).toHaveCount(1)
    await expect(page.getByRole('cell', { name: 'reports (1)', exact: true })).toHaveCount(1)

    // --- 3. Case-insensitive: uppercase name also conflicts ---
    await page.getByRole('button', { name: /new folder|folder/i }).click()
    const secondDialog = page
      .getByRole('dialog')
      .filter({ hasText: /new folder|name/i })
      .first()
    await secondDialog.getByRole('textbox').fill('REPORTS')

    const [caseResp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/objects') && r.request().method() === 'POST'),
      secondDialog.getByRole('button', { name: /create/i }).click(),
    ])
    expect(caseResp.status()).toBe(409)
    await expect(page.getByRole('dialog').filter({ hasText: /already/i })).toBeVisible()
  })
})
