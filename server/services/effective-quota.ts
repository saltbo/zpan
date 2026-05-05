import { eq, sql } from 'drizzle-orm'
import { orgQuotas, quotaGrants, storages } from '../db/schema'
import type { Database } from '../platform/interface'

export interface EffectiveQuota {
  orgId: string
  baseQuota: number
  grantedQuota: number
  quota: number
  used: number
}

export async function getEffectiveQuota(db: Database, orgId: string): Promise<EffectiveQuota> {
  const quotaRows = await db
    .select({ baseQuota: orgQuotas.quota, used: orgQuotas.used })
    .from(orgQuotas)
    .where(eq(orgQuotas.orgId, orgId))
    .limit(1)

  const grantRows = await db
    .select({ total: sql<number>`COALESCE(SUM(${quotaGrants.bytes}), 0)` })
    .from(quotaGrants)
    .where(sql`${quotaGrants.orgId} = ${orgId} AND ${quotaGrants.active} = 1`)

  const baseQuota = quotaRows[0]?.baseQuota ?? 0
  const grantedQuota = Number(grantRows[0]?.total ?? 0)
  return {
    orgId,
    baseQuota,
    grantedQuota,
    quota: baseQuota === 0 ? 0 : baseQuota + grantedQuota,
    used: quotaRows[0]?.used ?? 0,
  }
}

export async function hasQuotaForBytes(db: Database, orgId: string, bytes: number): Promise<boolean> {
  if (bytes <= 0) return true
  const quota = await getEffectiveQuota(db, orgId)
  if (quota.baseQuota === 0) return true
  return quota.used + bytes <= quota.quota
}

export async function incrementUsageIfEffectiveQuotaAllows(
  db: Database,
  orgId: string,
  storageId: string,
  bytes: number,
  teamQuotaEnabled = true,
): Promise<boolean> {
  if (teamQuotaEnabled) {
    const rows = await db.select({ id: orgQuotas.id }).from(orgQuotas).where(eq(orgQuotas.orgId, orgId)).limit(1)
    if (rows.length > 0) {
      const updated = await db
        .update(orgQuotas)
        .set({ used: sql`${orgQuotas.used} + ${bytes}` })
        .where(
          sql`${orgQuotas.orgId} = ${orgId}
            AND (${orgQuotas.quota} = 0 OR ${orgQuotas.used} + ${bytes} <= ${orgQuotas.quota} + (
              SELECT COALESCE(SUM(${quotaGrants.bytes}), 0)
              FROM ${quotaGrants}
              WHERE ${quotaGrants.orgId} = ${orgId} AND ${quotaGrants.active} = 1
            ))`,
        )
        .returning({ id: orgQuotas.id })

      if (updated.length === 0) return false
    }
  }

  await db
    .update(storages)
    .set({ used: sql`${storages.used} + ${bytes}` })
    .where(eq(storages.id, storageId))

  return true
}
