import type { CloudOrderQuotaChange } from '@shared/schemas'
import { and, eq, sql } from 'drizzle-orm'
import { orgQuotaEntitlements } from '../db/schema'

export function cloudOrderEntitlementIncreaseBytes(bytes: number) {
  return sql`CASE
    WHEN ${orgQuotaEntitlements.status} = 'active' THEN ${orgQuotaEntitlements.bytes} + ${bytes}
    ELSE ${bytes}
  END`
}

export function cloudOrderEntitlementWhere(event: CloudOrderQuotaChange, resourceType: 'storage' | 'traffic') {
  return and(
    eq(orgQuotaEntitlements.orgId, event.targetOrgId),
    eq(orgQuotaEntitlements.resourceType, resourceType),
    eq(orgQuotaEntitlements.source, 'cloud_order'),
    eq(orgQuotaEntitlements.sourceId, event.cloudOrderId),
  )
}
