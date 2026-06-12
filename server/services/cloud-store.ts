import type { CloudOrderQuotaChange } from '@shared/schemas'
import type { CloudStoreTarget } from '@shared/types'
import { and, eq, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { member, organization, user } from '../db/auth-schema'
import { activityEvents, orgQuotaEntitlements, orgQuotas, webhookEvents } from '../db/schema'
import { loadActiveLicenseBinding } from '../licensing/license-state'
import type { Database } from '../platform/interface'
import { type AtomicQuery, executeRows, executeWriteTransaction } from './db-transaction'

export async function getAccessibleTargets(db: Database, userId: string): Promise<CloudStoreTarget[]> {
  const rows = await db
    .select({ orgId: organization.id, name: organization.name, metadata: organization.metadata, role: member.role })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(eq(member.userId, userId))
    .orderBy(organization.name)

  return rows.map((r) => ({ orgId: r.orgId, name: r.name, type: parseOrgType(r.metadata), role: r.role }))
}

export async function getCloudStoreBinding(
  db: Database,
): Promise<{ boundLicenseId: string; storeId: string; refreshToken: string; instanceId: string }> {
  const binding = await loadActiveLicenseBinding(db)
  if (!binding?.refreshToken || !binding.cloudStoreId) throw new Error('quota_store_binding_missing')
  return {
    boundLicenseId: binding.cloudBindingId,
    storeId: binding.cloudStoreId,
    refreshToken: binding.refreshToken,
    instanceId: binding.instanceId,
  }
}

// Cloud-side accounting label for an order. Team purchases are labeled with
// the team name (the org is the customer); personal purchases keep the
// purchaser's email. Personal orgs are identified by their `personal-` slug.
export async function getCustomerLabel(db: Database, userId: string, orgId: string): Promise<string | null> {
  const orgs = await db
    .select({ name: organization.name, slug: organization.slug })
    .from(organization)
    .where(eq(organization.id, orgId))
    .limit(1)
  const org = orgs[0]
  if (org && !org.slug.startsWith('personal-')) return org.name

  const rows = await db.select({ email: user.email }).from(user).where(eq(user.id, userId)).limit(1)
  return rows[0]?.email ?? null
}

export async function processCloudOrderQuotaChange(
  db: Database,
  event: CloudOrderQuotaChange,
  rawPayload: string,
  payloadHash: string,
): Promise<{ duplicate: boolean; eventId: string }> {
  const webhook = await beginWebhookEvent(db, event, rawPayload, payloadHash)
  if (webhook.duplicate) return { duplicate: true, eventId: event.eventId }

  try {
    await processQuotaChangeTransaction(db, webhook.id, event)
  } catch (error) {
    await markWebhookEvent(db, webhook.id, 'failed', (error as Error).message)
    throw error
  }

  return { duplicate: false, eventId: event.eventId }
}

async function processQuotaChangeTransaction(
  db: Database,
  webhookId: string,
  event: CloudOrderQuotaChange,
): Promise<void> {
  const now = new Date(event.occurredAt ?? Date.now())
  await requireTargetQuota(db, event.targetOrgId)

  await executeWriteTransaction(db, [
    ...quotaChangeQueries(db, event, now),
    db.insert(activityEvents).values(quotaChangeAuditValues(event)),
    db
      .update(webhookEvents)
      .set({ status: 'processed', error: null, processedAt: new Date() })
      .where(eq(webhookEvents.id, webhookId)),
  ])
}

function quotaChangeQueries(db: Database, event: CloudOrderQuotaChange, now: Date): AtomicQuery[] {
  return event.direction === 'increase'
    ? insertQuotaEntitlementQueries(db, event, now)
    : revokeQuotaEntitlementQueries(db, event, now)
}

function quotaChangeAuditValues(event: CloudOrderQuotaChange): typeof activityEvents.$inferInsert {
  return {
    id: nanoid(),
    orgId: event.targetOrgId,
    userId: event.customerId ?? 'cloud-store',
    action: `quota_order_${event.direction}`,
    targetType: 'quota',
    targetId: event.targetOrgId,
    targetName: event.targetOrgId,
    metadata: JSON.stringify({
      eventId: event.eventId,
      eventType: event.eventType,
      direction: event.direction,
      storageBytes: event.storageBytes,
      trafficBytes: event.trafficBytes,
      cloudOrderId: event.cloudOrderId ?? null,
      packageName: event.packageName ?? null,
    }),
    createdAt: new Date(),
  }
}

async function requireTargetQuota(db: Database, orgId: string): Promise<void> {
  const rows = await executeRows(
    db.select({ id: orgQuotas.id }).from(orgQuotas).where(eq(orgQuotas.orgId, orgId)).limit(1),
  )
  if (rows.length === 0) throw new Error('target_quota_missing')
}

function insertQuotaEntitlementQueries(db: Database, event: CloudOrderQuotaChange, now: Date): AtomicQuery[] {
  return quotaEntitlementValues(event, now).flatMap((value) => [
    ...revokeExistingPlanQueries(db, value, now),
    db
      .insert(orgQuotaEntitlements)
      .values(value)
      .onConflictDoUpdate({
        target: [orgQuotaEntitlements.source, orgQuotaEntitlements.sourceId, orgQuotaEntitlements.resourceType],
        set: quotaEntitlementIncreaseValues(value, now),
      }),
  ])
}

function revokeExistingPlanQueries(
  db: Database,
  value: typeof orgQuotaEntitlements.$inferInsert,
  now: Date,
): AtomicQuery[] {
  if (value.entitlementType !== 'plan') return []
  return [
    db
      .update(orgQuotaEntitlements)
      .set({ status: 'revoked', updatedAt: now })
      .where(
        and(
          eq(orgQuotaEntitlements.orgId, value.orgId),
          eq(orgQuotaEntitlements.resourceType, value.resourceType),
          eq(orgQuotaEntitlements.entitlementType, 'plan'),
          eq(orgQuotaEntitlements.status, 'active'),
          sql`${orgQuotaEntitlements.sourceId} != ${value.sourceId}`,
        ),
      ),
  ]
}

function revokeQuotaEntitlementQueries(db: Database, event: CloudOrderQuotaChange, now: Date): AtomicQuery[] {
  return [
    revokeQuotaEntitlementQuery(db, event, 'storage', event.storageBytes, now),
    revokeQuotaEntitlementQuery(db, event, 'traffic', event.trafficBytes, now),
    legacyQuotaDecreaseQuery(db, event),
  ].filter((query): query is AtomicQuery => query !== null)
}

function revokeQuotaEntitlementQuery(
  db: Database,
  event: CloudOrderQuotaChange,
  resourceType: 'storage' | 'traffic',
  bytes: number,
  now: Date,
): AtomicQuery | null {
  if (bytes === 0) return null
  return db
    .update(orgQuotaEntitlements)
    .set(quotaEntitlementDecreaseValues(bytes, now))
    .where(quotaEntitlementMatch(event, resourceType))
}

function legacyQuotaDecreaseQuery(db: Database, event: CloudOrderQuotaChange): AtomicQuery | null {
  const values = legacyQuotaDecreaseBatchValues(event)
  if (!values) return null
  return db.update(orgQuotas).set(values).where(eq(orgQuotas.orgId, event.targetOrgId))
}

function legacyQuotaDecreaseBatchValues(event: CloudOrderQuotaChange): Partial<typeof orgQuotas.$inferInsert> | null {
  const values: Partial<typeof orgQuotas.$inferInsert> = {}
  if (event.storageBytes > 0)
    values.quota = sql`CASE
      WHEN NOT EXISTS (${quotaEntitlementExistsSql(event, 'storage')})
      THEN MAX(0, ${orgQuotas.quota} - ${event.storageBytes})
      ELSE ${orgQuotas.quota}
    END` as unknown as number
  if (event.trafficBytes > 0)
    values.trafficQuota = sql`CASE
      WHEN NOT EXISTS (${quotaEntitlementExistsSql(event, 'traffic')})
      THEN MAX(0, ${orgQuotas.trafficQuota} - ${event.trafficBytes})
      ELSE ${orgQuotas.trafficQuota}
    END` as unknown as number
  return Object.keys(values).length === 0 ? null : values
}

function quotaEntitlementExistsSql(event: CloudOrderQuotaChange, resourceType: 'storage' | 'traffic') {
  return sql`select 1 from ${orgQuotaEntitlements}
    where ${orgQuotaEntitlements.orgId} = ${event.targetOrgId}
      and ${orgQuotaEntitlements.resourceType} = ${resourceType}
      and ${orgQuotaEntitlements.source} = 'cloud_order'
      and ${orgQuotaEntitlements.sourceId} = ${event.cloudOrderId}
    limit 1`
}

function quotaEntitlementValues(event: CloudOrderQuotaChange, now: Date): (typeof orgQuotaEntitlements.$inferInsert)[] {
  return [
    quotaEntitlementValue(event, 'storage', event.storageBytes, now),
    quotaEntitlementValue(event, 'traffic', event.trafficBytes, now),
  ].filter((value): value is typeof orgQuotaEntitlements.$inferInsert => value !== null)
}

function quotaEntitlementIncreaseValues(value: typeof orgQuotaEntitlements.$inferInsert, now: Date) {
  const bytes = isSubscriptionSourceId(value.sourceId)
    ? value.bytes
    : (sql`CASE
        WHEN ${orgQuotaEntitlements.status} = 'active' THEN ${orgQuotaEntitlements.bytes} + ${value.bytes}
        ELSE ${value.bytes}
      END` as unknown as number)
  return {
    bytes,
    entitlementType: value.entitlementType,
    status: 'active',
    expiresAt: value.expiresAt,
    metadata: value.metadata,
    updatedAt: now,
  }
}

function quotaEntitlementDecreaseValues(bytes: number, now: Date) {
  return {
    bytes: sql`MAX(0, ${orgQuotaEntitlements.bytes} - ${bytes})`,
    status:
      sql`CASE WHEN ${orgQuotaEntitlements.bytes} <= ${bytes} THEN 'revoked' ELSE 'active' END` as unknown as string,
    updatedAt: now,
  }
}

function quotaEntitlementValue(
  event: CloudOrderQuotaChange,
  resourceType: 'storage' | 'traffic',
  bytes: number,
  now: Date,
): typeof orgQuotaEntitlements.$inferInsert | null {
  if (bytes === 0) return null
  return {
    id: nanoid(),
    orgId: event.targetOrgId,
    resourceType,
    entitlementType: isSubscriptionSourceId(event.cloudOrderId) ? 'plan' : 'grant',
    source: 'cloud_order',
    sourceId: event.cloudOrderId,
    bytes,
    startsAt: now,
    expiresAt: event.expiresAt ? new Date(event.expiresAt) : null,
    status: 'active',
    metadata: JSON.stringify(quotaEntitlementMetadata(event)),
    createdAt: now,
    updatedAt: now,
  }
}

function quotaEntitlementMatch(event: CloudOrderQuotaChange, resourceType: 'storage' | 'traffic') {
  return and(quotaEntitlementSourceMatch(event, resourceType), eq(orgQuotaEntitlements.status, 'active'))
}

function quotaEntitlementSourceMatch(event: CloudOrderQuotaChange, resourceType: 'storage' | 'traffic') {
  return and(
    eq(orgQuotaEntitlements.orgId, event.targetOrgId),
    eq(orgQuotaEntitlements.resourceType, resourceType),
    eq(orgQuotaEntitlements.source, 'cloud_order'),
    eq(orgQuotaEntitlements.sourceId, event.cloudOrderId),
  )
}

function quotaEntitlementMetadata(event: CloudOrderQuotaChange) {
  return {
    eventId: event.eventId,
    eventType: event.eventType,
    source: event.source ?? null,
    packageId: event.packageId ?? null,
    packageName: event.packageName ?? null,
    trafficOveragePriceCents: event.trafficOveragePriceCents ?? null,
    expiresAt: event.expiresAt ?? null,
    customerId: event.customerId ?? null,
    customerEmail: event.customerEmail ?? null,
  }
}

function isSubscriptionSourceId(sourceId: string) {
  return sourceId.startsWith('stripe_subscription:')
}

async function beginWebhookEvent(
  db: Database,
  event: CloudOrderQuotaChange,
  rawPayload: string,
  payloadHash: string,
): Promise<{ id: string; duplicate: boolean }> {
  const id = nanoid()
  try {
    await db.insert(webhookEvents).values({
      id,
      source: 'cloud',
      eventId: event.eventId,
      eventType: event.eventType,
      payloadHash,
      rawPayload,
      status: 'processing',
      createdAt: new Date(),
    })
    return { id, duplicate: false }
  } catch (error) {
    if (isUniqueConflict(error)) return resumeWebhookEvent(db, event, rawPayload, payloadHash)
    throw error
  }
}

async function resumeWebhookEvent(
  db: Database,
  event: CloudOrderQuotaChange,
  rawPayload: string,
  payloadHash: string,
): Promise<{ id: string; duplicate: boolean }> {
  const rows = await db
    .select({
      id: webhookEvents.id,
      payloadHash: webhookEvents.payloadHash,
      status: webhookEvents.status,
    })
    .from(webhookEvents)
    .where(and(eq(webhookEvents.source, 'cloud'), eq(webhookEvents.eventId, event.eventId)))
    .limit(1)

  const existing = rows[0]
  if (!existing) throw new Error('webhook_event_conflict')
  if (existing.payloadHash !== payloadHash) {
    throw new Error('webhook_payload_conflict')
  }
  if (existing.status === 'processed' || existing.status === 'duplicate' || existing.status === 'processing') {
    return { id: existing.id, duplicate: true }
  }

  await db
    .update(webhookEvents)
    .set({ rawPayload, status: 'processing', error: null, processedAt: null })
    .where(eq(webhookEvents.id, existing.id))

  return { id: existing.id, duplicate: false }
}

async function markWebhookEvent(db: Database, id: string, status: string, error: string | null): Promise<void> {
  await db.update(webhookEvents).set({ status, error, processedAt: new Date() }).where(eq(webhookEvents.id, id))
}

function parseOrgType(metadata: string | null): string {
  if (!metadata) return 'unknown'
  return (JSON.parse(metadata) as { type?: string }).type ?? 'unknown'
}

function isUniqueConflict(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const message = error.message.toLowerCase()
  return message.includes('unique') || message.includes('constraint failed')
}
