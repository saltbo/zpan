import { and, eq, inArray, or, sql } from 'drizzle-orm'
import { orgQuotaEntitlements, orgQuotas, storages } from '../db/schema'
import type { Database } from '../platform/interface'

export interface EffectiveQuota {
  orgId: string
  baseQuota: number
  entitlementQuota: number
  quota: number
  used: number
  baseTrafficQuota: number
  entitlementTrafficQuota: number
  trafficQuota: number
  trafficUsed: number
  trafficPeriod: string
  storagePlanName: string | null
  storageExtraNames: string[]
  trafficPlanName: string | null
  trafficExtraNames: string[]
  currentPlan: CurrentStoragePlan | null
}

export interface CurrentStoragePlan {
  sourceId: string
  packageId: string | null
  name: string
  storageBytes: number
  trafficBytes: number
  trafficOveragePriceCents: number | null
  expiresAt: string | null
  subscription: boolean
}

export function currentTrafficPeriod(now = new Date()): string {
  const month = String(now.getUTCMonth() + 1).padStart(2, '0')
  return `${now.getUTCFullYear()}-${month}`
}

export async function getEffectiveQuota(db: Database, orgId: string, now = new Date()): Promise<EffectiveQuota> {
  const period = currentTrafficPeriod(now)

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

  const storagePlan = await activePlanEntitlement(db, orgId, 'storage', now)
  const entitlementQuota = await activeExtraEntitlementBytes(db, orgId, 'storage', now)
  const storageExtraNames = await activeExtraEntitlementNames(db, orgId, 'storage', now)
  const entitlementTrafficQuota = await activeExtraEntitlementBytes(db, orgId, 'traffic', now)
  const trafficExtraNames = await activeExtraEntitlementNames(db, orgId, 'traffic', now)
  const trafficUsed = quotaRow && quotaRow.trafficPeriod === period ? quotaRow.trafficUsed : 0
  const trafficPeriod = quotaRow?.trafficPeriod === period ? quotaRow.trafficPeriod : period
  const trafficPlan = await activePlanEntitlement(db, orgId, 'traffic', now)
  const currentPlan = buildCurrentPlan(storagePlan, trafficPlan)
  const baseQuota = storagePlan?.bytes ?? 0
  const baseTrafficQuota = trafficPlan?.bytes ?? 0
  return {
    orgId,
    baseQuota,
    entitlementQuota,
    quota: baseQuota + entitlementQuota,
    used: quotaRow?.used ?? 0,
    baseTrafficQuota,
    entitlementTrafficQuota,
    trafficQuota: baseTrafficQuota + entitlementTrafficQuota,
    trafficUsed,
    trafficPeriod,
    storagePlanName: storagePlan?.name ?? null,
    storageExtraNames,
    trafficPlanName: trafficPlan?.name ?? null,
    trafficExtraNames,
    currentPlan,
  }
}

// Batch variant of getEffectiveQuota for list views. Resolves every org with two
// queries total (quota rows + active entitlements) instead of ~8 per org, then
// aggregates in memory. Returns one entry per requested orgId, even with no rows.
export async function getEffectiveQuotasByOrg(
  db: Database,
  orgIds: string[],
  now = new Date(),
): Promise<Map<string, EffectiveQuota>> {
  const result = new Map<string, EffectiveQuota>()
  if (orgIds.length === 0) return result

  const period = currentTrafficPeriod(now)
  const timestamp = now.getTime()

  const quotaRows = await db
    .select({
      orgId: orgQuotas.orgId,
      used: orgQuotas.used,
      trafficUsed: orgQuotas.trafficUsed,
      trafficPeriod: orgQuotas.trafficPeriod,
    })
    .from(orgQuotas)
    .where(inArray(orgQuotas.orgId, orgIds))
  const quotaByOrg = new Map(quotaRows.map((r) => [r.orgId, r]))

  const entRows = await db
    .select({
      orgId: orgQuotaEntitlements.orgId,
      resourceType: orgQuotaEntitlements.resourceType,
      entitlementType: orgQuotaEntitlements.entitlementType,
      sourceId: orgQuotaEntitlements.sourceId,
      bytes: orgQuotaEntitlements.bytes,
      startsAt: orgQuotaEntitlements.startsAt,
      expiresAt: orgQuotaEntitlements.expiresAt,
      metadata: orgQuotaEntitlements.metadata,
    })
    .from(orgQuotaEntitlements)
    .where(
      and(
        inArray(orgQuotaEntitlements.orgId, orgIds),
        eq(orgQuotaEntitlements.status, 'active'),
        sql`${orgQuotaEntitlements.startsAt} <= ${timestamp}`,
        or(sql`${orgQuotaEntitlements.expiresAt} IS NULL`, sql`${orgQuotaEntitlements.expiresAt} > ${timestamp}`),
      ),
    )

  const entByOrg = new Map<string, typeof entRows>()
  for (const row of entRows) {
    const list = entByOrg.get(row.orgId)
    if (list) list.push(row)
    else entByOrg.set(row.orgId, [row])
  }

  for (const orgId of orgIds) {
    const quotaRow = quotaByOrg.get(orgId)
    const ents = entByOrg.get(orgId) ?? []

    const storagePlan = pickPlanEntitlement(ents, 'storage')
    const trafficPlan = pickPlanEntitlement(ents, 'traffic')
    const entitlementQuota = sumExtraEntitlementBytes(ents, 'storage')
    const entitlementTrafficQuota = sumExtraEntitlementBytes(ents, 'traffic')

    const trafficUsed = quotaRow && quotaRow.trafficPeriod === period ? quotaRow.trafficUsed : 0
    const trafficPeriod = quotaRow?.trafficPeriod === period ? quotaRow.trafficPeriod : period
    const baseQuota = storagePlan?.bytes ?? 0
    const baseTrafficQuota = trafficPlan?.bytes ?? 0

    result.set(orgId, {
      orgId,
      baseQuota,
      entitlementQuota,
      quota: baseQuota + entitlementQuota,
      used: quotaRow?.used ?? 0,
      baseTrafficQuota,
      entitlementTrafficQuota,
      trafficQuota: baseTrafficQuota + entitlementTrafficQuota,
      trafficUsed,
      trafficPeriod,
      storagePlanName: storagePlan?.name ?? null,
      storageExtraNames: extraEntitlementNames(ents, 'storage'),
      trafficPlanName: trafficPlan?.name ?? null,
      trafficExtraNames: extraEntitlementNames(ents, 'traffic'),
      currentPlan: buildCurrentPlan(storagePlan, trafficPlan),
    })
  }

  return result
}

interface EntitlementRow {
  resourceType: string
  entitlementType: string
  sourceId: string
  bytes: number
  startsAt: Date
  expiresAt: Date | null
  metadata: string | null
}

// Mirrors activePlanEntitlement's ORDER BY bytes DESC, startsAt DESC LIMIT 1.
function pickPlanEntitlement(ents: EntitlementRow[], resourceType: 'storage' | 'traffic'): PlanEntitlement | null {
  const plans = ents
    .filter((e) => e.resourceType === resourceType && e.entitlementType === 'plan')
    .sort((a, b) => b.bytes - a.bytes || b.startsAt.getTime() - a.startsAt.getTime())
  const row = plans[0]
  return row ? toPlanEntitlement(row) : null
}

function sumExtraEntitlementBytes(ents: EntitlementRow[], resourceType: 'storage' | 'traffic'): number {
  return ents
    .filter((e) => e.resourceType === resourceType && e.entitlementType !== 'plan')
    .reduce((sum, e) => sum + e.bytes, 0)
}

function extraEntitlementNames(ents: EntitlementRow[], resourceType: 'storage' | 'traffic'): string[] {
  const names = ents
    .filter((e) => e.resourceType === resourceType && e.entitlementType !== 'plan')
    .flatMap((e) => {
      const name = entitlementName(e.metadata)
      return name ? [name] : []
    })
  return Array.from(new Set(names))
}

// Persists the monthly traffic reset for every org whose recorded period is stale.
// Idempotent: the WHERE clause matches nothing once a period has been reset, so it
// is safe to run on a schedule. getEffectiveQuota already normalizes stale periods
// in memory, so reads stay correct even between scheduled runs.
export async function resetExpiredTrafficQuotas(db: Database, now = new Date()): Promise<void> {
  const period = currentTrafficPeriod(now)
  await db
    .update(orgQuotas)
    .set({ trafficUsed: 0, trafficPeriod: period })
    .where(sql`${orgQuotas.trafficPeriod} != ${period}`)
}

export async function hasQuotaForBytes(db: Database, orgId: string, bytes: number): Promise<boolean> {
  if (bytes <= 0) return true
  const quota = await getEffectiveQuota(db, orgId)
  if (quota.baseQuota === 0 && quota.entitlementQuota === 0) return true
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
  if (quota.baseTrafficQuota === 0 && quota.entitlementTrafficQuota === 0) return true
  if ((quota.currentPlan?.trafficOveragePriceCents ?? 0) > 0) return true
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

  const trafficOverageAllowed = await hasActiveTrafficOverage(db, orgId, now)
  const overageAllowedSql = trafficOverageAllowed ? sql`1 = 1` : sql`1 = 0`

  if (quotaRows[0].trafficPeriod !== period) {
    const limitBytes = activeEntitlementBytesSql({
      aggregate: sql`SUM(${orgQuotaEntitlements.bytes})`,
      orgId,
      resourceType: 'traffic',
      now,
      sourceCondition: sql`1 = 1`,
    })
    const updated = await db
      .update(orgQuotas)
      .set({ trafficUsed: bytes, trafficPeriod: period })
      .where(
        sql`${orgQuotas.orgId} = ${orgId}
          AND ${orgQuotas.trafficPeriod} != ${period}
          AND (
            (${limitBytes} = 0)
            OR ${overageAllowedSql}
            OR ${bytes} <= ${limitBytes}
          )`,
      )
      .returning({ id: orgQuotas.id })
    if (updated.length > 0) return true
  }

  const limitBytes = activeEntitlementBytesSql({
    aggregate: sql`SUM(${orgQuotaEntitlements.bytes})`,
    orgId,
    resourceType: 'traffic',
    now,
    sourceCondition: sql`1 = 1`,
  })
  const updated = await db
    .update(orgQuotas)
    .set({ trafficUsed: sql`${orgQuotas.trafficUsed} + ${bytes}` })
    .where(
      sql`${orgQuotas.orgId} = ${orgId}
        AND ${orgQuotas.trafficPeriod} = ${period}
        AND (
          (${limitBytes} = 0)
          OR ${overageAllowedSql}
          OR ${orgQuotas.trafficUsed} + ${bytes} <= ${limitBytes}
        )`,
    )
    .returning({ id: orgQuotas.id })

  return updated.length > 0
}

async function hasActiveTrafficOverage(db: Database, orgId: string, now: Date) {
  const trafficPlan = await activePlanEntitlement(db, orgId, 'traffic', now)
  return (trafficPlan?.trafficOveragePriceCents ?? 0) > 0
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
  now = new Date(),
): Promise<boolean> {
  if (teamQuotaEnabled) {
    const rows = await db.select({ id: orgQuotas.id }).from(orgQuotas).where(eq(orgQuotas.orgId, orgId)).limit(1)
    if (rows.length > 0) {
      const limitBytes = activeEntitlementBytesSql({
        aggregate: sql`SUM(${orgQuotaEntitlements.bytes})`,
        orgId,
        resourceType: 'storage',
        now,
        sourceCondition: sql`1 = 1`,
      })
      const updated = await db
        .update(orgQuotas)
        .set({ used: sql`${orgQuotas.used} + ${bytes}` })
        .where(
          sql`${orgQuotas.orgId} = ${orgId}
            AND (
              (${limitBytes} = 0)
              OR ${orgQuotas.used} + ${bytes} <= ${limitBytes}
            )`,
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

async function activePlanEntitlement(
  db: Database,
  orgId: string,
  resourceType: 'storage' | 'traffic',
  now: Date,
): Promise<PlanEntitlement | null> {
  const rows = await db
    .select({
      sourceId: orgQuotaEntitlements.sourceId,
      bytes: orgQuotaEntitlements.bytes,
      expiresAt: orgQuotaEntitlements.expiresAt,
      metadata: orgQuotaEntitlements.metadata,
    })
    .from(orgQuotaEntitlements)
    .where(activePlanEntitlementWhere(orgId, resourceType, now))
    .orderBy(sql`${orgQuotaEntitlements.bytes} DESC, ${orgQuotaEntitlements.startsAt} DESC`)
    .limit(1)

  const row = rows[0]
  if (!row) return null
  return toPlanEntitlement(row)
}

function toPlanEntitlement(row: {
  sourceId: string
  bytes: number
  expiresAt: Date | null
  metadata: string | null
}): PlanEntitlement {
  const metadata = entitlementMetadata(row.metadata)
  return {
    sourceId: row.sourceId,
    bytes: row.bytes,
    name: metadata?.packageName ?? null,
    packageId: metadata?.packageId ?? null,
    trafficOveragePriceCents: metadata?.trafficOveragePriceCents ?? null,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
  }
}

async function activeExtraEntitlementBytes(
  db: Database,
  orgId: string,
  resourceType: 'storage' | 'traffic',
  now: Date,
): Promise<number> {
  const rows = await db
    .select({ bytes: sql<number>`COALESCE(SUM(${orgQuotaEntitlements.bytes}), 0)` })
    .from(orgQuotaEntitlements)
    .where(activeExtraEntitlementWhere(orgId, resourceType, now))

  return rows[0]?.bytes ?? 0
}

async function activeExtraEntitlementNames(
  db: Database,
  orgId: string,
  resourceType: 'storage' | 'traffic',
  now: Date,
): Promise<string[]> {
  const rows = await db
    .select({ metadata: orgQuotaEntitlements.metadata })
    .from(orgQuotaEntitlements)
    .where(activeExtraEntitlementWhere(orgId, resourceType, now))

  const names = rows.flatMap((row) => {
    const name = entitlementName(row.metadata)
    return name ? [name] : []
  })
  return Array.from(new Set(names))
}

function activePlanEntitlementWhere(orgId: string, resourceType: 'storage' | 'traffic', now: Date) {
  return activeEntitlementWhere(orgId, resourceType, now, sql`${orgQuotaEntitlements.entitlementType} = 'plan'`)
}

function activeExtraEntitlementWhere(orgId: string, resourceType: 'storage' | 'traffic', now: Date) {
  return activeEntitlementWhere(orgId, resourceType, now, sql`${orgQuotaEntitlements.entitlementType} != 'plan'`)
}

function activeEntitlementWhere(
  orgId: string,
  resourceType: 'storage' | 'traffic',
  now: Date,
  sourceCondition: ReturnType<typeof sql>,
) {
  const timestamp = now.getTime()
  return and(
    eq(orgQuotaEntitlements.orgId, orgId),
    eq(orgQuotaEntitlements.resourceType, resourceType),
    eq(orgQuotaEntitlements.status, 'active'),
    sql`${orgQuotaEntitlements.startsAt} <= ${timestamp}`,
    or(sql`${orgQuotaEntitlements.expiresAt} IS NULL`, sql`${orgQuotaEntitlements.expiresAt} > ${timestamp}`),
    sourceCondition,
  )
}

function activeEntitlementBytesSql({
  aggregate,
  orgId,
  resourceType,
  now,
  sourceCondition,
}: {
  aggregate: ReturnType<typeof sql>
  orgId: string
  resourceType: 'storage' | 'traffic'
  now: Date
  sourceCondition: ReturnType<typeof sql>
}) {
  const timestamp = now.getTime()
  return sql`(
    SELECT COALESCE(${aggregate}, 0)
    FROM ${orgQuotaEntitlements}
    WHERE ${orgQuotaEntitlements.orgId} = ${orgId}
      AND ${orgQuotaEntitlements.resourceType} = ${resourceType}
      AND ${orgQuotaEntitlements.status} = 'active'
      AND ${orgQuotaEntitlements.startsAt} <= ${timestamp}
      AND (${orgQuotaEntitlements.expiresAt} IS NULL OR ${orgQuotaEntitlements.expiresAt} > ${timestamp})
      AND ${sourceCondition}
  )`
}

interface PlanEntitlement {
  sourceId: string
  bytes: number
  name: string | null
  packageId: string | null
  trafficOveragePriceCents: number | null
  expiresAt: string | null
}

function buildCurrentPlan(
  storagePlan: PlanEntitlement | null,
  trafficPlan: PlanEntitlement | null,
): CurrentStoragePlan | null {
  const plan = storagePlan ?? trafficPlan
  if (!plan) return null

  return {
    sourceId: plan.sourceId,
    packageId: plan.packageId,
    name: plan.name ?? trafficPlan?.name ?? plan.sourceId,
    storageBytes: storagePlan?.bytes ?? 0,
    trafficBytes: trafficPlan?.bytes ?? 0,
    trafficOveragePriceCents: trafficPlan?.trafficOveragePriceCents ?? null,
    expiresAt: plan.expiresAt ?? trafficPlan?.expiresAt ?? null,
    subscription: isSubscriptionSourceId(plan.sourceId),
  }
}

function entitlementMetadata(metadata: string | null) {
  if (!metadata) return null
  const parsed = JSON.parse(metadata) as {
    packageId?: unknown
    packageName?: unknown
    trafficOveragePriceCents?: unknown
  }
  return {
    packageId: typeof parsed.packageId === 'string' ? parsed.packageId : null,
    packageName: typeof parsed.packageName === 'string' ? parsed.packageName : null,
    trafficOveragePriceCents:
      typeof parsed.trafficOveragePriceCents === 'number' && parsed.trafficOveragePriceCents > 0
        ? parsed.trafficOveragePriceCents
        : null,
  }
}

function entitlementName(metadata: string | null) {
  return entitlementMetadata(metadata)?.packageName ?? null
}

function isSubscriptionSourceId(sourceId: string) {
  return sourceId.startsWith('stripe_subscription:')
}
