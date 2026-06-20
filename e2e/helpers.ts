import {
  type APIRequestContext,
  type APIResponse,
  expect,
  type Page,
  request as playwrightRequest,
} from '@playwright/test'

/** Admin credentials seeded by global-setup.ts (CI) or db:reset (local dev) */
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

export type CloudLicense = {
  id: string
}

export async function expandSignInForm(page: Page) {
  const identityInput = page.locator('#identity')
  if (await identityInput.isVisible().catch(() => false)) return
  const expandButton = page.getByRole('button', { name: /sign in with email|使用邮箱登录/i })
  if (await expandButton.isVisible().catch(() => false)) await expandButton.click()
  await expect(identityInput).toBeVisible()
}

/** Sign in as admin and navigate to /admin/storages. */
export async function signInAsAdmin(page: Page) {
  await page.goto('/sign-in')
  await expandSignInForm(page)
  await page.locator('#identity').fill(ADMIN_EMAIL)
  await page.locator('#password').fill(ADMIN_PASSWORD)
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/auth/sign-in')),
    page.getByRole('button', { name: /sign in/i }).click(),
  ])
  expect(resp.status()).toBe(200)
  await expect(page).toHaveURL(/files/, { timeout: 10000 })
  // The post-sign-in client redirect to /files can still be in flight and
  // interrupt this navigation; retry the goto until /admin/storages commits.
  await expect(async () => {
    await page.goto('/admin/storages')
    await expect(page).toHaveURL(/admin\/storages/, { timeout: 5000 })
  }).toPass({ timeout: 15000 })
}

export async function expandSignUpForm(page: Page) {
  const usernameInput = page.locator('#username')
  if (await usernameInput.isVisible().catch(() => false)) return
  const expandButton = page.getByRole('button', { name: /sign up with email/i })
  if (await expandButton.isVisible().catch(() => false)) await expandButton.click()
  await expect(usernameInput).toBeVisible()
}

/** Register a fresh user and land on /files. */
export async function signUpAndGoToFiles(page: Page) {
  await page.goto('/sign-up')
  await expandSignUpForm(page)
  await page.locator('#email').fill(`e2e-${Date.now()}@example.com`)
  await page.locator('#username').fill(`e2e${Date.now()}`)
  await page.locator('#password').fill('password123456')
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/auth/sign-up')),
    page.getByRole('button', { name: /sign up/i }).click(),
  ])
  expect(resp.status()).toBe(200)
  await expect(page).toHaveURL(/files/, { timeout: 10000 })
}

/**
 * Create a folder via the UI. Waits for the API response to confirm success.
 * Storage must be seeded by global-setup.ts before this can work.
 */
export async function createFolder(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: /new folder|folder/i }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('textbox').fill(name)

  const [apiResp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/objects') && r.request().method() === 'POST'),
    dialog.getByRole('button', { name: /create/i }).click(),
  ])

  expect(apiResp.ok(), `folder creation failed (${apiResp.status()}) — ensure storage is configured`).toBe(true)
  await expect(dialog).not.toBeVisible({ timeout: 10000 })
}

// ─── Cloud licensing / pairing helpers ───────────────────────────────────────

/**
 * Run the full pairing handshake against the live cloud and wait until the
 * instance is bound and active. Returns the approved poll result (carries the
 * cloud_store_id). Callers are responsible for unbinding afterwards.
 */
export async function pairAndApprove(page: Page): Promise<PairingPollResult> {
  await unbindCurrentCloudBinding()

  const pairing = await postJson<PairingInfo>(page, '/api/site/licensing/pairings')
  await approvePairingInCloud(pairing)

  let approved: PairingPollResult | null = null
  await expect
    .poll(
      async () => {
        const result = await getJson<PairingPollResult>(page, `/api/site/licensing/pairings/${pairing.code}`)
        if (result.status === 'approved') approved = result
        return result.status
      },
      {
        timeout: 30_000,
      },
    )
    .toBe('approved')

  await expect
    .poll(async () => {
      const state = await getJson<BindingState>(page, '/api/site/licensing/status')
      return state.bound && state.active
    })
    .toBe(true)

  if (!approved) throw new Error('Cloud pairing approval did not resolve')
  return approved
}

export async function approvePairingInCloud(pairing: PairingInfo) {
  const email = process.env.E2E_CLOUD_BUSINESS_EMAIL ?? process.env.E2E_CLOUD_PRO_EMAIL
  const password = process.env.E2E_CLOUD_BUSINESS_PASSWORD ?? process.env.E2E_CLOUD_PRO_PASSWORD
  if (!email || !password) {
    throw new Error('E2E_CLOUD_BUSINESS_EMAIL and E2E_CLOUD_BUSINESS_PASSWORD are required')
  }

  const cloudOrigin = new URL(pairing.pairingUrl).origin
  const cloudRequest = await playwrightRequest.newContext({ baseURL: cloudOrigin })
  try {
    const signIn = await cloudRequest.post('/api/auth/sign-in/email', {
      data: { email, password },
    })
    await expectCloudOk(signIn, 'Cloud test account sign-in failed')

    const approve = await cloudRequest.patch(`/api/pairings/${encodeURIComponent(pairing.code)}`, {
      data: { action: 'approve' },
    })
    if (approve.status() === 409 && (await cloudErrorCode(approve)) === 'instance_limit') {
      await unbindCloudTestLicenses(cloudRequest)
      const retry = await cloudRequest.patch(`/api/pairings/${encodeURIComponent(pairing.code)}`, {
        data: { action: 'approve' },
      })
      await expectCloudOk(retry, 'Cloud pairing approval failed after license cleanup')
      return
    }
    await expectCloudOk(approve, 'Cloud pairing approval failed')
  } finally {
    await cloudRequest.dispose()
  }
}

export async function unbindCloudTestLicenses(cloudRequest: APIRequestContext) {
  const response = await cloudRequest.get('/api/licenses')
  await expectCloudOk(response, 'Cloud license list failed during pairing cleanup')

  const body = (await response.json()) as { items: CloudLicense[] }
  const licenses = body.items
  for (const license of licenses) {
    const deleted = await cloudRequest.delete(`/api/licenses/${encodeURIComponent(license.id)}`)
    await expectCloudOk(deleted, 'Cloud license cleanup failed')
  }
}

export async function cloudErrorCode(response: APIResponse): Promise<string | null> {
  const body = (await response.json().catch(() => null)) as { error?: { code?: string } } | null
  return body?.error?.code ?? null
}

export async function expectCloudOk(response: APIResponse, message: string) {
  if (response.ok()) return
  throw new Error(`${message}: ${response.status()} ${await response.text()}`)
}

export async function unbindCurrentCloudBinding() {
  const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:5185'
  const headers = { Origin: new URL(baseURL).origin }
  const request = await playwrightRequest.newContext({ baseURL })
  try {
    const signIn = await request.post('/api/auth/sign-in/email', {
      headers,
      data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    })
    await expectCloudOk(signIn, 'E2E admin sign-in failed during Cloud binding cleanup')

    const unbind = await request.delete('/api/site/licensing/binding', { headers })
    await expectCloudOk(unbind, 'Cloud binding cleanup failed')
  } finally {
    await request.dispose()
  }
}

// ─── Instance request helpers (browser-side fetch with retries) ───────────────

export async function getJson<T>(page: Page, url: string): Promise<T> {
  return browserJson<T>(page, 'GET', url)
}

export async function postJson<T>(page: Page, url: string, data?: unknown): Promise<T> {
  return browserJson<T>(page, 'POST', url, data)
}

async function browserJson<T>(page: Page, method: 'GET' | 'POST', url: string, data?: unknown): Promise<T> {
  const retryDelays = [500, 1000, 3000, 7000, 15000]
  const stripeRateLimitRetryDelays = [1000, 3000, 7000, 15000, 30000]
  for (let attempt = 0; attempt <= stripeRateLimitRetryDelays.length; attempt += 1) {
    try {
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
    } catch (error) {
      if (isStripeRateLimitBrowserJsonError(error) && attempt < stripeRateLimitRetryDelays.length) {
        await page.waitForTimeout(stripeRateLimitRetryDelays[attempt] ?? 0)
        continue
      }

      if (isTransientBrowserJsonError(error) && attempt < retryDelays.length) {
        await page.waitForTimeout(retryDelays[attempt] ?? 0)
        continue
      }

      throw error
    }
  }
  throw new Error(`${method} ${url} failed`)
}

function isStripeRateLimitBrowserJsonError(error: unknown) {
  if (!(error instanceof Error)) return false
  return error.message.includes('request_rate_limit_exceeded')
}

function isTransientBrowserJsonError(error: unknown) {
  if (!(error instanceof Error)) return false
  return (
    error.message.includes('Failed to fetch') ||
    error.message.includes('Execution context was destroyed') ||
    error.message.includes('Incoming request ended abruptly') ||
    error.message.includes('context canceled') ||
    error.message.includes('Load failed')
  )
}
