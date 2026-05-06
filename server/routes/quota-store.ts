import { zValidator } from '@hono/zod-validator'
import {
  checkoutInputSchema,
  cloudDeliveryEventSchema,
  generateStorageCodesInputSchema,
  quotaStorePackageInputSchema,
  quotaStorePackagePatchSchema,
  quotaStoreSettingsSchema,
  redemptionInputSchema,
  revokeStorageCodeSchema,
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
  processCloudDelivery,
  upsertQuotaStoreSettings,
} from '../services/quota-store'
import {
  cloudCheckoutResponseSchema,
  cloudPackageListResponseSchema,
  cloudPackageResponseSchema,
  cloudQuotaGrantsResponseSchema,
  cloudRedemptionResponseSchema,
  cloudStorageCodesResponseSchema,
  createCheckoutPayload,
  createRedemptionPayload,
  deleteCloud,
  getCloud,
  getCloudBaseUrl,
  getUserStoreSettings,
  packagesPath,
  parseJson,
  patchCloudWithBinding,
  postCloudWithBinding,
  postUserCloud,
  quotaGrantsPath,
  requestCloudWithBinding,
  sha256Hex,
  storageCodeListQuerySchema,
  storageCodesPath,
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
  .get('/storage-codes', zValidator('query', storageCodeListQuerySchema), async (c) => {
    const result = await getCloud(c, storageCodesPath(c.req.valid('query').status), cloudStorageCodesResponseSchema)
    if ('error' in result) return c.json(result, 502)
    return c.json({ items: result, total: result.length })
  })
  .post('/storage-codes', zValidator('json', generateStorageCodesInputSchema), async (c) => {
    const body = c.req.valid('json')
    const result = await postCloudWithBinding(
      c,
      storageCodesPath(),
      {
        resourceType: body.resourceType,
        bytes: body.resourceBytes,
        max_uses: body.maxUses,
        expires_at: body.expiresAt,
        count: body.count,
      },
      cloudStorageCodesResponseSchema,
    )
    if ('error' in result) return c.json(result, 502)
    return c.json({ items: result, total: result.length }, 201)
  })
  .patch('/storage-codes/:code', zValidator('json', revokeStorageCodeSchema), async (c) => {
    const code = c.req.param('code')
    const result = await requestCloudWithBinding(
      c,
      `${storageCodesPath()}/${encodeURIComponent(code)}`,
      'PATCH',
      z.object({}).passthrough(),
      c.req.valid('json'),
    )
    if ('error' in result) return c.json(result, 502)
    return c.json({ code, revoked: true })
  })
  .delete('/storage-codes/:code', async (c) => {
    const result = await deleteCloud(c, `${storageCodesPath()}/${encodeURIComponent(c.req.param('code'))}`)
    if (result?.error) return c.json(result, 502)
    return c.json({ code: c.req.param('code'), deleted: true })
  })
  .get('/delivery-records', async (c) => {
    const result = await getCloud(c, '/api/store/grants', cloudQuotaGrantsResponseSchema)
    if ('error' in result) return c.json(result, 502)
    return c.json({ items: result, total: result.length })
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
  .post('/checkout', zValidator('json', checkoutInputSchema), async (c) => {
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
      ),
      binding.refreshToken,
      cloudCheckoutResponseSchema,
    )
    if ('error' in result) return c.json(result, 502)
    return c.json({ checkoutUrl: result.checkoutUrl })
  })
  .post('/redemptions', zValidator('json', redemptionInputSchema), async (c) => {
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
      '/api/store/redemptions',
      await createRedemptionPayload(c, binding.boundLicenseId, body.code, body.targetOrgId, c.get('userId')!),
      binding.refreshToken,
      cloudRedemptionResponseSchema,
    )
    if ('error' in result) return c.json(result, 502)
    return c.json(result)
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
      ),
      binding.refreshToken,
      cloudCheckoutResponseSchema,
    )
    if ('error' in result) return c.json(result, 502)
    return c.json({ checkoutUrl: result.checkoutUrl })
  })
  .get('/grants', async (c) => {
    const db = c.get('platform').db
    const store = await getUserStoreSettings(db)
    if ('error' in store) return c.json({ error: store.error }, 403)
    const targets = await getAccessibleTargets(db, c.get('userId')!)
    if (targets.length === 0) return c.json({ items: [], total: 0 })
    const result = await getCloud(
      c,
      quotaGrantsPath(targets.map((target) => target.orgId)),
      cloudQuotaGrantsResponseSchema,
    )
    if ('error' in result) return c.json(result, 502)
    const accessibleOrgIds = new Set(targets.map((target) => target.orgId))
    const items = result.filter((grant) => accessibleOrgIds.has(grant.orgId))
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

  const parsed = cloudDeliveryEventSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: 'invalid_payload' }, 400)
  if (parsed.data.eventId !== eventAuth.eventId) return c.json({ error: 'invalid_event_token' }, 401)

  try {
    const result = await processCloudDelivery(db, parsed.data, rawPayload, payloadHash)
    return c.json({ success: true, duplicate: result.duplicate, eventId: result.eventId })
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400)
  }
})

export { adminQuotaStore, quotaStore, quotaStoreWebhooks }
