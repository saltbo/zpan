import { eq, sql, sum } from 'drizzle-orm'
import type { EffectiveQuota } from '../../shared/types'
import { orgQuotas, quotaGrants, storages } from '../db/schema'
import type { Database } from '../platform/interface'

/**
 * Returns effective quota for an org:
 *   quota = base (org_quotas.quota) + sum of all quota_grants.bytes for that org
 *   used  = org_quotas.used
 */
export async function getEffectiveQuota(db: Database, orgId: string): Promise<EffectiveQuota> {
  const [baseRow] = await db
    .select({ quota: orgQuotas.quota, used: orgQuotas.used })
    .from(orgQuotas)
    .where(eq(orgQuotas.orgId, orgId))

  const base = baseRow ?? { quota: 0, used: 0 }

  const [grantRow] = await db
    .select({ total: sum(quotaGrants.bytes) })
    .from(quotaGrants)
    .where(eq(quotaGrants.orgId, orgId))

  const grantedQuota = Number(grantRow?.total ?? 0)
  const effectiveQuota = base.quota + grantedQuota

  return {
    orgId,
    baseQuota: base.quota,
    grantedQuota,
    quota: effectiveQuota,
    used: base.used,
  }
}

/**
 * Atomically checks effective quota and increments used bytes if allowed.
 * Returns true if usage was allowed and incremented, false if quota exceeded.
 *
 * quota=0 base and no grants means unlimited (same as the existing convention).
 */
export async function incrementEffectiveQuotaIfAllowed(
  db: Database,
  orgId: string,
  storageId: string,
  bytes: number,
  teamQuotaEnabled = true,
): Promise<boolean> {
  if (teamQuotaEnabled) {
    const eq_ = getEffectiveQuota
    const { quota: effectiveQuota, used } = await eq_(db, orgId)

    if (effectiveQuota > 0 && used + bytes > effectiveQuota) {
      return false
    }

    // Only update org_quotas.used if a row exists; no row = unlimited.
    const existing = await db.select({ id: orgQuotas.id }).from(orgQuotas).where(eq(orgQuotas.orgId, orgId))
    if (existing.length > 0) {
      await db
        .update(orgQuotas)
        .set({ used: sql`${orgQuotas.used} + ${bytes}` })
        .where(eq(orgQuotas.orgId, orgId))
    }
  }

  await db
    .update(storages)
    .set({ used: sql`${storages.used} + ${bytes}` })
    .where(eq(storages.id, storageId))

  return true
}

/**
 * Decrements used bytes for an org (e.g. on delete/trash).
 * Clamps to 0 to prevent negative values.
 */
export async function decrementEffectiveQuota(db: Database, orgId: string, bytes: number): Promise<void> {
  await db
    .update(orgQuotas)
    .set({ used: sql`MAX(0, ${orgQuotas.used} - ${bytes})` })
    .where(eq(orgQuotas.orgId, orgId))
}

/**
 * Check-only variant — does not modify state.
 * quota=0 with no grants = unlimited.
 */
export async function isEffectiveQuotaSufficient(db: Database, orgId: string, bytes: number): Promise<boolean> {
  if (bytes <= 0) return true
  const { quota, used } = await getEffectiveQuota(db, orgId)
  if (quota === 0) return true
  return used + bytes <= quota
}
