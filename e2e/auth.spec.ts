import { expect, test } from '@playwright/test'

test.describe('Auth flow', () => {
  test('redirects to sign-in when not authenticated', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/sign-in/, { timeout: 5000 })
  })

  test('sign-up and redirect to files', async ({ page }) => {
    await page.goto('/sign-up')
    await expect(page.getByRole('heading', { name: 'ZPan' })).toBeVisible()

    await page.getByLabel('Name').fill('Test User')
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

  test('sign-in with existing account', async ({ page }) => {
    const email = `login-${Date.now()}@example.com`

    // Register via UI
    await page.goto('/sign-up')
    await page.getByLabel('Name').fill('Login Test')
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
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password').fill('password123456')

    const [signInResp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/auth/sign-in')),
      page.getByRole('button', { name: 'Sign in' }).click(),
    ])
    expect(signInResp.status()).toBe(200)

    await expect(page).toHaveURL(/files/, { timeout: 10000 })
  })

  test('shows sidebar after login', async ({ page }) => {
    await page.goto('/sign-up')
    await page.getByLabel('Name').fill('Sidebar Test')
    await page.getByLabel('Email').fill(`sidebar-${Date.now()}@example.com`)
    await page.getByLabel('Password').fill('password123456')
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/auth/sign-up')),
      page.getByRole('button', { name: 'Sign up' }).click(),
    ])

    await expect(page).toHaveURL(/files/, { timeout: 10000 })

    await expect(page.getByRole('link', { name: 'Files' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Recycle Bin' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Storage Backends' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Users' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()
  })

  test('navigate all placeholder pages', async ({ page }) => {
    await page.goto('/sign-up')
    await page.getByLabel('Name').fill('Pages Test')
    await page.getByLabel('Email').fill(`pages-${Date.now()}@example.com`)
    await page.getByLabel('Password').fill('password123456')
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/auth/sign-up')),
      page.getByRole('button', { name: 'Sign up' }).click(),
    ])
    await expect(page).toHaveURL(/files/, { timeout: 10000 })

    await expect(page.getByText('File manager will be implemented here')).toBeVisible()

    await page.goto('/recycle-bin')
    await expect(page.getByText('Deleted files will appear here')).toBeVisible({ timeout: 5000 })

    await page.goto('/storages')
    await expect(page.getByText('Configure your S3-compatible storage backends here')).toBeVisible({ timeout: 5000 })

    await page.goto('/users')
    await expect(page.getByText('User management will be implemented here')).toBeVisible({ timeout: 5000 })

    await page.goto('/settings')
    await expect(page.getByText('Profile and appearance settings will be here')).toBeVisible({ timeout: 5000 })
  })
})
