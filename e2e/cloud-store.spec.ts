import {
  type APIRequestContext,
  type Browser,
  expect,
  type Page,
  request as playwrightRequest,
  test,
} from '@playwright/test'
import {
  expectCloudOk,
  getJson,
  pairAndApprove,
  postJson,
  signInAsAdmin,
  signUpAndGoToFiles,
  unbindCurrentCloudBinding,
} from './helpers'

const LOCALHOST_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/
const CLOUD_BASE_ORIGIN = new URL(process.env.ZPAN_CLOUD_URL ?? 'https://zpan-cloud-staging.saltbo.workers.dev').origin

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
        await openWorkspaceBilling(page)
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
          await openWorkspaceBilling(userPage)
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
  const approved = await pairAndApprove(page)
  return createCloudBusinessContext(CLOUD_BASE_ORIGIN, approved.cloud_store_id)
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
  await page.getByRole('button', { name: 'Redeem gift card' }).click()
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

async function openWorkspaceBilling(page: Page) {
  const targets = await getJson<{ items: Array<{ orgId: string; role: string }> }>(page, '/api/store/targets')
  const target = targets.items.find((item) => item.role === 'owner') ?? targets.items[0]
  if (!target) throw new Error('Cloud store target is unavailable')

  await page.goto(`/teams/${encodeURIComponent(target.orgId)}/billing`)
  await expect(page.getByRole('button', { name: 'Redeem gift card' })).toBeVisible({ timeout: 20_000 })
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
