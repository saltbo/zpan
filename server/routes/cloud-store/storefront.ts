import { zValidator } from '@hono/zod-validator'
import {
  checkoutInputSchema,
  cloudWalletResponseSchema,
  cloudWalletTransactionsResponseSchema,
  redeemGiftCardInputSchema,
  redeemGiftCardResponseSchema,
} from '@shared/schemas'
import { Hono } from 'hono'
import { z } from 'zod'
import { requireAuth } from '../../middleware/auth'
import type { Env } from '../../middleware/platform'
import { requireFeature } from '../../middleware/require-feature'
import { canAccessTargetOrg, getAccessibleTargets, getCustomerLabel } from '../../services/cloud-store'
import { getEffectiveQuota } from '../../services/effective-quota'
import {
  billingPortalPath,
  cloudBillingPortalSessionResponseSchema,
  cloudCheckoutResponseSchema,
  cloudOrderResponseSchema,
  cloudPackageListResponseSchema,
  cloudPackageResponseSchema,
  cloudStoreOrdersQuerySchema,
  getCloud,
  getUserStoreSettings,
  ordersPath,
  packagesPath,
  patchCloudWithBinding,
  postCloudWithBinding,
  redemptionPath,
  walletPath,
} from '../cloud-store-helpers'
import { getCloudOrders, getInstanceOrigin } from './shared'

export const cloudStore = new Hono<Env>()
  .use(requireAuth)
  .use(requireFeature('quota_store'))
  .get('/packages', async (c) => {
    const store = await getUserStoreSettings(c.get('platform').db)
    if ('error' in store) return c.json({ error: store.error }, 403)
    const result = await getCloud(c, packagesPath({ status: 'active' }), cloudPackageListResponseSchema)
    if ('error' in result) return c.json(result, 502)
    return c.json(result)
  })
  .get('/targets', async (c) => {
    const db = c.get('platform').db
    const store = await getUserStoreSettings(db)
    if ('error' in store) return c.json({ error: store.error }, 403)
    const items = await getAccessibleTargets(db, c.get('userId')!)
    return c.json({ items, total: items.length })
  })
  .get('/wallet', async (c) => {
    const targetOrgId = c.get('orgId')
    if (!targetOrgId) return c.json({ error: 'No active organization' }, 400)
    const store = await getUserStoreSettings(c.get('platform').db)
    if ('error' in store) return c.json({ error: store.error }, 403)
    const result = await getCloud(c, walletPath(targetOrgId), cloudWalletResponseSchema)
    if ('error' in result) return c.json(result, 502)
    return c.json(result)
  })
  .get('/wallet/transactions', async (c) => {
    const targetOrgId = c.get('orgId')
    if (!targetOrgId) return c.json({ error: 'No active organization' }, 400)
    const store = await getUserStoreSettings(c.get('platform').db)
    if ('error' in store) return c.json({ error: store.error }, 403)
    const result = await getCloud(
      c,
      (storeId) => `/api/stores/${encodeURIComponent(storeId)}/wallets/${encodeURIComponent(targetOrgId)}/transactions`,
      cloudWalletTransactionsResponseSchema,
    )
    if ('error' in result) return c.json(result, 502)
    return c.json(result)
  })
  .post('/gift-cards/redeem', zValidator('json', redeemGiftCardInputSchema), async (c) => {
    const targetOrgId = c.get('orgId')
    if (!targetOrgId) return c.json({ error: 'No active organization' }, 400)
    const store = await getUserStoreSettings(c.get('platform').db)
    if ('error' in store) return c.json({ error: store.error }, 403)
    const result = await postCloudWithBinding(
      c,
      redemptionPath(targetOrgId),
      { codes: [c.req.valid('json').code] },
      redeemGiftCardResponseSchema,
    )
    if ('error' in result) return c.json(result, 502)
    return c.json(result)
  })
  .post('/checkouts', zValidator('json', checkoutInputSchema), async (c) => {
    const body = c.req.valid('json')
    const db = c.get('platform').db
    const userId = c.get('userId')!
    const targetOrgId = c.get('orgId')
    if (!targetOrgId) return c.json({ error: 'No active organization' }, 400)
    if (!(await canAccessTargetOrg(db, userId, targetOrgId))) return c.json({ error: 'Forbidden' }, 403)

    const store = await getUserStoreSettings(db)
    if ('error' in store) return c.json({ error: store.error }, 403)
    const currency = body.currency ?? 'usd'
    const product = await getCloud(c, packagesPath({ packageId: body.packageId }), cloudPackageResponseSchema)
    if ('error' in product) return c.json(product, 502)
    const price =
      product.prices.find((item) => item.id === body.priceId && item.currency === currency) ??
      product.prices.find((item) => item.currency === currency && item.recurring?.usageType !== 'metered')
    if (!price) return c.json({ error: 'package_price_missing' }, 400)
    if (price.recurring) {
      const quota = await getEffectiveQuota(db, targetOrgId)
      if (quota.storagePlanName || quota.trafficPlanName) return c.json({ error: 'workspace_plan_exists' }, 409)
    }
    const order = await postCloudWithBinding(
      c,
      ordersPath(),
      {
        items: [{ productId: body.packageId, priceId: price.id }],
        currency,
        deliveryCallbackUrl: `${getInstanceOrigin(c)}/api/store/webhook`,
        target: {
          orgId: targetOrgId,
          customerId: targetOrgId,
          customerLabel: await getCustomerLabel(db, userId),
        },
        ...(price.recurring ? {} : { walletCreditAmount: 'max' as const }),
      },
      z.object({ id: z.string().min(1) }),
    )
    if ('error' in order) return c.json(order, 502)
    const origin = getInstanceOrigin(c)
    const payment = await postCloudWithBinding(
      c,
      (storeId) => `${ordersPath()(storeId)}/${encodeURIComponent(order.id)}/payments`,
      {
        successUrl: `${origin}/storage`,
        cancelUrl: `${origin}/storage`,
      },
      cloudCheckoutResponseSchema,
    )
    if ('error' in payment) return c.json(payment, 502)
    return c.json(payment)
  })
  .post('/billing-portal-sessions', async (c) => {
    const db = c.get('platform').db
    const userId = c.get('userId')!
    const targetOrgId = c.get('orgId')
    if (!targetOrgId) return c.json({ error: 'No active organization' }, 400)
    if (!(await canAccessTargetOrg(db, userId, targetOrgId))) return c.json({ error: 'Forbidden' }, 403)

    const store = await getUserStoreSettings(db)
    if ('error' in store) return c.json({ error: store.error }, 403)
    const origin = getInstanceOrigin(c)
    const result = await postCloudWithBinding(
      c,
      billingPortalPath(),
      { customerId: targetOrgId, returnUrl: `${origin}/storage` },
      cloudBillingPortalSessionResponseSchema,
    )
    if ('error' in result) return c.json(result, 502)
    return c.json(result)
  })
  .get('/orders', zValidator('query', cloudStoreOrdersQuerySchema), async (c) => {
    const db = c.get('platform').db
    const store = await getUserStoreSettings(db)
    if ('error' in store) return c.json({ error: store.error }, 403)
    const userId = c.get('userId')
    if (!userId) return c.json({ error: 'forbidden' }, 403)
    const targetOrgId = c.get('orgId')
    if (!targetOrgId) return c.json({ error: 'No active organization' }, 400)
    const query = c.req.valid('query')
    if (!(await canAccessTargetOrg(db, userId, targetOrgId))) return c.json({ error: 'Forbidden' }, 403)
    const result = await getCloudOrders(c, { limit: query.limit, offset: query.offset, customerId: targetOrgId })
    if ('error' in result) return c.json(result, 502)
    return c.json(result)
  })
  .post('/orders/:orderId/payments', async (c) => {
    const db = c.get('platform').db
    const store = await getUserStoreSettings(db)
    if ('error' in store) return c.json({ error: store.error }, 403)
    const userId = c.get('userId')!
    const targetOrgId = c.get('orgId')
    if (!targetOrgId) return c.json({ error: 'No active organization' }, 400)
    if (!(await canAccessTargetOrg(db, userId, targetOrgId))) return c.json({ error: 'Forbidden' }, 403)
    const orderId = c.req.param('orderId')
    if (!orderId) return c.json({ error: 'not_found' }, 404)
    const order = await getCloud(c, orderPath(orderId), cloudOrderResponseSchema)
    if ('error' in order) return c.json(order, 502)
    if (!orderBelongsToTarget(order.target, targetOrgId)) return c.json({ error: 'Forbidden' }, 403)
    const origin = getInstanceOrigin(c)
    const result = await postCloudWithBinding(
      c,
      (storeId) => `${orderPath(orderId)(storeId)}/payments`,
      {
        successUrl: `${origin}/storage`,
        cancelUrl: `${origin}/storage`,
      },
      cloudCheckoutResponseSchema,
    )
    if ('error' in result) return c.json(result, 502)
    return c.json(result)
  })
  .patch('/orders/:orderId', zValidator('json', z.object({ status: z.literal('canceled') })), async (c) => {
    const db = c.get('platform').db
    const store = await getUserStoreSettings(db)
    if ('error' in store) return c.json({ error: store.error }, 403)
    const userId = c.get('userId')!
    const targetOrgId = c.get('orgId')
    if (!targetOrgId) return c.json({ error: 'No active organization' }, 400)
    if (!(await canAccessTargetOrg(db, userId, targetOrgId))) return c.json({ error: 'Forbidden' }, 403)
    const orderId = c.req.param('orderId')
    if (!orderId) return c.json({ error: 'not_found' }, 404)
    const order = await getCloud(c, orderPath(orderId), cloudOrderResponseSchema)
    if ('error' in order) return c.json(order, 502)
    if (!orderBelongsToTarget(order.target, targetOrgId)) return c.json({ error: 'Forbidden' }, 403)
    const result = await patchCloudWithBinding(c, orderPath(orderId), c.req.valid('json'), cloudOrderResponseSchema)
    if ('error' in result) return c.json(result, 502)
    return c.json(result)
  })

function orderPath(orderId: string) {
  return (storeId: string) => `${ordersPath()(storeId)}/${encodeURIComponent(orderId)}`
}

function orderBelongsToTarget(target: Record<string, unknown> | null, targetOrgId: string): boolean {
  return target?.orgId === targetOrgId || target?.customerId === targetOrgId
}
