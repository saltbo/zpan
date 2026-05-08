import { eq, sql } from 'drizzle-orm'
import { orgQuotaEntitlements, orgQuotas, storages } from '../db/schema'
import type { Database } from '../platform/interface'

export interface EffectiveQuota {
  orgId: string
  baseQuota: number
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

  const baseQuota = quotaRow?.baseQuota ?? 0
  const storageEntitlements = await getActiveQuotaEntitlementBytes(db, orgId, 'storage', now)
  const trafficEntitlements = await getActiveQuotaEntitlementBytes(db, orgId, 'traffic', now)
  const trafficUsed = quotaRow && quotaRow.trafficPeriod === period ? quotaRow.trafficUsed : 0
  const trafficPeriod = quotaRow?.trafficPeriod === period ? quotaRow.trafficPeriod : period
  return {
    orgId,
    baseQuota,
    quota: baseQuota === 0 ? 0 : baseQuota + storageEntitlements,
    used: quotaRow?.used ?? 0,
    trafficQuota: !quotaRow || quotaRow.trafficQuota === 0 ? 0 : quotaRow.trafficQuota + trafficEntitlements,
    trafficUsed,
    trafficPeriod,
  }
}

export async function getActiveQuotaEntitlementBytes(
  db: Database,
  orgId: string,
  resourceType: 'storage' | 'traffic',
  now = new Date(),
): Promise<number> {
  const nowMs = now.getTime()
  const rows = await db
    .select({
      bytes: sql<number>`COALESCE(SUM(${orgQuotaEntitlements.bytes}), 0)`,
    })
    .from(orgQuotaEntitlements)
    .where(
      sql`${orgQuotaEntitlements.orgId} = ${orgId}
        AND ${orgQuotaEntitlements.resourceType} = ${resourceType}
        AND ${orgQuotaEntitlements.status} = 'active'
        AND ${orgQuotaEntitlements.startsAt} <= ${nowMs}
        AND (${orgQuotaEntitlements.expiresAt} IS NULL OR ${orgQuotaEntitlements.expiresAt} > ${nowMs})`,
    )

  return Number(rows[0]?.bytes ?? 0)
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
          AND (${orgQuotas.trafficQuota} = 0 OR ${bytes} <= ${effectiveTrafficQuotaSql(orgId, now)})`,
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
        AND (${orgQuotas.trafficQuota} = 0 OR ${orgQuotas.trafficUsed} + ${bytes} <= ${effectiveTrafficQuotaSql(orgId, now)})`,
    )
    .returning({ id: orgQuotas.id })

  return updated.length > 0
}

export async function refundTraffic(db: Database, orgId: string, bytes: number, now = new Date()): Promise<void> {
  if (bytes <= 0) return
  const period = currentTrafficPeriod(now)
  await db
    .update(orgQuotas)
    .set({
      trafficUsed: sql`CASE WHEN ${orgQuotas.trafficUsed} > ${bytes} THEN ${orgQuotas.trafficUsed} - ${bytes} ELSE 0 END`,
    })
    .where(sql`${orgQuotas.orgId} = ${orgId} AND ${orgQuotas.trafficPeriod} = ${period}`)
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
            AND (${orgQuotas.quota} = 0 OR ${orgQuotas.used} + ${bytes} <= ${effectiveStorageQuotaSql(orgId)})`,
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

function effectiveStorageQuotaSql(orgId: string) {
  const nowMs = Date.now()
  return activeEntitlementQuotaSql(orgId, 'storage', nowMs, orgQuotas.quota)
}

function effectiveTrafficQuotaSql(orgId: string, now: Date) {
  return activeEntitlementQuotaSql(orgId, 'traffic', now.getTime(), orgQuotas.trafficQuota)
}

function activeEntitlementQuotaSql(
  orgId: string,
  resourceType: 'storage' | 'traffic',
  nowMs: number,
  baseColumn: typeof orgQuotas.quota | typeof orgQuotas.trafficQuota,
) {
  return sql`${baseColumn} + COALESCE((
    SELECT SUM(${orgQuotaEntitlements.bytes})
    FROM ${orgQuotaEntitlements}
    WHERE ${orgQuotaEntitlements.orgId} = ${orgId}
      AND ${orgQuotaEntitlements.resourceType} = ${resourceType}
      AND ${orgQuotaEntitlements.status} = 'active'
      AND ${orgQuotaEntitlements.startsAt} <= ${nowMs}
      AND (${orgQuotaEntitlements.expiresAt} IS NULL OR ${orgQuotaEntitlements.expiresAt} > ${nowMs})
  ), 0)`
}
