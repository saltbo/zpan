import { eq, sql } from 'drizzle-orm'
import { orgQuotas, quotaGrants, storages } from '../db/schema'
import type { Database } from '../platform/interface'

export interface EffectiveQuota {
  orgId: string
  baseQuota: number
  grantedQuota: number
  quota: number
  used: number
  trafficQuota: number
  trafficUsed: number
  trafficPeriod: string
}

export function currentTrafficPeriod(now = new Date()): string {
  const month = String(now.getUTCMonth() + 1).padStart(2, '0')
  return `${now.getUTCFullYear()}-${month}`
}

export async function getEffectiveQuota(db: Database, orgId: string, now = new Date()): Promise<EffectiveQuota> {
  const period = currentTrafficPeriod(now)
  await db
    .update(orgQuotas)
    .set({ trafficUsed: 0, trafficPeriod: period })
    .where(sql`${orgQuotas.orgId} = ${orgId} AND ${orgQuotas.trafficPeriod} != ${period}`)

  const quotaRows = await db
    .select({
      id: orgQuotas.id,
      baseQuota: orgQuotas.quota,
      used: orgQuotas.used,
      trafficQuota: orgQuotas.trafficQuota,
      trafficUsed: orgQuotas.trafficUsed,
      trafficPeriod: orgQuotas.trafficPeriod,
    })
    .from(orgQuotas)
    .where(eq(orgQuotas.orgId, orgId))
    .limit(1)
  const quotaRow = quotaRows[0]

  const grantRows = await db
    .select({ total: sql<number>`COALESCE(SUM(${quotaGrants.bytes}), 0)` })
    .from(quotaGrants)
    .where(sql`${quotaGrants.orgId} = ${orgId} AND ${quotaGrants.active} = 1`)

  const baseQuota = quotaRow?.baseQuota ?? 0
  const grantedQuota = Number(grantRows[0]?.total ?? 0)
  const trafficUsed = quotaRow && quotaRow.trafficPeriod === period ? quotaRow.trafficUsed : 0
  const trafficPeriod = quotaRow?.trafficPeriod === period ? quotaRow.trafficPeriod : period
  return {
    orgId,
    baseQuota,
    grantedQuota,
    quota: baseQuota === 0 ? 0 : baseQuota + grantedQuota,
    used: quotaRow?.used ?? 0,
    trafficQuota: quotaRow?.trafficQuota ?? 0,
    trafficUsed,
    trafficPeriod,
  }
}

export async function hasQuotaForBytes(db: Database, orgId: string, bytes: number): Promise<boolean> {
  if (bytes <= 0) return true
  const quota = await getEffectiveQuota(db, orgId)
  if (quota.baseQuota === 0) return true
  return quota.used + bytes <= quota.quota
}

export async function hasTrafficQuotaForBytes(
  db: Database,
  orgId: string,
  bytes: number,
  now = new Date(),
): Promise<boolean> {
  if (bytes <= 0) return true
  const quota = await getEffectiveQuota(db, orgId, now)
  if (quota.trafficQuota === 0) return true
  return quota.trafficUsed + bytes <= quota.trafficQuota
}

export async function consumeTrafficIfQuotaAllows(
  db: Database,
  orgId: string,
  bytes: number,
  now = new Date(),
): Promise<boolean> {
  if (bytes <= 0) return true
  const period = currentTrafficPeriod(now)
  const quotaRows = await db
    .select({ id: orgQuotas.id, trafficPeriod: orgQuotas.trafficPeriod, trafficQuota: orgQuotas.trafficQuota })
    .from(orgQuotas)
    .where(eq(orgQuotas.orgId, orgId))
    .limit(1)
  if (quotaRows.length === 0) return true

  if (quotaRows[0].trafficPeriod !== period) {
    const updated = await db
      .update(orgQuotas)
      .set({ trafficUsed: bytes, trafficPeriod: period })
      .where(
        sql`${orgQuotas.orgId} = ${orgId}
          AND ${orgQuotas.trafficPeriod} != ${period}
          AND (${orgQuotas.trafficQuota} = 0 OR ${bytes} <= ${orgQuotas.trafficQuota})`,
      )
      .returning({ id: orgQuotas.id })
    if (updated.length > 0) return true
  }

  const updated = await db
    .update(orgQuotas)
    .set({ trafficUsed: sql`${orgQuotas.trafficUsed} + ${bytes}` })
    .where(
      sql`${orgQuotas.orgId} = ${orgId}
        AND ${orgQuotas.trafficPeriod} = ${period}
        AND (${orgQuotas.trafficQuota} = 0 OR ${orgQuotas.trafficUsed} + ${bytes} <= ${orgQuotas.trafficQuota})`,
    )
    .returning({ id: orgQuotas.id })

  return updated.length > 0
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
