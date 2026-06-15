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
  cloud_dashboard_url?: string
}

type PairingInfo = {
  code: string
  pairingUrl: string
}

type PairingPollResult = {
  status: string
  cloud_store_id?: string
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

type CloudStore = {
  id: string
  type: string
}

type CloudBusinessContext = {
  request: APIRequestContext
  storeId: string
}

type ResponseLike = {
  status(): number
  text(): Promise<string>
}

test.describe
  .serial('ZPan Cloud store integration', () => {
    test.afterAll(async () => {
      await unbindCurrentCloudBinding()
    })

    test('@desktop covers pairing, Cloud store setup, gift-card credit redemption, and checkout', async ({
      page,
      baseURL,
    }) => {
      test.setTimeout(420_000)

      await signInAsAdmin(page)
      const cloud = await ensureCloudBinding(page)

      try {
        const testId = Date.now()
        const packageName = `E2E Cloud Plan ${testId}`
        const creditPackageName = `E2E Credits ${testId}`
        const storagePlan = await createStoragePlan(cloud, packageName)
        const product = await createCreditPackage(cloud, creditPackageName)
        const giftCard = await createGiftCard(cloud)
        await expectCloudProductVisible(cloud, storagePlan.id, packageName)
        await expectCloudGiftCardVisible(cloud, giftCard.code)

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

        await expectOrderCreated(page)
      } finally {
        await cloud.request.dispose()
      }
    })

    test('@desktop lets a regular user list Cloud packages and redeem a gift card', async ({
      page,
      browser,
      baseURL,
    }) => {
      test.setTimeout(300_000)

      await signInAsAdmin(page)
      const cloud = await ensureCloudBinding(page)

      try {
        const testId = Date.now()
        const packageName = `E2E User Plan ${testId}`
        await createStoragePlan(cloud, packageName)
        const giftCard = await createGiftCard(cloud)
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
      } finally {
        await cloud.request.dispose()
      }
    })
  })

async function ensureCloudBinding(page: Page): Promise<CloudBusinessContext> {
  await unbindCurrentCloudBinding()

  const pairing = await postJson<PairingInfo>(page, '/api/licensing/pairings')
  await approvePairingInCloud(pairing)

  let approved: PairingPollResult | null = null
  await expect
    .poll(
      async () => {
        const result = await getJson<PairingPollResult>(page, `/api/licensing/pairings/${pairing.code}`)
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
      const state = await getJson<BindingState>(page, '/api/licensing/status')
      return state.bound && state.active
    })
    .toBe(true)

  if (!approved?.cloud_store_id) throw new Error('Cloud pairing approval did not include cloud_store_id')
  return createCloudBusinessContext(new URL(pairing.pairingUrl).origin, approved.cloud_store_id)
}

async function createCloudBusinessContext(baseURL: string, storeId?: string): Promise<CloudBusinessContext> {
  const email = process.env.E2E_CLOUD_BUSINESS_EMAIL ?? process.env.E2E_CLOUD_PRO_EMAIL
  const password = process.env.E2E_CLOUD_BUSINESS_PASSWORD ?? process.env.E2E_CLOUD_PRO_PASSWORD
  if (!email || !password) {
    throw new Error('E2E_CLOUD_BUSINESS_EMAIL and E2E_CLOUD_BUSINESS_PASSWORD are required')
  }

  const request = await playwrightRequest.newContext({ baseURL })
  const signIn = await request.post('/api/auth/sign-in/email', {
    data: { email, password },
  })
  await expectCloudOk(signIn, 'Cloud test account sign-in failed')

  return { request, storeId: storeId ?? (await pollCloudBusinessStore(request)) }
}

async function pollCloudBusinessStore(request: APIRequestContext): Promise<string> {
  let storeId: string | null = null
  await expect
    .poll(
      async () => {
        const response = await request.get('/api/accounts/me/stores')
        await expectCloudOk(response, 'Cloud store list failed')
        const body = (await response.json()) as { data?: { items?: CloudStore[] }; items?: CloudStore[] }
        const stores = body.data?.items ?? body.items ?? []
        storeId = stores.find((store) => store.type === 'instance')?.id ?? null
        return storeId
      },
      { timeout: 60_000 },
    )
    .not.toBeNull()
  return storeId!
}

async function approvePairingInCloud(pairing: PairingInfo) {
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
  const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:5185'
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

async function createStoragePlan(cloud: CloudBusinessContext, name: string) {
  return cloudJson<CloudProduct>(cloud, 'POST', `/api/stores/${cloud.storeId}/products`, {
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

async function createCreditPackage(cloud: CloudBusinessContext, name: string) {
  return cloudJson<CloudProduct>(cloud, 'POST', `/api/stores/${cloud.storeId}/products`, {
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

async function createGiftCard(cloud: CloudBusinessContext) {
  const cards = await cloudJson<CloudGiftCard[]>(cloud, 'POST', `/api/stores/${cloud.storeId}/gift-cards`, {
    credits: 200,
    count: 1,
  })
  expect(cards.length).toBe(1)
  const card = cards[0]
  if (card.code === null) throw new Error('Cloud gift card create response did not include code')
  return { ...card, code: card.code }
}

async function expectCloudProductVisible(cloud: CloudBusinessContext, packageId: string, packageName: string) {
  await expect
    .poll(
      async () => {
        const product = await cloudJson<CloudProduct>(
          cloud,
          'GET',
          `/api/stores/${cloud.storeId}/products/${packageId}`,
        )
        return product.name
      },
      { timeout: 60_000 },
    )
    .toBe(packageName)
}

async function expectCloudGiftCardVisible(cloud: CloudBusinessContext, code: string) {
  await expect
    .poll(
      async () => {
        const giftCards = await cloudJson<{ items: CloudGiftCard[] }>(
          cloud,
          'GET',
          `/api/stores/${cloud.storeId}/gift-cards`,
        )
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
  await expectResponseStatus(await redeemResponse, 200)
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
        try {
          const products = await getJson<{ items: CloudProduct[] }>(page, '/api/store/packages')
          return products.items.map((item) => item.name)
        } catch (error) {
          if (isPlaywrightSkipError(error)) throw error
          return [`API error: ${error instanceof Error ? error.message : String(error)}`]
        }
      },
      { timeout: 180_000 },
    )
    .toContain(packageName)
}

async function expectOrderCreated(page: Page) {
  const orders = await getJson<{ items: CloudOrder[] }>(page, '/api/store/orders')
  expect(orders.items[0]).toEqual(
    expect.objectContaining({
      paymentStatus: expect.stringMatching(/paid|pending|unpaid/),
    }),
  )

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

async function cloudJson<T>(
  cloud: CloudBusinessContext,
  method: 'GET' | 'POST',
  url: string,
  data?: unknown,
): Promise<T> {
  const response = await cloud.request.fetch(url, {
    method,
    data,
  })
  await expectCloudOk(response, `Cloud ${method} ${url} failed`)
  const body = (await response.json()) as { data?: T } | T
  return body && typeof body === 'object' && 'data' in body ? (body.data as T) : (body as T)
}

async function expectResponseStatus(response: ResponseLike, status: number) {
  if (response.status() === status) return
  const text = await response.text()
  expect(response.status(), `expected ${status}, got ${response.status()}: ${text}`).toBe(status)
}

function isPlaywrightSkipError(error: unknown) {
  return error instanceof Error && error.message.startsWith('Test is skipped:')
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
