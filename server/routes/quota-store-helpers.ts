import { storageCodeStatusSchema } from '@shared/schemas'
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
export const cloudRedemptionResponseSchema = z.object({ ok: z.boolean() }).passthrough()
const cloudPackagePriceSchema = z.union([
  z.object({ currency: z.string().min(1), amount: z.number().int().positive() }),
  z
    .object({ currency: z.string().min(1), unit_amount: z.number().int().positive() })
    .transform((price) => ({ currency: price.currency, amount: price.unit_amount })),
])
const cloudPackageSchema = z.union([
  // Legacy camelCase: resourceType/resourceBytes → storageBytes/trafficBytes
  z
    .object({
      id: z.string().min(1),
      name: z.string().min(1),
      description: z.string().nullable().default(''),
      resourceType: z.enum(['storage', 'traffic']),
      resourceBytes: z.number().int().positive(),
      prices: z.array(cloudPackagePriceSchema).min(1),
      active: z.boolean().default(true),
      sortOrder: z.number().int().default(0),
      createdAt: z.string().min(1),
      updatedAt: z.string().min(1),
    })
    .transform((pkg) => ({
      id: pkg.id,
      name: pkg.name,
      description: pkg.description ?? '',
      storageBytes: pkg.resourceType === 'storage' ? pkg.resourceBytes : 0,
      trafficBytes: pkg.resourceType === 'traffic' ? pkg.resourceBytes : 0,
      prices: pkg.prices,
      active: pkg.active,
      sortOrder: pkg.sortOrder,
      createdAt: pkg.createdAt,
      updatedAt: pkg.updatedAt,
    })),
  // Legacy snake_case: resource_type/resource_bytes → storageBytes/trafficBytes
  z
    .object({
      id: z.string().min(1),
      name: z.string().min(1),
      description: z.string().nullable().default(''),
      resource_type: z.enum(['storage', 'traffic']),
      resource_bytes: z.number().int().positive(),
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
      storageBytes: pkg.resource_type === 'storage' ? pkg.resource_bytes : 0,
      trafficBytes: pkg.resource_type === 'traffic' ? pkg.resource_bytes : 0,
      prices: pkg.prices,
      active: pkg.active,
      sortOrder: pkg.sort_order,
      createdAt: pkg.created_at,
      updatedAt: pkg.updated_at,
    })),
  // New snake_case: storage_bytes/traffic_bytes
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
  // New camelCase: storageBytes/trafficBytes (must come last due to optional defaults)
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
export const cloudStorageCodesResponseSchema = z.array(
  z
    .object({
      code: z.string().min(1),
      resourceType: z.enum(['storage', 'traffic']),
      bytes: z.number().int().positive(),
      maxUses: z.number().int().positive(),
      usesCount: z.number().int().min(0),
      expiresAt: z.string().nullable(),
      createdAt: z.string().min(1),
      revokedAt: z.string().nullable(),
    })
    .transform((code) => ({
      code: code.code,
      resourceType: code.resourceType,
      resourceBytes: code.bytes,
      maxUses: code.maxUses,
      usesCount: code.usesCount,
      expiresAt: code.expiresAt,
      createdAt: code.createdAt,
      revokedAt: code.revokedAt,
    })),
)
export const cloudQuotaGrantsResponseSchema = z.array(
  z.union([
    z.object({
      id: z.string().min(1),
      orgId: z.string().min(1),
      source: z.enum(['stripe', 'redeem_code', 'admin_adjustment']),
      externalEventId: z.string().nullable(),
      cloudOrderId: z.string().nullable(),
      cloudRedemptionId: z.string().nullable(),
      code: z.string().nullable(),
      bytes: z.number().int().positive(),
      packageSnapshot: z.string().nullable(),
      grantedBy: z.string().nullable(),
      terminalUserId: z.string().nullable(),
      terminalUserEmail: z.string().nullable(),
      active: z.boolean(),
      createdAt: z.string().min(1),
    }),
    z
      .object({
        id: z.string().min(1),
        org_id: z.string().min(1),
        source: z.enum(['stripe', 'redeem_code', 'admin_adjustment']),
        external_event_id: z.string().nullable(),
        cloud_order_id: z.string().nullable(),
        cloud_redemption_id: z.string().nullable(),
        code: z.string().nullable(),
        bytes: z.number().int().positive(),
        package_snapshot: z.string().nullable(),
        granted_by: z.string().nullable(),
        terminal_user_id: z.string().nullable(),
        terminal_user_email: z.string().nullable(),
        active: z.boolean(),
        created_at: z.string().min(1),
      })
      .transform((grant) => ({
        id: grant.id,
        orgId: grant.org_id,
        source: grant.source,
        externalEventId: grant.external_event_id,
        cloudOrderId: grant.cloud_order_id,
        cloudRedemptionId: grant.cloud_redemption_id,
        code: grant.code,
        bytes: grant.bytes,
        packageSnapshot: grant.package_snapshot,
        grantedBy: grant.granted_by,
        terminalUserId: grant.terminal_user_id,
        terminalUserEmail: grant.terminal_user_email,
        active: grant.active,
        createdAt: grant.created_at,
      })),
  ]),
)
export const storageCodeListQuerySchema = z.object({ status: storageCodeStatusSchema.optional() })

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

export function storageCodesPath(status?: z.infer<typeof storageCodeStatusSchema>) {
  if (!status) return '/api/store/storage-codes'
  return `/api/store/storage-codes?status=${encodeURIComponent(status)}`
}

export function packagesPath(packageId?: string) {
  if (!packageId) return '/api/store/packages'
  return `/api/store/packages/${encodeURIComponent(packageId)}`
}

export function quotaGrantsPath(orgIds: string[]) {
  return `/api/store/grants?targetOrgIds=${encodeURIComponent(orgIds.join(','))}`
}

export async function createCheckoutPayload(
  c: RouteContext,
  boundLicenseId: string,
  packageId: string,
  targetOrgId: string,
  userId: string,
  currency?: string,
) {
  const origin = getInstanceOrigin(c)
  return {
    boundLicenseId,
    packageId,
    targetOrgId,
    terminalUserId: userId,
    terminalUserLabel: await getUserTerminalLabel(c.get('platform').db, userId),
    currency,
    successUrl: `${origin}/storage`,
    cancelUrl: `${origin}/storage`,
  }
}

export async function createRedemptionPayload(
  c: { get(key: 'platform'): Env['Variables']['platform'] },
  boundLicenseId: string,
  code: string,
  targetOrgId: string,
  userId: string,
) {
  return {
    boundLicenseId,
    code,
    targetOrgId,
    terminalUserId: userId,
    terminalUserLabel: await getUserTerminalLabel(c.get('platform').db, userId),
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
