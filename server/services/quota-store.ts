import type { CloudDeliveryEvent, QuotaStorePackageInput, QuotaStoreSettingsInput } from '@shared/schemas'
import type { QuotaGrant, QuotaStorePackage, QuotaStoreSettings, QuotaTarget } from '@shared/types'
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { member, organization, user } from '../db/auth-schema'
import { quotaDeliveryEvents, quotaGrants, quotaStorePackages, quotaStoreSettings } from '../db/schema'
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

export async function listQuotaStorePackages(db: Database, activeOnly = false): Promise<QuotaStorePackage[]> {
  const query = db.select().from(quotaStorePackages)
  const rows = activeOnly
    ? await query.where(purchasablePackageCondition()).orderBy(quotaStorePackages.sortOrder, quotaStorePackages.name)
    : await query.orderBy(quotaStorePackages.sortOrder, quotaStorePackages.name)
  return rows.map(packageDto)
}

function purchasablePackageCondition(packageId?: string) {
  const conditions = [
    eq(quotaStorePackages.active, true),
    eq(quotaStorePackages.syncStatus, 'synced'),
    isNotNull(quotaStorePackages.cloudPackageId),
  ]
  if (packageId) conditions.push(eq(quotaStorePackages.id, packageId))
  return and(...conditions)
}

export async function createQuotaStorePackage(db: Database, input: QuotaStorePackageInput): Promise<QuotaStorePackage> {
  const now = new Date()
  const row = {
    id: nanoid(),
    ...input,
    cloudPackageId: null,
    syncStatus: 'pending',
    syncError: null,
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(quotaStorePackages).values(row)
  return packageDto(row)
}

export async function updateQuotaStorePackage(
  db: Database,
  id: string,
  input: QuotaStorePackageInput,
): Promise<QuotaStorePackage | null> {
  const now = new Date()
  const rows = await db
    .update(quotaStorePackages)
    .set({ ...input, syncStatus: 'pending', syncError: null, updatedAt: now })
    .where(eq(quotaStorePackages.id, id))
    .returning()
  return rows[0] ? packageDto(rows[0]) : null
}

export async function deleteQuotaStorePackage(db: Database, id: string): Promise<boolean> {
  const rows = await db
    .delete(quotaStorePackages)
    .where(eq(quotaStorePackages.id, id))
    .returning({ id: quotaStorePackages.id })
  return rows.length > 0
}

export async function getQuotaStorePackage(db: Database, id: string): Promise<QuotaStorePackage | null> {
  const rows = await db.select().from(quotaStorePackages).where(eq(quotaStorePackages.id, id)).limit(1)
  return rows[0] ? packageDto(rows[0]) : null
}

export async function getActiveQuotaStorePackage(db: Database, id: string): Promise<QuotaStorePackage | null> {
  const rows = await db.select().from(quotaStorePackages).where(purchasablePackageCondition(id)).limit(1)
  return rows[0] ? packageDto(rows[0]) : null
}

export async function markPackageSynced(
  db: Database,
  id: string,
  result: { cloudPackageId?: string | null; error?: string | null },
): Promise<QuotaStorePackage> {
  const values: Partial<typeof quotaStorePackages.$inferInsert> = {
    syncStatus: result.error ? 'failed' : 'synced',
    syncError: result.error ?? null,
    updatedAt: new Date(),
  }
  if (result.cloudPackageId !== undefined) values.cloudPackageId = result.cloudPackageId

  const rows = await db.update(quotaStorePackages).set(values).where(eq(quotaStorePackages.id, id)).returning()
  return packageDto(rows[0])
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

export async function listGrantsForUser(db: Database, userId: string): Promise<QuotaGrant[]> {
  const targets = await getAccessibleTargets(db, userId)
  if (targets.length === 0) return []
  const rows = await db
    .select()
    .from(quotaGrants)
    .where(
      inArray(
        quotaGrants.orgId,
        targets.map((t) => t.orgId),
      ),
    )
    .orderBy(sql`${quotaGrants.createdAt} DESC`)
  return rows.map(grantDto)
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
): Promise<{ duplicate: boolean; grantId: string | null }> {
  const delivery = await beginDeliveryEvent(db, event, rawPayload, payloadHash)
  if (delivery.duplicate) return { duplicate: true, grantId: null }

  const packageSnapshot = await validateDeliveryPackage(db, delivery.id, event)
  const now = new Date()
  const grantId = nanoid()

  try {
    await db.insert(quotaGrants).values({
      id: grantId,
      orgId: event.targetOrgId,
      source: event.source,
      externalEventId: event.eventId,
      cloudOrderId: event.cloudOrderId ?? null,
      cloudRedemptionId: event.cloudRedemptionId ?? null,
      code: event.code ?? null,
      bytes: event.bytes,
      packageSnapshot,
      terminalUserId: event.terminalUserId ?? null,
      terminalUserEmail: event.terminalUserEmail ?? null,
      active: true,
      createdAt: now,
    })
  } catch (error) {
    if (isUniqueConflict(error)) {
      await markDeliveryEvent(db, delivery.id, 'duplicate', null)
      return { duplicate: true, grantId: null }
    }
    await markDeliveryEvent(db, delivery.id, 'failed', (error as Error).message)
    throw error
  }

  await markDeliveryEvent(db, delivery.id, 'processed', null)
  return { duplicate: false, grantId }
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

async function validatePackageBytes(db: Database, event: CloudDeliveryEvent): Promise<string | null> {
  if (event.source === 'stripe' && !event.packageId) throw new Error('package_required')
  if (!event.packageId) return null
  const pkg = await findDeliveryPackage(db, event.packageId)
  if (!pkg || pkg.bytes !== event.bytes || (event.package && event.package.bytes !== pkg.bytes)) {
    throw new Error('invalid_package_delivery')
  }
  return JSON.stringify(event.package ?? packageDto(pkg))
}

async function findDeliveryPackage(db: Database, packageId: string) {
  const localRows = await db.select().from(quotaStorePackages).where(eq(quotaStorePackages.id, packageId)).limit(1)
  if (localRows[0]) return localRows[0]

  const cloudRows = await db
    .select()
    .from(quotaStorePackages)
    .where(eq(quotaStorePackages.cloudPackageId, packageId))
    .limit(2)
  if (cloudRows.length !== 1) return null
  return cloudRows[0]
}

async function validateDeliveryPackage(
  db: Database,
  eventId: string,
  event: CloudDeliveryEvent,
): Promise<string | null> {
  try {
    return await validatePackageBytes(db, event)
  } catch (error) {
    await markDeliveryEvent(db, eventId, 'failed', (error as Error).message)
    throw error
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
      payloadHash: quotaDeliveryEvents.payloadHash,
      status: quotaDeliveryEvents.status,
    })
    .from(quotaDeliveryEvents)
    .where(
      sql`${quotaDeliveryEvents.eventId} = ${event.eventId}
        OR (${event.cloudOrderId ?? null} IS NOT NULL AND ${quotaDeliveryEvents.cloudOrderId} = ${event.cloudOrderId ?? null})
        OR (${event.cloudRedemptionId ?? null} IS NOT NULL
          AND ${quotaDeliveryEvents.cloudRedemptionId} = ${event.cloudRedemptionId ?? null})`,
    )
    .limit(1)

  const existing = rows[0]
  if (!existing) throw new Error('delivery_event_conflict')
  if (existing.payloadHash !== payloadHash) throw new Error('delivery_payload_conflict')
  if (existing.status === 'processed' || existing.status === 'duplicate') return { id: existing.id, duplicate: true }

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

function settingsDto(row: typeof quotaStoreSettings.$inferSelect, cloudReady = true): QuotaStoreSettings {
  return {
    id: row.id,
    enabled: row.enabled,
    status: row.enabled ? (cloudReady ? 'ready' : 'cloud_unbound') : 'store_disabled',
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function packageDto(row: typeof quotaStorePackages.$inferSelect): QuotaStorePackage {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    bytes: row.bytes,
    amount: row.amount,
    currency: row.currency,
    active: row.active,
    sortOrder: row.sortOrder,
    cloudPackageId: row.cloudPackageId,
    syncStatus: row.syncStatus as QuotaStorePackage['syncStatus'],
    syncError: row.syncError,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function grantDto(row: typeof quotaGrants.$inferSelect): QuotaGrant {
  return {
    id: row.id,
    orgId: row.orgId,
    source: row.source as QuotaGrant['source'],
    externalEventId: row.externalEventId,
    cloudOrderId: row.cloudOrderId,
    cloudRedemptionId: row.cloudRedemptionId,
    code: row.code,
    bytes: row.bytes,
    packageSnapshot: row.packageSnapshot,
    grantedBy: row.grantedBy,
    terminalUserId: row.terminalUserId,
    terminalUserEmail: row.terminalUserEmail,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
  }
}

function parseOrgType(metadata: string | null): string {
  if (!metadata) return 'unknown'
  return (JSON.parse(metadata) as { type?: string }).type ?? 'unknown'
}

function isUniqueConflict(error: unknown): boolean {
  return error instanceof Error && error.message.toLowerCase().includes('unique')
}
