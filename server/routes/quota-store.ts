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
  getUserTerminalLabel,
  listGrantsForUser,
  listQuotaStorePackages,
  markPackageSynced,
  processCloudDelivery,
  updateQuotaStorePackage,
  upsertQuotaStoreSettings,
} from '../services/quota-store'

const cloudCheckoutResponseSchema = z
  .object({ orderId: z.string().min(1), url: z.string().url() })
  .transform((value) => ({ checkoutUrl: value.url }))
const cloudPackageSyncResponseSchema = z.object({
  packages: z.array(z.object({ id: z.string().min(1), externalPackageId: z.string().min(1) }).passthrough()),
})
const cloudRedemptionResponseSchema = z.object({ ok: z.boolean() }).passthrough()

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
    const synced = await syncPackages(db, pkg.id)
    return c.json(synced, synced.syncStatus === 'failed' ? 202 : 201)
  })
  .put('/packages/:id', zValidator('json', quotaStorePackageInputSchema), async (c) => {
    const db = c.get('platform').db
    const pkg = await updateQuotaStorePackage(db, c.req.param('id'), c.req.valid('json'))
    if (!pkg) return c.json({ error: 'Package not found' }, 404)
    const synced = await syncPackages(db, pkg.id)
    return c.json(synced)
  })
  .delete('/packages/:id', async (c) => {
    const db = c.get('platform').db
    const id = c.req.param('id')
    const pkg = await getQuotaStorePackage(db, id)
    if (!pkg) return c.json({ error: 'Package not found' }, 404)

    const syncError = await syncCatalog(db, id)
    if (syncError) return c.json({ error: syncError }, 502)

    const deleted = await deleteQuotaStorePackage(db, id)
    if (!deleted) return c.json({ error: 'Package not found' }, 404)
    return c.json({ id, deleted: true })
  })

const quotaStore = new Hono<Env>()
  .use(requireAuth)
  .use(requireFeature('quota_store'))
  .get('/packages', async (c) => {
    const items = await listQuotaStorePackages(c.get('platform').db, true)
    return c.json({ items, total: items.length })
  })
  .get('/targets', async (c) => {
    const items = await getAccessibleTargets(c.get('platform').db, c.get('userId')!)
    return c.json({ items, total: items.length })
  })
  .post('/checkout', zValidator('json', checkoutInputSchema), async (c) => {
    const body = c.req.valid('json')
    const db = c.get('platform').db
    if (!(await canAccessTargetOrg(db, c.get('userId')!, body.targetOrgId))) {
      return c.json({ error: 'Forbidden' }, 403)
    }

    const settings = await getRequiredSettings(db)
    const pkg = await getActiveQuotaStorePackage(db, body.packageId)
    if (!pkg) return c.json({ error: 'Package not found' }, 404)
    const result = await postUserCloud(
      settings,
      '/api/store/checkout',
      { session: await createCheckoutSession(db, settings, pkg, body.targetOrgId, c.get('userId')!) },
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

    const settings = await getRequiredSettings(db)
    const result = await postUserCloud(
      settings,
      '/api/store/redemptions',
      {
        code: body.code,
        session: await createRedemptionSession(db, body.targetOrgId, c.get('userId')!),
      },
      cloudRedemptionResponseSchema,
    )
    if ('error' in result) return c.json(result, 502)
    return c.json(result)
  })
  .get('/grants', async (c) => {
    const items = await listGrantsForUser(c.get('platform').db, c.get('userId')!)
    return c.json({ items, total: items.length })
  })

const quotaStoreWebhooks = new Hono<Env>().use(requireFeature('quota_store')).post('/cloud', async (c) => {
  const db = c.get('platform').db
  const settings = await getRequiredSettings(db)
  const rawPayload = await c.req.text()
  const timestamp = c.req.header('x-zpan-cloud-timestamp') ?? ''
  const signature = c.req.header('x-zpan-cloud-signature') ?? ''
  if (!(await verifyTimestampedSignature(rawPayload, timestamp, settings.webhookSigningSecret, signature))) {
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

async function syncPackages(db: Parameters<typeof markPackageSynced>[0], packageId: string) {
  try {
    const result = await syncCatalog(db)
    if (result) return markPackageSynced(db, packageId, { error: result })
    return (await getQuotaStorePackage(db, packageId))!
  } catch (error) {
    return markPackageSynced(db, packageId, { error: (error as Error).message })
  }
}

async function syncCatalog(db: Parameters<typeof markPackageSynced>[0], excludingPackageId?: string) {
  try {
    const settings = await getRequiredSettings(db)
    const binding = await getCloudStoreBinding(db)
    const packages = (await listQuotaStorePackages(db)).filter((pkg) => pkg.id !== excludingPackageId)
    const result = await postStoreSignedCloud(
      settings.cloudBaseUrl,
      '/api/store/packages/sync',
      binding.sharedSecret,
      {
        boundLicenseId: binding.boundLicenseId,
        callbackUrl: `${settings.publicInstanceUrl}/api/quota-store/webhooks/cloud`,
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
  settings: Awaited<ReturnType<typeof getRequiredSettings>>,
  path: string,
  payload: object,
  responseSchema: z.ZodType<T, z.ZodTypeDef, unknown>,
) {
  try {
    return await postCloudJson(settings.cloudBaseUrl, path, payload, responseSchema)
  } catch (error) {
    return { error: (error as Error).message }
  }
}

async function postCloudJson<T>(
  baseUrl: string,
  path: string,
  payload: object,
  responseSchema: z.ZodType<T, z.ZodTypeDef, unknown>,
): Promise<T> {
  const body = JSON.stringify(payload)
  const res = await fetch(new URL(path, baseUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  })
  const data = await readCloudJson(res)
  if (!res.ok) throw new Error(readCloudError(data) ?? `cloud_request_failed_${res.status}`)
  return parseCloudResponse(data, responseSchema)
}

async function postStoreSignedCloud<T>(
  baseUrl: string,
  path: string,
  secret: string,
  payload: object,
  responseSchema: z.ZodType<T, z.ZodTypeDef, unknown>,
): Promise<T> {
  const body = JSON.stringify(payload)
  const timestamp = String(Date.now())
  const res = await fetch(new URL(path, baseUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-zpan-store-timestamp': timestamp,
      'x-zpan-store-signature': await signTimestampedPayload(body, timestamp, secret),
    },
    body,
  })
  const data = await readCloudJson(res)
  if (!res.ok) throw new Error(readCloudError(data) ?? `cloud_request_failed_${res.status}`)
  return parseCloudResponse(data, responseSchema)
}

async function readCloudJson(res: Response): Promise<unknown> {
  try {
    return await res.json()
  } catch {
    return {}
  }
}

function readCloudError(data: unknown): string | null {
  if (!data || typeof data !== 'object' || !('error' in data)) return null
  return typeof data.error === 'string' ? data.error : null
}

function parseCloudResponse<T>(data: unknown, schema: z.ZodType<T, z.ZodTypeDef, unknown>): T {
  const parsed = schema.safeParse(data)
  if (!parsed.success) throw new Error('invalid_cloud_response')
  return parsed.data
}

async function signPayload(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = await crypto.subtle.sign('HMAC', key, encode(payload))
  return hex(signature)
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
  if (!Number.isInteger(requestTime) || Math.abs(Date.now() - requestTime) > 5 * 60 * 1000) return false
  const expected = hexToBytes(await signTimestampedPayload(payload, timestamp, secret))
  const received = hexToBytes(signature)
  if (!expected || !received || received.length !== expected.length) return false
  return timingSafeEqual(received, expected)
}

async function createCheckoutSession(
  db: Parameters<typeof getCloudStoreBinding>[0],
  settings: Awaited<ReturnType<typeof getRequiredSettings>>,
  pkg: QuotaStorePackage,
  targetOrgId: string,
  userId: string,
): Promise<string> {
  const binding = await getCloudStoreBinding(db)
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
      successUrl: `${settings.publicInstanceUrl}/quota-store/checkout/success`,
      cancelUrl: `${settings.publicInstanceUrl}/quota-store/checkout/cancel`,
      expiresAt: sessionExpiry(),
    },
    binding.sharedSecret,
  )
}

async function createRedemptionSession(
  db: Parameters<typeof getCloudStoreBinding>[0],
  targetOrgId: string,
  userId: string,
): Promise<string> {
  const binding = await getCloudStoreBinding(db)
  return signStorageSession(
    {
      boundLicenseId: binding.boundLicenseId,
      targetOrgId,
      terminalUserId: userId,
      terminalUserLabel: await getUserTerminalLabel(db, userId),
      expiresAt: sessionExpiry(),
    },
    binding.sharedSecret,
  )
}

async function signStorageSession(payload: object, secret: string): Promise<string> {
  const encoded = base64Url(JSON.stringify(payload))
  return `${encoded}.${await signPayload(encoded, secret)}`
}

function sessionExpiry(): string {
  return new Date(Date.now() + 15 * 60 * 1000).toISOString()
}

function base64Url(value: string): string {
  const bytes = new TextEncoder().encode(value)
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
  return hex(await crypto.subtle.digest('SHA-256', encode(payload)))
}

function encode(value: string): ArrayBuffer {
  return new TextEncoder().encode(value).buffer as ArrayBuffer
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
