import { expect, test } from '@playwright/test'
import { signUpAndGoToFiles } from './helpers'

const oauthQuery = new URLSearchParams({
  client_id: 'dynamic-client',
  redirect_uri: 'https://broker.example.com/callback',
  response_type: 'code',
  scope: 'openid offline_access objects:read shares:create quota:read',
  authorization_details: JSON.stringify([{ type: 'https://zpan.space/authorization-details/workspace' }]),
}).toString()

test.describe('OAuth Apps UI', () => {
  test('renders consent details and submits full approval @desktop', async ({ page }) => {
    await signUpAndGoToFiles(page)

    await page.route('**/api/oauth-consent?*', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          clientId: 'dynamic-client',
          clientName: 'FlareAuth',
          clientOrigin: 'https://broker.example.com',
          workspaces: [{ id: 'org-e2e', name: 'Personal' }],
          requestedWorkspaceIds: [],
          scopes: ['objects:read', 'shares:create', 'quota:read'],
          standardScopes: ['openid', 'offline_access'],
          redirectUri: 'https://broker.example.com/callback',
          grantLifetime: { accessTokenSeconds: 900, refreshTokenSeconds: 2_592_000 },
        }),
      })
    })
    await page.route('**/api/oauth-consent', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback()
      expect(route.request().method()).toBe('POST')
      const body = route.request().postDataJSON() as { accept: boolean; oauthQuery?: string; workspaceIds?: string[] }
      expect(body).toEqual({ accept: true, oauthQuery, workspaceIds: ['org-e2e'] })
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ url: 'https://broker.example.com/callback?code=e2e-code' }),
      })
    })
    await page.route('https://broker.example.com/callback?code=e2e-code', async (route) => {
      await route.fulfill({ contentType: 'text/html', body: '<main>Returned to FlareAuth</main>' })
    })

    await page.goto(`/oauth/consent?${oauthQuery}`)

    await expect(page.getByRole('heading', { name: 'FlareAuth wants to access your workspaces' })).toBeVisible()
    await expect(page.getByText('https://broker.example.com', { exact: true })).toBeVisible()
    await expect(page.getByText('Personal')).toBeVisible()
    await expect(page.getByText('List, inspect, and download objects')).toBeVisible()
    await expect(page.getByText('Create public shares')).toBeVisible()
    await expect(page.getByText('Inspect workspace quota')).toBeVisible()
    await expect(page.getByRole('navigation')).toHaveCount(0)

    const approve = page.getByRole('button', { name: 'Approve Access' })
    await expect(approve).toBeDisabled()
    await page.getByRole('checkbox', { name: 'Personal' }).check()
    await expect(approve).toBeEnabled()
    await approve.click()
    await expect(page).toHaveURL(/broker\.example\.com\/callback\?code=e2e-code/, { timeout: 10000 })
    await expect(page.getByText('Returned to FlareAuth')).toBeVisible()
  })

  test('lists and revokes delegated grants in settings @desktop', async ({ page }) => {
    await signUpAndGoToFiles(page)
    let revoked = false

    await page.route('**/api/oauth-grants', async (route) => {
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
                  workspaces: [{ id: 'org-e2e', name: 'Personal' }],
                  scopes: ['objects:read', 'shares:create'],
                  createdAt: '2026-07-29T12:00:00.000Z',
                  lastUsedAt: null,
                  status: 'active',
                },
              ],
        }),
      })
    })
    await page.route('**/api/oauth-grants/grant-e2e', async (route) => {
      expect(route.request().method()).toBe('DELETE')
      revoked = true
      await route.fulfill({ status: 204 })
    })

    await page.goto('/settings/oauth-apps')

    await expect(page.getByText('Authorized OAuth Apps')).toBeVisible()
    await expect(page.getByRole('cell', { name: 'FlareAuth' })).toBeVisible()
    await expect(page.getByText('2 permissions')).toBeVisible()

    await page.getByRole('button', { name: 'Details' }).click()
    const sheet = page.getByRole('dialog', { name: 'FlareAuth' })
    await expect(sheet.getByText('List, inspect, and download objects')).toBeVisible()
    await expect(sheet.getByText('Create public shares')).toBeVisible()
    await sheet.getByRole('button', { name: 'Revoke access' }).click()
    const confirm = page.getByRole('dialog', { name: 'Revoke OAuth Grant' })
    await expect(confirm).toBeVisible()
    await confirm.getByRole('button', { name: 'Revoke access' }).click()
    await expect(page.getByText('No authorized OAuth apps yet')).toBeVisible()
  })

  test('keeps consent and delegated grants usable on narrow screens @mobile', async ({ page }) => {
    await signUpAndGoToFiles(page)

    await page.route('**/api/oauth-consent?*', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          clientId: 'dynamic-client',
          clientName: 'FlareAuth',
          clientOrigin: 'https://broker.example.com',
          workspaces: [{ id: 'org-e2e', name: 'Personal' }],
          requestedWorkspaceIds: [],
          scopes: ['objects:read', 'shares:create', 'quota:read'],
          standardScopes: ['openid', 'offline_access'],
          redirectUri: 'https://broker.example.com/callback',
          grantLifetime: { accessTokenSeconds: 900, refreshTokenSeconds: 2_592_000 },
        }),
      })
    })
    await page.route('**/api/oauth-grants', async (route) => {
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
              workspaces: [{ id: 'org-e2e', name: 'Personal' }],
              scopes: ['objects:read', 'shares:create', 'quota:read'],
              createdAt: '2026-07-29T12:00:00.000Z',
              lastUsedAt: '2026-07-29T12:30:00.000Z',
              status: 'active',
            },
          ],
        }),
      })
    })

    await page.goto(`/oauth/consent?${oauthQuery}`)
    await expect(page.getByRole('heading', { name: 'FlareAuth wants to access your workspaces' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Approve Access' })).toBeVisible()
    await expect(page.getByText('List, inspect, and download objects')).toBeVisible()
    await expect(page.getByText('Create public shares')).toBeVisible()
    await page.getByRole('checkbox', { name: 'Personal' }).check()
    await expect
      .poll(async () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
      .toBe(true)

    await page.goto('/settings/oauth-apps')
    await expect(page.getByText('Authorized OAuth Apps')).toBeVisible()
    await expect(page.getByRole('cell', { name: 'FlareAuth' })).toBeVisible()
    await expect
      .poll(async () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
      .toBe(true)
    await page.getByRole('button', { name: 'Details' }).click()
    const sheet = page.getByRole('dialog', { name: 'FlareAuth' })
    await expect(sheet.getByText('Inspect workspace quota')).toBeVisible()
    await expect(sheet.getByRole('button', { name: 'Revoke access' })).toBeVisible()
  })
})
