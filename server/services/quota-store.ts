import type { CloudOrderQuotaChange, QuotaStoreSettingsInput } from '@shared/schemas'
import type { QuotaStoreSettings, QuotaTarget } from '@shared/types'
import { and, eq, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { member, organization, user } from '../db/auth-schema'
import { activityEvents, orgQuotas, quotaStoreSettings, webhookEvents } from '../db/schema'
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

export async function getUserTerminalLabel(db: Database, userId: string): Promise<string | null> {
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

export async function getRequiredSettings(db: Database) {
  const settings = await getRawSettings(db)
  if (!settings?.enabled) throw new Error('quota_store_disabled')
  return settings
}

async function getRawSettings(db: Database) {
  const rows = await db.select().from(quotaStoreSettings).where(eq(quotaStoreSettings.id, SETTINGS_ID)).limit(1)
  return rows[0] ?? null
}

async function processQuotaChangeTransaction(
  db: Database,
  webhookId: string,
  event: CloudOrderQuotaChange,
): Promise<void> {
  if (isSyncDatabase(db)) {
    db.transaction((tx) => {
      applyQuotaChangeSync(tx as Database, event)
      recordQuotaChangeAuditSync(tx as Database, event)
      markWebhookEventSync(tx as Database, webhookId, 'processed', null)
    })
    return
  }

  await db.transaction(async (tx) => {
    await applyQuotaChange(tx as Database, event)
    await recordQuotaChangeAudit(tx as Database, event)
    await markWebhookEvent(tx as Database, webhookId, 'processed', null)
  })
}

async function applyQuotaChange(db: Database, event: CloudOrderQuotaChange): Promise<void> {
  const rows = await db
    .update(orgQuotas)
    .set(quotaUpdateValues(event))
    .where(eq(orgQuotas.orgId, event.targetOrgId))
    .returning({ id: orgQuotas.id })

  if (rows.length === 0) throw new Error('target_quota_missing')
}

function applyQuotaChangeSync(db: Database, event: CloudOrderQuotaChange): void {
  const rows = (
    db
      .update(orgQuotas)
      .set(quotaUpdateValues(event))
      .where(eq(orgQuotas.orgId, event.targetOrgId))
      .returning({ id: orgQuotas.id }) as {
      all(): Array<{ id: string }>
    }
  ).all()

  if (rows.length === 0) throw new Error('target_quota_missing')
}

function quotaUpdateValues(event: CloudOrderQuotaChange) {
  return {
    quota: quotaUpdateExpression(orgQuotas.quota, event.storageBytes, event.direction),
    trafficQuota: quotaUpdateExpression(orgQuotas.trafficQuota, event.trafficBytes, event.direction),
  }
}

function quotaUpdateExpression(
  column: typeof orgQuotas.quota | typeof orgQuotas.trafficQuota,
  bytes: number,
  direction: CloudOrderQuotaChange['direction'],
) {
  if (direction === 'increase') return sql`${column} + ${bytes}`
  return sql`MAX(0, ${column} - ${bytes})`
}

async function recordQuotaChangeAudit(db: Database, event: CloudOrderQuotaChange): Promise<void> {
  await db.insert(activityEvents).values(quotaChangeAuditValues(event))
}

function recordQuotaChangeAuditSync(db: Database, event: CloudOrderQuotaChange): void {
  ;(db.insert(activityEvents).values(quotaChangeAuditValues(event)) as { run(): void }).run()
}

function quotaChangeAuditValues(event: CloudOrderQuotaChange): typeof activityEvents.$inferInsert {
  return {
    id: nanoid(),
    orgId: event.targetOrgId,
    userId: event.terminalUserId ?? 'cloud-store',
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
    }),
    createdAt: new Date(),
  }
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

function markWebhookEventSync(db: Database, id: string, status: string, error: string | null): void {
  ;(
    db.update(webhookEvents).set({ status, error, processedAt: new Date() }).where(eq(webhookEvents.id, id)) as {
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
