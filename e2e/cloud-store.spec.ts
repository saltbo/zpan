import {
  type APIRequestContext,
  type APIResponse,
  type Browser,
  expect,
  type Page,
  request as playwrightRequest,
  test,
} from '@playwright/test'
import { ADMIN_EMAIL, ADMIN_PASSWORD, signInAsAdmin, signUpAndGoToFiles } from './helpers'

const LOCALHOST_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/

type BindingState = {
  bound: boolean
  active?: boolean
  account_email?: string
}

type PairingInfo = {
  code: string
  pairingUrl: string
}

type CloudProduct = {
  id: string
  name: string
  prices: Array<{ id: string; currency: string; amount: number }>
}

type CloudGiftCard = {
  code: string | null
  codeLast4: string
}

type CloudOrder = {
  id: string
  paymentStatus: string
  fulfillmentStatus: string
}

type CloudLicense = {
  id: string
}

test.describe
  .serial('ZPan Cloud store integration', () => {
    test.afterAll(async () => {
      await unbindCurrentCloudBinding()
    })

    test('@desktop covers pairing, admin store setup, gift-card credit redemption, and checkout', async ({
      page,
      baseURL,
    }) => {
      test.setTimeout(180_000)

      await signInAsAdmin(page)
      await ensureCloudBinding(page)

      const testId = Date.now()
      const packageName = `E2E Cloud Plan ${testId}`
      const creditPackageName = `E2E Credits ${testId}`
      await createStoragePlan(page, packageName)
      const product = await createCreditPackage(page, creditPackageName)
      const giftCard = await createGiftCard(page)
      await expectAdminProductVisibleInApi(page, packageName)
      await expectAdminGiftCardVisibleInApi(page, giftCard.code)

      await page.goto('/storage')
      await expect(page.getByRole('heading', { name: 'Storage', exact: true })).toBeVisible({ timeout: 20_000 })
      await expectStorefrontProductVisibleInApi(page, packageName)

      const creditsBefore = await getCreditBalance(page)
      await redeemGiftCard(page, giftCard.code)
      await expect.poll(() => getCreditBalance(page), { timeout: 20_000 }).toBeGreaterThanOrEqual(creditsBefore + 200)

      const hasPublicCallbackUrl = Boolean(baseURL && !LOCALHOST_RE.test(new URL(baseURL).origin))
      if (!hasPublicCallbackUrl) {
        test.info().annotations.push({
          type: 'checkout-delivery-skipped',
          description: 'Cloud staging cannot call back to a localhost ZPan instance.',
        })
        return
      }

      await postJson<{ orderId: string; url: string }>(page, '/api/store/checkouts', {
        packageId: product.id,
        priceId: product.prices[0].id,
      })

      await expectOrderCreated(page, product.id)
    })

    test('@desktop creates Cloud store products and gift cards through admin UI forms', async ({ page }) => {
      test.setTimeout(180_000)

      await signInAsAdmin(page)
      await ensureCloudBinding(page)

      const testId = Date.now()
      const packageName = `E2E UI Plan ${testId}`
      const creditPackageName = `E2E UI Credits ${testId}`
      await createStoragePlanThroughUi(page, packageName)
      await createCreditPackageThroughUi(page, creditPackageName)

      await expectAdminProductVisibleInApi(page, packageName)
      await expectAdminCreditProductVisibleInApi(page, creditPackageName)

      const giftCardCode = await createGiftCardThroughUi(page)
      await expectAdminGiftCardVisibleInApi(page, giftCardCode)
    })

    test('@desktop lets a regular user list Cloud packages and redeem a gift card', async ({
      page,
      browser,
      baseURL,
    }) => {
      test.setTimeout(120_000)

      await signInAsAdmin(page)
      await ensureCloudBinding(page)

      const testId = Date.now()
      const packageName = `E2E User Plan ${testId}`
      await createStoragePlan(page, packageName)
      const giftCard = await createGiftCard(page)
      await expectStorefrontProductVisibleInApi(page, packageName)

      const userContext = await newBrowserContext(browser, baseURL)
      try {
        const userPage = await userContext.newPage()
        await signUpAndGoToFiles(userPage)
        await userPage.goto('/storage')
        await expect(userPage.getByRole('heading', { name: 'Storage', exact: true })).toBeVisible({ timeout: 20_000 })
        await expectStorefrontProductVisibleInApi(userPage, packageName)

        const creditsBefore = await getCreditBalance(userPage)
        await redeemGiftCard(userPage, giftCard.code)
        await expect
          .poll(() => getCreditBalance(userPage), { timeout: 20_000 })
          .toBeGreaterThanOrEqual(creditsBefore + 200)
      } finally {
        await userContext.close()
      }
    })
  })

async function ensureCloudBinding(page: Page) {
  const current = await getJson<BindingState>(page, '/api/licensing/status')
  if (current.bound && current.active) {
    await enableCloudStore(page)
    return
  }

  const pairing = await postJson<PairingInfo>(page, '/api/licensing/pair')
  await approvePairingInCloud(pairing)

  await expect
    .poll(async () => (await getJson<{ status: string }>(page, `/api/licensing/pair/${pairing.code}/poll`)).status, {
      timeout: 30_000,
    })
    .toBe('approved')

  await expect
    .poll(async () => {
      const state = await getJson<BindingState>(page, '/api/licensing/status')
      return state.bound && state.active
    })
    .toBe(true)
  await enableCloudStore(page)
}

async function enableCloudStore(page: Page) {
  await putJson(page, '/api/admin/store/settings', { enabled: true })
}

async function approvePairingInCloud(pairing: PairingInfo) {
  const email = process.env.E2E_CLOUD_PRO_EMAIL
  const password = process.env.E2E_CLOUD_PRO_PASSWORD
  if (!email || !password) throw new Error('E2E_CLOUD_PRO_EMAIL and E2E_CLOUD_PRO_PASSWORD are required')

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

async function unbindCloudTestLicenses(cloudRequest: APIRequestContext) {
  const response = await cloudRequest.get('/api/licenses')
  await expectCloudOk(response, 'Cloud license list failed during pairing cleanup')

  const body = (await response.json()) as { items: CloudLicense[] }
  const licenses = body.items
  for (const license of licenses) {
    const deleted = await cloudRequest.delete(`/api/licenses/${encodeURIComponent(license.id)}`)
    await expectCloudOk(deleted, 'Cloud license cleanup failed')
  }
}

async function cloudErrorCode(response: APIResponse): Promise<string | null> {
  const body = (await response.json().catch(() => null)) as { error?: { code?: string } } | null
  return body?.error?.code ?? null
}

async function expectCloudOk(response: APIResponse, message: string) {
  if (response.ok()) return
  throw new Error(`${message}: ${response.status()} ${await response.text()}`)
}

async function unbindCurrentCloudBinding() {
  const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:5173'
  const headers = { Origin: new URL(baseURL).origin }
  const request = await playwrightRequest.newContext({ baseURL })
  try {
    const signIn = await request.post('/api/auth/sign-in/email', {
      headers,
      data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    })
    await expectCloudOk(signIn, 'E2E admin sign-in failed during Cloud binding cleanup')

    const unbind = await request.delete('/api/licensing/binding', { headers })
    await expectCloudOk(unbind, 'Cloud binding cleanup failed')
  } finally {
    await request.dispose()
  }
}

async function createStoragePlan(page: Page, name: string) {
  return postJson<CloudProduct>(page, '/api/admin/store/packages', {
    type: 'store_item',
    name,
    description: 'Playwright staging Cloud store plan',
    metadata: {
      deliverable: {
        type: 'zpan.plan',
        storageBytes: 1024 * 1024,
        includedCredits: 200,
      },
    },
    prices: [
      {
        currency: 'usd',
        amount: 100,
        recurring: { interval: 'month', intervalCount: 1 },
        metadata: { creditGrantType: 'subscription_grant', creditAmount: '200' },
      },
    ],
    active: true,
    sortOrder: -Date.now(),
  })
}

async function createCreditPackage(page: Page, name: string) {
  return postJson<CloudProduct>(page, '/api/admin/store/packages', {
    type: 'store_item',
    name,
    description: 'Playwright staging Cloud store Credits package',
    metadata: {
      deliverable: {
        type: 'zpan.credits',
        includedCredits: 200,
      },
    },
    prices: [{ currency: 'usd', amount: 100, metadata: { creditGrantType: 'top_up', creditAmount: '200' } }],
    active: true,
    sortOrder: -Date.now(),
  })
}

async function createGiftCard(page: Page) {
  const cards = await postJson<CloudGiftCard[]>(page, '/api/admin/store/gift-cards', {
    credits: 200,
    count: 1,
  })
  expect(cards.length).toBe(1)
  const card = cards[0]
  if (card.code === null) throw new Error('Cloud gift card create response did not include code')
  return { ...card, code: card.code }
}

async function createStoragePlanThroughUi(page: Page, packageName: string) {
  await gotoAdminCloudStore(page)
  await page.getByRole('button', { name: 'New plan' }).click()
  const dialog = page.getByRole('dialog', { name: 'New plan' })
  await dialog.getByLabel('Plan name').fill(packageName)
  await dialog.getByLabel('Description').fill('Created by Playwright through the admin form')
  await dialog.getByRole('spinbutton', { name: 'Storage quota' }).fill('1')
  await dialog.getByRole('spinbutton', { name: 'Included Credits' }).fill('200')
  await dialog.getByLabel('Monthly price (USD)').fill('1')

  const response = page.waitForResponse(
    (item) => item.url().includes('/api/admin/store/packages') && item.request().method() === 'POST',
  )
  await dialog.getByRole('button', { name: 'Save' }).click()
  expect((await response).status()).toBe(201)
  await expect(dialog).not.toBeVisible({ timeout: 20_000 })
}

async function createCreditPackageThroughUi(page: Page, packageName: string) {
  await gotoAdminCloudStore(page)
  await page.getByRole('button', { name: 'New Credits package' }).click()
  const dialog = page.getByRole('dialog', { name: 'New Credits package' })
  await dialog.getByLabel('Name').fill(packageName)
  await dialog.getByLabel('Description').fill('Created by Playwright through the admin form')
  await dialog.getByRole('spinbutton', { name: 'Credits' }).fill('200')
  await dialog.getByLabel('Package amount (USD)').fill('1')

  const response = page.waitForResponse(
    (item) => item.url().includes('/api/admin/store/packages') && item.request().method() === 'POST',
  )
  await dialog.getByRole('button', { name: 'Save' }).click()
  expect((await response).status()).toBe(201)
  await expect(dialog).not.toBeVisible({ timeout: 20_000 })
}

async function createGiftCardThroughUi(page: Page) {
  await gotoAdminCloudStore(page)
  await page.getByRole('tab', { name: 'Gift Cards' }).click()
  await page.getByRole('button', { name: 'Generate gift cards' }).click()
  const dialog = page.getByRole('dialog', { name: 'Generate gift cards' })
  await dialog.getByLabel('Credits').fill('3')

  const response = page.waitForResponse(
    (item) => item.url().includes('/api/admin/store/gift-cards') && item.request().method() === 'POST',
  )
  await dialog.getByRole('button', { name: 'Generate' }).click()
  const result = await response
  expect(result.status()).toBe(201)
  const cards = (await result.json()) as CloudGiftCard[]
  expect(cards.length).toBe(1)
  const card = cards[0]
  if (card.code === null) throw new Error('Cloud gift card create response did not include code')
  return card.code
}

async function gotoAdminCloudStore(page: Page) {
  await expect
    .poll(
      async () => {
        try {
          await Promise.all([
            getJson(page, '/api/admin/store/settings'),
            getJson(page, '/api/admin/store/packages'),
            getJson(page, '/api/admin/store/credits/products'),
          ])
          return true
        } catch {
          return false
        }
      },
      { timeout: 45_000 },
    )
    .toBe(true)

  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.goto('/admin/cloud-store', { waitUntil: 'domcontentloaded' })
    await expect(page).toHaveURL(/admin\/cloud-store/, { timeout: 10_000 })
    const heading = page.getByRole('heading', { name: 'Storage Plans', exact: true })
    try {
      await expect(heading).toBeVisible({ timeout: 15_000 })
      return
    } catch (error) {
      if (attempt === 1) throw error
      await page.waitForTimeout(1500)
    }
  }
}

async function expectAdminProductVisibleInApi(page: Page, packageName: string) {
  await expect
    .poll(
      async () => {
        const products = await getJson<{ items: CloudProduct[] }>(page, '/api/admin/store/packages')
        return products.items.map((item) => item.name)
      },
      { timeout: 60_000 },
    )
    .toContain(packageName)
}

async function expectAdminCreditProductVisibleInApi(page: Page, packageName: string) {
  await expect
    .poll(
      async () => {
        const products = await getJson<{ items: CloudProduct[] }>(page, '/api/admin/store/credits/products')
        return products.items.map((item) => item.name)
      },
      { timeout: 60_000 },
    )
    .toContain(packageName)
}

async function expectAdminGiftCardVisibleInApi(page: Page, code: string) {
  await expect
    .poll(
      async () => {
        const giftCards = await getJson<{ items: CloudGiftCard[] }>(page, '/api/admin/store/gift-cards')
        return giftCards.items.map((item) => item.codeLast4)
      },
      { timeout: 60_000 },
    )
    .toContain(code.slice(-4))
}

async function redeemGiftCard(page: Page, code: string) {
  await page.getByRole('button', { name: 'View credit activity' }).click()
  const creditsDialog = page.getByRole('dialog', { name: 'Credits' })
  await creditsDialog.getByRole('button', { name: 'Redeem gift card' }).click()
  const redeemDialog = page.getByRole('dialog', { name: 'Redeem gift card' })
  await redeemDialog.getByLabel('Gift card code').fill(code)
  const redeemResponse = page.waitForResponse(
    (response) => response.url().includes('/api/store/credits/redemptions') && response.request().method() === 'POST',
  )
  await redeemDialog.getByRole('button', { name: 'Redeem' }).click()
  expect((await redeemResponse).status()).toBe(200)
  await expect(page.getByText(/Redeemed successfully/)).toBeVisible({ timeout: 20_000 })
  await page.keyboard.press('Escape')
}

async function getCreditBalance(page: Page) {
  const credits = await getJson<{ balance: number }>(page, '/api/store/credits')
  return credits.balance
}

async function expectStorefrontProductVisibleInApi(page: Page, packageName: string) {
  await expect
    .poll(
      async () => {
        const products = await getJson<{ items: CloudProduct[] }>(page, '/api/store/packages')
        return products.items.map((item) => item.name)
      },
      { timeout: 60_000 },
    )
    .toContain(packageName)
}

async function expectOrderCreated(page: Page, productId: string) {
  const orders = await getJson<{ items: CloudOrder[] }>(page, '/api/store/orders')
  expect(orders.items[0]).toEqual(
    expect.objectContaining({
      paymentStatus: expect.stringMatching(/paid|pending|unpaid/),
    }),
  )

  const adminOrders = await getJson<{
    items: Array<CloudOrder & { items: Array<{ productId: string }> }>
  }>(page, '/api/admin/store/orders')
  expect(adminOrders.items.some((order) => order.items.some((item) => item.productId === productId))).toBe(true)
  return orders
}

async function newBrowserContext(browser: Browser, baseURL: string | undefined) {
  return browser.newContext({ baseURL, locale: 'en-US' })
}

async function getJson<T>(page: Page, url: string): Promise<T> {
  return browserJson<T>(page, 'GET', url)
}

async function postJson<T>(page: Page, url: string, data?: unknown): Promise<T> {
  return browserJson<T>(page, 'POST', url, data)
}

async function putJson<T>(page: Page, url: string, data?: unknown): Promise<T> {
  return browserJson<T>(page, 'PUT', url, data)
}

async function browserJson<T>(page: Page, method: 'GET' | 'POST' | 'PUT', url: string, data?: unknown): Promise<T> {
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
