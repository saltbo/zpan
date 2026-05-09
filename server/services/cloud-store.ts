import type { CloudOrderQuotaChange, CloudStoreSettingsInput } from '@shared/schemas'
import type { CloudStoreSettings, CloudStoreTarget } from '@shared/types'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { member, organization, user } from '../db/auth-schema'
import { activityEvents, orgQuotaEntitlements, orgQuotas, systemOptions, webhookEvents } from '../db/schema'
import { loadActiveLicenseBinding } from '../licensing/license-state'
import type { Database } from '../platform/interface'

const CLOUD_STORE_ENABLED_KEY = 'cloud_store_enabled'
const CLOUD_STORE_CREATED_AT_KEY = 'cloud_store_created_at'
const CLOUD_STORE_UPDATED_AT_KEY = 'cloud_store_updated_at'
const CLOUD_STORE_SETTING_KEYS = [
  CLOUD_STORE_ENABLED_KEY,
  CLOUD_STORE_CREATED_AT_KEY,
  CLOUD_STORE_UPDATED_AT_KEY,
] as const

export async function getCloudStoreSettings(db: Database): Promise<CloudStoreSettings | null> {
  const settings = await getRawSettings(db)
  if (!settings) return null
  const binding = await loadActiveLicenseBinding(db)
  return settingsDto(settings, Boolean(binding?.refreshToken))
}

export async function upsertCloudStoreSettings(
  db: Database,
  input: CloudStoreSettingsInput,
): Promise<CloudStoreSettings> {
  const now = new Date()
  const existing = await getRawSettings(db)
  const createdAt = existing?.createdAt ?? now
  await writeSystemOption(db, CLOUD_STORE_ENABLED_KEY, input.enabled ? 'true' : 'false')
  await writeSystemOption(db, CLOUD_STORE_CREATED_AT_KEY, createdAt.toISOString())
  await writeSystemOption(db, CLOUD_STORE_UPDATED_AT_KEY, now.toISOString())
  return (await getCloudStoreSettings(db))!
}

export async function getAccessibleTargets(db: Database, userId: string): Promise<CloudStoreTarget[]> {
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
  const rows = await db
    .select({ key: systemOptions.key, value: systemOptions.value })
    .from(systemOptions)
    .where(inArray(systemOptions.key, [...CLOUD_STORE_SETTING_KEYS]))
  if (rows.length === 0) return null
  const values = new Map(rows.map((row) => [row.key, row.value]))
  const enabled = values.get(CLOUD_STORE_ENABLED_KEY)
  if (enabled === undefined) return null
  const createdAt = values.get(CLOUD_STORE_CREATED_AT_KEY)
  const updatedAt = values.get(CLOUD_STORE_UPDATED_AT_KEY)
  if (!createdAt || !updatedAt) throw new Error('cloud_store_settings_incomplete')
  return {
    id: CLOUD_STORE_ENABLED_KEY,
    enabled: enabled === 'true',
    createdAt: new Date(createdAt),
    updatedAt: new Date(updatedAt),
  }
}

async function writeSystemOption(db: Database, key: string, value: string) {
  const existing = await db
    .select({ key: systemOptions.key })
    .from(systemOptions)
    .where(eq(systemOptions.key, key))
    .limit(1)
  if (existing.length > 0) {
    await db.update(systemOptions).set({ value, public: false }).where(eq(systemOptions.key, key))
    return
  }
  await db.insert(systemOptions).values({ key, value, public: false })
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

  await applyQuotaChange(db, event)
  await recordQuotaChangeAudit(db, event)
  await markWebhookEvent(db, webhookId, 'processed', null)
}

async function applyQuotaChange(db: Database, event: CloudOrderQuotaChange): Promise<void> {
  await requireTargetQuota(db, event.targetOrgId)

  const now = new Date(event.occurredAt ?? Date.now())
  if (event.direction === 'increase') {
    await insertQuotaEntitlements(db, event, now)
    return
  }

  await revokeQuotaEntitlements(db, event, now)
}

function applyQuotaChangeSync(db: Database, event: CloudOrderQuotaChange): void {
  const rows = (
    db.select({ id: orgQuotas.id }).from(orgQuotas).where(eq(orgQuotas.orgId, event.targetOrgId)).limit(1) as {
      all(): Array<{ id: string }>
    }
  ).all()

  if (rows.length === 0) throw new Error('target_quota_missing')

  const now = new Date(event.occurredAt ?? Date.now())
  if (event.direction === 'increase') {
    insertQuotaEntitlementsSync(db, event, now)
    return
  }

  revokeQuotaEntitlementsSync(db, event, now)
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
      packageName: event.packageName ?? null,
    }),
    createdAt: new Date(),
  }
}

async function requireTargetQuota(db: Database, orgId: string): Promise<void> {
  const rows = await db.select({ id: orgQuotas.id }).from(orgQuotas).where(eq(orgQuotas.orgId, orgId)).limit(1)
  if (rows.length === 0) throw new Error('target_quota_missing')
}

async function insertQuotaEntitlements(db: Database, event: CloudOrderQuotaChange, now: Date): Promise<void> {
  const values = quotaEntitlementValues(event, now)
  if (values.length === 0) return
  for (const value of values) {
    await db
      .insert(orgQuotaEntitlements)
      .values(value)
      .onConflictDoUpdate({
        target: [orgQuotaEntitlements.source, orgQuotaEntitlements.sourceId, orgQuotaEntitlements.resourceType],
        set: quotaEntitlementIncreaseValues(value, now),
      })
  }
}

function insertQuotaEntitlementsSync(db: Database, event: CloudOrderQuotaChange, now: Date): void {
  const values = quotaEntitlementValues(event, now)
  if (values.length === 0) return
  for (const value of values) {
    ;(
      db
        .insert(orgQuotaEntitlements)
        .values(value)
        .onConflictDoUpdate({
          target: [orgQuotaEntitlements.source, orgQuotaEntitlements.sourceId, orgQuotaEntitlements.resourceType],
          set: quotaEntitlementIncreaseValues(value, now),
        }) as { run(): void }
    ).run()
  }
}

async function revokeQuotaEntitlements(db: Database, event: CloudOrderQuotaChange, now: Date): Promise<void> {
  const storageRevoked = await revokeQuotaEntitlement(db, event, 'storage', event.storageBytes, now)
  const trafficRevoked = await revokeQuotaEntitlement(db, event, 'traffic', event.trafficBytes, now)
  await applyLegacyQuotaDecrease(db, event, storageRevoked, trafficRevoked)
}

function revokeQuotaEntitlementsSync(db: Database, event: CloudOrderQuotaChange, now: Date): void {
  const storageRevoked = revokeQuotaEntitlementSync(db, event, 'storage', event.storageBytes, now)
  const trafficRevoked = revokeQuotaEntitlementSync(db, event, 'traffic', event.trafficBytes, now)
  applyLegacyQuotaDecreaseSync(db, event, storageRevoked, trafficRevoked)
}

async function revokeQuotaEntitlement(
  db: Database,
  event: CloudOrderQuotaChange,
  resourceType: 'storage' | 'traffic',
  bytes: number,
  now: Date,
): Promise<boolean> {
  if (bytes === 0) return true
  const rows = await db
    .update(orgQuotaEntitlements)
    .set(quotaEntitlementDecreaseValues(bytes, now))
    .where(quotaEntitlementMatch(event, resourceType))
    .returning({ id: orgQuotaEntitlements.id })
  if (rows.length > 0) return true

  const existing = await db
    .select({ id: orgQuotaEntitlements.id })
    .from(orgQuotaEntitlements)
    .where(quotaEntitlementSourceMatch(event, resourceType))
    .limit(1)
  return existing.length > 0
}

function revokeQuotaEntitlementSync(
  db: Database,
  event: CloudOrderQuotaChange,
  resourceType: 'storage' | 'traffic',
  bytes: number,
  now: Date,
): boolean {
  if (bytes === 0) return true
  const rows = (
    db
      .update(orgQuotaEntitlements)
      .set(quotaEntitlementDecreaseValues(bytes, now))
      .where(quotaEntitlementMatch(event, resourceType)) as {
      returning(fields: { id: typeof orgQuotaEntitlements.id }): { all(): Array<{ id: string }> }
    }
  )
    .returning({ id: orgQuotaEntitlements.id })
    .all()
  if (rows.length > 0) return true

  const existing = (
    db
      .select({ id: orgQuotaEntitlements.id })
      .from(orgQuotaEntitlements)
      .where(quotaEntitlementSourceMatch(event, resourceType))
      .limit(1) as { all(): Array<{ id: string }> }
  ).all()
  return existing.length > 0
}

async function applyLegacyQuotaDecrease(
  db: Database,
  event: CloudOrderQuotaChange,
  storageRevoked: boolean,
  trafficRevoked: boolean,
): Promise<void> {
  const values = legacyQuotaDecreaseValues(event, storageRevoked, trafficRevoked)
  if (!values) return
  await db.update(orgQuotas).set(values).where(eq(orgQuotas.orgId, event.targetOrgId))
}

function applyLegacyQuotaDecreaseSync(
  db: Database,
  event: CloudOrderQuotaChange,
  storageRevoked: boolean,
  trafficRevoked: boolean,
): void {
  const values = legacyQuotaDecreaseValues(event, storageRevoked, trafficRevoked)
  if (!values) return
  ;(db.update(orgQuotas).set(values).where(eq(orgQuotas.orgId, event.targetOrgId)) as { run(): void }).run()
}

function legacyQuotaDecreaseValues(
  event: CloudOrderQuotaChange,
  storageRevoked: boolean,
  trafficRevoked: boolean,
): Partial<typeof orgQuotas.$inferInsert> | null {
  const values: Partial<typeof orgQuotas.$inferInsert> = {}
  if (!storageRevoked && event.storageBytes > 0)
    values.quota = sql`MAX(0, ${orgQuotas.quota} - ${event.storageBytes})` as unknown as number
  if (!trafficRevoked && event.trafficBytes > 0) {
    values.trafficQuota = sql`MAX(0, ${orgQuotas.trafficQuota} - ${event.trafficBytes})` as unknown as number
  }
  return Object.keys(values).length === 0 ? null : values
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
    terminalUserId: event.terminalUserId ?? null,
    terminalUserEmail: event.terminalUserEmail ?? null,
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

function markWebhookEventSync(db: Database, id: string, status: string, error: string | null): void {
  ;(
    db.update(webhookEvents).set({ status, error, processedAt: new Date() }).where(eq(webhookEvents.id, id)) as {
      run(): void
    }
  ).run()
}

function settingsDto(
  row: { id: string; enabled: boolean; createdAt: Date; updatedAt: Date },
  cloudReady = true,
): CloudStoreSettings {
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
