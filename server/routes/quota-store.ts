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
  getQuotaStorePackage,
  getQuotaStoreSettings,
  getRequiredSettings,
  listGrantsForUser,
  listQuotaStorePackages,
  markPackageSynced,
  processCloudDelivery,
  updateQuotaStorePackage,
  upsertQuotaStoreSettings,
} from '../services/quota-store'

const cloudCheckoutResponseSchema = z.object({ checkoutUrl: z.string().url() })
const cloudPackageSyncResponseSchema = z.object({ cloudPackageId: z.string().min(1) })
const cloudRedemptionResponseSchema = z.object({ checkoutUrl: z.string().url() }).passthrough()

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
    const synced = await syncPackage(db, pkg, 'upsert')
    return c.json(synced, synced.syncStatus === 'failed' ? 202 : 201)
  })
  .put('/packages/:id', zValidator('json', quotaStorePackageInputSchema), async (c) => {
    const db = c.get('platform').db
    const pkg = await updateQuotaStorePackage(db, c.req.param('id'), c.req.valid('json'))
    if (!pkg) return c.json({ error: 'Package not found' }, 404)
    const synced = await syncPackage(db, pkg, 'upsert')
    return c.json(synced)
  })
  .delete('/packages/:id', async (c) => {
    const db = c.get('platform').db
    const id = c.req.param('id')
    const pkg = await getQuotaStorePackage(db, id)
    if (!pkg) return c.json({ error: 'Package not found' }, 404)

    const syncError = await syncPackageDelete(db, pkg)
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
    const result = await postUserCloud(
      settings,
      '/api/quota-store/checkout',
      {
        ...body,
        callbackUrl: `${settings.publicInstanceUrl}/api/quota-store/webhooks/cloud`,
        userId: c.get('userId'),
      },
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
      '/api/quota-store/redemptions',
      {
        ...body,
        callbackUrl: `${settings.publicInstanceUrl}/api/quota-store/webhooks/cloud`,
        userId: c.get('userId'),
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
  const signature = c.req.header('x-zpan-signature') ?? ''
  if (!(await verifySignature(rawPayload, settings.webhookSigningSecret, signature))) {
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

async function syncPackage(db: Parameters<typeof markPackageSynced>[0], pkg: QuotaStorePackage, action: 'upsert') {
  try {
    const settings = await getRequiredSettings(db)
    const result = await postSignedCloud(
      settings.cloudBaseUrl,
      '/api/quota-store/packages',
      settings.webhookSigningSecret,
      {
        action,
        package: pkg,
      },
      cloudPackageSyncResponseSchema,
    )
    return markPackageSynced(db, pkg.id, { cloudPackageId: result.cloudPackageId })
  } catch (error) {
    return markPackageSynced(db, pkg.id, { error: (error as Error).message })
  }
}

async function syncPackageDelete(db: Parameters<typeof markPackageSynced>[0], pkg: QuotaStorePackage) {
  try {
    const settings = await getRequiredSettings(db)
    await postSignedCloud(
      settings.cloudBaseUrl,
      '/api/quota-store/packages',
      settings.webhookSigningSecret,
      {
        action: 'delete',
        package: pkg,
      },
      z.unknown(),
    )
    return null
  } catch (error) {
    return (error as Error).message
  }
}

async function postUserCloud<T>(
  settings: Awaited<ReturnType<typeof getRequiredSettings>>,
  path: string,
  payload: object,
  responseSchema: z.ZodType<T>,
) {
  try {
    return await postSignedCloud(settings.cloudBaseUrl, path, settings.webhookSigningSecret, payload, responseSchema)
  } catch (error) {
    return { error: (error as Error).message }
  }
}

async function postSignedCloud<T>(
  baseUrl: string,
  path: string,
  secret: string,
  payload: object,
  responseSchema: z.ZodType<T>,
): Promise<T> {
  const body = JSON.stringify(payload)
  const res = await fetch(new URL(path, baseUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-zpan-signature': await signPayload(body, secret) },
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

function parseCloudResponse<T>(data: unknown, schema: z.ZodType<T>): T {
  const parsed = schema.safeParse(data)
  if (!parsed.success) throw new Error('invalid_cloud_response')
  return parsed.data
}

async function signPayload(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = await crypto.subtle.sign('HMAC', key, encode(payload))
  return hex(signature)
}

async function verifySignature(payload: string, secret: string, signature: string): Promise<boolean> {
  const expected = hexToBytes(await signPayload(payload, secret))
  const received = hexToBytes(signature)
  if (!expected || !received || received.length !== expected.length) return false
  return timingSafeEqual(received, expected)
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
