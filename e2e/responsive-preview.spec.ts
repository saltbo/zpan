import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, type Page, test } from '@playwright/test'
import { signUpAndGoToFiles } from './helpers'

const FAKE_S3 = 'https://fake-s3.e2e.local'
const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures')

function fakeFile(name: string, type: string, size: number) {
  const id = `mock-${name.replace(/\W/g, '-')}`
  return {
    id,
    orgId: 'org',
    alias: '',
    name,
    type,
    size,
    dirtype: 0, // FILE
    parent: '',
    object: `mock/${name}`,
    storageId: 'storage',
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

/** Set up route mocks so clicking a file triggers preview with fixture data. */
async function setupPreviewMocks(page: Page, file: { name: string; type: string; size: number; fixture: string }) {
  const mock = fakeFile(file.name, file.type, file.size)
  const downloadUrl = `${FAKE_S3}/${file.name}`

  // Mock file list to include our fake file
  await page.route('**/api/objects?*', async (route) => {
    const resp = await route.fetch()
    const body = await resp.json()
    body.items = [mock, ...(body.items ?? [])]
    body.total = body.items.length
    return route.fulfill({ json: body })
  })

  // Mock getObject → return file with downloadUrl
  await page.route(`**/api/objects/${mock.id}`, (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    return route.fulfill({ json: { ...mock, downloadUrl } })
  })

  // Mock S3 download → serve fixture
  await page.route(`${FAKE_S3}/**`, (route) =>
    route.fulfill({ path: path.join(fixturesDir, file.fixture), contentType: file.type }),
  )

  return mock
}

// ---------------------------------------------------------------------------
// Preview per file type: mobile drawer vs desktop dialog
// ---------------------------------------------------------------------------
test.describe('Preview with mocked files', () => {
  test('mobile: text file renders in full-screen drawer @mobile', async ({ page }) => {
    await signUpAndGoToFiles(page)

    await setupPreviewMocks(page, { name: 'readme.txt', type: 'text/plain', size: 50, fixture: 'sample.txt' })

    // Reload to get mocked file list
    await page.reload()
    await expect(page.getByText('readme.txt')).toBeVisible({ timeout: 10000 })

    // Click file name to open preview
    await page.getByRole('button', { name: 'readme.txt' }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 10000 })

    // Header shows file name
    await expect(dialog.locator('p', { hasText: 'readme.txt' })).toBeVisible()

    // Content is rendered
    await expect(dialog.getByText('Hello, this is a plain text file')).toBeVisible({ timeout: 10000 })

    // Drawer is full-screen on mobile
    const bounds = await dialog.boundingBox()
    if (bounds) {
      const viewport = page.viewportSize()!
      expect(bounds.height).toBeGreaterThan(viewport.height * 0.9)
      expect(bounds.width).toBeGreaterThanOrEqual(viewport.width - 2)
    }
  })

  test('mobile: markdown file renders in drawer @mobile', async ({ page }) => {
    await signUpAndGoToFiles(page)

    await setupPreviewMocks(page, { name: 'docs.md', type: 'text/markdown', size: 44, fixture: 'sample.md' })
    await page.reload()
    await expect(page.getByText('docs.md')).toBeVisible({ timeout: 10000 })

    await page.getByRole('button', { name: 'docs.md' }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 10000 })
    await expect(dialog.locator('p', { hasText: 'docs.md' })).toBeVisible()
  })

  test('mobile: code file renders in drawer @mobile', async ({ page }) => {
    await signUpAndGoToFiles(page)

    await setupPreviewMocks(page, { name: 'config.json', type: 'application/json', size: 19, fixture: 'sample.json' })
    await page.reload()
    await expect(page.getByText('config.json')).toBeVisible({ timeout: 10000 })

    await page.getByRole('button', { name: 'config.json' }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 10000 })
    await expect(dialog.locator('p', { hasText: 'config.json' })).toBeVisible()
  })

  test('desktop: text file renders in centered dialog @desktop', async ({ page }) => {
    await signUpAndGoToFiles(page)

    await setupPreviewMocks(page, { name: 'notes.txt', type: 'text/plain', size: 50, fixture: 'sample.txt' })
    await page.reload()
    await expect(page.getByText('notes.txt')).toBeVisible({ timeout: 10000 })

    await page.getByRole('button', { name: 'notes.txt' }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 10000 })
    await expect(dialog.locator('p', { hasText: 'notes.txt' })).toBeVisible()
    await expect(dialog.getByText('Hello, this is a plain text file')).toBeVisible({ timeout: 10000 })

    // Desktop: dialog should NOT be full screen
    const bounds = await dialog.boundingBox()
    if (bounds) {
      const viewport = page.viewportSize()!
      expect(bounds.width).toBeLessThan(viewport.width * 0.95)
    }
  })
})

// ---------------------------------------------------------------------------
// No overflow
// ---------------------------------------------------------------------------
test.describe('Preview no overflow', () => {
  test('mobile: page has no horizontal overflow @mobile', async ({ page }) => {
    await signUpAndGoToFiles(page)

    const hasHScroll = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    )
    expect(hasHScroll).toBe(false)
  })
})
