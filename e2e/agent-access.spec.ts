import { expect, test } from '@playwright/test'
import { signUpAndGoToFiles } from './helpers'

const oauthQuery =
  'client_id=dynamic-client&redirect_uri=https%3A%2F%2Fbroker.example.com%2Fcallback&response_type=code&scope=openid%20offline_access%20objects%3Aread%20shares%3Acreate%20quota%3Aread'

test.describe('Agent Access OAuth UI', () => {
  test('renders consent details and submits full approval @desktop', async ({ page }) => {
    await signUpAndGoToFiles(page)

    await page.route('**/api/agent-oauth-consent?*', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          clientId: 'dynamic-client',
          clientName: 'FlareAuth',
          instanceOrigin: 'http://localhost:5185',
          workspace: { id: 'org-e2e', name: 'Personal' },
          scopes: ['objects:read', 'shares:create', 'quota:read'],
          standardScopes: ['openid', 'offline_access'],
          redirectUri: 'https://broker.example.com/callback',
          grantLifetime: { accessTokenSeconds: 900, refreshTokenSeconds: 2_592_000 },
        }),
      })
    })
    await page.route('**/api/agent-oauth-consent', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback()
      expect(route.request().method()).toBe('POST')
      const body = route.request().postDataJSON() as { accept: boolean; oauthQuery?: string; scope?: string }
      expect(body).toEqual({ accept: true, oauthQuery })
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ url: 'https://broker.example.com/callback?code=e2e-code' }),
      })
    })
    await page.route('https://broker.example.com/callback?code=e2e-code', async (route) => {
      await route.fulfill({ contentType: 'text/html', body: '<main>Returned to FlareAuth</main>' })
    })

    await page.goto(`/settings/agent-access?${oauthQuery}`)

    await expect(page.getByRole('heading', { name: 'Authorize Application' })).toBeVisible()
    await expect(page.getByText('http://localhost:5185')).toBeVisible()
    await expect(page.getByText('https://broker.example.com/callback')).toBeVisible()
    await expect(page.getByText('Files: read objects')).toBeVisible()
    await expect(page.getByText('Shares: create shares')).toBeVisible()
    await expect(page.getByText('Quota: read workspace quota')).toBeVisible()

    await page.getByRole('button', { name: 'Approve Access' }).click()
    await expect(page).toHaveURL(/broker\.example\.com\/callback\?code=e2e-code/, { timeout: 10000 })
    await expect(page.getByText('Returned to FlareAuth')).toBeVisible()
  })

  test('lists and revokes delegated grants in settings @desktop', async ({ page }) => {
    await signUpAndGoToFiles(page)
    let revoked = false

    await page.route('**/api/agent-oauth-grants', async (route) => {
      if (route.request().method() !== 'GET') return route.fallback()
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          items: revoked
            ? []
            : [
                {
                  id: 'grant-e2e',
                  clientId: 'dynamic-client',
                  clientName: 'FlareAuth',
                  userId: 'user-e2e',
                  orgId: 'org-e2e',
                  workspaceName: 'Personal',
                  scopes: ['objects:read', 'shares:create'],
                  createdAt: '2026-07-29T12:00:00.000Z',
                  lastUsedAt: null,
                  status: 'active',
                },
              ],
        }),
      })
    })
    await page.route('**/api/agent-oauth-grants/grant-e2e', async (route) => {
      expect(route.request().method()).toBe('DELETE')
      revoked = true
      await route.fulfill({ status: 204 })
    })

    await page.goto('/settings/agent-access')

    await expect(page.getByText('Delegated OAuth Grants')).toBeVisible()
    await expect(page.getByRole('cell', { name: 'FlareAuth' })).toBeVisible()
    await expect(page.getByText('Shares: create shares')).toBeVisible()

    const revokeButtons = page.getByRole('button', { name: 'Revoke' })
    await revokeButtons.last().click()
    await expect(page.getByRole('dialog', { name: 'Revoke OAuth Grant' })).toBeVisible()
    await page.getByRole('dialog').getByRole('button', { name: 'Revoke' }).click()
    await expect(page.getByText('No delegated OAuth grants yet')).toBeVisible()
  })

  test('keeps consent and delegated grants usable on narrow screens @mobile', async ({ page }) => {
    await signUpAndGoToFiles(page)

    await page.route('**/api/agent-oauth-consent?*', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          clientId: 'dynamic-client',
          clientName: 'FlareAuth',
          instanceOrigin: 'http://localhost:5185',
          workspace: { id: 'org-e2e', name: 'Personal' },
          scopes: ['objects:read', 'shares:create', 'quota:read'],
          standardScopes: ['openid', 'offline_access'],
          redirectUri: 'https://broker.example.com/callback',
          grantLifetime: { accessTokenSeconds: 900, refreshTokenSeconds: 2_592_000 },
        }),
      })
    })
    await page.route('**/api/agent-oauth-grants', async (route) => {
      if (route.request().method() !== 'GET') return route.fallback()
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          items: [
            {
              id: 'grant-mobile',
              clientId: 'dynamic-client',
              clientName: 'FlareAuth',
              userId: 'user-e2e',
              orgId: 'org-e2e',
              workspaceName: 'Personal',
              scopes: ['objects:read', 'shares:create', 'quota:read'],
              createdAt: '2026-07-29T12:00:00.000Z',
              lastUsedAt: '2026-07-29T12:30:00.000Z',
              status: 'active',
            },
          ],
        }),
      })
    })

    await page.goto(`/settings/agent-access?${oauthQuery}`)
    await expect(page.getByRole('heading', { name: 'Authorize Application' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Approve Access' })).toBeVisible()
    await expect(page.getByText('Files: read objects')).toBeVisible()
    await expect(page.getByText('Shares: create shares')).toBeVisible()
    await expect
      .poll(async () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
      .toBe(true)

    await page.goto('/settings/agent-access')
    await expect(page.getByText('Delegated OAuth Grants')).toBeVisible()
    await expect(page.getByRole('cell', { name: 'FlareAuth' })).toBeVisible()
    const grantsTableContainer = page.locator('[data-slot="table-container"]').last()
    await expect(grantsTableContainer).toBeVisible()
    await expect
      .poll(async () =>
        grantsTableContainer.evaluate((node) => (node as HTMLElement).scrollWidth > (node as HTMLElement).clientWidth),
      )
      .toBe(true)
    await expect
      .poll(async () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
      .toBe(true)
    await grantsTableContainer.evaluate((node) => {
      node.scrollLeft = node.scrollWidth
    })
    await expect(page.getByRole('button', { name: 'Revoke' }).last()).toBeVisible()
  })
})
