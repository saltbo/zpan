import { zValidator } from '@hono/zod-validator'
import {
  checkoutInputSchema,
  cloudCreditBalanceResponseSchema,
  cloudCreditLedgerResponseSchema,
  redeemGiftCardInputSchema,
  redeemGiftCardResponseSchema,
} from '@shared/schemas'
import { Hono } from 'hono'
import { z } from 'zod'
import { requireAuth } from '../../middleware/auth'
import type { Env } from '../../middleware/platform'
import { requireFeature } from '../../middleware/require-feature'
import {
  canAccessTargetOrg,
  getAccessibleTargets,
  getCloudStoreBinding,
  getCustomerLabel,
} from '../../services/cloud-store'
import { getEffectiveQuota } from '../../services/effective-quota'
import { requestBoundCloudJson } from '../../services/licensing-cloud'
import {
  cloudBillingPortalSessionResponseSchema,
  cloudCheckoutResponseSchema,
  cloudOrderResponseSchema,
  cloudPackageListResponseSchema,
  cloudPackageResponseSchema,
  cloudStoreOrdersQuerySchema,
  getBoundCloudClient,
  getCloudBaseUrl,
  getUserStoreSettings,
  type RouteContext,
  unwrapCloudResponse,
  withCloudRequestTimeout,
} from '../cloud-store-helpers'
import { getCloudOrders, getInstanceOrigin } from './shared'

export const cloudStore = new Hono<Env>()
  .use(requireAuth)
  .use(requireFeature('quota_store'))
  .get('/packages', async (c) => {
    const store = await getUserStoreSettings(c.get('platform').db)
    if ('error' in store) return c.json({ error: store.error }, 403)
    const result = await cloudRequest(c, async ({ client, storeId }) =>
      unwrapCloudResponse(
        await client.stores[':storeId'].products.$get({
          param: { storeId },
          query: { type: 'store_item', limit: '100', status: 'active' },
        }),
        cloudPackageListResponseSchema,
      ),
    )
    if (isCloudError(result)) return c.json(result, 502)
    const items = result.items.filter((item) => item.metadata.deliverable.type === 'zpan.plan')
    return c.json({ ...result, items, total: items.length })
  })
  .get('/credits/products', async (c) => {
    const store = await getUserStoreSettings(c.get('platform').db)
    if ('error' in store) return c.json({ error: store.error }, 403)
    const result = await cloudRequest(c, async ({ client, storeId }) =>
      unwrapCloudResponse(
        await client.stores[':storeId'].products.$get({
          param: { storeId },
          query: { type: 'store_item', limit: '100', status: 'active' },
        }),
        cloudPackageListResponseSchema,
      ),
    )
    if (isCloudError(result)) return c.json(result, 502)
    const items = result.items.filter((item) => item.metadata.deliverable.type === 'zpan.credits')
    return c.json({ ...result, items, total: items.length })
  })
  .get('/targets', async (c) => {
    const db = c.get('platform').db
    const store = await getUserStoreSettings(db)
    if ('error' in store) return c.json({ error: store.error }, 403)
    const items = await getAccessibleTargets(db, c.get('userId')!)
    return c.json({ items, total: items.length })
  })
  .get('/credits', async (c) => {
    const targetOrgId = c.get('orgId')
    if (!targetOrgId) return c.json({ error: 'No active organization' }, 400)
    const store = await getUserStoreSettings(c.get('platform').db)
    if ('error' in store) return c.json({ error: store.error }, 403)
    const result = await cloudRequest(c, async ({ storeId }) =>
      unwrapCloudResponse(
        await getCloudCreditResource(c, storeId, targetOrgId, 'balance'),
        cloudCreditBalanceResponseSchema,
      ),
    )
    if (isCloudError(result)) return c.json(result, 502)
    return c.json(result)
  })
  .get('/credits/ledger-entries', async (c) => {
    const targetOrgId = c.get('orgId')
    if (!targetOrgId) return c.json({ error: 'No active organization' }, 400)
    const store = await getUserStoreSettings(c.get('platform').db)
    if ('error' in store) return c.json({ error: store.error }, 403)
    const result = await cloudRequest(c, async ({ storeId }) =>
      unwrapCloudResponse(
        await getCloudCreditResource(c, storeId, targetOrgId, 'ledger-entries'),
        cloudCreditLedgerResponseSchema,
      ),
    )
    if (isCloudError(result)) return c.json(result, 502)
    return c.json(result)
  })
  .post('/credits/redemptions', zValidator('json', redeemGiftCardInputSchema), async (c) => {
    const targetOrgId = c.get('orgId')
    if (!targetOrgId) return c.json({ error: 'No active organization' }, 400)
    const store = await getUserStoreSettings(c.get('platform').db)
    if ('error' in store) return c.json({ error: store.error }, 403)
    const result = await cloudRequest(c, async ({ storeId }) =>
      unwrapCloudResponse(
        await postCloudCreditRedemption(c, storeId, targetOrgId, [c.req.valid('json').code]),
        redeemGiftCardResponseSchema,
      ),
    )
    if (isCloudError(result)) return c.json(result, 502)
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
    const currency = 'usd'
    const product = await cloudRequest(c, async ({ client, storeId }) =>
      unwrapCloudResponse(
        await client.stores[':storeId'].products[':productId'].$get({
          param: { storeId, productId: body.packageId },
        }),
        cloudPackageResponseSchema,
      ),
    )
    if (isCloudError(product)) return c.json(product, 502)
    const price = body.priceId
      ? product.prices.find(
          (item) => item.id === body.priceId && item.currency === currency && item.recurring?.usageType !== 'metered',
        )
      : product.prices.find((item) => item.currency === currency && item.recurring?.usageType !== 'metered')
    if (!price) return c.json({ error: 'package_price_missing' }, 400)
    if (price.recurring) {
      const quota = await getEffectiveQuota(db, targetOrgId)
      if (quota.currentPlan?.subscription) return c.json({ error: 'workspace_plan_exists' }, 409)
    }
    const order = await cloudRequest(c, async ({ client, storeId }) =>
      unwrapCloudResponse(
        await client.stores[':storeId'].orders.$post({
          param: { storeId },
          json: {
            items: [{ productId: body.packageId, priceId: price.id, quantity: 1 }],
            currency,
            deliveryCallbackUrl: `${getInstanceOrigin(c)}/api/store/webhook`,
            target: {
              orgId: targetOrgId,
              customerId: targetOrgId,
              customerLabel: await getCustomerLabel(db, userId),
            },
          },
        }),
        cloudOrderResponseSchema,
      ),
    )
    if (isCloudError(order)) return c.json(order, 502)
    const origin = getInstanceOrigin(c)
    const payment = await cloudRequest(c, async ({ client, storeId }) =>
      unwrapCloudResponse(
        await client.stores[':storeId'].orders[':orderId'].payments.$post({
          param: { storeId, orderId: order.id },
          json: {
            successUrl: `${origin}/storage`,
            cancelUrl: `${origin}/storage`,
          },
        }),
        cloudCheckoutResponseSchema,
      ),
    )
    if (isCloudError(payment)) return c.json(payment, 502)
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
    const result = await cloudRequest(c, async ({ client, storeId }) =>
      unwrapCloudResponse(
        await client.stores[':storeId'].billing['portal-sessions'].$post({
          param: { storeId },
          json: { customerId: targetOrgId, returnUrl: `${origin}/storage` },
        }),
        cloudBillingPortalSessionResponseSchema,
      ),
    )
    if (isCloudError(result)) return c.json(result, 502)
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
    const order = await getOrder(c, orderId)
    if (isCloudError(order)) return c.json(order, 502)
    if (!orderBelongsToTarget(order.target, targetOrgId)) return c.json({ error: 'Forbidden' }, 403)
    const origin = getInstanceOrigin(c)
    const result = await cloudRequest(c, async ({ client, storeId }) =>
      unwrapCloudResponse(
        await client.stores[':storeId'].orders[':orderId'].payments.$post({
          param: { storeId, orderId },
          json: {
            successUrl: `${origin}/storage`,
            cancelUrl: `${origin}/storage`,
          },
        }),
        cloudCheckoutResponseSchema,
      ),
    )
    if (isCloudError(result)) return c.json(result, 502)
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
    const order = await getOrder(c, orderId)
    if (isCloudError(order)) return c.json(order, 502)
    if (!orderBelongsToTarget(order.target, targetOrgId)) return c.json({ error: 'Forbidden' }, 403)
    const result = await cloudRequest(c, async ({ client, storeId }) =>
      unwrapCloudResponse(
        await client.stores[':storeId'].orders[':orderId'].$patch({
          param: { storeId, orderId },
          json: c.req.valid('json'),
        }),
        cloudOrderResponseSchema,
      ),
    )
    if (isCloudError(result)) return c.json(result, 502)
    return c.json(result)
  })

function getOrder(c: RouteContext, orderId: string) {
  return cloudRequest(c, async ({ client, storeId }) =>
    unwrapCloudResponse(
      await client.stores[':storeId'].orders[':orderId'].$get({ param: { storeId, orderId } }),
      cloudOrderResponseSchema,
    ),
  )
}

function orderBelongsToTarget(target: Record<string, unknown> | null, targetOrgId: string): boolean {
  return target?.orgId === targetOrgId || target?.customerId === targetOrgId
}

function cloudCreditPath(storeId: string, customerId: string, resource: string) {
  return `/api/stores/${encodeURIComponent(storeId)}/credit-accounts/${encodeURIComponent(customerId)}/${resource}`
}

async function getCloudCreditResource(
  c: RouteContext,
  storeId: string,
  customerId: string,
  resource: 'balance' | 'ledger-entries',
) {
  const binding = await getCloudStoreBinding(c.get('platform').db)
  const data = await requestBoundCloudJson(
    getCloudBaseUrl(c),
    cloudCreditPath(storeId, customerId, resource),
    binding.refreshToken,
    {
      method: 'GET',
    },
  )
  return jsonResponse(data)
}

async function postCloudCreditRedemption(c: RouteContext, storeId: string, customerId: string, codes: string[]) {
  const binding = await getCloudStoreBinding(c.get('platform').db)
  const data = await requestBoundCloudJson(
    getCloudBaseUrl(c),
    cloudCreditPath(storeId, customerId, 'redemptions'),
    binding.refreshToken,
    {
      method: 'POST',
      payload: { codes },
    },
  )
  return jsonResponse(data, 201)
}

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  }
}

async function cloudRequest<T>(
  c: RouteContext,
  request: (context: Awaited<ReturnType<typeof getBoundCloudClient>>) => Promise<T>,
): Promise<T | { error: string }> {
  try {
    return await withCloudRequestTimeout(request(await getBoundCloudClient(c)))
  } catch (error) {
    return { error: (error as Error).message }
  }
}

function isCloudError(result: unknown): result is { error: string } {
  return Boolean(result && typeof result === 'object' && 'error' in result)
}
