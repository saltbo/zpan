import { storageCodeStatusSchema } from '@shared/schemas'
import type { QuotaStorePackage } from '@shared/types'
import { z } from 'zod'
import { ZPAN_CLOUD_URL_DEFAULT } from '../../shared/constants'
import type { Env } from '../middleware/platform'
import { postBoundCloudJson, requestBoundCloudJson } from '../services/licensing-cloud'
import {
  getCloudStoreBinding,
  getQuotaStorePackage,
  getRequiredSettings,
  getUserTerminalLabel,
  listQuotaStorePackages,
  markPackageSynced,
} from '../services/quota-store'

export type RouteContext = {
  get(key: 'platform'): Env['Variables']['platform']
  req: { url: string; header(name: string): string | undefined }
}

export const cloudCheckoutResponseSchema = z
  .object({ orderId: z.string().min(1), url: z.string().url() })
  .transform((value) => ({ checkoutUrl: value.url }))
export const cloudPackageSyncResponseSchema = z.object({
  packages: z.array(z.object({ id: z.string().min(1), externalPackageId: z.string().min(1) }).passthrough()),
})
export const cloudRedemptionResponseSchema = z.object({ ok: z.boolean() }).passthrough()
export const cloudStorageCodesResponseSchema = z.array(
  z.union([
    z.object({
      code: z.string().min(1),
      bytes: z.number().int().positive(),
      maxUses: z.number().int().positive(),
      usesCount: z.number().int().min(0),
      expiresAt: z.string().nullable(),
      createdAt: z.string().min(1),
      revokedAt: z.string().nullable(),
    }),
    z
      .object({
        code: z.string().min(1),
        bytes: z.number().int().positive(),
        max_uses: z.number().int().positive(),
        uses_count: z.number().int().min(0),
        expires_at: z.string().nullable(),
        created_at: z.string().min(1),
        revoked_at: z.string().nullable(),
      })
      .transform((code) => ({
        code: code.code,
        bytes: code.bytes,
        maxUses: code.max_uses,
        usesCount: code.uses_count,
        expiresAt: code.expires_at,
        createdAt: code.created_at,
        revokedAt: code.revoked_at,
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

export async function syncPackages(c: RouteContext, packageId: string) {
  const db = c.get('platform').db
  try {
    const result = await syncCatalog(c)
    if (result) return markPackageSynced(db, packageId, { error: result })
    return (await getQuotaStorePackage(db, packageId))!
  } catch (error) {
    return markPackageSynced(db, packageId, { error: (error as Error).message })
  }
}

export async function syncCatalog(c: RouteContext, excludingPackageId?: string) {
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

export async function postCloudWithBinding<T>(
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

export async function getCloud<T>(c: RouteContext, path: string, responseSchema: z.ZodType<T, z.ZodTypeDef, unknown>) {
  try {
    const binding = await getCloudStoreBinding(c.get('platform').db)
    const data = await requestBoundCloudJson(getCloudBaseUrl(c), path, binding.refreshToken, { method: 'GET' })
    return parseCloudResponse(data, responseSchema)
  } catch (error) {
    return { error: (error as Error).message }
  }
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

export async function createCheckoutPayload(
  c: RouteContext,
  boundLicenseId: string,
  pkg: QuotaStorePackage,
  targetOrgId: string,
  userId: string,
) {
  const origin = getInstanceOrigin(c)
  return {
    boundLicenseId,
    externalPackageId: pkg.id,
    targetOrgId,
    terminalUserId: userId,
    terminalUserLabel: await getUserTerminalLabel(c.get('platform').db, userId),
    amount: pkg.amount,
    currency: pkg.currency,
    bytes: pkg.bytes,
    successUrl: `${origin}/store`,
    cancelUrl: `${origin}/store`,
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
    if (localPackageIds.has(pkg.externalPackageId))
      await markPackageSynced(db, pkg.externalPackageId, { cloudPackageId: pkg.id })
  }
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
