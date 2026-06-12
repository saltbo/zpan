import { and, desc, eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { organization } from '../db/auth-schema'
import { orgQuotaEntitlements } from '../db/schema'
import type { Database } from '../platform/interface'
import type { QuotaEntitlementItem, UserOperationFailure } from './user'

// Org-scoped admin entitlement operations. These work for any org — teams and
// personal spaces alike; the user-scoped wrappers in user.ts resolve a user's
// personal org first and then delegate here.

export async function requireOrg(db: Database, orgId: string): Promise<{ orgId: string } | UserOperationFailure> {
  const rows = await db.select({ id: organization.id }).from(organization).where(eq(organization.id, orgId)).limit(1)
  if (!rows[0]) return { error: `Organization not found: ${orgId}`, status: 404 }
  return { orgId }
}

export async function listOrgEntitlements(
  db: Database,
  orgId: string,
): Promise<{ orgId: string; items: QuotaEntitlementItem[] } | UserOperationFailure> {
  const org = await requireOrg(db, orgId)
  if ('error' in org) return org
  const items = await db
    .select()
    .from(orgQuotaEntitlements)
    .where(eq(orgQuotaEntitlements.orgId, orgId))
    .orderBy(desc(orgQuotaEntitlements.createdAt))
  return { orgId, items }
}

export async function grantOrgEntitlement(
  db: Database,
  input: {
    adminUserId: string
    orgId: string
    resourceType: 'storage'
    bytes: number
    expiresAt?: Date | null
    note?: string | null
  },
): Promise<{ orgId: string; entitlement: QuotaEntitlementItem } | UserOperationFailure> {
  const org = await requireOrg(db, input.orgId)
  if ('error' in org) return org
  const now = new Date()
  const entitlement = {
    id: nanoid(),
    orgId: input.orgId,
    resourceType: input.resourceType,
    entitlementType: 'grant',
    source: 'admin_grant',
    sourceId: `admin_grant:${nanoid()}`,
    bytes: input.bytes,
    startsAt: now,
    expiresAt: input.expiresAt ?? null,
    status: 'active',
    metadata: JSON.stringify({
      note: input.note ?? null,
      grantedBy: input.adminUserId,
    }),
    createdAt: now,
    updatedAt: now,
  } satisfies typeof orgQuotaEntitlements.$inferInsert
  const rows = await db.insert(orgQuotaEntitlements).values(entitlement).returning()
  return { orgId: input.orgId, entitlement: rows[0] }
}

export async function updateOrgEntitlement(
  db: Database,
  input: {
    adminUserId: string
    orgId: string
    entitlementId: string
    bytes?: number
    expiresAt?: Date | null
    note?: string | null
  },
): Promise<{ orgId: string; entitlement: QuotaEntitlementItem } | UserOperationFailure> {
  const existing = await findAdminGrant(db, input.orgId, input.entitlementId)
  if ('error' in existing) return existing

  const metadata =
    input.note === undefined
      ? existing.metadata
      : mergeGrantMetadata(existing.metadata, { note: input.note, updatedBy: input.adminUserId })
  const rows = await db
    .update(orgQuotaEntitlements)
    .set({
      bytes: input.bytes ?? existing.bytes,
      expiresAt: input.expiresAt === undefined ? existing.expiresAt : input.expiresAt,
      metadata,
      updatedAt: new Date(),
    })
    .where(eq(orgQuotaEntitlements.id, input.entitlementId))
    .returning()
  return { orgId: input.orgId, entitlement: rows[0] }
}

export async function revokeOrgEntitlement(
  db: Database,
  input: { adminUserId: string; orgId: string; entitlementId: string },
): Promise<{ orgId: string; entitlement: QuotaEntitlementItem } | UserOperationFailure> {
  const existing = await findAdminGrant(db, input.orgId, input.entitlementId)
  if ('error' in existing) return existing

  const rows = await db
    .update(orgQuotaEntitlements)
    .set({
      status: 'revoked',
      metadata: mergeGrantMetadata(existing.metadata, { revokedBy: input.adminUserId }),
      updatedAt: new Date(),
    })
    .where(eq(orgQuotaEntitlements.id, input.entitlementId))
    .returning()
  return { orgId: input.orgId, entitlement: rows[0] }
}

async function findAdminGrant(
  db: Database,
  orgId: string,
  entitlementId: string,
): Promise<QuotaEntitlementItem | UserOperationFailure> {
  const rows = await db
    .select()
    .from(orgQuotaEntitlements)
    .where(and(eq(orgQuotaEntitlements.id, entitlementId), eq(orgQuotaEntitlements.orgId, orgId)))
    .limit(1)
  const row = rows[0]
  if (!row) return { error: `Entitlement not found: ${entitlementId}`, status: 404 }
  if (row.source !== 'admin_grant') {
    return { error: 'Only admin-granted entitlements can be modified', status: 400 }
  }
  return row
}

function mergeGrantMetadata(existing: string | null, patch: Record<string, unknown>): string {
  const base = existing ? (JSON.parse(existing) as Record<string, unknown>) : {}
  return JSON.stringify({ ...base, ...patch })
}
