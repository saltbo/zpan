import { zValidator } from '@hono/zod-validator'
import {
  checkoutInputSchema,
  cloudWalletResponseSchema,
  redeemGiftCardInputSchema,
  redeemGiftCardResponseSchema,
} from '@shared/schemas'
import { Hono } from 'hono'
import { z } from 'zod'
import { requireAuth } from '../../middleware/auth'
import type { Env } from '../../middleware/platform'
import { requireFeature } from '../../middleware/require-feature'
import { canAccessTargetOrg, getAccessibleTargets, getUserTerminalLabel } from '../../services/cloud-store'
import {
  cloudCheckoutResponseSchema,
  cloudPackageListResponseSchema,
  cloudStoreOrdersQuerySchema,
  getCloud,
  getUserStoreSettings,
  ordersPath,
  packagesPath,
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
    const store = await getUserStoreSettings(c.get('platform').db)
    if ('error' in store) return c.json({ error: store.error }, 403)
    const result = await getCloud(c, walletPath(), cloudWalletResponseSchema)
    if ('error' in result) return c.json(result, 502)
    return c.json(result)
  })
  .post('/gift-cards/redeem', zValidator('json', redeemGiftCardInputSchema), async (c) => {
    const store = await getUserStoreSettings(c.get('platform').db)
    if ('error' in store) return c.json({ error: store.error }, 403)
    const result = await postCloudWithBinding(c, redemptionPath(), c.req.valid('json'), redeemGiftCardResponseSchema)
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
    const order = await postCloudWithBinding(
      c,
      ordersPath(),
      {
        items: [{ productId: body.packageId }],
        currency: body.currency ?? 'usd',
        target: {
          orgId: targetOrgId,
          endUserId: targetOrgId,
          endUserLabel: await getUserTerminalLabel(db, userId),
        },
        walletCreditAmount: 'max' as const,
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
    const result = await getCloudOrders(c, { limit: query.limit, offset: query.offset, endUserId: targetOrgId })
    if ('error' in result) return c.json(result, 502)
    return c.json(result)
  })
