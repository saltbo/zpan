import {
  cloudOrderSchema,
  discountQuoteSchema,
  giftCardStatusSchema,
  cloudOrdersResponseSchema as zpanCloudOrdersResponseSchema,
} from '@shared/schemas'
import { z } from 'zod'
import {
  billingPortalSessionResponseSchema,
  commerceProductSchema,
  paymentCreateResponseSchema,
  productListResponseSchema,
} from 'zpan-cloud-sdk'
import { ZPAN_CLOUD_URL_DEFAULT } from '../../shared/constants'
import type { Env } from '../middleware/platform'
import { buildBoundCloudClient } from '../usecases/cloud-store'

// The cloud-proxy plumbing (bound client, timeout, response unwrapping) and all
// CloudStoreRepo / LicensingCloudGateway access live in the cloud-store usecase.
// This module keeps only PURE helpers (schemas, request-derived values, hashing)
// plus a thin `getBoundCloudClient(c)` that forwards `deps` whole to the usecase —
// the latter exists so the orders helper in cloud-store/shared.ts keeps its
// context-based call site. Re-exported usecase plumbing keeps that helper working.
export { unwrapCloudResponse, withCloudRequestTimeout } from '../usecases/cloud-store'

export type RouteContext = {
  get(key: 'platform'): Env['Variables']['platform']
  get(key: 'deps'): Env['Variables']['deps']
  req: { url: string; header(name: string): string | undefined }
}

export const cloudCheckoutResponseSchema = paymentCreateResponseSchema
export const cloudBillingPortalSessionResponseSchema = billingPortalSessionResponseSchema
export const cloudPackageResponseSchema = commerceProductSchema
export const cloudPackageListResponseSchema = productListResponseSchema
export const cloudOrdersResponseSchema = zpanCloudOrdersResponseSchema
export const cloudOrderResponseSchema = cloudOrderSchema
export const cloudDiscountQuoteResponseSchema = discountQuoteSchema
export const cloudOrdersQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
})
export const cloudStoreOrdersQuerySchema = cloudOrdersQuerySchema

const rawCloudGiftCardSchema = z.object({
  id: z.string().min(1),
  storeId: z.string().min(1),
  campaignId: z.string().nullable(),
  code: z.string().nullable(),
  codeLast4: z.string().min(1),
  credits: z.number().int().nonnegative(),
  status: giftCardStatusSchema,
  expiresAt: z.string().nullable(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  disabledAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  createdByAdmin: z.string().min(1),
})
export const cloudGiftCardSchema = rawCloudGiftCardSchema
export const cloudGiftCardsResponseSchema = z.object({
  items: z.array(cloudGiftCardSchema),
  total: z.number().int(),
  limit: z.number().int().optional(),
  offset: z.number().int().optional(),
})
export const cloudGiftCardListSchema = z.array(cloudGiftCardSchema)
export const cloudGiftCardCreateResponseSchema = z
  .union([cloudGiftCardListSchema, cloudGiftCardsResponseSchema])
  .transform((response) => (Array.isArray(response) ? response : response.items))
export const giftCardListQuerySchema = z.object({ status: giftCardStatusSchema.optional() })

// Forwards `deps` whole to the usecase, which owns the port access. Kept so the
// orders helper (cloud-store/shared.ts) can build a bound client from a context.
export async function getBoundCloudClient(c: RouteContext) {
  return buildBoundCloudClient(c.get('deps'), getCloudBaseUrl(c))
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

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
