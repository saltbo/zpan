import { and, eq, or, sql } from 'drizzle-orm'
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
  expiresAt: string | null
  subscription: boolean
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

  const defaultQuota = quotaRow?.baseQuota ?? 0
  const storagePlan = await activePlanEntitlement(db, orgId, 'storage', now)
  const planQuota = storagePlan?.bytes ?? 0
  const baseQuota = planQuota > 0 ? planQuota : defaultQuota
  const entitlementQuota = await activeExtraEntitlementBytes(db, orgId, 'storage', now)
  const storageExtraNames = await activeExtraEntitlementNames(db, orgId, 'storage', now)
  const entitlementTrafficQuota = await activeExtraEntitlementBytes(db, orgId, 'traffic', now)
  const trafficExtraNames = await activeExtraEntitlementNames(db, orgId, 'traffic', now)
  const trafficUsed = quotaRow && quotaRow.trafficPeriod === period ? quotaRow.trafficUsed : 0
  const trafficPeriod = quotaRow?.trafficPeriod === period ? quotaRow.trafficPeriod : period
  const defaultTrafficQuota = quotaRow?.trafficQuota ?? 0
  const trafficPlan = await activePlanEntitlement(db, orgId, 'traffic', now)
  const planTrafficQuota = trafficPlan?.bytes ?? 0
  const baseTrafficQuota = planTrafficQuota > 0 ? planTrafficQuota : defaultTrafficQuota
  const currentPlan = buildCurrentPlan(storagePlan, trafficPlan)
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
    const planBytes = activePlanEntitlementBytesSql(orgId, 'traffic', now)
    const extraBytes = activeExtraEntitlementBytesSql(orgId, 'traffic', now)
    const limitBytes = effectiveQuotaLimitSql(orgQuotas.trafficQuota, planBytes, extraBytes)
    const updated = await db
      .update(orgQuotas)
      .set({ trafficUsed: bytes, trafficPeriod: period })
      .where(
        sql`${orgQuotas.orgId} = ${orgId}
          AND ${orgQuotas.trafficPeriod} != ${period}
          AND (
            (${orgQuotas.trafficQuota} = 0 AND ${planBytes} = 0 AND ${extraBytes} = 0)
            OR ${bytes} <= ${limitBytes}
          )`,
      )
      .returning({ id: orgQuotas.id })
    if (updated.length > 0) return true
  }

  const planBytes = activePlanEntitlementBytesSql(orgId, 'traffic', now)
  const extraBytes = activeExtraEntitlementBytesSql(orgId, 'traffic', now)
  const limitBytes = effectiveQuotaLimitSql(orgQuotas.trafficQuota, planBytes, extraBytes)
  const updated = await db
    .update(orgQuotas)
    .set({ trafficUsed: sql`${orgQuotas.trafficUsed} + ${bytes}` })
    .where(
      sql`${orgQuotas.orgId} = ${orgId}
        AND ${orgQuotas.trafficPeriod} = ${period}
        AND (
          (${orgQuotas.trafficQuota} = 0 AND ${planBytes} = 0 AND ${extraBytes} = 0)
          OR ${orgQuotas.trafficUsed} + ${bytes} <= ${limitBytes}
        )`,
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
  now = new Date(),
): Promise<boolean> {
  if (teamQuotaEnabled) {
    const rows = await db.select({ id: orgQuotas.id }).from(orgQuotas).where(eq(orgQuotas.orgId, orgId)).limit(1)
    if (rows.length > 0) {
      const planBytes = activePlanEntitlementBytesSql(orgId, 'storage', now)
      const extraBytes = activeExtraEntitlementBytesSql(orgId, 'storage', now)
      const limitBytes = effectiveQuotaLimitSql(orgQuotas.quota, planBytes, extraBytes)
      const updated = await db
        .update(orgQuotas)
        .set({ used: sql`${orgQuotas.used} + ${bytes}` })
        .where(
          sql`${orgQuotas.orgId} = ${orgId}
            AND (
              (${orgQuotas.quota} = 0 AND ${planBytes} = 0 AND ${extraBytes} = 0)
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

  const metadata = entitlementMetadata(row.metadata)
  return {
    sourceId: row.sourceId,
    bytes: row.bytes,
    name: metadata?.packageName ?? null,
    packageId: metadata?.packageId ?? null,
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
  return activeEntitlementWhere(
    orgId,
    resourceType,
    now,
    sql`${orgQuotaEntitlements.sourceId} LIKE 'stripe_subscription:%'`,
  )
}

function activeExtraEntitlementWhere(orgId: string, resourceType: 'storage' | 'traffic', now: Date) {
  return activeEntitlementWhere(
    orgId,
    resourceType,
    now,
    sql`${orgQuotaEntitlements.sourceId} NOT LIKE 'stripe_subscription:%'`,
  )
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

function activePlanEntitlementBytesSql(orgId: string, resourceType: 'storage' | 'traffic', now: Date) {
  return activeEntitlementBytesSql({
    aggregate: sql`MAX(${orgQuotaEntitlements.bytes})`,
    orgId,
    resourceType,
    now,
    sourceCondition: sql`${orgQuotaEntitlements.sourceId} LIKE 'stripe_subscription:%'`,
  })
}

function activeExtraEntitlementBytesSql(orgId: string, resourceType: 'storage' | 'traffic', now: Date) {
  return activeEntitlementBytesSql({
    aggregate: sql`SUM(${orgQuotaEntitlements.bytes})`,
    orgId,
    resourceType,
    now,
    sourceCondition: sql`${orgQuotaEntitlements.sourceId} NOT LIKE 'stripe_subscription:%'`,
  })
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

function effectiveQuotaLimitSql(
  defaultQuota: typeof orgQuotas.quota | typeof orgQuotas.trafficQuota,
  planBytes: ReturnType<typeof sql>,
  extraBytes: ReturnType<typeof sql>,
) {
  return sql`CASE WHEN ${planBytes} > 0 THEN ${planBytes} ELSE ${defaultQuota} END + ${extraBytes}`
}

interface PlanEntitlement {
  sourceId: string
  bytes: number
  name: string | null
  packageId: string | null
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
    expiresAt: plan.expiresAt ?? trafficPlan?.expiresAt ?? null,
    subscription: isSubscriptionSourceId(plan.sourceId),
  }
}

function entitlementMetadata(metadata: string | null) {
  if (!metadata) return null
  const parsed = JSON.parse(metadata) as { packageId?: unknown; packageName?: unknown }
  return {
    packageId: typeof parsed.packageId === 'string' ? parsed.packageId : null,
    packageName: typeof parsed.packageName === 'string' ? parsed.packageName : null,
  }
}

function entitlementName(metadata: string | null) {
  return entitlementMetadata(metadata)?.packageName ?? null
}

function isSubscriptionSourceId(sourceId: string) {
  return sourceId.startsWith('stripe_subscription:')
}
