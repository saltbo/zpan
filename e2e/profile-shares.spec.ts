import { expect, test } from '@playwright/test'

const folderShare = {
  token: 'profile-folder',
  kind: 'landing',
  status: 'active',
  expiresAt: null,
  downloadLimit: null,
  matter: { name: 'Photos', type: 'folder', size: 0, isFolder: true },
  creatorName: 'Alice',
  requiresPassword: false,
  expired: false,
  exhausted: false,
  accessibleByUser: false,
  downloads: 0,
  views: 0,
  rootRef: 'profile-folder-root',
}

test('anonymous profile opens curated files and folders through the landing-share flow @desktop [spec: profile/share-flow]', async ({
  page,
}) => {
  await page.route('**/api/users/alice', (route) =>
    route.fulfill({
      json: {
        user: { username: 'alice', name: 'Alice', image: null },
        shares: [
          { token: 'profile-file', name: 'Brief.txt', type: 'text/plain', size: 50, isFolder: false },
          { token: folderShare.token, name: 'Photos', type: 'folder', size: 0, isFolder: true },
        ],
      },
    }),
  )
  await page.route(`**/api/shares/${folderShare.token}`, (route) => route.fulfill({ json: folderShare }))
  await page.route(`**/api/shares/${folderShare.token}/objects?*`, (route) => {
    const parent = new URL(route.request().url()).searchParams.get('parent') ?? ''
    return route.fulfill({
      json:
        parent === 'Albums'
          ? {
              items: [{ ref: 'summer-ref', name: 'summer.jpg', type: 'image/jpeg', size: 128, isFolder: false }],
              total: 1,
              page: 1,
              pageSize: 50,
              breadcrumb: [
                { name: 'Photos', path: '' },
                { name: 'Albums', path: 'Albums' },
              ],
            }
          : {
              items: [{ ref: 'albums-ref', name: 'Albums', type: 'folder', size: 0, isFolder: true }],
              total: 1,
              page: 1,
              pageSize: 50,
              breadcrumb: [{ name: 'Photos', path: '' }],
            },
    })
  })

  await page.goto('/u/alice')

  await expect(page.getByText('@alice')).toBeVisible()
  await expect(page.locator('a[href="/s/profile-file"]')).toContainText('Brief.txt')
  const folderLink = page.locator(`a[href="/s/${folderShare.token}"]`)
  await expect(folderLink).toContainText('Photos')
  await folderLink.click()

  await expect(page).toHaveURL(`/s/${folderShare.token}`)
  await expect(page.getByTestId('page-header')).toContainText('Photos')
  await page.getByRole('button', { name: 'Albums' }).dblclick()
  await expect(page.getByTestId('page-header')).toContainText('Albums')
  await expect(page.getByText('summer.jpg')).toBeVisible()
})
