import { and, eq } from 'drizzle-orm'
import { orgQuotaEntitlements } from '../db/schema'
import type { Database } from '../platform/interface'
import { getEffectiveQuota } from './effective-quota'
import { isOrgOwner } from './org'
import type { QuotaEntitlementItem } from './user'

export interface AllocationFailure {
  error: string
  code: 'NOT_FOUND' | 'NOT_TRANSFERABLE' | 'FORBIDDEN' | 'SAME_ORG' | 'SOURCE_OVER_QUOTA'
  status: 400 | 403 | 404
}

// One-time purchased packs are the only transferable entitlements. Plans
// (subscriptions) have a renewal/cancellation lifecycle keyed to the org they
// were bought for, and admin grants are pinned to the space the admin chose.
export function isTransferableEntitlement(item: Pick<QuotaEntitlementItem, 'entitlementType' | 'source' | 'status'>) {
  return item.entitlementType === 'grant' && item.source === 'cloud_order' && item.status === 'active'
}

// Move a whole purchased pack between two orgs the user owns. The source org
// must still fit its usage after losing the pack — a transfer must never leave
// a space over quota.
export async function transferEntitlementToOrg(
  db: Database,
  input: { userId: string; entitlementId: string; sourceOrgId: string; targetOrgId: string },
): Promise<{ entitlement: QuotaEntitlementItem } | AllocationFailure> {
  const { userId, entitlementId, sourceOrgId, targetOrgId } = input
  if (targetOrgId === sourceOrgId) {
    return { error: 'Target must be a different space', code: 'SAME_ORG', status: 400 }
  }

  const rows = await db
    .select()
    .from(orgQuotaEntitlements)
    .where(and(eq(orgQuotaEntitlements.id, entitlementId), eq(orgQuotaEntitlements.orgId, sourceOrgId)))
    .limit(1)
  const entitlement = rows[0]
  if (!entitlement) return { error: `Entitlement not found: ${entitlementId}`, code: 'NOT_FOUND', status: 404 }
  if (!isTransferableEntitlement(entitlement)) {
    return { error: 'Only purchased one-time packs can be moved', code: 'NOT_TRANSFERABLE', status: 400 }
  }

  if (!(await isOrgOwner(db, userId, sourceOrgId)) || !(await isOrgOwner(db, userId, targetOrgId))) {
    return { error: 'Forbidden', code: 'FORBIDDEN', status: 403 }
  }

  const sourceQuota = await getEffectiveQuota(db, sourceOrgId)
  const remaining = sourceQuota.quota - entitlement.bytes
  // quota 0 means unlimited only when nothing is granted; after removing this
  // pack the remaining entitlements define the cap unless none are left at all.
  const unlimitedAfter = sourceQuota.baseQuota === 0 && sourceQuota.entitlementQuota - entitlement.bytes === 0
  if (!unlimitedAfter && sourceQuota.used > remaining) {
    return {
      error: 'Source space usage exceeds its quota after the transfer. Free up space first.',
      code: 'SOURCE_OVER_QUOTA',
      status: 400,
    }
  }

  const updated = await db
    .update(orgQuotaEntitlements)
    .set({
      orgId: targetOrgId,
      metadata: mergeMetadata(entitlement.metadata, {
        allocatedBy: userId,
        allocatedFrom: sourceOrgId,
        allocatedAt: new Date().toISOString(),
      }),
      updatedAt: new Date(),
    })
    .where(eq(orgQuotaEntitlements.id, entitlementId))
    .returning()
  return { entitlement: updated[0] }
}

function mergeMetadata(existing: string | null, patch: Record<string, unknown>): string {
  let base: Record<string, unknown> = {}
  if (existing) {
    try {
      base = JSON.parse(existing) as Record<string, unknown>
    } catch {
      base = {}
    }
  }
  return JSON.stringify({ ...base, ...patch })
}
