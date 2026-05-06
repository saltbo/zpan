import type { CloudDeliveryEvent, QuotaStoreSettingsInput } from '@shared/schemas'
import type { QuotaStoreSettings, QuotaTarget } from '@shared/types'
import { and, eq, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { member, organization, user } from '../db/auth-schema'
import { activityEvents, orgQuotas, quotaDeliveryEvents, quotaStoreSettings } from '../db/schema'
import { loadActiveLicenseBinding } from '../licensing/license-state'
import type { Database } from '../platform/interface'

const SETTINGS_ID = 'default'

export async function getQuotaStoreSettings(db: Database): Promise<QuotaStoreSettings | null> {
  const settings = await getRawSettings(db)
  if (!settings) return null
  const binding = await loadActiveLicenseBinding(db)
  return settingsDto(settings, Boolean(binding?.refreshToken))
}

export async function upsertQuotaStoreSettings(
  db: Database,
  input: QuotaStoreSettingsInput,
): Promise<QuotaStoreSettings> {
  const now = new Date()
  const existing = await getQuotaStoreSettings(db)
  const values = {
    enabled: input.enabled,
    updatedAt: now,
  }

  if (existing) {
    await db.update(quotaStoreSettings).set(values).where(eq(quotaStoreSettings.id, SETTINGS_ID))
  } else {
    await db.insert(quotaStoreSettings).values({ id: SETTINGS_ID, ...values, createdAt: now })
  }

  return (await getQuotaStoreSettings(db))!
}

export async function getAccessibleTargets(db: Database, userId: string): Promise<QuotaTarget[]> {
  const rows = await db
    .select({ orgId: organization.id, name: organization.name, metadata: organization.metadata, role: member.role })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(eq(member.userId, userId))
    .orderBy(organization.name)

  return rows.map((r) => ({ orgId: r.orgId, name: r.name, type: parseOrgType(r.metadata), role: r.role }))
}

export async function canAccessTargetOrg(db: Database, userId: string, orgId: string): Promise<boolean> {
  const rows = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.organizationId, orgId)))
    .limit(1)
  return rows.length > 0
}

export async function getCloudStoreBinding(
  db: Database,
): Promise<{ boundLicenseId: string; refreshToken: string; instanceId: string }> {
  const binding = await loadActiveLicenseBinding(db)
  if (!binding?.refreshToken) throw new Error('quota_store_binding_missing')
  return { boundLicenseId: binding.cloudBindingId, refreshToken: binding.refreshToken, instanceId: binding.instanceId }
}

export async function getUserTerminalLabel(db: Database, userId: string): Promise<string | null> {
  const rows = await db.select({ email: user.email }).from(user).where(eq(user.id, userId)).limit(1)
  return rows[0]?.email ?? null
}

export async function processCloudDelivery(
  db: Database,
  event: CloudDeliveryEvent,
  rawPayload: string,
  payloadHash: string,
): Promise<{ duplicate: boolean; eventId: string }> {
  const delivery = await beginDeliveryEvent(db, event, rawPayload, payloadHash)
  if (delivery.duplicate) return { duplicate: true, eventId: event.eventId }

  try {
    await processDeliveryTransaction(db, delivery.id, event)
  } catch (error) {
    await markDeliveryEvent(db, delivery.id, 'failed', (error as Error).message)
    throw error
  }

  return { duplicate: false, eventId: event.eventId }
}

export async function getRequiredSettings(db: Database) {
  const settings = await getRawSettings(db)
  if (!settings?.enabled) throw new Error('quota_store_disabled')
  return settings
}

async function getRawSettings(db: Database) {
  const rows = await db.select().from(quotaStoreSettings).where(eq(quotaStoreSettings.id, SETTINGS_ID)).limit(1)
  return rows[0] ?? null
}

async function processDeliveryTransaction(db: Database, deliveryId: string, event: CloudDeliveryEvent): Promise<void> {
  if (isSyncDatabase(db)) {
    db.transaction((tx) => {
      applyDeliveryResourceSync(tx as Database, event)
      recordDeliveryAuditSync(tx as Database, event)
      markDeliveryEventSync(tx as Database, deliveryId, 'processed', null)
    })
    return
  }

  await db.transaction(async (tx) => {
    await applyDeliveryResource(tx as Database, event)
    await recordDeliveryAudit(tx as Database, event)
    await markDeliveryEvent(tx as Database, deliveryId, 'processed', null)
  })
}

async function applyDeliveryResource(db: Database, event: CloudDeliveryEvent): Promise<void> {
  const values =
    event.resourceType === 'storage'
      ? { quota: quotaUpdateExpression(event) }
      : { trafficQuota: quotaUpdateExpression(event) }

  const rows = await db
    .update(orgQuotas)
    .set(values)
    .where(eq(orgQuotas.orgId, event.targetOrgId))
    .returning({ id: orgQuotas.id })

  if (rows.length === 0) throw new Error('target_quota_missing')
}

function applyDeliveryResourceSync(db: Database, event: CloudDeliveryEvent): void {
  const values =
    event.resourceType === 'storage'
      ? { quota: quotaUpdateExpression(event) }
      : { trafficQuota: quotaUpdateExpression(event) }

  const rows = (
    db.update(orgQuotas).set(values).where(eq(orgQuotas.orgId, event.targetOrgId)).returning({ id: orgQuotas.id }) as {
      all(): Array<{ id: string }>
    }
  ).all()

  if (rows.length === 0) throw new Error('target_quota_missing')
}

function quotaUpdateExpression(event: CloudDeliveryEvent) {
  const column = event.resourceType === 'storage' ? orgQuotas.quota : orgQuotas.trafficQuota
  if (event.operation === 'increase') return sql`${column} + ${event.resourceBytes}`
  return sql`MAX(0, ${column} - ${event.resourceBytes})`
}

async function recordDeliveryAudit(db: Database, event: CloudDeliveryEvent): Promise<void> {
  await db.insert(activityEvents).values(deliveryAuditValues(event))
}

function recordDeliveryAuditSync(db: Database, event: CloudDeliveryEvent): void {
  ;(db.insert(activityEvents).values(deliveryAuditValues(event)) as { run(): void }).run()
}

function deliveryAuditValues(event: CloudDeliveryEvent): typeof activityEvents.$inferInsert {
  return {
    id: nanoid(),
    orgId: event.targetOrgId,
    userId: event.terminalUserId ?? 'cloud-store',
    action: `quota_${event.resourceType}_${event.operation}`,
    targetType: 'quota',
    targetId: event.targetOrgId,
    targetName: event.targetOrgId,
    metadata: JSON.stringify({
      eventId: event.eventId,
      resourceType: event.resourceType,
      operation: event.operation,
      resourceBytes: event.resourceBytes,
      cloudOrderId: event.cloudOrderId ?? null,
      cloudRedemptionId: event.cloudRedemptionId ?? null,
      code: event.code ?? null,
    }),
    createdAt: new Date(),
  }
}

async function beginDeliveryEvent(
  db: Database,
  event: CloudDeliveryEvent,
  rawPayload: string,
  payloadHash: string,
): Promise<{ id: string; duplicate: boolean }> {
  const id = nanoid()
  try {
    await db.insert(quotaDeliveryEvents).values({
      id,
      eventId: event.eventId,
      cloudOrderId: event.cloudOrderId ?? null,
      cloudRedemptionId: event.cloudRedemptionId ?? null,
      code: event.code ?? null,
      payloadHash,
      rawPayload,
      status: 'processing',
      createdAt: new Date(),
    })
    return { id, duplicate: false }
  } catch (error) {
    if (isUniqueConflict(error)) return resumeDeliveryEvent(db, event, rawPayload, payloadHash)
    throw error
  }
}

async function resumeDeliveryEvent(
  db: Database,
  event: CloudDeliveryEvent,
  rawPayload: string,
  payloadHash: string,
): Promise<{ id: string; duplicate: boolean }> {
  const rows = await db
    .select({
      id: quotaDeliveryEvents.id,
      code: quotaDeliveryEvents.code,
      payloadHash: quotaDeliveryEvents.payloadHash,
      status: quotaDeliveryEvents.status,
    })
    .from(quotaDeliveryEvents)
    .where(
      sql`${quotaDeliveryEvents.eventId} = ${event.eventId}
        OR (${event.cloudRedemptionId ?? null} IS NOT NULL
          AND ${quotaDeliveryEvents.cloudRedemptionId} = ${event.cloudRedemptionId ?? null})
        OR (${event.code ?? null} IS NOT NULL AND ${quotaDeliveryEvents.code} = ${event.code ?? null})`,
    )
    .limit(1)

  const existing = rows[0]
  if (!existing) throw new Error('delivery_event_conflict')
  if (existing.payloadHash !== payloadHash) {
    if (event.code && existing.code === event.code && existing.status !== 'failed') {
      return { id: existing.id, duplicate: true }
    }
    throw new Error('delivery_payload_conflict')
  }
  if (existing.status === 'processed' || existing.status === 'duplicate' || existing.status === 'processing') {
    return { id: existing.id, duplicate: true }
  }

  await db
    .update(quotaDeliveryEvents)
    .set({ rawPayload, status: 'processing', error: null, processedAt: null })
    .where(eq(quotaDeliveryEvents.id, existing.id))

  return { id: existing.id, duplicate: false }
}

async function markDeliveryEvent(db: Database, id: string, status: string, error: string | null): Promise<void> {
  await db
    .update(quotaDeliveryEvents)
    .set({ status, error, processedAt: new Date() })
    .where(eq(quotaDeliveryEvents.id, id))
}

function markDeliveryEventSync(db: Database, id: string, status: string, error: string | null): void {
  ;(
    db
      .update(quotaDeliveryEvents)
      .set({ status, error, processedAt: new Date() })
      .where(eq(quotaDeliveryEvents.id, id)) as {
      run(): void
    }
  ).run()
}

function settingsDto(row: typeof quotaStoreSettings.$inferSelect, cloudReady = true): QuotaStoreSettings {
  return {
    id: row.id,
    enabled: row.enabled,
    status: cloudReady ? 'ready' : 'cloud_unbound',
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function parseOrgType(metadata: string | null): string {
  if (!metadata) return 'unknown'
  return (JSON.parse(metadata) as { type?: string }).type ?? 'unknown'
}

function isUniqueConflict(error: unknown): boolean {
  return error instanceof Error && error.message.toLowerCase().includes('unique')
}

function isSyncDatabase(db: Database): boolean {
  return db.constructor.name === 'BetterSQLite3Database'
}
