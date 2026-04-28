import path from 'node:path'
import { expect, test } from '@playwright/test'
import Database from 'better-sqlite3'
import { signInAsAdmin } from './helpers'

const DB_PATH = path.resolve(process.cwd(), process.env.DATABASE_URL || './zpan.db')

function withDb<T>(fn: (db: Database.Database) => T): T {
  const db = new Database(DB_PATH)
  try {
    return fn(db)
  } finally {
    db.close()
  }
}

function upsertSystemOption(key: string, value: string, isPublic = false) {
  withDb((db) => {
    db.prepare(`
      INSERT INTO system_options (key, value, public)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, public = excluded.public
    `).run(key, value, isPublic ? 1 : 0)
  })
}

function setSignupModeInDb(value: string) {
  upsertSystemOption('auth_signup_mode', value, true)
}

function saveEmailConfigInDb() {
  upsertSystemOption('email_provider', 'http')
  upsertSystemOption('email_from', 'no-reply@example.com')
  upsertSystemOption('email_http_url', 'https://postman-echo.com/post')
  upsertSystemOption('email_http_api_key', 'e2e-test-key')
}

test.describe('Site invitation signup flow', () => {
  test.afterEach(async () => {
    setSignupModeInDb('')
  })

  test('admin can inspect invitation and invited user can register with token @desktop', async ({ page }) => {
    setSignupModeInDb('closed')
    saveEmailConfigInDb()
    const invitationEmail = `invited-${Date.now()}@example.com`

    await signInAsAdmin(page)
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
