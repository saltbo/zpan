import { zValidator } from '@hono/zod-validator'
import {
  checkoutInputSchema,
  cloudDeliveryEventSchema,
  generateStorageCodesInputSchema,
  quotaStorePackageInputSchema,
  quotaStoreSettingsSchema,
  redemptionInputSchema,
} from '@shared/schemas'
import { Hono } from 'hono'
import { verifyCloudEventToken } from '../licensing/cloud-event-token'
import { requireAdmin, requireAuth } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import { requireFeature } from '../middleware/require-feature'
import {
  canAccessTargetOrg,
  createQuotaStorePackage,
  deleteQuotaStorePackage,
  getAccessibleTargets,
  getActiveQuotaStorePackage,
  getCloudStoreBinding,
  getQuotaStorePackage,
  getQuotaStoreSettings,
  getRequiredSettings,
  listGrantsForUser,
  listQuotaGrants,
  listQuotaStorePackages,
  processCloudDelivery,
  updateQuotaStorePackage,
  upsertQuotaStoreSettings,
} from '../services/quota-store'
import {
  cloudCheckoutResponseSchema,
  cloudRedemptionResponseSchema,
  cloudStorageCodesResponseSchema,
  createCheckoutPayload,
  createRedemptionPayload,
  deleteCloud,
  getCloud,
  getCloudBaseUrl,
  getUserStoreSettings,
  parseJson,
  postCloudWithBinding,
  postUserCloud,
  sha256Hex,
  storageCodeListQuerySchema,
  storageCodesPath,
  syncCatalog,
  syncPackages,
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
    const items = await listQuotaStorePackages(c.get('platform').db)
    return c.json({ items, total: items.length })
  })
  .post('/packages', zValidator('json', quotaStorePackageInputSchema), async (c) => {
    const db = c.get('platform').db
    const pkg = await createQuotaStorePackage(db, c.req.valid('json'))
    const synced = await syncPackages(c, pkg.id)
    return c.json(synced, synced.syncStatus === 'failed' ? 202 : 201)
  })
  .put('/packages/:id', zValidator('json', quotaStorePackageInputSchema), async (c) => {
    const db = c.get('platform').db
    const pkg = await updateQuotaStorePackage(db, c.req.param('id'), c.req.valid('json'))
    if (!pkg) return c.json({ error: 'Package not found' }, 404)
    const synced = await syncPackages(c, pkg.id)
    return c.json(synced)
  })
  .delete('/packages/:id', async (c) => {
    const db = c.get('platform').db
    const id = c.req.param('id')
    const pkg = await getQuotaStorePackage(db, id)
    if (!pkg) return c.json({ error: 'Package not found' }, 404)

    const syncError = await syncCatalog(c, id)
    if (syncError) return c.json({ error: syncError }, 502)

    const deleted = await deleteQuotaStorePackage(db, id)
    if (!deleted) return c.json({ error: 'Package not found' }, 404)
    return c.json({ id, deleted: true })
  })
  .post('/sync', async (c) => {
    const syncError = await syncCatalog(c)
    if (syncError) return c.json({ error: syncError }, 502)
    const items = await listQuotaStorePackages(c.get('platform').db)
    return c.json({ items, total: items.length })
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
      '/api/store/storage-codes',
      {
        bytes: body.bytes,
        max_uses: body.maxUses,
        expires_at: body.expiresAt,
        count: body.count,
      },
      cloudStorageCodesResponseSchema,
    )
    if ('error' in result) return c.json(result, 502)
    return c.json({ items: result, total: result.length }, 201)
  })
  .delete('/storage-codes/:code', async (c) => {
    const result = await deleteCloud(c, `/api/store/storage-codes/${encodeURIComponent(c.req.param('code'))}`)
    if (result?.error) return c.json(result, 502)
    return c.json({ code: c.req.param('code'), revoked: true })
  })
  .get('/delivery-records', async (c) => {
    const items = await listQuotaGrants(c.get('platform').db)
    return c.json({ items, total: items.length })
  })

const quotaStore = new Hono<Env>()
  .use(requireAuth)
  .use(requireFeature('quota_store'))
  .get('/packages', async (c) => {
    const db = c.get('platform').db
    const store = await getUserStoreSettings(db)
    if ('error' in store) return c.json({ error: store.error }, 403)
    const items = await listQuotaStorePackages(db, true)
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
    const pkg = await getActiveQuotaStorePackage(db, body.packageId)
    if (!pkg) return c.json({ error: 'Package not found' }, 404)
    const binding = await getCloudStoreBinding(db)
    const result = await postUserCloud(
      c,
      '/api/store/checkout',
      await createCheckoutPayload(c, binding.boundLicenseId, pkg, body.targetOrgId, c.get('userId')!),
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
  .get('/grants', async (c) => {
    const db = c.get('platform').db
    const store = await getUserStoreSettings(db)
    if ('error' in store) return c.json({ error: store.error }, 403)
    const items = await listGrantsForUser(db, c.get('userId')!)
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
    return c.json({ success: true, duplicate: result.duplicate, grantId: result.grantId })
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400)
  }
})

export { adminQuotaStore, quotaStore, quotaStoreWebhooks }
