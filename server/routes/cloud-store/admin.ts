import { zValidator } from '@hono/zod-validator'
import {
  cloudProductInputSchema,
  cloudProductPatchSchema,
  cloudStoreSettingsSchema,
  createGiftCardInputSchema,
  disableGiftCardSchema,
} from '@shared/schemas'
import { Hono } from 'hono'
import { requireAdmin } from '../../middleware/auth'
import type { Env } from '../../middleware/platform'
import { requireFeature } from '../../middleware/require-feature'
import { getCloudStoreBinding, getCloudStoreSettings, upsertCloudStoreSettings } from '../../services/cloud-store'
import { requestBoundCloudJson } from '../../services/licensing-cloud'
import {
  cloudGiftCardCreateResponseSchema,
  cloudGiftCardsResponseSchema,
  cloudOrdersQuerySchema,
  cloudPackageListResponseSchema,
  cloudPackageResponseSchema,
  getBoundCloudClient,
  getCloudBaseUrl,
  giftCardListQuerySchema,
  type RouteContext,
  unwrapCloudResponse,
} from '../cloud-store-helpers'
import { getCloudOrders } from './shared'

export const adminCloudStore = new Hono<Env>()
  .use(requireAdmin)
  .use(requireFeature('quota_store'))
  .get('/settings', async (c) => {
    const settings = await getCloudStoreSettings(c.get('platform').db)
    return c.json(settings ?? null)
  })
  .put('/settings', zValidator('json', cloudStoreSettingsSchema), async (c) => {
    const settings = await upsertCloudStoreSettings(c.get('platform').db, c.req.valid('json'))
    return c.json(settings)
  })
  .get('/packages', async (c) => {
    const result = await cloudRequest(c, async ({ client, storeId }) =>
      unwrapCloudResponse(
        await client.stores[':storeId'].products.$get({
          param: { storeId },
          query: { type: 'store_item', limit: '100' },
        }),
        cloudPackageListResponseSchema,
      ),
    )
    if (isCloudError(result)) return c.json(result, 502)
    return c.json(result)
  })
  .post('/packages', zValidator('json', cloudProductInputSchema), async (c) => {
    const result = await cloudRequest(c, async ({ client, storeId }) =>
      unwrapCloudResponse(
        await client.stores[':storeId'].products.$post({
          param: { storeId },
          json: c.req.valid('json'),
        }),
        cloudPackageResponseSchema,
      ),
    )
    if (isCloudError(result)) return c.json(result, 502)
    return c.json(result, 201)
  })
  .get('/packages/:id', async (c) => {
    const productId = c.req.param('id')
    const result = await cloudRequest(c, async ({ client, storeId }) =>
      unwrapCloudResponse(
        await client.stores[':storeId'].products[':productId'].$get({ param: { storeId, productId } }),
        cloudPackageResponseSchema,
      ),
    )
    if (isCloudError(result)) return c.json(result, 502)
    return c.json(result)
  })
  .patch('/packages/:id', zValidator('json', cloudProductPatchSchema), async (c) => {
    const productId = c.req.param('id')
    const result = await cloudRequest(c, async ({ client, storeId }) =>
      unwrapCloudResponse(
        await client.stores[':storeId'].products[':productId'].$patch({
          param: { storeId, productId },
          json: c.req.valid('json'),
        }),
        cloudPackageResponseSchema,
      ),
    )
    if (isCloudError(result)) return c.json(result, 502)
    return c.json(result)
  })
  .put('/packages/:id', zValidator('json', cloudProductInputSchema), async (c) => {
    const productId = c.req.param('id')
    const result = await cloudRequest(c, async ({ client, storeId }) =>
      unwrapCloudResponse(
        await client.stores[':storeId'].products[':productId'].$patch({
          param: { storeId, productId },
          json: c.req.valid('json'),
        }),
        cloudPackageResponseSchema,
      ),
    )
    if (isCloudError(result)) return c.json(result, 502)
    return c.json(result)
  })
  .delete('/packages/:id', async (c) => {
    const productId = c.req.param('id')
    const result = await cloudRequest(c, async ({ client, storeId }) =>
      unwrapCloudResponse(
        await client.stores[':storeId'].products[':productId'].$delete({ param: { storeId, productId } }),
      ),
    )
    if (isCloudError(result)) return c.json(result, 502)
    return c.json({ id: productId, deleted: true })
  })
  .get('/gift-cards', zValidator('query', giftCardListQuerySchema), async (c) => {
    const query = c.req.valid('query')
    const result = await cloudRequest(c, async ({ client, storeId }) =>
      unwrapCloudResponse(
        await client.stores[':storeId']['gift-cards'].$get({
          param: { storeId },
          query: query.status ? { status: query.status } : {},
        }),
        cloudGiftCardsResponseSchema,
      ),
    )
    if (isCloudError(result)) return c.json(result, 502)
    return c.json(result)
  })
  .post('/gift-cards', zValidator('json', createGiftCardInputSchema), async (c) => {
    const result = await cloudRequest(c, async ({ storeId }) => createCloudGiftCards(c, storeId, c.req.valid('json')))
    if (isCloudError(result)) return c.json(result, 502)
    return c.json(result, 201)
  })
  .patch('/gift-cards/:code', zValidator('json', disableGiftCardSchema), async (c) => {
    const code = c.req.param('code')
    const result = await cloudRequest(c, async ({ client, storeId }) =>
      unwrapCloudResponse(
        await client.stores[':storeId']['gift-cards'][':code'].$patch({
          param: { storeId, code },
          json: c.req.valid('json'),
        }),
      ),
    )
    if (isCloudError(result)) return c.json(result, 502)
    return c.json({ code, disabled: true })
  })
  .delete('/gift-cards/:code', async (c) => {
    const code = c.req.param('code')
    const result = await cloudRequest(c, async ({ client, storeId }) =>
      unwrapCloudResponse(await client.stores[':storeId']['gift-cards'][':code'].$delete({ param: { storeId, code } })),
    )
    if (isCloudError(result)) return c.json(result, 502)
    return c.json({ code, deleted: true })
  })
  .get('/orders', zValidator('query', cloudOrdersQuerySchema), async (c) => {
    const result = await getCloudOrders(c, c.req.valid('query'))
    if ('error' in result) return c.json(result, 502)
    return c.json(result)
  })

async function cloudRequest<T>(
  c: RouteContext,
  request: (context: Awaited<ReturnType<typeof getBoundCloudClient>>) => Promise<T>,
): Promise<T | { error: string }> {
  try {
    return await request(await getBoundCloudClient(c))
  } catch (error) {
    return { error: (error as Error).message }
  }
}

function isCloudError(result: unknown): result is { error: string } {
  return Boolean(result && typeof result === 'object' && 'error' in result)
}

async function createCloudGiftCards(
  c: RouteContext,
  storeId: string,
  payload: { credits: number; count: number; expiresAt?: string },
) {
  const binding = await getCloudStoreBinding(c.get('platform').db)
  const cloudPayload = {
    amount: payload.credits,
    currency: 'usd',
    count: payload.count,
    ...(payload.expiresAt ? { expiresAt: payload.expiresAt } : {}),
  }
  const data = await requestBoundCloudJson(
    getCloudBaseUrl(c),
    `/api/stores/${encodeURIComponent(storeId)}/gift-cards`,
    binding.refreshToken,
    { method: 'POST', payload: cloudPayload },
  )
  return cloudGiftCardCreateResponseSchema.parse(data)
}
