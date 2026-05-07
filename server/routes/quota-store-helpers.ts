import { giftCardStatusSchema } from '@shared/schemas'
import { z } from 'zod'
import { ZPAN_CLOUD_URL_DEFAULT } from '../../shared/constants'
import type { Env } from '../middleware/platform'
import { postBoundCloudJson, requestBoundCloudJson } from '../services/licensing-cloud'
import { getCloudStoreBinding, getRequiredSettings, getUserTerminalLabel } from '../services/quota-store'

export type RouteContext = {
  get(key: 'platform'): Env['Variables']['platform']
  req: { url: string; header(name: string): string | undefined }
}

export const cloudCheckoutResponseSchema = z
  .object({ orderId: z.string().min(1), url: z.string().url() })
  .transform((value) => ({ checkoutUrl: value.url }))
const cloudPackagePriceSchema = z.union([
  z.object({ currency: z.string().min(1), amount: z.number().int().positive() }),
  z
    .object({ currency: z.string().min(1), unit_amount: z.number().int().positive() })
    .transform((price) => ({ currency: price.currency, amount: price.unit_amount })),
])
const cloudPackageSchema = z.union([
  z
    .object({
      id: z.string().min(1),
      name: z.string().min(1),
      description: z.string().nullable().default(''),
      storage_bytes: z.number().int().min(0).default(0),
      traffic_bytes: z.number().int().min(0).default(0),
      prices: z.array(cloudPackagePriceSchema).min(1),
      active: z.boolean().default(true),
      sort_order: z.number().int().default(0),
      created_at: z.string().min(1),
      updated_at: z.string().min(1),
    })
    .transform((pkg) => ({
      id: pkg.id,
      name: pkg.name,
      description: pkg.description ?? '',
      storageBytes: pkg.storage_bytes,
      trafficBytes: pkg.traffic_bytes,
      prices: pkg.prices,
      active: pkg.active,
      sortOrder: pkg.sort_order,
      createdAt: pkg.created_at,
      updatedAt: pkg.updated_at,
    })),
  z
    .object({
      id: z.string().min(1),
      name: z.string().min(1),
      description: z.string().nullable().default(''),
      storageBytes: z.number().int().min(0).default(0),
      trafficBytes: z.number().int().min(0).default(0),
      prices: z.array(cloudPackagePriceSchema).min(1),
      active: z.boolean().default(true),
      sortOrder: z.number().int().default(0),
      createdAt: z.string().min(1),
      updatedAt: z.string().min(1),
    })
    .transform((pkg) => ({ ...pkg, description: pkg.description ?? '' })),
])
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
    orgId: z.string().min(1),
    packageName: z.string().min(1),
    packageDescription: z.string().nullable().default(null),
    storageBytes: z.number().int().min(0),
    trafficBytes: z.number().int().min(0),
    subtotalAmount: z.number().int().min(0),
    giftCardAmount: z.number().int().min(0).default(0),
    stripeAmount: z.number().int().min(0).default(0),
    paidAmount: z.number().int().min(0).default(0),
    currency: z.string().min(1),
    giftCardId: z.string().nullable().default(null),
    stripeSessionId: z.string().nullable().default(null),
    stripePaymentIntentId: z.string().nullable().default(null),
    paymentStatus: z.enum(['pending', 'paid', 'refunded', 'canceled']),
    fulfillmentStatus: z.enum(['pending', 'delivering', 'delivered', 'failed']).nullable().default(null),
    terminalUserId: z.string().nullable().default(null),
    terminalUserEmail: z.string().nullable().default(null),
    createdAt: z.string().min(1),
    paidAt: z.string().nullable().default(null),
    fulfilledAt: z.string().nullable().default(null),
  })
  .or(
    z
      .object({
        id: z.string().min(1),
        target_org_id: z.string().min(1),
        package_name: z.string().min(1),
        package_description: z.string().nullable().default(null),
        storage_bytes: z.number().int().min(0),
        traffic_bytes: z.number().int().min(0),
        subtotal_amount: z.number().int().min(0),
        gift_card_amount: z.number().int().min(0).default(0),
        stripe_amount: z.number().int().min(0).default(0),
        paid_amount: z.number().int().min(0).default(0),
        currency: z.string().min(1),
        gift_card_id: z.string().nullable().default(null),
        stripe_session_id: z.string().nullable().default(null),
        stripe_payment_intent_id: z.string().nullable().default(null),
        payment_status: z.enum(['pending', 'paid', 'refunded', 'canceled']),
        fulfillment_status: z.enum(['pending', 'delivering', 'delivered', 'failed']).nullable().default(null),
        terminal_user_id: z.string().nullable().default(null),
        terminal_user_email: z.string().nullable().default(null),
        created_at: z.string().min(1),
        paid_at: z.string().nullable().default(null),
        fulfilled_at: z.string().nullable().default(null),
      })
      .transform((order) => ({
        id: order.id,
        orgId: order.target_org_id,
        packageName: order.package_name,
        packageDescription: order.package_description,
        storageBytes: order.storage_bytes,
        trafficBytes: order.traffic_bytes,
        subtotalAmount: order.subtotal_amount,
        giftCardAmount: order.gift_card_amount,
        stripeAmount: order.stripe_amount,
        paidAmount: order.paid_amount,
        currency: order.currency,
        giftCardId: order.gift_card_id,
        stripeSessionId: order.stripe_session_id,
        stripePaymentIntentId: order.stripe_payment_intent_id,
        paymentStatus: order.payment_status,
        fulfillmentStatus: order.fulfillment_status,
        terminalUserId: order.terminal_user_id,
        terminalUserEmail: order.terminal_user_email,
        createdAt: order.created_at,
        paidAt: order.paid_at,
        fulfilledAt: order.fulfilled_at,
      })),
  )

export const cloudOrdersResponseSchema = z.union([
  z.array(cloudOrderSchema).transform((items) => ({ items, total: items.length })),
  z.object({ items: z.array(cloudOrderSchema), total: z.number().int().min(0).optional() }).transform((result) => ({
    items: result.items,
    total: result.total ?? result.items.length,
  })),
])

export const cloudGiftCardsResponseSchema = z.array(
  z.union([
    z.object({
      id: z.string().min(1),
      code: z.string().min(1),
      initialAmount: z.number().int().positive(),
      remainingAmount: z.number().int().min(0),
      currency: z.string().min(1),
      status: z.enum(['active', 'disabled', 'exhausted', 'expired']),
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
        status: z.enum(['active', 'disabled', 'exhausted', 'expired']),
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
  ]),
)
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

export async function postUserCloud<T>(
  c: RouteContext,
  path: string,
  payload: object,
  refreshToken: string,
  responseSchema: z.ZodType<T, z.ZodTypeDef, unknown>,
) {
  try {
    return await postCloud(getCloudBaseUrl(c), path, refreshToken, payload, responseSchema)
  } catch (error) {
    return { error: (error as Error).message }
  }
}

export async function patchCloudWithBinding<T>(
  c: RouteContext,
  path: string,
  payload: object,
  responseSchema: z.ZodType<T, z.ZodTypeDef, unknown>,
) {
  return requestCloudWithBinding(c, path, 'PATCH', responseSchema, payload)
}

export async function postCloudWithBinding<T>(
  c: RouteContext,
  path: string,
  payload: object,
  responseSchema: z.ZodType<T, z.ZodTypeDef, unknown>,
) {
  return requestCloudWithBinding(c, path, 'POST', responseSchema, payload)
}

export async function requestCloudWithBinding<T>(
  c: RouteContext,
  path: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  responseSchema: z.ZodType<T, z.ZodTypeDef, unknown>,
  payload?: object,
) {
  try {
    const binding = await getCloudStoreBinding(c.get('platform').db)
    const data = await requestBoundCloudJson(getCloudBaseUrl(c), path, binding.refreshToken, { method, payload })
    return parseCloudResponse(data, responseSchema)
  } catch (error) {
    return { error: (error as Error).message }
  }
}

export async function getCloud<T>(c: RouteContext, path: string, responseSchema: z.ZodType<T, z.ZodTypeDef, unknown>) {
  return requestCloudWithBinding(c, path, 'GET', responseSchema)
}

export async function deleteCloud(c: RouteContext, path: string) {
  try {
    const binding = await getCloudStoreBinding(c.get('platform').db)
    await requestBoundCloudJson(getCloudBaseUrl(c), path, binding.refreshToken, { method: 'DELETE' })
    return null
  } catch (error) {
    return { error: (error as Error).message }
  }
}

export function giftCardsPath(status?: z.infer<typeof giftCardStatusSchema>) {
  if (!status) return '/api/store/gift-cards'
  return `/api/store/gift-cards?status=${encodeURIComponent(status)}`
}

export function packagesPath(packageId?: string) {
  if (!packageId) return '/api/store/packages'
  return `/api/store/packages/${encodeURIComponent(packageId)}`
}

export function ordersPath(orgIds?: string[]) {
  if (!orgIds?.length) return '/api/store/orders'
  return `/api/store/orders?targetOrgIds=${encodeURIComponent(orgIds.join(','))}`
}

export async function createCheckoutPayload(
  c: RouteContext,
  boundLicenseId: string,
  packageId: string,
  targetOrgId: string,
  userId: string,
  currency?: string,
  giftCardCode?: string,
) {
  const origin = getInstanceOrigin(c)
  return {
    boundLicenseId,
    packageId,
    targetOrgId,
    terminalUserId: userId,
    terminalUserLabel: await getUserTerminalLabel(c.get('platform').db, userId),
    currency,
    giftCardCode,
    successUrl: `${origin}/storage`,
    cancelUrl: `${origin}/storage`,
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

async function postCloud<T>(
  baseUrl: string,
  path: string,
  refreshToken: string,
  payload: object,
  responseSchema: z.ZodType<T, z.ZodTypeDef, unknown>,
) {
  return parseCloudResponse(await postBoundCloudJson(baseUrl, path, refreshToken, payload), responseSchema)
}

function parseCloudResponse<T>(data: unknown, schema: z.ZodType<T, z.ZodTypeDef, unknown>): T {
  const parsed = schema.safeParse(data)
  if (!parsed.success) throw new Error('invalid_cloud_response')
  return parsed.data
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
