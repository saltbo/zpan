import { expect, test } from '@playwright/test'
import {
  getJson,
  pairAndApprove,
  postJson,
  signInAsAdmin,
  signUpAndGoToFiles,
  unbindCurrentCloudBinding,
} from './helpers'

const PLAN_NAME = 'E2E Storage Plan'
const GIFT_CARD_CODE = 'E2E-GIFT-200'

test.describe('ZPan Cloud store protocol integration', () => {
  test.afterEach(async () => {
    await unbindCurrentCloudBinding()
  })

  test('@desktop @critical pairs, browses a plan, redeems credit, and creates checkout', async ({ page }) => {
    await signInAsAdmin(page)
    await pairAndApprove(page)
    await page.context().clearCookies()
    await signUpAndGoToFiles(page)

    await page.goto('/storage')
    await expect(page.getByRole('heading', { name: 'Storage', exact: true })).toBeVisible()
    const packages = await getJson<{ items: Array<{ id: string; name: string; prices: Array<{ id: string }> }> }>(
      page,
      '/api/store/packages',
    )
    expect(packages.items.map((item) => item.name)).toContain(PLAN_NAME)

    const targets = await getJson<{ items: Array<{ orgId: string; role: string }> }>(page, '/api/store/targets')
    const target = targets.items.find((item) => item.role === 'owner') ?? targets.items[0]
    if (!target) throw new Error('Cloud store target is unavailable')

    await page.goto(`/teams/${encodeURIComponent(target.orgId)}/billing`)
    await page.getByRole('button', { name: 'Redeem gift card' }).click()
    const redeemDialog = page.getByRole('dialog', { name: 'Redeem gift card' })
    await redeemDialog.getByLabel('Gift card code').fill(GIFT_CARD_CODE)
    const redeemResponse = page.waitForResponse(
      (response) => response.url().includes('/api/store/credits/redemptions') && response.request().method() === 'POST',
    )
    await redeemDialog.getByRole('button', { name: 'Redeem' }).click()
    expect((await redeemResponse).status()).toBe(200)
    await expect(page.getByText(/Redeemed successfully/)).toBeVisible()
    await expect.poll(async () => (await getJson<{ balance: number }>(page, '/api/store/credits')).balance).toBe(200)

    const plan = packages.items.find((item) => item.name === PLAN_NAME)
    if (!plan?.prices[0]) throw new Error('E2E plan is missing its price')
    const checkout = await postJson<{ orderId: string; url: string }>(page, '/api/store/checkouts', {
      packageId: plan.id,
      priceId: plan.prices[0].id,
    })
    expect(checkout.orderId).toBe('e2e-order')

    const orders = await getJson<{ items: Array<{ id: string; paymentStatus: string }> }>(page, '/api/store/orders')
    expect(orders.items).toContainEqual(expect.objectContaining({ id: 'e2e-order', paymentStatus: 'pending' }))
  })
})
