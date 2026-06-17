import { z } from '@hono/zod-openapi'
import { pageSchema } from '@shared/schemas'
import type { EntitlementResult, QuotaEntitlementItem } from '../usecases/ports'

// Quota entitlement DTO shared by the team- and user-scoped admin endpoints. The
// domain record carries Date timestamps; toQuotaEntitlementDTO serializes them.
export const quotaEntitlementSchema = z
  .object({
    id: z.string(),
    orgId: z.string(),
    resourceType: z.string(),
    entitlementType: z.string(),
    source: z.string(),
    sourceId: z.string(),
    bytes: z.number().int(),
    startsAt: z.string(),
    expiresAt: z.string().nullable(),
    status: z.string(),
    metadata: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('QuotaEntitlement')

export type QuotaEntitlementDTO = z.infer<typeof quotaEntitlementSchema>

export function toQuotaEntitlementDTO(e: QuotaEntitlementItem): QuotaEntitlementDTO {
  return {
    ...e,
    startsAt: e.startsAt.toISOString(),
    expiresAt: e.expiresAt ? e.expiresAt.toISOString() : null,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
  }
}

export const entitlementResultSchema = z
  .object({ orgId: z.string(), entitlement: quotaEntitlementSchema })
  .openapi('EntitlementResult')

export function toEntitlementResultDTO(r: EntitlementResult): z.infer<typeof entitlementResultSchema> {
  return { orgId: r.orgId, entitlement: toQuotaEntitlementDTO(r.entitlement) }
}

// Entitlements are returned as the shared Page<T> envelope like every other list.
// They aren't truly paged (the full set is always returned), so handlers set
// total = items.length and page = 1. orgId is dropped — it's already in the path.
export const entitlementListSchema = pageSchema(quotaEntitlementSchema, 'EntitlementList')
