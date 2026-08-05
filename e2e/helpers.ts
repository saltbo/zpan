import { expect, type Page, request as playwrightRequest, test } from '@playwright/test'

export const ADMIN_EMAIL = 'e2e-admin@test.local'
export const ADMIN_PASSWORD = 'password123456'

export type BindingState = {
  bound: boolean
  active?: boolean
  account_email?: string
  cloud_dashboard_url?: string
}

export type PairingInfo = {
  code: string
  pairingUrl: string
}

export type PairingPollResult = {
  status: string
  cloud_store_id?: string
}

export async function expandSignInForm(page: Page) {
  const identityInput = page.locator('#identity')
  if (await identityInput.isVisible().catch(() => false)) return
  const expandButton = page.getByRole('button', { name: /sign in with email|使用邮箱登录/i })
  if (await expandButton.isVisible().catch(() => false)) await expandButton.click()
  await expect(identityInput).toBeVisible()
}

export async function signInAsAdmin(page: Page) {
  await page.goto('/sign-in')
  await expandSignInForm(page)
  await page.locator('#identity').fill(ADMIN_EMAIL)
  await page.locator('#password').fill(ADMIN_PASSWORD)
  const responsePromise = page.waitForResponse((response) => response.url().includes('/api/auth/sign-in'))
  await page.getByRole('button', { name: /sign in/i }).click()
  expect((await responsePromise).status()).toBe(200)
  await expect(page).toHaveURL(/files/, { timeout: 10_000 })
  await page.goto('/admin/storages')
  await expect(page).toHaveURL(/admin\/storages/)
}

export async function expandSignUpForm(page: Page) {
  const usernameInput = page.locator('#username')
  if (await usernameInput.isVisible().catch(() => false)) return
  const expandButton = page.getByRole('button', { name: /sign up with email/i })
  if (await expandButton.isVisible().catch(() => false)) await expandButton.click()
  await expect(usernameInput).toBeVisible()
}

export async function signUpAndGoToFiles(page: Page) {
  const identity = testIdentity('e2e')
  await page.goto('/sign-up')
  await expandSignUpForm(page)
  await page.locator('#email').fill(`${identity}@example.com`)
  await page.locator('#username').fill(identity)
  await page.locator('#password').fill('password123456')
  const responsePromise = page.waitForResponse((response) => response.url().includes('/api/auth/sign-up'))
  await page.getByRole('button', { name: /sign up/i }).click()
  expect((await responsePromise).status()).toBe(200)
  await expect(page).toHaveURL(/files/, { timeout: 10_000 })
}

export async function createFolder(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: /new folder|folder/i }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('textbox').fill(name)
  const responsePromise = page.waitForResponse(
    (response) => response.url().includes('/api/objects') && response.request().method() === 'POST',
  )
  await dialog.getByRole('button', { name: /create/i }).click()
  const response = await responsePromise
  expect(response.ok(), `folder creation failed (${response.status()}) — ensure storage is configured`).toBe(true)
  await expect(dialog).not.toBeVisible({ timeout: 10_000 })
}

export async function pairAndApprove(page: Page): Promise<PairingPollResult> {
  await unbindCurrentCloudBinding()
  const pairing = await postJson<PairingInfo>(page, '/api/site/licensing/pairings')
  const cloudRequest = await playwrightRequest.newContext({ baseURL: new URL(pairing.pairingUrl).origin })
  try {
    const approval = await cloudRequest.patch(`/_test/pairings/${encodeURIComponent(pairing.code)}/approve`, {
      data: { action: 'approve' },
    })
    if (!approval.ok()) throw new Error(`Cloud fake approval failed: ${approval.status()} ${await approval.text()}`)
  } finally {
    await cloudRequest.dispose()
  }

  let approved: PairingPollResult | null = null
  await expect
    .poll(
      async () => {
        const result = await getJson<PairingPollResult>(page, `/api/site/licensing/pairings/${pairing.code}`)
        if (result.status === 'approved') approved = result
        return result.status
      },
      { timeout: 10_000 },
    )
    .toBe('approved')
  await expect
    .poll(async () => {
      const state = await getJson<BindingState>(page, '/api/site/licensing/binding')
      return state.bound && state.active
    })
    .toBe(true)
  if (!approved) throw new Error('Cloud pairing approval did not resolve')
  return approved
}

export async function unbindCurrentCloudBinding() {
  const baseURL = process.env.E2E_BASE_URL
  if (!baseURL) throw new Error('E2E_BASE_URL is required')
  const headers = { Origin: new URL(baseURL).origin }
  const request = await playwrightRequest.newContext({ baseURL })
  try {
    const signIn = await request.post('/api/auth/sign-in/email', {
      headers,
      data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    })
    if (!signIn.ok()) throw new Error(`E2E admin sign-in failed during Cloud binding cleanup: ${signIn.status()}`)
    const unbind = await request.delete('/api/site/licensing/binding', { headers })
    if (!unbind.ok()) throw new Error(`Cloud binding cleanup failed: ${unbind.status()} ${await unbind.text()}`)
  } finally {
    await request.dispose()
  }
}

export async function getJson<T>(page: Page, url: string): Promise<T> {
  return browserJson<T>(page, 'GET', url)
}

export async function postJson<T>(page: Page, url: string, data?: unknown): Promise<T> {
  return browserJson<T>(page, 'POST', url, data)
}

async function browserJson<T>(page: Page, method: 'GET' | 'POST', url: string, data?: unknown): Promise<T> {
  return (await page.evaluate(
    async ({ method, url, data }) => {
      const response = await fetch(url, {
        method,
        headers: data === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: data === undefined ? undefined : JSON.stringify(data),
      })
      const text = await response.text()
      if (!response.ok) throw new Error(`${method} ${url} failed with ${response.status}: ${text}`)
      return text ? JSON.parse(text) : null
    },
    { method, url, data },
  )) as T
}

export function testIdentity(prefix: string) {
  const id = test
    .info()
    .testId.replace(/[^a-z0-9]+/gi, '')
    .toLowerCase()
  return `${prefix}${id.slice(-20)}`
}
