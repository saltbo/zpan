import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, type Page, test } from '@playwright/test'
import { signUpAndGoToFiles } from './helpers'

const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures')

const folderShare = {
  token: 'folder-share-e2e',
  kind: 'landing',
  status: 'active',
  expiresAt: null,
  downloadLimit: null,
  matter: { name: 'Client Files', type: 'application/x-directory', size: 0, isFolder: true },
  creatorName: 'E2E Admin',
  requiresPassword: false,
  expired: false,
  exhausted: false,
  accessibleByUser: false,
  downloads: 0,
  views: 3,
  rootRef: 'root-folder-ref',
}

const fileShare = {
  token: 'file-share-e2e',
  kind: 'landing',
  status: 'active',
  expiresAt: null,
  downloadLimit: null,
  matter: { name: 'Brief.txt', type: 'text/plain', size: 50, isFolder: false },
  creatorName: 'E2E Admin',
  requiresPassword: false,
  expired: false,
  exhausted: false,
  accessibleByUser: false,
  downloads: 0,
  views: 1,
  rootRef: 'root-file-ref',
}

async function mockFolderShare(page: Page) {
  await page.route(`**/api/shares/${folderShare.token}`, (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    return route.fulfill({ json: folderShare })
  })

  await page.route(`**/api/shares/${folderShare.token}/objects?*`, async (route) => {
    const url = new URL(route.request().url())
    const parent = url.searchParams.get('parent') ?? ''
    if (parent === 'Reports') {
      return route.fulfill({
        json: {
          items: [{ ref: 'nested-notes-ref', name: 'notes.txt', type: 'text/plain', size: 50, isFolder: false }],
          total: 1,
          page: 1,
          pageSize: 50,
          breadcrumb: [
            { name: 'Client Files', path: '' },
            { name: 'Reports', path: 'Reports' },
          ],
        },
      })
    }

    return route.fulfill({
      json: {
        items: [
          { ref: 'reports-folder-ref', name: 'Reports', type: 'application/x-directory', size: 0, isFolder: true },
          { ref: 'overview-ref', name: 'overview.txt', type: 'text/plain', size: 50, isFolder: false },
        ],
        total: 2,
        page: 1,
        pageSize: 50,
        breadcrumb: [{ name: 'Client Files', path: '' }],
      },
    })
  })

  await page.route(`**/api/shares/${folderShare.token}/objects/*`, (route) =>
    route.fulfill({ path: path.join(fixturesDir, 'sample.txt'), contentType: 'text/plain' }),
  )
}

async function mockFileShare(page: Page) {
  await page.route(`**/api/shares/${fileShare.token}`, (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    return route.fulfill({ json: fileShare })
  })

  await page.route(`**/api/shares/${fileShare.token}/objects/${fileShare.rootRef}`, (route) =>
    route.fulfill({ path: path.join(fixturesDir, 'sample.txt'), contentType: 'text/plain' }),
  )
}

async function expectNoHorizontalOverflow(page: Page) {
  const hasHScroll = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  )
  expect(hasHScroll).toBe(false)
}

test.describe('Share access page shell', () => {
  test('public folder share uses the standard page shell without promotional chrome @all', async ({ page }) => {
    await mockFolderShare(page)
    await page.goto(`/s/${folderShare.token}`)

    await expect(page.locator('header')).toContainText('ZPan')
    await expect(page.getByTestId('page-header')).toContainText('Client Files')
    await expect(page.getByText('overview.txt')).toBeVisible()
    await expect(page.getByText('Reports')).toBeVisible()
    await expect(page.getByText('E2E Admin')).toBeVisible()

    await expect(page.getByText('Public access page')).toHaveCount(0)
    await expect(page.getByText('Open workspace')).toHaveCount(0)
    await expect(page.getByText('Shared Folder')).toHaveCount(0)
    await expect(page.getByText(/Browse shared content/i)).toHaveCount(0)
    await expect(page.getByText(/editing actions are disabled/i)).toHaveCount(0)

    await expect(page.locator('footer')).toContainText('ZPan')
    await expect(page.locator('footer')).toContainText(new Date().getFullYear().toString())
    await expectNoHorizontalOverflow(page)
  })

  test('folder share keeps FileManager navigation integrated with the share header @desktop', async ({ page }) => {
    await mockFolderShare(page)
    await page.goto(`/s/${folderShare.token}`)

    await page.getByRole('button', { name: 'Reports' }).dblclick()

    await expect(page.getByTestId('page-header')).toContainText('Client Files')
    await expect(page.getByTestId('page-header')).toContainText('Reports')
    await expect(page.getByText('notes.txt')).toBeVisible()
    await expect(page.getByText('overview.txt')).toHaveCount(0)
    await expectNoHorizontalOverflow(page)
  })

  test('single-file share uses the same share surface and shows preview actions @all', async ({ page }) => {
    await mockFileShare(page)
    await page.goto(`/s/${fileShare.token}`)

    await expect(page.getByTestId('page-header')).toContainText('Brief.txt')
    await expect(page.getByText('E2E Admin')).toBeVisible()
    await expect(page.getByRole('link', { name: /download/i })).toBeVisible()
    await expect(page.getByText('Hello, this is a plain text file')).toBeVisible({ timeout: 10000 })

    await expect(page.getByText('Public access page')).toHaveCount(0)
    await expect(page.getByText('Open workspace')).toHaveCount(0)
    await expect(page.getByText(/Preview and download/i)).toHaveCount(0)
    await expectNoHorizontalOverflow(page)
  })

  test('signed-in visitor sees avatar dropdown in the topbar @desktop', async ({ page }) => {
    await signUpAndGoToFiles(page)
    await mockFolderShare(page)
    await page.goto(`/s/${folderShare.token}`)

    await expect(page.locator('header').getByRole('button').first()).toBeVisible()
    await page.locator('header').getByRole('button').first().click()

    await expect(page.getByRole('menuitem', { name: /settings/i })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: /teams/i })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: /sign out/i })).toBeVisible()
    await expect(page.locator('header').getByText('Public access page')).toHaveCount(0)
    await expect(page.locator('header').getByText('Open workspace')).toHaveCount(0)
  })

  test('mobile share page keeps topbar, content, and footer within the viewport @mobile', async ({ page }) => {
    await mockFolderShare(page)
    await page.goto(`/s/${folderShare.token}`)

    await expect(page.locator('header')).toBeVisible()
    await expect(page.getByTestId('page-header')).toContainText('Client Files')
    await expect(page.locator('footer')).toBeVisible()
    await expect(page.getByText('overview.txt')).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })
})
