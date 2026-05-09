import { zValidator } from '@hono/zod-validator'
import {
  cloudProductInputSchema,
  cloudProductPatchSchema,
  cloudStoreSettingsSchema,
  createGiftCardInputSchema,
  disableGiftCardSchema,
} from '@shared/schemas'
import { Hono } from 'hono'
import { z } from 'zod'
import { requireAdmin } from '../../middleware/auth'
import type { Env } from '../../middleware/platform'
import { requireFeature } from '../../middleware/require-feature'
import { getCloudStoreSettings, upsertCloudStoreSettings } from '../../services/cloud-store'
import {
  cloudGiftCardListSchema,
  cloudGiftCardsResponseSchema,
  cloudOrdersQuerySchema,
  cloudPackageListResponseSchema,
  cloudPackageResponseSchema,
  deleteCloud,
  getCloud,
  giftCardListQuerySchema,
  giftCardsPath,
  packagesPath,
  patchCloudWithBinding,
  postCloudWithBinding,
} from '../cloud-store-helpers'
import { getCloudOrders } from './shared'

type CloudProductPatchInput = ReturnType<typeof cloudProductPatchSchema.parse>

function hasRecurringPrice(input: { prices: Array<{ recurring?: unknown }> }) {
  return input.prices.some((price) => price.recurring)
}

function cloudProductDeliverable(input: {
  name?: string
  metadata: { storageBytes: number; trafficBytes: number; validityDays?: number; overageCapCents?: number }
  prices: Array<{ recurring?: unknown }>
}) {
  return {
    type: hasRecurringPrice(input) ? 'zpan.plan' : 'zpan.extra',
    packageName: input.name,
    storageBytes: input.metadata.storageBytes,
    trafficBytes: input.metadata.trafficBytes,
    validityDays: input.metadata.validityDays,
    overageCapCents: input.metadata.overageCapCents,
  }
}

function cloudProductPayload(input: ReturnType<typeof cloudProductInputSchema.parse>) {
  return {
    ...input,
    type: 'store_item',
    metadata: {
      deliverable: cloudProductDeliverable(input),
    },
  }
}

function cloudProductPatchPayload(input: CloudProductPatchInput) {
  if (!input.metadata && !input.name && input.type === undefined) return input
  if (input.metadata) {
    return {
      ...input,
      type: 'store_item',
      metadata: {
        deliverable: cloudProductDeliverable({
          name: input.name,
          metadata: input.metadata,
          prices: input.prices!,
        }),
      },
    }
  }
  return {
    ...input,
    type: 'store_item',
  }
}

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
    const result = await getCloud(c, packagesPath(), cloudPackageListResponseSchema)
    if ('error' in result) return c.json(result, 502)
    return c.json(result)
  })
  .post('/packages', zValidator('json', cloudProductInputSchema), async (c) => {
    const result = await postCloudWithBinding(
      c,
      packagesPath(),
      cloudProductPayload(c.req.valid('json')),
      cloudPackageResponseSchema,
    )
    if ('error' in result) return c.json(result, 502)
    return c.json(result, 201)
  })
  .get('/packages/:id', async (c) => {
    const result = await getCloud(c, packagesPath({ packageId: c.req.param('id') }), cloudPackageResponseSchema)
    if ('error' in result) return c.json(result, 502)
    return c.json(result)
  })
  .patch('/packages/:id', zValidator('json', cloudProductPatchSchema), async (c) => {
    const result = await patchCloudWithBinding(
      c,
      packagesPath({ packageId: c.req.param('id') }),
      cloudProductPatchPayload(c.req.valid('json')),
      cloudPackageResponseSchema,
    )
    if ('error' in result) return c.json(result, 502)
    return c.json(result)
  })
  .put('/packages/:id', zValidator('json', cloudProductInputSchema), async (c) => {
    const result = await patchCloudWithBinding(
      c,
      packagesPath({ packageId: c.req.param('id') }),
      cloudProductPayload(c.req.valid('json')),
      cloudPackageResponseSchema,
    )
    if ('error' in result) return c.json(result, 502)
    return c.json(result)
  })
  .delete('/packages/:id', async (c) => {
    const id = c.req.param('id')
    const result = await deleteCloud(c, packagesPath({ packageId: id }))
    if (result?.error) return c.json(result, 502)
    return c.json({ id, deleted: true })
  })
  .get('/gift-cards', zValidator('query', giftCardListQuerySchema), async (c) => {
    const result = await getCloud(c, giftCardsPath(c.req.valid('query').status), cloudGiftCardsResponseSchema)
    if ('error' in result) return c.json(result, 502)
    return c.json(result)
  })
  .post('/gift-cards', zValidator('json', createGiftCardInputSchema), async (c) => {
    const result = await postCloudWithBinding(c, giftCardsPath(), c.req.valid('json'), cloudGiftCardListSchema)
    if ('error' in result) return c.json(result, 502)
    return c.json(result, 201)
  })
  .patch('/gift-cards/:code', zValidator('json', disableGiftCardSchema), async (c) => {
    const code = c.req.param('code')
    const result = await patchCloudWithBinding(
      c,
      (storeId) => `${giftCardsPath()(storeId)}/${encodeURIComponent(code)}`,
      c.req.valid('json'),
      z.null(),
    )
    if (result && 'error' in result) return c.json(result, 502)
    return c.json({ code, disabled: true })
  })
  .delete('/gift-cards/:code', async (c) => {
    const code = c.req.param('code')
    const result = await deleteCloud(c, (storeId) => `${giftCardsPath()(storeId)}/${encodeURIComponent(code)}`)
    if (result?.error) return c.json(result, 502)
    return c.json({ code, deleted: true })
  })
  .get('/orders', zValidator('query', cloudOrdersQuerySchema), async (c) => {
    const result = await getCloudOrders(c, c.req.valid('query'))
    if ('error' in result) return c.json(result, 502)
    return c.json(result)
  })
