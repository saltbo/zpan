import { giftCardStatusSchema } from '@shared/schemas'
import { z } from 'zod'
import { ZPAN_CLOUD_URL_DEFAULT } from '../../shared/constants'
import type { Env } from '../middleware/platform'
import { requestBoundCloudJson } from '../services/licensing-cloud'
import { getCloudStoreBinding, getRequiredSettings, getUserTerminalLabel } from '../services/quota-store'

export type RouteContext = {
  get(key: 'platform'): Env['Variables']['platform']
  req: { url: string; header(name: string): string | undefined }
}

type CloudPath = string | ((storeId: string) => string)

export const cloudCheckoutResponseSchema = z
  .object({ orderId: z.string().min(1), url: z.string().url() })
  .or(z.object({ paymentId: z.string().min(1).optional(), orderId: z.string().min(1), url: z.string().url() }))
  .transform((value) => ({ checkoutUrl: value.url }))

const cloudPackageAmountSchema = z
  .union([z.number(), z.string()])
  .transform((value) => (typeof value === 'string' ? Number(value) : value))
  .pipe(z.number().int().positive())
const cloudPackageResourceSchema = z
  .union([z.number(), z.string()])
  .transform((value) => (typeof value === 'string' ? Number(value) : value))
  .pipe(z.number().int().min(0))
const cloudPackageSortOrderSchema = z.preprocess(
  (value) => (typeof value === 'string' ? Number(value) : value),
  z.number().int().default(0),
)

const cloudPackagePriceSchema = z.union([
  z.object({
    id: z.string().min(1).optional(),
    currency: z.string().min(1),
    amount: cloudPackageAmountSchema,
  }),
  z
    .object({
      id: z.string().min(1).optional(),
      currency: z.string().min(1),
      unit_amount: cloudPackageAmountSchema,
    })
    .transform((price) => ({ id: price.id, currency: price.currency, amount: price.unit_amount })),
])

const cloudPackageSchema = z.preprocess(
  (value) => {
    if (typeof value !== 'object' || value === null) return value
    const pkg = value as Record<string, unknown>
    const resourceType = pkg.resourceType ?? pkg.resource_type
    const resourceBytes = pkg.resourceBytes ?? pkg.resource_bytes
    const metadata = valueToRecord(pkg.metadata)
    const metadataStorageBytes = metadata.storageBytes ?? metadata.storage_bytes
    const metadataTrafficBytes = metadata.trafficBytes ?? metadata.traffic_bytes

    return {
      ...pkg,
      type: pkg.type ?? 'zpan_quota',
      storageBytes:
        pkg.storageBytes ??
        pkg.storage_bytes ??
        (resourceType === 'storage' ? resourceBytes : undefined) ??
        metadataStorageBytes,
      trafficBytes:
        pkg.trafficBytes ??
        pkg.traffic_bytes ??
        (resourceType === 'traffic' ? resourceBytes : undefined) ??
        metadataTrafficBytes,
      sortOrder: pkg.sortOrder ?? pkg.sort_order,
      createdAt: pkg.createdAt ?? pkg.created_at,
      updatedAt: pkg.updatedAt ?? pkg.updated_at,
    }
  },
  z
    .object({
      id: z.string().min(1),
      type: z.literal('zpan_quota'),
      name: z.string().min(1),
      description: z.string().nullable().optional(),
      storageBytes: cloudPackageResourceSchema.optional(),
      trafficBytes: cloudPackageResourceSchema.optional(),
      prices: z.array(cloudPackagePriceSchema).min(1),
      active: z.boolean().default(true),
      sortOrder: cloudPackageSortOrderSchema,
      createdAt: z.string().min(1),
      updatedAt: z.string().min(1),
    })
    .superRefine((pkg, ctx) => {
      const storageBytes = pkg.storageBytes ?? 0
      const trafficBytes = pkg.trafficBytes ?? 0
      if (storageBytes <= 0 && trafficBytes <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['storageBytes'],
          message: 'At least one of storageBytes or trafficBytes must be greater than 0',
        })
      }
    })
    .transform((pkg) => ({
      id: pkg.id,
      name: pkg.name,
      description: pkg.description ?? '',
      storageBytes: pkg.storageBytes ?? 0,
      trafficBytes: pkg.trafficBytes ?? 0,
      prices: pkg.prices.map((price) => ({ currency: price.currency, amount: price.amount })),
      active: pkg.active,
      sortOrder: pkg.sortOrder,
      createdAt: pkg.createdAt,
      updatedAt: pkg.updatedAt,
    })),
)
export const cloudPackageResponseSchema = cloudPackageSchema
export const cloudPackageListResponseSchema = z.union([
  z.array(cloudPackageSchema).transform((items) => ({ items, total: items.length })),
  z.object({ items: z.array(cloudPackageSchema), total: z.number().int().min(0).optional() }).transform((result) => ({
    items: result.items,
    total: result.total ?? result.items.length,
  })),
])
const cloudOrderSchema = z
  .object({
    id: z.string().min(1),
    target: z.record(z.string(), z.unknown()).nullable().default(null),
    paymentStatus: z.enum(['unpaid', 'pending', 'paid', 'failed', 'refunded', 'canceled']),
    fulfillmentStatus: z.enum(['pending', 'fulfilled', 'failed', 'canceled']),
    subtotalAmount: z.number().int().min(0),
    discountAmount: z.number().int().min(0),
    totalAmount: z.number().int().min(0),
    currency: z.string().min(1),
    items: z
      .array(
        z.object({
          name: z.string().min(1),
          description: z.string().nullable().default(null),
          fulfillmentPayload: z.record(z.string(), z.unknown()),
        }),
      )
      .min(1),
    payments: z
      .array(
        z.object({
          provider: z.string().min(1),
          providerSessionId: z.string().nullable().default(null),
          providerPaymentIntentId: z.string().nullable().default(null),
        }),
      )
      .optional(),
    createdAt: z.string().min(1),
    paidAt: z.string().nullable().default(null),
    fulfilledAt: z.string().nullable().default(null),
  })
  .transform((order) => {
    const item = order.items[0]
    const payment = order.payments?.find((candidate) => candidate.provider === 'stripe') ?? null
    const target = order.target ?? {}
    const payload = item.fulfillmentPayload
    const storageBytes = typeof payload.storageBytes === 'number' ? payload.storageBytes : 0
    const trafficBytes = typeof payload.trafficBytes === 'number' ? payload.trafficBytes : 0
    return {
      id: order.id,
      orgId: typeof target.orgId === 'string' ? target.orgId : '',
      packageName: item.name,
      packageDescription: item.description,
      storageBytes,
      trafficBytes,
      subtotalAmount: order.subtotalAmount,
      giftCardAmount: order.discountAmount,
      stripeAmount: order.totalAmount,
      paidAmount: order.paymentStatus === 'paid' ? order.subtotalAmount : 0,
      currency: order.currency,
      giftCardId: null,
      stripeSessionId: payment?.providerSessionId ?? null,
      stripePaymentIntentId: payment?.providerPaymentIntentId ?? null,
      paymentStatus:
        order.paymentStatus === 'unpaid' || order.paymentStatus === 'failed' ? 'pending' : order.paymentStatus,
      fulfillmentStatus:
        order.fulfillmentStatus === 'fulfilled'
          ? 'delivered'
          : order.fulfillmentStatus === 'canceled'
            ? 'failed'
            : order.fulfillmentStatus,
      terminalUserId: typeof target.endUserId === 'string' ? target.endUserId : null,
      terminalUserEmail: typeof target.endUserLabel === 'string' ? target.endUserLabel : null,
      createdAt: order.createdAt,
      paidAt: order.paidAt,
      fulfilledAt: order.fulfilledAt,
    }
  })

export const cloudOrdersResponseSchema = z.union([
  z.array(cloudOrderSchema).transform((items) => ({ items, total: items.length })),
  z.object({ items: z.array(cloudOrderSchema), total: z.number().int().min(0).optional() }).transform((result) => ({
    items: result.items,
    total: result.total ?? result.items.length,
  })),
])

const cloudGiftCardSchema = z.union([
  z.object({
    id: z.string().min(1),
    code: z.string().min(1),
    initialAmount: z.number().int().positive(),
    remainingAmount: z.number().int().min(0),
    currency: z.string().min(1),
    status: z.enum(['created', 'active', 'disabled', 'exhausted', 'expired', 'revoked']),
    expiresAt: z.string().nullable(),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
    disabledAt: z.string().nullable(),
  }),
  z
    .object({
      id: z.string().min(1),
      code: z.string().nullable(),
      initial_amount: z.number().int().positive(),
      remaining_amount: z.number().int().min(0),
      currency: z.string().min(1),
      status: z.enum(['created', 'active', 'disabled', 'exhausted', 'expired', 'revoked']),
      expires_at: z.string().nullable(),
      created_at: z.string().min(1),
      updated_at: z.string().min(1),
      disabled_at: z.string().nullable(),
    })
    .transform((card) => ({
      id: card.id,
      code: card.code ?? '',
      initialAmount: card.initial_amount,
      remainingAmount: card.remaining_amount,
      currency: card.currency,
      status: card.status,
      expiresAt: card.expires_at,
      createdAt: card.created_at,
      updatedAt: card.updated_at,
      disabledAt: card.disabled_at,
    })),
])

export const cloudGiftCardsResponseSchema = z.union([
  z.array(cloudGiftCardSchema).transform((items) => ({ items, total: items.length })),
  z.object({ items: z.array(cloudGiftCardSchema), total: z.number().int().min(0).optional() }).transform((result) => ({
    items: result.items,
    total: result.total ?? result.items.length,
  })),
])
export const giftCardListQuerySchema = z.object({ status: giftCardStatusSchema.optional() })

export async function getUserStoreSettings(db: Parameters<typeof getRequiredSettings>[0]) {
  try {
    await getRequiredSettings(db)
    await getCloudStoreBinding(db)
    return { ready: true }
  } catch (error) {
    const message = (error as Error).message
    if (message === 'quota_store_disabled' || message === 'quota_store_binding_missing') return { error: message }
    throw error
  }
}

export async function patchCloudWithBinding<T>(
  c: RouteContext,
  path: CloudPath,
  payload: object,
  responseSchema: z.ZodType<T, z.ZodTypeDef, unknown>,
) {
  return requestCloudWithBinding(c, path, 'PATCH', responseSchema, payload)
}

export async function postCloudWithBinding<T>(
  c: RouteContext,
  path: CloudPath,
  payload: object,
  responseSchema: z.ZodType<T, z.ZodTypeDef, unknown>,
) {
  return requestCloudWithBinding(c, path, 'POST', responseSchema, payload)
}

export async function requestCloudWithBinding<T>(
  c: RouteContext,
  path: CloudPath,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  responseSchema: z.ZodType<T, z.ZodTypeDef, unknown>,
  payload?: object,
) {
  try {
    const binding = await getCloudStoreBinding(c.get('platform').db)
    const data = await requestBoundCloudJson(
      getCloudBaseUrl(c),
      resolveCloudPath(path, binding.storeId),
      binding.refreshToken,
      { method, payload },
    )
    return parseCloudResponse(data, responseSchema)
  } catch (error) {
    return { error: (error as Error).message }
  }
}

export async function getCloud<T>(
  c: RouteContext,
  path: CloudPath,
  responseSchema: z.ZodType<T, z.ZodTypeDef, unknown>,
) {
  return requestCloudWithBinding(c, path, 'GET', responseSchema)
}

export async function deleteCloud(c: RouteContext, path: CloudPath) {
  try {
    const binding = await getCloudStoreBinding(c.get('platform').db)
    await requestBoundCloudJson(getCloudBaseUrl(c), resolveCloudPath(path, binding.storeId), binding.refreshToken, {
      method: 'DELETE',
    })
    return null
  } catch (error) {
    return { error: (error as Error).message }
  }
}

export function giftCardsPath(status?: z.infer<typeof giftCardStatusSchema>) {
  return (storeId: string) => {
    const path = `/api/stores/${encodeURIComponent(storeId)}/gift-cards`
    if (!status) return path
    return `${path}?status=${encodeURIComponent(status)}`
  }
}

export function packagesPath(packageId?: string) {
  return (storeId: string) => {
    const path = `/api/stores/${encodeURIComponent(storeId)}/products`
    if (!packageId) return `${path}?type=zpan_quota&limit=100`
    return `${path}/${encodeURIComponent(packageId)}`
  }
}

export function ordersPath(options: { limit?: number; offset?: number; endUserId?: string } = {}) {
  return (storeId: string) => {
    const path = `/api/stores/${encodeURIComponent(storeId)}/orders`
    const search = new URLSearchParams()
    if (options.limit !== undefined) search.set('limit', String(options.limit))
    if (options.offset !== undefined) search.set('offset', String(options.offset))
    if (options.endUserId) search.set('endUserId', options.endUserId)
    const query = search.toString()
    return query ? `${path}?${query}` : path
  }
}

export async function createOrderPayload(
  c: RouteContext,
  packageId: string,
  targetOrgId: string,
  userId: string,
  currency?: string,
) {
  return {
    items: [{ productId: packageId }],
    currency: currency ?? 'usd',
    target: {
      orgId: targetOrgId,
      endUserId: userId,
      endUserLabel: await getUserTerminalLabel(c.get('platform').db, userId),
    },
    walletCreditAmount: 'max' as const,
  }
}

export function createPaymentPayload(c: RouteContext) {
  const origin = getInstanceOrigin(c)
  return {
    provider: 'stripe',
    successUrl: `${origin}/storage`,
    cancelUrl: `${origin}/storage`,
  }
}

export function cloudPackagePayload(pkg: {
  name?: string
  description?: string
  storageBytes?: number
  trafficBytes?: number
  prices?: Array<{ currency: string; amount: number }>
  active?: boolean
  sortOrder?: number
}) {
  const includesProductShape =
    pkg.name !== undefined ||
    pkg.prices !== undefined ||
    pkg.storageBytes !== undefined ||
    pkg.trafficBytes !== undefined
  return {
    type: includesProductShape ? ('zpan_quota' as const) : undefined,
    name: pkg.name,
    description: pkg.description,
    active: pkg.active,
    sortOrder: pkg.sortOrder,
    metadata:
      pkg.storageBytes === undefined && pkg.trafficBytes === undefined
        ? undefined
        : {
            storageBytes: pkg.storageBytes ?? 0,
            trafficBytes: pkg.trafficBytes ?? 0,
          },
    prices: pkg.prices,
  }
}

export function parseJson(payload: string): unknown | null {
  try {
    return JSON.parse(payload) as unknown
  } catch {
    return null
  }
}

export async function sha256Hex(payload: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload).buffer as ArrayBuffer))
}

export function getCloudBaseUrl(c: { get(key: 'platform'): { getEnv(k: string): string | undefined } }): string {
  return c.get('platform').getEnv('ZPAN_CLOUD_URL') ?? ZPAN_CLOUD_URL_DEFAULT
}

function valueToRecord(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined || typeof value !== 'object' || Array.isArray(value)) {
    return Object.create(null) as Record<string, unknown>
  }
  return value as Record<string, unknown>
}

function parseCloudResponse<T>(data: unknown, schema: z.ZodType<T, z.ZodTypeDef, unknown>): T {
  const parsed = schema.safeParse(data)
  if (!parsed.success) throw new Error('invalid_cloud_response')
  return parsed.data
}

function resolveCloudPath(path: CloudPath, storeId: string) {
  return typeof path === 'function' ? path(storeId) : path
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

function isLocalHost(hostname: string) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
