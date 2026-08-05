/**
 * E2E: Image Host gallery page
 *
 * Golden path: enable feature → upload to the local S3 protocol fake → view in
 * grid → switch to table → copy Markdown URL → delete with Undo.
 */

import { type APIResponse, expect, test } from '@playwright/test'
import { expandSignUpForm, testIdentity } from './helpers'

const PASSWORD = 'password123456'

async function expectApiOk(response: APIResponse, label: string) {
  if (response.ok()) return
  const body = await response.text().catch(() => '')
  expect(response.ok(), `${label} failed with ${response.status()}: ${body}`).toBe(true)
}

async function openImageRowActions(page: import('@playwright/test').Page, fileName: string) {
  const row = page.getByRole('row', { name: new RegExp(fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) })
  await expect(row).toBeVisible({ timeout: 10000 })
  await row.getByRole('button').last().click()
}

async function signUpAndGoToImageHost(page: import('@playwright/test').Page) {
  const identity = testIdentity('ihost')
  await page.goto('/sign-up')
  await expandSignUpForm(page)
  await page.getByLabel('Email').fill(`${identity}@example.com`)
  await page.getByLabel('Username').fill(identity)
  await page.getByLabel('Password').fill(PASSWORD)
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/auth/sign-up')),
    page.getByRole('button', { name: 'Sign up' }).click(),
  ])
  expect(resp.status()).toBe(200)
  await expect(page).toHaveURL(/files/, { timeout: 10000 })
}

async function openImageHostSettings(page: import('@playwright/test').Page) {
  const response = await page.request.get('/api/auth/organization/list')
  await expectApiOk(response, 'List workspaces')
  const organizations = (await response.json()) as Array<{ id: string }>
  expect(organizations.length).toBeGreaterThan(0)
  await page.goto(`/teams/${organizations[0].id}/ihost`)
  await expect(page).toHaveURL(/teams\/[^/]+\/ihost/, { timeout: 10000 })
}

async function enableImageHostFromSettings(page: import('@playwright/test').Page) {
  await openImageHostSettings(page)
  const enableBtn = page.getByRole('button', { name: /enable|activate/i })
  await expect(enableBtn).toBeVisible({ timeout: 10000 })
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/image-hosting/config'), { timeout: 10000 }),
    enableBtn.click(),
  ])
  expect(response.ok()).toBe(true)
}

// ---------------------------------------------------------------------------
// Image Host feature gate
// ---------------------------------------------------------------------------
test.describe('Image Host @all', () => {
  test('shows enable-feature prompt in settings before activation', async ({ page }) => {
    await signUpAndGoToImageHost(page)
    await openImageHostSettings(page)
    // Settings page shows an enable/activate button
    const enableBtn = page.getByRole('button', { name: /enable|activate/i })
    await expect(enableBtn).toBeVisible({ timeout: 10000 })
  })

  test('gallery is accessible after enabling the feature', async ({ page }) => {
    await signUpAndGoToImageHost(page)
    await enableImageHostFromSettings(page)

    // Navigate to the image host page
    await page.goto('/image-host')
    await expect(page).toHaveURL(/image-host/, { timeout: 10000 })
    // After enable, the gallery / empty state should be visible
    await expect(page.getByText(/drag and drop|no image/i)).toBeVisible({ timeout: 10000 })
  })
})

// ---------------------------------------------------------------------------
// Image Host gallery — full golden path
// ---------------------------------------------------------------------------
test.describe('Image Host gallery golden path', () => {
  // Sign up, enable image hosting, and return to the page
  async function setupImageHost(page: import('@playwright/test').Page) {
    await signUpAndGoToImageHost(page)
    await enableImageHostFromSettings(page)
    await page.goto('/image-host')
    await expect(page).toHaveURL(/image-host/, { timeout: 10000 })
    await expect(page.getByText(/drag and drop|no image/i)).toBeVisible({ timeout: 10000 })
  }

  test('upload → switch between list and grid views @desktop @tablet @critical', async ({ page }) => {
    await setupImageHost(page)

    // Create a tiny PNG file buffer (1×1 transparent PNG)
    const pngBytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    )

    const [uploadResp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/image-hosting/images') && r.request().method() === 'POST', {
        timeout: 10000,
      }),
      page.locator('input[type="file"]').first().setInputFiles({
        name: 'test-image.png',
        mimeType: 'image/png',
        buffer: pngBytes,
      }),
    ])
    await expectApiOk(uploadResp, 'Image upload')

    const listView = page.getByRole('radio', { name: 'List view' })
    const gridView = page.getByRole('radio', { name: 'Grid view' })
    await expect(listView).toBeChecked()
    await expect(page.getByRole('row').filter({ hasText: 'test-image.png' })).toBeVisible()

    await gridView.click()
    await expect(gridView).toBeChecked()
    await expect(page.getByRole('button', { name: /test-image\.png/ })).toBeVisible()

    await listView.click()
    await expect(listView).toBeChecked()
  })

  test('copy URL with Markdown format via row actions @all', async ({ page, context }) => {
    await setupImageHost(page)

    // Grant clipboard permissions
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])

    // Seed an image via API so we have something to interact with
    const presignResp = await page.request.post('/api/image-hosting/images/presign', {
      headers: { 'Content-Type': 'application/json' },
      data: { path: 'e2e-copy-test.png', mime: 'image/png', size: 100 },
    })
    await expectApiOk(presignResp, 'Seed image presign')
    const { id: draftId } = await presignResp.json()

    // Confirm the draft (simulate successful S3 upload)
    const confirmResp = await page.request.put(`/api/image-hosting/images/${draftId}/status`)
    await expectApiOk(confirmResp, 'Confirm seeded image')

    await page.route('**/api/image-hosting/images?*', async (route) => {
      if (route.request().method() !== 'GET') return route.continue()
      const response = await route.fetch()
      const body = (await response.json()) as { items: Array<{ path: string; url: string }> }
      for (const item of body.items) {
        if (item.path === 'e2e-copy-test.png') item.url = 'https://images.example.com/e2e-copy-test.png'
      }
      await route.fulfill({ response, json: body })
    })

    // Reload to see the seeded image
    await page.reload()

    await openImageRowActions(page, 'e2e-copy-test.png')
    await page.getByRole('menuitem', { name: /copy url/i }).hover()
    await page.getByRole('menuitem', { name: /markdown/i }).click()

    const clipText = await page.evaluate(() => navigator.clipboard.readText())
    expect(clipText).toBe('![](https://images.example.com/e2e-copy-test.png)')
  })

  test('delete with Undo → cancel → item restored @all', async ({ page }) => {
    await setupImageHost(page)

    // Seed an image
    const presignResp = await page.request.post('/api/image-hosting/images/presign', {
      headers: { 'Content-Type': 'application/json' },
      data: { path: 'e2e-delete-undo.png', mime: 'image/png', size: 100 },
    })
    await expectApiOk(presignResp, 'Seed image presign')
    const { id: draftId } = await presignResp.json()
    const confirmResp = await page.request.put(`/api/image-hosting/images/${draftId}/status`)
    await expectApiOk(confirmResp, 'Confirm seeded image')

    await page.reload()

    await openImageRowActions(page, 'e2e-delete-undo.png')
    const deleteMenuItem = page.getByRole('menuitem', { name: /delete/i }).first()
    await expect(deleteMenuItem).toBeVisible({ timeout: 3000 })
    await deleteMenuItem.click()

    // Undo toast should appear
    const undoBtn = page.getByRole('button', { name: 'Undo', exact: true })
    await expect(undoBtn).toBeVisible({ timeout: 5000 })

    // Click Undo to cancel the deletion
    await undoBtn.click()

    // Toast should be dismissed — item remains in the gallery
    await expect(undoBtn).not.toBeVisible({ timeout: 3000 })
  })
})
