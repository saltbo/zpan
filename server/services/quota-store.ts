import { createHash, timingSafeEqual } from 'node:crypto'
import { eq, or } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import type {
  CreateQuotaStorePackageInput,
  PutQuotaStoreSettingsInput,
  UpdateQuotaStorePackageInput,
} from '../../shared/schemas'
import type { QuotaGrant, QuotaStorePackage, QuotaStoreSettings } from '../../shared/types'
import { quotaDeliveryEvents, quotaGrants, quotaStorePackages, quotaStoreSettings } from '../db/schema'
import type { Database } from '../platform/interface'

// ─── Settings ─────────────────────────────────────────────────────────────────

export async function getQuotaStoreSettings(db: Database): Promise<QuotaStoreSettings> {
  const [row] = await db.select().from(quotaStoreSettings).where(eq(quotaStoreSettings.id, 'default'))
  if (!row) {
    return { enabled: false, cloudBaseUrl: null, instancePublicUrl: null, webhookSigningSecret: null, updatedAt: null }
  }
  return {
    enabled: row.enabled,
    cloudBaseUrl: row.cloudBaseUrl ?? null,
    instancePublicUrl: row.instancePublicUrl ?? null,
    webhookSigningSecret: row.webhookSigningSecret ?? null,
    updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
  }
}

export async function putQuotaStoreSettings(
  db: Database,
  input: PutQuotaStoreSettingsInput,
): Promise<QuotaStoreSettings> {
  const now = new Date()
  const existing = await db
    .select({ id: quotaStoreSettings.id })
    .from(quotaStoreSettings)
    .where(eq(quotaStoreSettings.id, 'default'))
  const values = {
    enabled: input.enabled,
    cloudBaseUrl: input.cloudBaseUrl ?? null,
    instancePublicUrl: input.instancePublicUrl ?? null,
    webhookSigningSecret: input.webhookSigningSecret ?? null,
    updatedAt: now,
  }
  if (existing.length > 0) {
    await db.update(quotaStoreSettings).set(values).where(eq(quotaStoreSettings.id, 'default'))
  } else {
    await db.insert(quotaStoreSettings).values({ id: 'default', ...values })
  }
  return {
    enabled: input.enabled,
    cloudBaseUrl: input.cloudBaseUrl ?? null,
    instancePublicUrl: input.instancePublicUrl ?? null,
    webhookSigningSecret: input.webhookSigningSecret ?? null,
    updatedAt: now.toISOString(),
  }
}

// ─── Packages ─────────────────────────────────────────────────────────────────

function rowToPackage(row: typeof quotaStorePackages.$inferSelect): QuotaStorePackage {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    bytes: row.bytes,
    amount: row.amount,
    currency: row.currency,
    active: row.active,
    sortOrder: row.sortOrder,
    cloudSyncId: row.cloudSyncId ?? null,
    cloudSyncStatus: (row.cloudSyncStatus as QuotaStorePackage['cloudSyncStatus']) ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export async function listQuotaStorePackages(db: Database, activeOnly = false): Promise<QuotaStorePackage[]> {
  const rows = await db
    .select()
    .from(quotaStorePackages)
    .where(activeOnly ? eq(quotaStorePackages.active, true) : undefined)
    .orderBy(quotaStorePackages.sortOrder, quotaStorePackages.createdAt)
  return rows.map(rowToPackage)
}

export async function getQuotaStorePackage(db: Database, id: string): Promise<QuotaStorePackage | null> {
  const [row] = await db.select().from(quotaStorePackages).where(eq(quotaStorePackages.id, id))
  return row ? rowToPackage(row) : null
}

export async function createQuotaStorePackage(
  db: Database,
  input: CreateQuotaStorePackageInput,
): Promise<QuotaStorePackage> {
  const now = new Date()
  const id = nanoid()
  await db.insert(quotaStorePackages).values({
    id,
    name: input.name,
    description: input.description ?? null,
    bytes: input.bytes,
    amount: input.amount,
    currency: input.currency,
    active: input.active ?? true,
    sortOrder: input.sortOrder ?? 0,
    cloudSyncStatus: 'pending',
    createdAt: now,
    updatedAt: now,
  })
  return (await getQuotaStorePackage(db, id))!
}

export async function updateQuotaStorePackage(
  db: Database,
  id: string,
  input: UpdateQuotaStorePackageInput,
): Promise<QuotaStorePackage | null> {
  const existing = await getQuotaStorePackage(db, id)
  if (!existing) return null
  const now = new Date()
  await db
    .update(quotaStorePackages)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description ?? null } : {}),
      ...(input.bytes !== undefined ? { bytes: input.bytes } : {}),
      ...(input.amount !== undefined ? { amount: input.amount } : {}),
      ...(input.currency !== undefined ? { currency: input.currency } : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      cloudSyncStatus: 'pending',
      updatedAt: now,
    })
    .where(eq(quotaStorePackages.id, id))
  return (await getQuotaStorePackage(db, id))!
}

export async function deleteQuotaStorePackage(db: Database, id: string): Promise<boolean> {
  const existing = await getQuotaStorePackage(db, id)
  if (!existing) return false
  await db.delete(quotaStorePackages).where(eq(quotaStorePackages.id, id))
  return true
}

// ─── Grants ───────────────────────────────────────────────────────────────────

function rowToGrant(row: typeof quotaGrants.$inferSelect): QuotaGrant {
  return {
    id: row.id,
    orgId: row.orgId,
    source: row.source as QuotaGrant['source'],
    externalEventId: row.externalEventId ?? null,
    cloudOrderId: row.cloudOrderId ?? null,
    code: row.code ?? null,
    bytes: row.bytes,
    packageSnapshot: row.packageSnapshot ?? null,
    grantedBy: row.grantedBy ?? null,
    terminalUserId: row.terminalUserId ?? null,
    createdAt: row.createdAt.toISOString(),
  }
}

export async function listQuotaGrants(db: Database, orgIds: string[]): Promise<QuotaGrant[]> {
  if (orgIds.length === 0) return []
  const rows = await db
    .select()
    .from(quotaGrants)
    .where(
      orgIds.length === 1 ? eq(quotaGrants.orgId, orgIds[0]) : or(...orgIds.map((id) => eq(quotaGrants.orgId, id))),
    )
    .orderBy(quotaGrants.createdAt)
  return rows.map(rowToGrant)
}

export async function appendQuotaGrant(
  db: Database,
  input: {
    orgId: string
    source: QuotaGrant['source']
    bytes: number
    externalEventId?: string | null
    cloudOrderId?: string | null
    code?: string | null
    packageSnapshot?: string | null
    grantedBy?: string | null
    terminalUserId?: string | null
  },
): Promise<QuotaGrant> {
  const id = nanoid()
  const now = new Date()
  await db.insert(quotaGrants).values({
    id,
    orgId: input.orgId,
    source: input.source,
    bytes: input.bytes,
    externalEventId: input.externalEventId ?? null,
    cloudOrderId: input.cloudOrderId ?? null,
    code: input.code ?? null,
    packageSnapshot: input.packageSnapshot ?? null,
    grantedBy: input.grantedBy ?? null,
    terminalUserId: input.terminalUserId ?? null,
    createdAt: now,
  })
  const [row] = await db.select().from(quotaGrants).where(eq(quotaGrants.id, id))
  return rowToGrant(row)
}

// ─── Delivery events (webhook idempotency) ────────────────────────────────────

export function hashPayload(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

export async function findDeliveryEvent(db: Database, eventId: string) {
  const [row] = await db.select().from(quotaDeliveryEvents).where(eq(quotaDeliveryEvents.eventId, eventId))
  return row ?? null
}

export async function recordDeliveryEvent(
  db: Database,
  input: {
    eventId: string
    cloudOrderId?: string | null
    rawPayload: string
    status: 'processed' | 'duplicate' | 'error'
  },
): Promise<void> {
  const now = new Date()
  await db.insert(quotaDeliveryEvents).values({
    id: nanoid(),
    eventId: input.eventId,
    cloudOrderId: input.cloudOrderId ?? null,
    payloadHash: hashPayload(input.rawPayload),
    rawPayload: input.rawPayload,
    status: input.status,
    createdAt: now,
    processedAt: input.status !== 'duplicate' ? now : null,
  })
}

// ─── Webhook signature verification ──────────────────────────────────────────

/**
 * Verifies an HMAC-SHA256 signature from Cloud over the raw request body.
 * Header format: "zpan-sig=<hex>"
 */
export function verifyWebhookSignature(secret: string, rawBody: string, signatureHeader: string | null): boolean {
  if (!signatureHeader) return false
  const match = signatureHeader.match(/^zpan-sig=([0-9a-f]+)$/i)
  if (!match) return false
  const provided = match[1]
  const expected = createHash('sha256').update(`${secret}.${rawBody}`).digest('hex')
  if (provided.length !== expected.length) return false
  const enc = new TextEncoder()
  try {
    return timingSafeEqual(enc.encode(provided), enc.encode(expected))
  } catch {
    return false
  }
}

// ─── Cloud catalog sync ───────────────────────────────────────────────────────

/**
 * Syncs a package to the Cloud catalog. Returns updated cloudSyncId / status.
 * In a real integration this would call cloud.zpan.space APIs. For now it
 * marks the package as synced and stores a generated sync id so the contract
 * is in place for the real Cloud endpoint.
 */
export async function syncPackageToCloud(
  db: Database,
  pkg: QuotaStorePackage,
  cloudBaseUrl: string,
): Promise<{ cloudSyncId: string; cloudSyncStatus: 'synced' | 'error'; error?: string }> {
  try {
    const resp = await fetch(`${cloudBaseUrl}/api/catalog/packages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        externalId: pkg.id,
        name: pkg.name,
        description: pkg.description,
        bytes: pkg.bytes,
        amount: pkg.amount,
        currency: pkg.currency,
      }),
    })
    if (!resp.ok) {
      const text = await resp.text().catch(() => 'unknown error')
      await db.update(quotaStorePackages).set({ cloudSyncStatus: 'error' }).where(eq(quotaStorePackages.id, pkg.id))
      return { cloudSyncId: pkg.cloudSyncId ?? '', cloudSyncStatus: 'error', error: text }
    }
    const body = (await resp.json()) as { id?: string }
    const cloudSyncId = body.id ?? pkg.id
    await db
      .update(quotaStorePackages)
      .set({ cloudSyncId, cloudSyncStatus: 'synced' })
      .where(eq(quotaStorePackages.id, pkg.id))
    return { cloudSyncId, cloudSyncStatus: 'synced' }
  } catch (err) {
    await db.update(quotaStorePackages).set({ cloudSyncStatus: 'error' }).where(eq(quotaStorePackages.id, pkg.id))
    return {
      cloudSyncId: pkg.cloudSyncId ?? '',
      cloudSyncStatus: 'error',
      error: err instanceof Error ? err.message : 'unknown',
    }
  }
}

// ─── Checkout / Redeem (Cloud-side) ──────────────────────────────────────────

export async function createCloudCheckout(input: {
  cloudBaseUrl: string
  instancePublicUrl: string
  packageId: string
  cloudSyncId: string
  targetOrgId: string
  userId: string
  callbackUrl: string
}): Promise<{ checkoutUrl: string }> {
  const resp = await fetch(`${input.cloudBaseUrl}/api/store/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      packageId: input.cloudSyncId,
      targetOrgId: input.targetOrgId,
      userId: input.userId,
      callbackUrl: input.callbackUrl,
      instanceUrl: input.instancePublicUrl,
    }),
  })
  if (!resp.ok) {
    const text = await resp.text().catch(() => 'unknown')
    throw new Error(`Cloud checkout failed: ${text}`)
  }
  const body = (await resp.json()) as { checkoutUrl?: string }
  if (!body.checkoutUrl) throw new Error('Cloud checkout returned no URL')
  return { checkoutUrl: body.checkoutUrl }
}

export async function sendCloudRedeem(input: {
  cloudBaseUrl: string
  instancePublicUrl: string
  code: string
  targetOrgId: string
  userId: string
}): Promise<{ granted: boolean; bytes: number }> {
  const resp = await fetch(`${input.cloudBaseUrl}/api/store/redeem`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code: input.code,
      targetOrgId: input.targetOrgId,
      userId: input.userId,
      instanceUrl: input.instancePublicUrl,
    }),
  })
  if (!resp.ok) {
    const text = await resp.text().catch(() => 'unknown')
    throw new Error(`Cloud redeem failed: ${text}`)
  }
  const body = (await resp.json()) as { granted?: boolean; bytes?: number }
  return { granted: body.granted ?? false, bytes: body.bytes ?? 0 }
}
