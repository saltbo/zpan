import { expect, test } from '@playwright/test'
import { signInAsAdmin } from './helpers'

async function setSignupMode(page: import('@playwright/test').Page, value: string) {
  const result = await page.evaluate(async (nextValue) => {
    const res = await fetch('/api/system/options/auth_signup_mode', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: nextValue, public: true }),
    })
    return { ok: res.ok, status: res.status, body: await res.text() }
  }, value)

  expect(result.ok, result.body).toBe(true)
}

async function saveEmailConfig(page: import('@playwright/test').Page) {
  const result = await page.evaluate(async () => {
    const res = await fetch('/api/admin/email-config', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        enabled: true,
        provider: 'http',
        from: 'no-reply@example.com',
        http: {
          url: 'https://postman-echo.com/post',
          apiKey: 'e2e-test-key',
        },
      }),
    })
    return { ok: res.ok, status: res.status, body: await res.text() }
  })

  expect(result.ok, result.body).toBe(true)
}

test.describe('Site invitation signup flow', () => {
  test.afterEach(async ({ page }) => {
    await signInAsAdmin(page)
    await setSignupMode(page, '')
  })

  test('admin can inspect invitation and invited user can register with token @desktop', async ({ page }) => {
    const invitationEmail = `invited-${Date.now()}@example.com`

    await signInAsAdmin(page)
    await setSignupMode(page, 'closed')
    await saveEmailConfig(page)
    await page.goto('/admin/users')

    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/admin/site-invitations') && r.request().method() === 'GET'),
      page.getByRole('button', { name: 'Invite User' }).click(),
    ])
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Invite Users' })).toBeVisible()

    await page.getByLabel('Invite email').fill(invitationEmail)
    const [createResp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/admin/site-invitations') && r.request().method() === 'POST'),
      page.getByRole('button', { name: 'Send Invite', exact: true }).click(),
    ])
    expect(createResp.status()).toBe(201)
    const invitation = (await createResp.json()) as { email: string; token: string }
    const invitationRow = dialog.locator('tr', { hasText: invitation.email })

    await expect(page.getByText(invitation.email)).toBeVisible()
    await expect(invitationRow.getByText('Pending', { exact: true })).toBeVisible()

    await page.context().clearCookies()
    await page.goto(`/sign-up?invite=${encodeURIComponent(invitation.token)}`)

    const emailInput = page.getByLabel('Email')
    await expect(emailInput).toHaveValue(invitationEmail)
    await expect(emailInput).toHaveAttribute('readonly')

    const username = `invitee${Date.now()}`
    await page.getByLabel('Username').fill(username)
    await page.getByLabel('Password').fill('password123456')

    const [signUpResp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/auth/sign-up')),
      page.getByRole('button', { name: 'Sign up' }).click(),
    ])
    const signUpBody = await signUpResp.text()
    expect(signUpResp.status(), signUpBody).toBe(200)
    await expect(page).toHaveURL(/files/, { timeout: 10000 })

    await page.context().clearCookies()
    await signInAsAdmin(page)
    await page.goto('/admin/users')
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/admin/site-invitations') && r.request().method() === 'GET'),
      page.getByRole('button', { name: 'Invite User' }).click(),
    ])
    const acceptedDialog = page.getByRole('dialog')
    const acceptedRow = acceptedDialog.locator('tr', { hasText: invitation.email })
    await expect(acceptedRow).toBeVisible()
    await expect(acceptedRow.getByText('Accepted', { exact: true })).toBeVisible()
  })
})
