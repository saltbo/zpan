import {
  cloudOrderSchema,
  giftCardStatusSchema,
  cloudOrdersResponseSchema as zpanCloudOrdersResponseSchema,
} from '@shared/schemas'
import { z } from 'zod'
import {
  billingPortalSessionResponseSchema,
  commerceProductSchema,
  createCloudClient,
  giftCardListResponseSchema,
  paymentCreateResponseSchema,
  productListResponseSchema,
  storeGiftCardSchema,
} from 'zpan-cloud-sdk'
import { ZPAN_CLOUD_URL_DEFAULT } from '../../shared/constants'
import type { Env } from '../middleware/platform'
import { getCloudStoreBinding, getRequiredSettings } from '../services/cloud-store'

export type RouteContext = {
  get(key: 'platform'): Env['Variables']['platform']
  req: { url: string; header(name: string): string | undefined }
}

export const cloudCheckoutResponseSchema = paymentCreateResponseSchema
export const cloudBillingPortalSessionResponseSchema = billingPortalSessionResponseSchema
export const cloudPackageResponseSchema = commerceProductSchema
export const cloudPackageListResponseSchema = productListResponseSchema
export const cloudOrdersResponseSchema = zpanCloudOrdersResponseSchema
export const cloudOrderResponseSchema = cloudOrderSchema
export const cloudOrdersQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
})
export const cloudStoreOrdersQuerySchema = cloudOrdersQuerySchema

export const cloudGiftCardSchema = storeGiftCardSchema
export const cloudGiftCardsResponseSchema = giftCardListResponseSchema
export const cloudGiftCardListSchema = z.array(storeGiftCardSchema)
export const cloudGiftCardCreateResponseSchema = z
  .union([cloudGiftCardListSchema, cloudGiftCardsResponseSchema])
  .transform((response) => (Array.isArray(response) ? response : response.items))
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

export async function getBoundCloudClient(c: RouteContext) {
  const binding = await getCloudStoreBinding(c.get('platform').db)
  return {
    client: createCloudClient({ baseUrl: `${getCloudBaseUrl(c).replace(/\/$/, '')}/api`, token: binding.refreshToken }),
    storeId: binding.storeId,
  }
}

export async function unwrapCloudResponse<T, U = T>(
  response: {
    status: number
    ok: boolean
    json(): Promise<T>
  },
  responseSchema?: z.ZodType<U>,
): Promise<U> {
  if (response.status === 204) return null as U
  const data = await response.json().catch(() => null)
  if (!response.ok) throw new Error(cloudErrorCode(data) ?? `cloud_request_failed_${response.status}`)
  const payload = data && typeof data === 'object' && 'data' in data ? data.data : data
  if (!responseSchema) return payload as U
  const parsed = responseSchema.safeParse(payload)
  if (!parsed.success) throw new Error('invalid_cloud_response')
  return parsed.data
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

function cloudErrorCode(data: unknown) {
  if (!data || typeof data !== 'object' || !('error' in data)) return null
  const error = data.error
  if (typeof error === 'string') return error
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') return error.code
  return null
}

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
