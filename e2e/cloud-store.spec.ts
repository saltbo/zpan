import { type APIResponse, type Browser, expect, type Page, request as playwrightRequest, test } from '@playwright/test'
import { signInAsAdmin, signUpAndGoToFiles } from './helpers'

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
  code: string
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
    test('@desktop covers pairing, admin store setup, gift-card wallet redemption, and wallet checkout', async ({
      page,
      baseURL,
    }) => {
      test.setTimeout(180_000)

      await signInAsAdmin(page)
      await ensureCloudBinding(page)

      const testId = Date.now()
      const packageName = `E2E Cloud Pack ${testId}`
      const product = await createOneTimePackage(page, packageName)
      const giftCard = await createGiftCard(page)
      await expectAdminProductVisibleInApi(page, packageName)
      await expectAdminGiftCardVisibleInApi(page, giftCard.code)

      await page.goto('/storage')
      await expect(page.getByRole('heading', { name: 'Storage' })).toBeVisible()
      await expectStorefrontProductVisibleInApi(page, packageName)

      const walletBefore = await getWalletBalance(page)
      await redeemGiftCard(page, giftCard.code)
      await expect.poll(() => getWalletBalance(page), { timeout: 20_000 }).toBeGreaterThanOrEqual(walletBefore + 200)

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
        currency: 'usd',
      })

      const orders = await expectOrderCreated(page, product.id)
      await expectOrderFulfilled(page, orders.items[0].id)
      await expectUserQuotaIncludesPackage(page, packageName)
    })

    test('@desktop creates Cloud store products and gift cards through admin UI forms', async ({ page }) => {
      test.setTimeout(120_000)

      await signInAsAdmin(page)
      await ensureCloudBinding(page)

      const testId = Date.now()
      const packageName = `E2E UI Pack ${testId}`
      await createOneTimePackageThroughUi(page, packageName)

      await expectAdminProductVisibleInApi(page, packageName)

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
      const packageName = `E2E User Pack ${testId}`
      await createOneTimePackage(page, packageName)
      const giftCard = await createGiftCard(page)
      await expectStorefrontProductVisibleInApi(page, packageName)

      const userContext = await newBrowserContext(browser, baseURL)
      try {
        const userPage = await userContext.newPage()
        await signUpAndGoToFiles(userPage)
        await userPage.goto('/storage')
        await expect(userPage.getByRole('heading', { name: 'Storage' })).toBeVisible()
        await expectStorefrontProductVisibleInApi(userPage, packageName)

        const walletBefore = await getWalletBalance(userPage)
        await redeemGiftCard(userPage, giftCard.code)
        await expect
          .poll(() => getWalletBalance(userPage), { timeout: 20_000 })
          .toBeGreaterThanOrEqual(walletBefore + 200)
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
    await deleteCloudLicenses(cloudRequest)

    const approve = await cloudRequest.patch(`/api/pairings/${encodeURIComponent(pairing.code)}`, {
      data: { action: 'approve' },
    })
    await expectCloudOk(approve, 'Cloud pairing approval failed')
  } finally {
    await cloudRequest.dispose()
  }
}

async function deleteCloudLicenses(cloudRequest: Awaited<ReturnType<typeof playwrightRequest.newContext>>) {
  const licenses = await cloudRequest.get('/api/licenses')
  await expectCloudOk(licenses, 'Cloud license list failed')

  const body = (await licenses.json()) as { data?: CloudLicense[] } | CloudLicense[]
  const activeLicenses = Array.isArray(body) ? body : (body.data ?? [])
  for (const license of activeLicenses) {
    const deleted = await cloudRequest.delete(`/api/licenses/${encodeURIComponent(license.id)}`)
    await expectCloudOk(deleted, 'Cloud license cleanup failed')
  }
}

async function expectCloudOk(response: APIResponse, message: string) {
  if (response.ok()) return
  throw new Error(`${message}: ${response.status()} ${await response.text()}`)
}

async function createOneTimePackage(page: Page, name: string) {
  return postJson<CloudProduct>(page, '/api/admin/store/packages', {
    type: 'zpan_quota',
    name,
    description: 'Playwright staging Cloud store package',
    metadata: {
      storageBytes: 1024 * 1024,
      trafficBytes: 1024 * 1024,
      validityDays: 7,
    },
    prices: [{ currency: 'usd', amount: 100 }],
    active: true,
    sortOrder: 100_000,
  })
}

async function createGiftCard(page: Page) {
  const cards = await postJson<CloudGiftCard[]>(page, '/api/admin/store/gift-cards', {
    amount: 200,
    currency: 'usd',
    count: 1,
  })
  expect(cards.length).toBe(1)
  return cards[0]
}

async function createOneTimePackageThroughUi(page: Page, packageName: string) {
  await page.goto('/admin/cloud-store')
  await expect(page.getByRole('heading', { name: 'Storage Plans' })).toBeVisible()
  await page.getByRole('button', { name: 'New plan' }).click()
  const dialog = page.getByRole('dialog', { name: 'New plan' })
  await dialog.getByLabel('Plan name').fill(packageName)
  await dialog.getByLabel('Description').fill('Created by Playwright through the admin form')
  await dialog.getByRole('combobox', { name: 'Billing' }).click()
  await page.getByRole('option', { name: 'Fixed-duration package' }).click()
  await dialog.getByLabel('Valid days').fill('7')
  await dialog.getByRole('spinbutton', { name: 'Storage quota' }).fill('1')
  await dialog.getByRole('spinbutton', { name: 'Download traffic quota' }).fill('1')
  await dialog.getByLabel('USD amount').fill('1')

  const response = page.waitForResponse(
    (item) => item.url().includes('/api/admin/store/packages') && item.request().method() === 'POST',
  )
  await dialog.getByRole('button', { name: 'Save' }).click()
  expect((await response).status()).toBe(201)
  await expect(dialog).not.toBeVisible({ timeout: 20_000 })
}

async function createGiftCardThroughUi(page: Page) {
  await page.goto('/admin/cloud-store')
  await expect(page.getByRole('heading', { name: 'Storage Plans' })).toBeVisible()
  await page.getByRole('tab', { name: 'Gift Cards' }).click()
  await page.getByRole('button', { name: 'Generate gift cards' }).click()
  const dialog = page.getByRole('dialog', { name: 'Generate gift cards' })
  await dialog.getByLabel('Amount').fill('3')

  const response = page.waitForResponse(
    (item) => item.url().includes('/api/admin/store/gift-cards') && item.request().method() === 'POST',
  )
  await dialog.getByRole('button', { name: 'Generate' }).click()
  const result = await response
  expect(result.status()).toBe(201)
  const cards = (await result.json()) as CloudGiftCard[]
  expect(cards.length).toBe(1)
  return cards[0].code
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

async function expectAdminGiftCardVisibleInApi(page: Page, code: string) {
  await expect
    .poll(
      async () => {
        const giftCards = await getJson<{ items: CloudGiftCard[] }>(page, '/api/admin/store/gift-cards')
        return giftCards.items.map((item) => item.code)
      },
      { timeout: 60_000 },
    )
    .toContain(code)
}

async function redeemGiftCard(page: Page, code: string) {
  await page.getByRole('button', { name: 'Wallet' }).click()
  const walletDialog = page.getByRole('dialog', { name: 'Wallet' })
  await walletDialog.getByRole('button', { name: 'Redeem gift card' }).click()
  const redeemDialog = page.getByRole('dialog', { name: 'Redeem gift card' })
  await redeemDialog.getByLabel('Gift card code').fill(code)
  const redeemResponse = page.waitForResponse(
    (response) => response.url().includes('/api/store/gift-cards/redeem') && response.request().method() === 'POST',
  )
  await redeemDialog.getByRole('button', { name: 'Redeem' }).click()
  expect((await redeemResponse).status()).toBe(200)
  await expect(page.getByText(/Redeemed successfully/)).toBeVisible({ timeout: 20_000 })
  await page.keyboard.press('Escape')
}

async function getWalletBalance(page: Page) {
  const wallet = await getJson<{ balances: Array<{ availableAmount: number; currency: string }> }>(
    page,
    '/api/store/wallet',
  )
  return wallet.balances.find((balance) => balance.currency === 'usd')?.availableAmount ?? 0
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

async function expectOrderFulfilled(page: Page, orderId: string) {
  await expect
    .poll(
      async () => {
        const orders = await getJson<{ items: CloudOrder[] }>(page, '/api/store/orders')
        return orders.items.find((order) => order.id === orderId)?.fulfillmentStatus
      },
      { timeout: 60_000 },
    )
    .toBe('fulfilled')
}

async function expectUserQuotaIncludesPackage(page: Page, packageName: string) {
  await expect
    .poll(
      async () => {
        const quota = await getJson<{
          storagePlanName: string | null
          storageExtraNames: string[]
          trafficPlanName: string | null
          trafficExtraNames: string[]
        }>(page, '/api/quotas/me')
        return [
          quota.storagePlanName,
          quota.trafficPlanName,
          ...quota.storageExtraNames,
          ...quota.trafficExtraNames,
        ].filter(Boolean)
      },
      { timeout: 60_000 },
    )
    .toContain(packageName)
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
  return page.evaluate(
    async ({ method, url, data }) => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const response = await fetch(url, {
            method,
            headers: data === undefined ? undefined : { 'Content-Type': 'application/json' },
            body: data === undefined ? undefined : JSON.stringify(data),
          })
          const text = await response.text()
          if (!response.ok) throw new Error(`${method} ${url} failed with ${response.status}: ${text}`)
          return text ? JSON.parse(text) : null
        } catch (error) {
          if (!(error instanceof TypeError) || attempt === 2) throw error
          await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)))
        }
      }
    },
    { method, url, data },
  ) as Promise<T>
}
