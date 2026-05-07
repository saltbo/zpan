import { zValidator } from '@hono/zod-validator'
import {
  checkoutInputSchema,
  cloudOrderQuotaChangeSchema,
  createGiftCardInputSchema,
  disableGiftCardSchema,
  quotaStorePackageInputSchema,
  quotaStorePackagePatchSchema,
  quotaStoreSettingsSchema,
} from '@shared/schemas'
import { Hono } from 'hono'
import { z } from 'zod'
import { verifyCloudEventToken } from '../licensing/cloud-event-token'
import { requireAdmin, requireAuth } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import { requireFeature } from '../middleware/require-feature'
import {
  canAccessTargetOrg,
  getAccessibleTargets,
  getCloudStoreBinding,
  getQuotaStoreSettings,
  getRequiredSettings,
  processCloudOrderQuotaChange,
  upsertQuotaStoreSettings,
} from '../services/quota-store'
import {
  cloudCheckoutResponseSchema,
  cloudGiftCardsResponseSchema,
  cloudOrdersResponseSchema,
  cloudPackageListResponseSchema,
  cloudPackageResponseSchema,
  createCheckoutPayload,
  deleteCloud,
  getCloud,
  getCloudBaseUrl,
  getUserStoreSettings,
  giftCardListQuerySchema,
  giftCardsPath,
  ordersPath,
  packagesPath,
  parseJson,
  patchCloudWithBinding,
  postCloudWithBinding,
  postUserCloud,
  sha256Hex,
} from './quota-store-helpers'

const adminQuotaStore = new Hono<Env>()
  .use(requireAdmin)
  .use(requireFeature('quota_store'))
  .get('/settings', async (c) => {
    const settings = await getQuotaStoreSettings(c.get('platform').db)
    return c.json(settings ?? null)
  })
  .put('/settings', zValidator('json', quotaStoreSettingsSchema), async (c) => {
    const settings = await upsertQuotaStoreSettings(c.get('platform').db, c.req.valid('json'))
    return c.json(settings)
  })
  .get('/packages', async (c) => {
    const result = await getCloud(c, packagesPath(), cloudPackageListResponseSchema)
    if ('error' in result) return c.json(result, 502)
    return c.json(result)
  })
  .post('/packages', zValidator('json', quotaStorePackageInputSchema), async (c) => {
    const result = await postCloudWithBinding(c, packagesPath(), c.req.valid('json'), cloudPackageResponseSchema)
    if ('error' in result) return c.json(result, 502)
    return c.json(result, 201)
  })
  .get('/packages/:id', async (c) => {
    const result = await getCloud(c, packagesPath(c.req.param('id')), cloudPackageResponseSchema)
    if ('error' in result) return c.json(result, 502)
    return c.json(result)
  })
  .patch('/packages/:id', zValidator('json', quotaStorePackagePatchSchema), async (c) => {
    const result = await patchCloudWithBinding(
      c,
      packagesPath(c.req.param('id')),
      c.req.valid('json'),
      cloudPackageResponseSchema,
    )
    if ('error' in result) return c.json(result, 502)
    return c.json(result)
  })
  .put('/packages/:id', zValidator('json', quotaStorePackageInputSchema), async (c) => {
    const result = await patchCloudWithBinding(
      c,
      packagesPath(c.req.param('id')),
      c.req.valid('json'),
      cloudPackageResponseSchema,
    )
    if ('error' in result) return c.json(result, 502)
    return c.json(result)
  })
  .delete('/packages/:id', async (c) => {
    const id = c.req.param('id')
    const result = await deleteCloud(c, packagesPath(id))
    if (result?.error) return c.json(result, 502)
    return c.json({ id, deleted: true })
  })
  .get('/gift-cards', zValidator('query', giftCardListQuerySchema), async (c) => {
    const result = await getCloud(c, giftCardsPath(c.req.valid('query').status), cloudGiftCardsResponseSchema)
    if ('error' in result) return c.json(result, 502)
    return c.json({ items: result, total: result.length })
  })
  .post('/gift-cards', zValidator('json', createGiftCardInputSchema), async (c) => {
    const body = c.req.valid('json')
    const result = await postCloudWithBinding(
      c,
      giftCardsPath(),
      {
        amount: body.amount,
        currency: body.currency,
        expires_at: body.expiresAt,
        count: body.count,
      },
      cloudGiftCardsResponseSchema,
    )
    if ('error' in result) return c.json(result, 502)
    return c.json({ items: result, total: result.length }, 201)
  })
  .patch('/gift-cards/:code', zValidator('json', disableGiftCardSchema), async (c) => {
    const code = c.req.param('code')
    const result = await patchCloudWithBinding(
      c,
      `${giftCardsPath()}/${encodeURIComponent(code)}`,
      c.req.valid('json'),
      z.object({}).passthrough(),
    )
    if ('error' in result) return c.json(result, 502)
    return c.json({ code, disabled: true })
  })
  .delete('/gift-cards/:code', async (c) => {
    const result = await deleteCloud(c, `${giftCardsPath()}/${encodeURIComponent(c.req.param('code'))}`)
    if (result?.error) return c.json(result, 502)
    return c.json({ code: c.req.param('code'), deleted: true })
  })
  .get('/orders', async (c) => {
    const result = await getCloud(c, ordersPath(), cloudOrdersResponseSchema)
    if ('error' in result) return c.json(result, 502)
    return c.json(result)
  })

const quotaStore = new Hono<Env>()
  .use(requireAuth)
  .use(requireFeature('quota_store'))
  .get('/packages', async (c) => {
    const db = c.get('platform').db
    const store = await getUserStoreSettings(db)
    if ('error' in store) return c.json({ error: store.error }, 403)
    const result = await getCloud(c, packagesPath(), cloudPackageListResponseSchema)
    if ('error' in result) return c.json(result, 502)
    const items = result.items.filter((pkg) => pkg.active)
    return c.json({ items, total: items.length })
  })
  .get('/targets', async (c) => {
    const db = c.get('platform').db
    const store = await getUserStoreSettings(db)
    if ('error' in store) return c.json({ error: store.error }, 403)
    const items = await getAccessibleTargets(db, c.get('userId')!)
    return c.json({ items, total: items.length })
  })
  .post('/checkouts', zValidator('json', checkoutInputSchema), async (c) => {
    const body = c.req.valid('json')
    const db = c.get('platform').db
    if (!(await canAccessTargetOrg(db, c.get('userId')!, body.targetOrgId))) {
      return c.json({ error: 'Forbidden' }, 403)
    }

    const store = await getUserStoreSettings(db)
    if ('error' in store) return c.json({ error: store.error }, 403)
    const binding = await getCloudStoreBinding(db)
    const result = await postUserCloud(
      c,
      '/api/store/checkouts',
      await createCheckoutPayload(
        c,
        binding.boundLicenseId,
        body.packageId,
        body.targetOrgId,
        c.get('userId')!,
        body.currency,
        body.giftCardCode,
      ),
      binding.refreshToken,
      cloudCheckoutResponseSchema,
    )
    if ('error' in result) return c.json(result, 502)
    return c.json({ checkoutUrl: result.checkoutUrl })
  })
  .get('/orders', async (c) => {
    const db = c.get('platform').db
    const store = await getUserStoreSettings(db)
    if ('error' in store) return c.json({ error: store.error }, 403)
    const targets = await getAccessibleTargets(db, c.get('userId')!)
    if (targets.length === 0) return c.json({ items: [], total: 0 })
    const result = await getCloud(c, ordersPath(targets.map((target) => target.orgId)), cloudOrdersResponseSchema)
    if ('error' in result) return c.json(result, 502)
    const accessibleOrgIds = new Set(targets.map((target) => target.orgId))
    const items = result.items.filter((order) => accessibleOrgIds.has(order.orgId))
    return c.json({ items, total: items.length })
  })

const quotaStoreWebhooks = new Hono<Env>().use(requireFeature('quota_store')).post('/cloud', async (c) => {
  const db = c.get('platform').db
  await getRequiredSettings(db)
  const binding = await getCloudStoreBinding(db)
  const rawPayload = await c.req.text()
  const payloadHash = await sha256Hex(rawPayload)
  const eventToken = c.req.header('x-zpan-cloud-event-token') ?? ''
  const eventAuth = verifyCloudEventToken(eventToken, {
    cloudBaseUrl: getCloudBaseUrl(c),
    instanceId: binding.instanceId,
    boundLicenseId: binding.boundLicenseId,
    payloadHash,
  })
  if (!eventAuth) return c.json({ error: 'invalid_event_token' }, 401)

  const body = parseJson(rawPayload)
  if (!body) return c.json({ error: 'invalid_payload' }, 400)

  const parsed = cloudOrderQuotaChangeSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: 'invalid_payload' }, 400)
  if (parsed.data.eventId !== eventAuth.eventId) return c.json({ error: 'invalid_event_token' }, 401)

  try {
    const result = await processCloudOrderQuotaChange(db, parsed.data, rawPayload, payloadHash)
    return c.json({ success: true, duplicate: result.duplicate, eventId: result.eventId })
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400)
  }
})

export { adminQuotaStore, quotaStore, quotaStoreWebhooks }
