import { isPersonalOrgLike } from '@shared/org-slugs'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { member, organization, user } from '../../db/auth-schema'
import { orgQuotaEntitlements } from '../../db/schema'
import type { Database } from '../../platform/interface'
import type {
  GrantEntitlementInput,
  QuotaEntitlementItem,
  UpdateEntitlementInput,
  UserAdminRepo,
  UserOperationFailure,
} from '../../usecases/ports'

async function isBanned(db: Database, userId: string): Promise<boolean> {
  const rows = await db.select({ banned: user.banned }).from(user).where(eq(user.id, userId))
  return Boolean(rows[0]?.banned)
}

async function matchesUsername(db: Database, userId: string, username: string): Promise<boolean> {
  const rows = await db
    .select({ email: user.email, username: user.username })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)
  const account = rows[0]
  if (!account) return false
  return account.email.toLowerCase() === username.toLowerCase() || account.username === username
}

async function listUserPersonalEntitlements(
  db: Database,
  userId: string,
): Promise<{ orgId: string; items: QuotaEntitlementItem[] } | UserOperationFailure> {
  const org = await findUserPersonalOrg(db, userId)
  if ('error' in org) return org
  return listOrgEntitlements(db, org.orgId)
}

async function grantUserPersonalEntitlement(
  db: Database,
  input: {
    adminUserId: string
    targetUserId: string
    resourceType: 'storage'
    bytes: number
    expiresAt?: Date | null
    note?: string | null
  },
): Promise<{ orgId: string; entitlement: QuotaEntitlementItem } | UserOperationFailure> {
  const org = await findUserPersonalOrg(db, input.targetUserId)
  if ('error' in org) return org
  return grantOrgEntitlement(db, { ...input, orgId: org.orgId })
}

async function updateUserPersonalEntitlement(
  db: Database,
  input: {
    adminUserId: string
    targetUserId: string
    entitlementId: string
    bytes?: number
    expiresAt?: Date | null
    note?: string | null
  },
): Promise<{ orgId: string; entitlement: QuotaEntitlementItem } | UserOperationFailure> {
  const org = await findUserPersonalOrg(db, input.targetUserId)
  if ('error' in org) return org
  return updateOrgEntitlement(db, { ...input, orgId: org.orgId })
}

async function revokeUserPersonalEntitlement(
  db: Database,
  input: { adminUserId: string; targetUserId: string; entitlementId: string },
): Promise<{ orgId: string; entitlement: QuotaEntitlementItem } | UserOperationFailure> {
  const org = await findUserPersonalOrg(db, input.targetUserId)
  if ('error' in org) return org
  return revokeOrgEntitlement(db, { ...input, orgId: org.orgId })
}

async function findUserPersonalOrg(db: Database, userId: string): Promise<{ orgId: string } | UserOperationFailure> {
  const existingIds = await requireUsers(db, [userId])
  if ('error' in existingIds) return existingIds
  const rows = await db
    .select({ orgId: organization.id, slug: organization.slug, metadata: organization.metadata })
    .from(user)
    .innerJoin(member, eq(member.userId, user.id))
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(eq(user.id, userId))
  const orgId = rows.find(isPersonalOrgLike)?.orgId
  if (!orgId) return { error: `Personal organization not found for user: ${userId}`, status: 404 }
  return { orgId }
}

async function requireUsers(db: Database, userIds: string[]): Promise<string[] | UserOperationFailure> {
  const uniqueIds = [...new Set(userIds)]
  const rows = await db.select({ id: user.id }).from(user).where(inArray(user.id, uniqueIds))
  if (rows.length !== uniqueIds.length) {
    const found = new Set(rows.map((row) => row.id))
    const missing = uniqueIds.filter((id) => !found.has(id))
    return { error: `User not found: ${missing.join(', ')}`, status: 404 }
  }
  return uniqueIds
}

// --- Org-scoped admin entitlement operations (formerly services/org-entitlements) ---

async function requireOrg(db: Database, orgId: string): Promise<{ orgId: string } | UserOperationFailure> {
  const rows = await db.select({ id: organization.id }).from(organization).where(eq(organization.id, orgId)).limit(1)
  if (!rows[0]) return { error: `Organization not found: ${orgId}`, status: 404 }
  return { orgId }
}

async function listOrgEntitlements(
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

async function grantOrgEntitlement(
  db: Database,
  input: GrantEntitlementInput,
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
    metadata: JSON.stringify({ note: input.note ?? null, grantedBy: input.adminUserId }),
    createdAt: now,
    updatedAt: now,
  } satisfies typeof orgQuotaEntitlements.$inferInsert
  const rows = await db.insert(orgQuotaEntitlements).values(entitlement).returning()
  return { orgId: input.orgId, entitlement: rows[0] }
}

async function updateOrgEntitlement(
  db: Database,
  input: UpdateEntitlementInput,
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

async function revokeOrgEntitlement(
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

export function createUserAdminRepo(db: Database): UserAdminRepo {
  return {
    isBanned: (userId) => isBanned(db, userId),
    matchesUsername: (userId, username) => matchesUsername(db, userId, username),
    listUserPersonalEntitlements: (userId) => listUserPersonalEntitlements(db, userId),
    grantUserPersonalEntitlement: (input) => grantUserPersonalEntitlement(db, input),
    updateUserPersonalEntitlement: (input) => updateUserPersonalEntitlement(db, input),
    revokeUserPersonalEntitlement: (input) => revokeUserPersonalEntitlement(db, input),
    requireOrg: (orgId) => requireOrg(db, orgId),
    listOrgEntitlements: (orgId) => listOrgEntitlements(db, orgId),
    grantOrgEntitlement: (input) => grantOrgEntitlement(db, input),
    updateOrgEntitlement: (input) => updateOrgEntitlement(db, input),
    revokeOrgEntitlement: (input) => revokeOrgEntitlement(db, input),
  }
}
