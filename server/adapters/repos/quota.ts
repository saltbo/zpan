import { DEFAULT_ORG_QUOTA, DEFAULT_ORG_TRAFFIC_QUOTA } from '@shared/constants'
import { and, eq, inArray, or, sql } from 'drizzle-orm'
import { organization } from '../../db/auth-schema'
import { orgQuotaEntitlements, orgQuotas, storages, systemOptions } from '../../db/schema'
import { currentTrafficPeriod } from '../../domain/quota'
import type { Database } from '../../platform/interface'
import type { CurrentStoragePlan, EffectiveQuota, QuotaRepo } from '../../usecases/ports'

async function getEffectiveQuota(db: Database, orgId: string, now = new Date()): Promise<EffectiveQuota> {
  // Delegate to the batch path's single in-memory aggregation. It always
  // returns an entry for every requested orgId (zero-filled when absent).
  const byOrg = await getEffectiveQuotasByOrg(db, [orgId], now)
  return byOrg.get(orgId) as EffectiveQuota
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

  // D1 caps a query at 100 bound parameters, so chunk the IN lists. The
  // entitlements query binds a few extra params (status + timestamps) on top of
  // the org ids, so keep chunks comfortably below the cap.
  const chunks = chunk(orgIds, 90)

  const quotaChunks = await Promise.all(
    chunks.map((ids) =>
      db
        .select({
          orgId: orgQuotas.orgId,
          used: orgQuotas.used,
          trafficUsed: orgQuotas.trafficUsed,
          trafficPeriod: orgQuotas.trafficPeriod,
        })
        .from(orgQuotas)
        .where(inArray(orgQuotas.orgId, ids)),
    ),
  )
  const quotaByOrg = new Map(quotaChunks.flat().map((r) => [r.orgId, r]))

  const entChunks = await Promise.all(
    chunks.map((ids) =>
      db
        .select({
          orgId: orgQuotaEntitlements.orgId,
          resourceType: orgQuotaEntitlements.resourceType,
          entitlementType: orgQuotaEntitlements.entitlementType,
          source: orgQuotaEntitlements.source,
          sourceId: orgQuotaEntitlements.sourceId,
          bytes: orgQuotaEntitlements.bytes,
          startsAt: orgQuotaEntitlements.startsAt,
          expiresAt: orgQuotaEntitlements.expiresAt,
          metadata: orgQuotaEntitlements.metadata,
        })
        .from(orgQuotaEntitlements)
        .where(
          and(
            inArray(orgQuotaEntitlements.orgId, ids),
            eq(orgQuotaEntitlements.status, 'active'),
            sql`${orgQuotaEntitlements.startsAt} <= ${timestamp}`,
            or(sql`${orgQuotaEntitlements.expiresAt} IS NULL`, sql`${orgQuotaEntitlements.expiresAt} > ${timestamp}`),
          ),
        ),
    ),
  )

  const entByOrg = new Map<string, EntitlementRow[]>()
  for (const row of entChunks.flat()) {
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

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size))
  }
  return out
}

interface EntitlementRow {
  resourceType: string
  entitlementType: string
  source: string
  sourceId: string
  bytes: number
  startsAt: Date
  expiresAt: Date | null
  metadata: string | null
}

// Mirrors activePlanEntitlement's ORDER BY bytes DESC, startsAt DESC LIMIT 1.
function pickPlanEntitlement(ents: EntitlementRow[], resourceType: 'storage' | 'traffic'): PlanEntitlement | null {
  const plans = ents.filter((e) => e.resourceType === resourceType && e.entitlementType === 'plan')
  const paidPlans = plans.filter((plan) => plan.source !== 'free_plan')
  const row = (paidPlans.length > 0 ? paidPlans : plans).sort(
    (a, b) => b.bytes - a.bytes || b.startsAt.getTime() - a.startsAt.getTime(),
  )[0]
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
async function resetExpiredTrafficQuotas(db: Database, now = new Date()): Promise<void> {
  const period = currentTrafficPeriod(now)
  await db
    .update(orgQuotas)
    .set({ trafficUsed: 0, trafficPeriod: period })
    .where(sql`${orgQuotas.trafficPeriod} != ${period}`)
}

async function reconcileFreePlanBaselines(db: Database, now = new Date()): Promise<void> {
  const rows = await db
    .select({ key: systemOptions.key, value: systemOptions.value })
    .from(systemOptions)
    .where(inArray(systemOptions.key, ['default_org_quota', 'default_team_quota', 'default_org_monthly_traffic_quota']))
  const options = new Map(rows.map((row) => [row.key, row.value]))
  const orgQuota = positiveOption(options.get('default_org_quota'), DEFAULT_ORG_QUOTA)
  const teamQuota = positiveOption(options.get('default_team_quota'), orgQuota)
  const trafficQuota = nonNegativeOption(options.get('default_org_monthly_traffic_quota'), DEFAULT_ORG_TRAFFIC_QUOTA)
  const timestamp = now.getTime()

  await db.run(sql`
    UPDATE org_quota_entitlements
    SET status = 'active', expires_at = NULL, updated_at = ${timestamp}
    WHERE source = 'free_plan' AND entitlement_type = 'plan'
      AND EXISTS (SELECT 1 FROM organization o WHERE o.id = org_quota_entitlements.org_id)
      AND (status <> 'active' OR expires_at IS NOT NULL)
  `)
  await db.run(sql`
    INSERT INTO org_quota_entitlements (
      id, org_id, resource_type, entitlement_type, source, source_id, bytes,
      starts_at, expires_at, status, metadata, created_at, updated_at
    )
    SELECT
      lower(hex(randomblob(16))), o.id, 'storage', 'plan', 'free_plan', 'free_plan:' || o.id,
      CASE WHEN json_valid(o.metadata) = 1 AND json_extract(o.metadata, '$.type') = 'team'
        THEN ${teamQuota} ELSE ${orgQuota} END,
      ${timestamp}, NULL, 'active',
      json_object(
        'packageName', 'Free', 'packageId', NULL, 'source', 'free_plan',
        'settingKey', CASE WHEN json_valid(o.metadata) = 1 AND json_extract(o.metadata, '$.type') = 'team'
          THEN 'default_team_quota' ELSE 'default_org_quota' END
      ),
      ${timestamp}, ${timestamp}
    FROM organization o
    WHERE NOT EXISTS (
      SELECT 1 FROM org_quota_entitlements e
      WHERE e.org_id = o.id AND e.resource_type = 'storage'
        AND e.entitlement_type = 'plan' AND e.source = 'free_plan'
    )
  `)
  await db.run(sql`
    INSERT INTO org_quota_entitlements (
      id, org_id, resource_type, entitlement_type, source, source_id, bytes,
      starts_at, expires_at, status, metadata, created_at, updated_at
    )
    SELECT
      lower(hex(randomblob(16))), o.id, 'traffic', 'plan', 'free_plan', 'free_plan:' || o.id,
      ${trafficQuota}, ${timestamp}, NULL, 'active',
      json_object(
        'packageName', 'Free', 'packageId', NULL, 'source', 'free_plan',
        'settingKey', 'default_org_monthly_traffic_quota'
      ),
      ${timestamp}, ${timestamp}
    FROM organization o
    WHERE NOT EXISTS (
      SELECT 1 FROM org_quota_entitlements e
      WHERE e.org_id = o.id AND e.resource_type = 'traffic'
        AND e.entitlement_type = 'plan' AND e.source = 'free_plan'
    )
  `)
}

function positiveOption(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function nonNegativeOption(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback
}

async function hasQuotaForBytes(db: Database, orgId: string, bytes: number): Promise<boolean> {
  if (bytes <= 0) return true
  const quota = await getEffectiveQuota(db, orgId)
  if (quota.quota <= 0) return false
  return quota.used + bytes <= quota.quota
}

async function hasTrafficQuotaForBytes(db: Database, orgId: string, bytes: number, now = new Date()): Promise<boolean> {
  if (bytes <= 0) return true
  const quota = await getEffectiveQuota(db, orgId, now)
  const trafficPlan = await activePlanEntitlement(db, orgId, 'traffic', now)
  if (quota.trafficQuota === 0) return trafficPlan !== null
  if ((quota.currentPlan?.trafficOveragePriceCents ?? 0) > 0) return true
  return quota.trafficUsed + bytes <= quota.trafficQuota
}

async function consumeTrafficIfQuotaAllows(
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
  if (quotaRows.length === 0) return false

  const trafficOverageAllowed = await hasActiveTrafficOverage(db, orgId, now)
  const overageAllowedSql = trafficOverageAllowed ? sql`1 = 1` : sql`1 = 0`

  if (quotaRows[0].trafficPeriod !== period) {
    const limitBytes = activeEntitlementBytesSql(orgId, 'traffic', now)
    const hasPlan = activePlanEntitlementExistsSql(orgId, 'traffic', now)
    const updated = await db
      .update(orgQuotas)
      .set({ trafficUsed: bytes, trafficPeriod: period })
      .where(
        sql`${orgQuotas.orgId} = ${orgId}
          AND ${orgQuotas.trafficPeriod} != ${period}
          AND (
            (${limitBytes} = 0 AND ${hasPlan})
            OR ${overageAllowedSql}
            OR ${bytes} <= ${limitBytes}
          )`,
      )
      .returning({ id: orgQuotas.id })
    if (updated.length > 0) return true
  }

  const limitBytes = activeEntitlementBytesSql(orgId, 'traffic', now)
  const hasPlan = activePlanEntitlementExistsSql(orgId, 'traffic', now)
  const updated = await db
    .update(orgQuotas)
    .set({ trafficUsed: sql`${orgQuotas.trafficUsed} + ${bytes}` })
    .where(
      sql`${orgQuotas.orgId} = ${orgId}
        AND ${orgQuotas.trafficPeriod} = ${period}
        AND (
          (${limitBytes} = 0 AND ${hasPlan})
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

async function refundTraffic(db: Database, orgId: string, bytes: number, now = new Date()): Promise<void> {
  if (bytes <= 0) return
  const period = currentTrafficPeriod(now)
  await db
    .update(orgQuotas)
    .set({
      trafficUsed: sql`CASE WHEN ${orgQuotas.trafficUsed} > ${bytes} THEN ${orgQuotas.trafficUsed} - ${bytes} ELSE 0 END`,
    })
    .where(sql`${orgQuotas.orgId} = ${orgId} AND ${orgQuotas.trafficPeriod} = ${period}`)
}

async function incrementUsageIfEffectiveQuotaAllows(
  db: Database,
  orgId: string,
  storageId: string,
  bytes: number,
  teamQuotaEnabled = true,
  now = new Date(),
): Promise<boolean> {
  if (teamQuotaEnabled) {
    const rows = await db.select({ id: orgQuotas.id }).from(orgQuotas).where(eq(orgQuotas.orgId, orgId)).limit(1)
    if (rows.length === 0) return false
    const limitBytes = activeEntitlementBytesSql(orgId, 'storage', now)
    const updated = await db
      .update(orgQuotas)
      .set({ used: sql`${orgQuotas.used} + ${bytes}` })
      .where(
        sql`${orgQuotas.orgId} = ${orgId}
          AND ${limitBytes} > 0
          AND ${orgQuotas.used} + ${bytes} <= ${limitBytes}`,
      )
      .returning({ id: orgQuotas.id })

    if (updated.length === 0) return false
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
    .orderBy(
      sql`CASE WHEN ${orgQuotaEntitlements.source} = 'free_plan' THEN 1 ELSE 0 END`,
      sql`${orgQuotaEntitlements.bytes} DESC, ${orgQuotaEntitlements.startsAt} DESC`,
    )
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

function activePlanEntitlementWhere(orgId: string, resourceType: 'storage' | 'traffic', now: Date) {
  return activeEntitlementWhere(orgId, resourceType, now, sql`${orgQuotaEntitlements.entitlementType} = 'plan'`)
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

function activeEntitlementBytesSql(orgId: string, resourceType: 'storage' | 'traffic', now: Date) {
  const timestamp = now.getTime()
  return sql`(
    SELECT
      COALESCE(
        MAX(CASE WHEN ${orgQuotaEntitlements.entitlementType} = 'plan' AND ${orgQuotaEntitlements.source} <> 'free_plan' THEN ${orgQuotaEntitlements.bytes} END),
        MAX(CASE WHEN ${orgQuotaEntitlements.entitlementType} = 'plan' THEN ${orgQuotaEntitlements.bytes} END),
        0
      )
      + COALESCE(SUM(CASE WHEN ${orgQuotaEntitlements.entitlementType} <> 'plan' THEN ${orgQuotaEntitlements.bytes} ELSE 0 END), 0)
    FROM ${orgQuotaEntitlements}
    WHERE ${orgQuotaEntitlements.orgId} = ${orgId}
      AND ${orgQuotaEntitlements.resourceType} = ${resourceType}
      AND ${orgQuotaEntitlements.status} = 'active'
      AND ${orgQuotaEntitlements.startsAt} <= ${timestamp}
      AND (${orgQuotaEntitlements.expiresAt} IS NULL OR ${orgQuotaEntitlements.expiresAt} > ${timestamp})
  )`
}

function activePlanEntitlementExistsSql(orgId: string, resourceType: 'storage' | 'traffic', now: Date) {
  const timestamp = now.getTime()
  return sql`EXISTS (
    SELECT 1
    FROM ${orgQuotaEntitlements}
    WHERE ${orgQuotaEntitlements.orgId} = ${orgId}
      AND ${orgQuotaEntitlements.resourceType} = ${resourceType}
      AND ${orgQuotaEntitlements.entitlementType} = 'plan'
      AND ${orgQuotaEntitlements.status} = 'active'
      AND ${orgQuotaEntitlements.startsAt} <= ${timestamp}
      AND (${orgQuotaEntitlements.expiresAt} IS NULL OR ${orgQuotaEntitlements.expiresAt} > ${timestamp})
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

async function listOrgQuotaOverview(db: Database) {
  return db
    .select({
      id: orgQuotas.id,
      orgId: orgQuotas.orgId,
      orgName: organization.name,
      orgMetadata: organization.metadata,
    })
    .from(orgQuotas)
    .innerJoin(organization, eq(organization.id, orgQuotas.orgId))
    .orderBy(organization.name)
}

export function createQuotaRepo(db: Database): QuotaRepo {
  return {
    listOrgQuotaOverview: () => listOrgQuotaOverview(db),
    getEffectiveQuota: (orgId, now) => getEffectiveQuota(db, orgId, now),
    getEffectiveQuotasByOrg: (orgIds, now) => getEffectiveQuotasByOrg(db, orgIds, now),
    reconcileFreePlanBaselines: (now) => reconcileFreePlanBaselines(db, now),
    resetExpiredTrafficQuotas: (now) => resetExpiredTrafficQuotas(db, now),
    hasQuotaForBytes: (orgId, bytes) => hasQuotaForBytes(db, orgId, bytes),
    hasTrafficQuotaForBytes: (orgId, bytes, now) => hasTrafficQuotaForBytes(db, orgId, bytes, now),
    consumeTrafficIfQuotaAllows: (orgId, bytes, now) => consumeTrafficIfQuotaAllows(db, orgId, bytes, now),
    refundTraffic: (orgId, bytes, now) => refundTraffic(db, orgId, bytes, now),
    incrementUsageIfEffectiveQuotaAllows: (orgId, storageId, bytes, teamQuotaEnabled, now) =>
      incrementUsageIfEffectiveQuotaAllows(db, orgId, storageId, bytes, teamQuotaEnabled, now),
  }
}
