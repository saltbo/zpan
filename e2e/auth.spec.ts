import { expect, test } from '@playwright/test'

test.describe('Auth flow', () => {
  test('redirects to sign-in when not authenticated @all', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/sign-in/, { timeout: 5000 })
  })

  test('sign-up and redirect to files @all', async ({ page }) => {
    await page.goto('/sign-up')
    await expect(page.getByRole('heading', { name: 'ZPan' })).toBeVisible()

    await page.getByLabel('Username').fill(`test${Date.now()}`)
    await page.getByLabel('Name', { exact: true }).fill('Test User')
    await page.getByLabel('Email').fill(`test-${Date.now()}@example.com`)
    await page.getByLabel('Password').fill('password123456')

    // Listen for the sign-up API response
    const [response] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/auth/sign-up')),
      page.getByRole('button', { name: 'Sign up' }).click(),
    ])
    expect(response.status()).toBe(200)

    await expect(page).toHaveURL(/files/, { timeout: 10000 })
  })

  test('sign-in with existing account @all', async ({ page }) => {
    const email = `login-${Date.now()}@example.com`

    // Register via UI
    await page.goto('/sign-up')
    await page.getByLabel('Username').fill(`login${Date.now()}`)
    await page.getByLabel('Name', { exact: true }).fill('Login Test')
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password').fill('password123456')
    const [signUpResp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/auth/sign-up')),
      page.getByRole('button', { name: 'Sign up' }).click(),
    ])
    expect(signUpResp.status()).toBe(200)
    await expect(page).toHaveURL(/files/, { timeout: 10000 })

    // Clear cookies and go to sign-in
    await page.context().clearCookies()
    await page.goto('/sign-in')
    await page.getByLabel('Email or Username').fill(email)
    await page.getByLabel('Password').fill('password123456')

    const [signInResp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/auth/sign-in')),
      page.getByRole('button', { name: 'Sign in' }).click(),
    ])
    expect(signInResp.status()).toBe(200)

    await expect(page).toHaveURL(/files/, { timeout: 10000 })
  })

  test('sidebar shows only My Files and Trash for regular users @desktop @tablet', async ({ page }) => {
    await page.goto('/sign-up')
    await page.getByLabel('Username').fill(`sidebar${Date.now()}`)
    await page.getByLabel('Name', { exact: true }).fill('Sidebar Test')
    await page.getByLabel('Email').fill(`sidebar-${Date.now()}@example.com`)
    await page.getByLabel('Password').fill('password123456')

    const [signUpResp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/auth/sign-up')),
      page.getByRole('button', { name: 'Sign up' }).click(),
    ])
    expect(signUpResp.status()).toBe(200)
    await expect(page).toHaveURL(/files/, { timeout: 10000 })

    // Main sidebar should show My Files and Trash
    const sidebar = page.locator('[data-slot="sidebar"]')
    await expect(sidebar.getByText('My Files')).toBeVisible()
    await expect(sidebar.getByText('Trash')).toBeVisible()

    // Admin items should NOT be in the main sidebar
    await expect(sidebar.getByText('Storages')).not.toBeVisible()
    await expect(sidebar.getByText('Users')).not.toBeVisible()
  })
})
