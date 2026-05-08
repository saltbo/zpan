import { giftCardStatusSchema } from '@shared/schemas'
import { z } from 'zod'
import { ZPAN_CLOUD_URL_DEFAULT } from '../../shared/constants'
import type { Env } from '../middleware/platform'
import { getCloudStoreBinding, getRequiredSettings } from '../services/cloud-store'
import { requestBoundCloudJson } from '../services/licensing-cloud'

export type RouteContext = {
  get(key: 'platform'): Env['Variables']['platform']
  req: { url: string; header(name: string): string | undefined }
}

type CloudPath = string | ((storeId: string) => string)

export const cloudCheckoutResponseSchema = z
  .object({ orderId: z.string().min(1), url: z.string().url() })
  .or(z.object({ paymentId: z.string().min(1).optional(), orderId: z.string().min(1), url: z.string().url() }))

const cloudPackageAmountSchema = z.number().int().positive()
const cloudPackageResourceSchema = z.number().int().min(0)

const cloudPackagePriceSchema = z.object({
  id: z.string().min(1).optional(),
  currency: z.string().min(1),
  amount: cloudPackageAmountSchema,
})

const cloudPackageSchema = z
  .object({
    id: z.string().min(1),
    type: z.literal('zpan_quota'),
    name: z.string().min(1),
    description: z.string().nullable(),
    metadata: z.object({
      storageBytes: cloudPackageResourceSchema,
      trafficBytes: cloudPackageResourceSchema,
    }),
    prices: z.array(cloudPackagePriceSchema).min(1),
    active: z.boolean(),
    sortOrder: z.number().int(),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  })
  .superRefine((pkg, ctx) => {
    if (pkg.metadata.storageBytes <= 0 && pkg.metadata.trafficBytes <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['metadata', 'storageBytes'],
        message: 'At least one of storageBytes or trafficBytes must be greater than 0',
      })
    }
  })
export const cloudPackageResponseSchema = cloudPackageSchema
export const cloudPackageListResponseSchema = z.object({
  items: z.array(cloudPackageSchema),
  total: z.number().int().min(0),
})
const cloudOrderSchema = z.object({
  id: z.string().min(1),
  storeId: z.string().min(1),
  buyerAccountId: z.string().min(1).nullable(),
  target: z.record(z.string(), z.unknown()).nullable().default(null),
  status: z.enum(['pending', 'paid', 'fulfilled', 'failed', 'canceled', 'refunded']),
  paymentStatus: z.enum(['unpaid', 'pending', 'paid', 'failed', 'refunded', 'canceled']),
  fulfillmentStatus: z.enum(['pending', 'fulfilled', 'failed', 'canceled']),
  subtotalAmount: z.number().int().min(0),
  discountAmount: z.number().int().min(0),
  totalAmount: z.number().int().min(0),
  currency: z.string().min(1),
  items: z
    .array(
      z.object({
        id: z.string().min(1),
        orderId: z.string().min(1),
        productId: z.string().min(1),
        productType: z.string().min(1),
        name: z.string().min(1),
        description: z.string().nullable().default(null),
        quantity: z.number().int().positive(),
        unitAmount: z.number().int().min(0),
        totalAmount: z.number().int().min(0),
        fulfillmentPayload: z
          .object({
            storageBytes: z.number().int().min(0).optional(),
            trafficBytes: z.number().int().min(0).optional(),
          })
          .catchall(z.unknown()),
      }),
    )
    .min(1),
  payments: z
    .array(
      z.object({
        id: z.string().min(1),
        orderId: z.string().min(1),
        provider: z.string().min(1),
        amount: z.number().int().min(0),
        currency: z.string().min(1),
        status: z.enum(['pending', 'paid', 'failed', 'refunded', 'canceled']),
        providerSessionId: z.string().nullable().default(null),
        providerPaymentIntentId: z.string().nullable().default(null),
        createdAt: z.string().min(1),
        paidAt: z.string().nullable().default(null),
      }),
    )
    .optional(),
  createdAt: z.string().min(1),
  paidAt: z.string().nullable().default(null),
  fulfilledAt: z.string().nullable().default(null),
  canceledAt: z.string().nullable().default(null),
})

export const cloudOrdersResponseSchema = z.object({
  items: z.array(cloudOrderSchema),
  total: z.number().int().min(0),
})
export const cloudOrdersQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
})
export const cloudStoreOrdersQuerySchema = cloudOrdersQuerySchema

export const cloudGiftCardSchema = z.object({
  id: z.string().min(1),
  storeId: z.string().min(1).nullable().optional(),
  boundLicenseId: z.string().min(1).nullable(),
  code: z.string().min(1),
  amount: z.number().int().min(0),
  currency: z.string().min(1),
  status: z.enum(['created', 'active', 'disabled', 'exhausted', 'expired', 'revoked']),
  expiresAt: z.string().nullable(),
  firstRedeemedAt: z.string().nullable(),
  lastRedeemedAt: z.string().nullable(),
  redemptionCount: z.number().int().min(0),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  disabledAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  createdByAdmin: z.string().min(1),
})

export const cloudGiftCardsResponseSchema = z.object({
  items: z.array(cloudGiftCardSchema),
  total: z.number().int().min(0),
})
export const cloudGiftCardListSchema = z.array(cloudGiftCardSchema)
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

export function packagesPath(options: { packageId?: string; status?: 'active' | 'inactive' } = {}) {
  return (storeId: string) => {
    const path = `/api/stores/${encodeURIComponent(storeId)}/products`
    if (options.packageId) return `${path}/${encodeURIComponent(options.packageId)}`
    const search = new URLSearchParams({ type: 'zpan_quota', limit: '100' })
    if (options.status) search.set('status', options.status)
    return `${path}?${search.toString()}`
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

export function walletPath() {
  return (storeId: string) => `/api/stores/${encodeURIComponent(storeId)}/wallet`
}

export function redemptionPath() {
  return (storeId: string) => `/api/stores/${encodeURIComponent(storeId)}/gift-cards/redeem`
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

function parseCloudResponse<T>(data: unknown, schema: z.ZodType<T, z.ZodTypeDef, unknown>): T {
  const parsed = schema.safeParse(data)
  if (!parsed.success) throw new Error('invalid_cloud_response')
  return parsed.data
}

function resolveCloudPath(path: CloudPath, storeId: string) {
  return typeof path === 'function' ? path(storeId) : path
}

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
