import { zValidator } from '@hono/zod-validator'
import {
  checkoutInputSchema,
  cloudDeliveryEventSchema,
  quotaStorePackageInputSchema,
  quotaStoreSettingsSchema,
  redemptionInputSchema,
} from '@shared/schemas'
import type { QuotaStorePackage } from '@shared/types'
import { Hono } from 'hono'
import { z } from 'zod'
import { ZPAN_CLOUD_URL_DEFAULT } from '../../shared/constants'
import { requireAdmin, requireAuth } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import { requireFeature } from '../middleware/require-feature'
import { postBoundCloudJson } from '../services/licensing-cloud'
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
  getUserTerminalLabel,
  listGrantsForUser,
  listQuotaStorePackages,
  markPackageSynced,
  processCloudDelivery,
  updateQuotaStorePackage,
  upsertQuotaStoreSettings,
} from '../services/quota-store'

type RouteContext = {
  get(key: 'platform'): Env['Variables']['platform']
  req: { url: string; header(name: string): string | undefined }
}

const cloudCheckoutResponseSchema = z
  .object({ orderId: z.string().min(1), url: z.string().url() })
  .transform((value) => ({ checkoutUrl: value.url }))
const cloudPackageSyncResponseSchema = z.object({
  packages: z.array(z.object({ id: z.string().min(1), externalPackageId: z.string().min(1) }).passthrough()),
})
const cloudRedemptionResponseSchema = z.object({ ok: z.boolean() }).passthrough()
const MAX_SIGNATURE_SKEW_MS = 5 * 60 * 1000

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
    const result = await postUserCloud(
      c,
      '/api/store/checkout',
      { session: await createCheckoutSession(c, pkg, body.targetOrgId, c.get('userId')!) },
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
    const result = await postUserCloud(
      c,
      '/api/store/redemptions',
      {
        code: body.code,
        session: await createRedemptionSession(c, body.targetOrgId, c.get('userId')!),
      },
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
  const timestamp = c.req.header('x-zpan-cloud-timestamp') ?? ''
  const signature = c.req.header('x-zpan-cloud-signature') ?? ''
  if (!(await verifyTimestampedSignature(rawPayload, timestamp, binding.storeKey, signature))) {
    return c.json({ error: 'invalid_signature' }, 401)
  }

  const body = parseJson(rawPayload)
  if (!body) return c.json({ error: 'invalid_payload' }, 400)

  const parsed = cloudDeliveryEventSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: 'invalid_payload' }, 400)

  try {
    const result = await processCloudDelivery(db, parsed.data, rawPayload, await sha256Hex(rawPayload))
    return c.json({ success: true, duplicate: result.duplicate, grantId: result.grantId })
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400)
  }
})

export { adminQuotaStore, quotaStore, quotaStoreWebhooks }

async function getUserStoreSettings(db: Parameters<typeof getRequiredSettings>[0]) {
  try {
    await getRequiredSettings(db)
    await getCloudStoreBinding(db)
    return { ready: true }
  } catch (error) {
    const message = (error as Error).message
    if (message === 'quota_store_disabled' || message === 'quota_store_binding_missing') {
      return { error: message }
    }
    throw error
  }
}

async function syncPackages(c: RouteContext, packageId: string) {
  const db = c.get('platform').db
  try {
    const result = await syncCatalog(c)
    if (result) return markPackageSynced(db, packageId, { error: result })
    return (await getQuotaStorePackage(db, packageId))!
  } catch (error) {
    return markPackageSynced(db, packageId, { error: (error as Error).message })
  }
}

async function syncCatalog(c: RouteContext, excludingPackageId?: string) {
  const db = c.get('platform').db
  try {
    await getRequiredSettings(db)
    const binding = await getCloudStoreBinding(db)
    const packages = (await listQuotaStorePackages(db)).filter((pkg) => pkg.id !== excludingPackageId)
    const result = await postCloud(
      getCloudBaseUrl(c),
      '/api/store/packages/sync',
      binding.refreshToken,
      {
        boundLicenseId: binding.boundLicenseId,
        packages: packages.map(cloudPackagePayload),
      },
      cloudPackageSyncResponseSchema,
    )
    await markSyncedPackages(db, result.packages)
    return null
  } catch (error) {
    return (error as Error).message
  }
}

async function postUserCloud<T>(
  c: RouteContext,
  path: string,
  payload: object,
  responseSchema: z.ZodType<T, z.ZodTypeDef, unknown>,
) {
  try {
    const binding = await getCloudStoreBinding(c.get('platform').db)
    return await postCloud(getCloudBaseUrl(c), path, binding.refreshToken, payload, responseSchema)
  } catch (error) {
    return { error: (error as Error).message }
  }
}

async function postCloud<T>(
  baseUrl: string,
  path: string,
  refreshToken: string,
  payload: object,
  responseSchema: z.ZodType<T, z.ZodTypeDef, unknown>,
): Promise<T> {
  const data = await postBoundCloudJson(baseUrl, path, refreshToken, payload)
  return parseCloudResponse(data, responseSchema)
}

function parseCloudResponse<T>(data: unknown, schema: z.ZodType<T, z.ZodTypeDef, unknown>): T {
  const parsed = schema.safeParse(data)
  if (!parsed.success) throw new Error('invalid_cloud_response')
  return parsed.data
}

async function createCheckoutSession(
  c: RouteContext,
  pkg: QuotaStorePackage,
  targetOrgId: string,
  userId: string,
): Promise<string> {
  const db = c.get('platform').db
  const binding = await getCloudStoreBinding(db)
  const origin = getInstanceOrigin(c)
  return signStorageSession(
    {
      boundLicenseId: binding.boundLicenseId,
      externalPackageId: pkg.id,
      targetOrgId,
      terminalUserId: userId,
      terminalUserLabel: await getUserTerminalLabel(db, userId),
      amount: pkg.amount,
      currency: pkg.currency,
      bytes: pkg.bytes,
      successUrl: `${origin}/store`,
      cancelUrl: `${origin}/store`,
      expiresAt: sessionExpiry(),
    },
    binding.storeKey,
  )
}

async function createRedemptionSession(
  c: { get(key: 'platform'): Env['Variables']['platform'] },
  targetOrgId: string,
  userId: string,
): Promise<string> {
  const db = c.get('platform').db
  const binding = await getCloudStoreBinding(db)
  return signStorageSession(
    {
      boundLicenseId: binding.boundLicenseId,
      targetOrgId,
      terminalUserId: userId,
      terminalUserLabel: await getUserTerminalLabel(db, userId),
      expiresAt: sessionExpiry(),
    },
    binding.storeKey,
  )
}

function sessionExpiry(): string {
  return new Date(Date.now() + 15 * 60 * 1000).toISOString()
}

async function signStorageSession(payload: object, secret: string): Promise<string> {
  const encoded = base64Url(JSON.stringify(payload))
  return `${encoded}.${await signPayload(encoded, secret)}`
}

async function signPayload(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encodeBuffer(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ])
  return hex(await crypto.subtle.sign('HMAC', key, encodeBuffer(payload)))
}

async function signTimestampedPayload(payload: string, timestamp: string, secret: string): Promise<string> {
  return signPayload(`${timestamp}.${payload}`, secret)
}

async function verifyTimestampedSignature(
  payload: string,
  timestamp: string,
  secret: string,
  signature: string,
): Promise<boolean> {
  const requestTime = Number(timestamp)
  if (!Number.isInteger(requestTime) || Math.abs(Date.now() - requestTime) > MAX_SIGNATURE_SKEW_MS) return false
  const expected = hexToBytes(await signTimestampedPayload(payload, timestamp, secret))
  const received = hexToBytes(signature)
  if (!expected || !received || received.length !== expected.length) return false
  return timingSafeEqual(received, expected)
}

function base64Url(value: string): string {
  const bytes = encodeBytes(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function cloudPackagePayload(pkg: QuotaStorePackage) {
  return {
    id: pkg.id,
    name: pkg.name,
    description: pkg.description || null,
    bytes: pkg.bytes,
    amount: pkg.amount,
    currency: pkg.currency,
    active: pkg.active,
    sortOrder: pkg.sortOrder,
  }
}

async function markSyncedPackages(
  db: Parameters<typeof markPackageSynced>[0],
  packages: Array<{ id: string; externalPackageId: string }>,
) {
  const localPackageIds = new Set((await listQuotaStorePackages(db)).map((pkg) => pkg.id))
  for (const pkg of packages) {
    if (localPackageIds.has(pkg.externalPackageId)) {
      await markPackageSynced(db, pkg.externalPackageId, { cloudPackageId: pkg.id })
    }
  }
}

function parseJson(payload: string): unknown | null {
  try {
    return JSON.parse(payload) as unknown
  } catch {
    return null
  }
}

async function sha256Hex(payload: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', encodeBytes(payload).buffer as ArrayBuffer))
}

function encodeBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

function encodeBuffer(value: string): ArrayBuffer {
  const bytes = encodeBytes(value)
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function hexToBytes(value: string): Uint8Array | null {
  if (!/^[0-9a-f]+$/i.test(value) || value.length % 2 !== 0) return null
  const bytes = new Uint8Array(value.length / 2)
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  let diff = 0
  for (let i = 0; i < a.length; i += 1) {
    diff |= a[i] ^ b[i]
  }
  return diff === 0
}

function getCloudBaseUrl(c: { get(key: 'platform'): { getEnv(k: string): string | undefined } }): string {
  return c.get('platform').getEnv('ZPAN_CLOUD_URL') ?? ZPAN_CLOUD_URL_DEFAULT
}

function getInstanceOrigin(c: RouteContext): string {
  const configuredOrigin = publicOriginFromEnv(
    c.get('platform').getEnv('ZPAN_PUBLIC_ORIGIN') ?? c.get('platform').getEnv('BETTER_AUTH_URL'),
  )
  if (configuredOrigin) return configuredOrigin

  const requestUrl = new URL(c.req.url)
  if (requestUrl.protocol === 'https:' || isLocalHost(requestUrl.hostname)) return requestUrl.origin
  return `https://${requestUrl.host}`
}

function publicOriginFromEnv(value: string | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.origin
  } catch {
    return null
  }
}

function isLocalHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}
