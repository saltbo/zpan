import { and, count, desc, eq, inArray, or, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { member, organization, user } from '../../db/auth-schema'
import { orgQuotaEntitlements, orgQuotas } from '../../db/schema'
import type { Database } from '../../platform/interface'
import type {
  GrantEntitlementInput,
  QuotaEntitlementItem,
  UpdateEntitlementInput,
  UserAdminRepo,
  UserOperationFailure,
  UserWithOrg,
} from '../../usecases/ports'

async function listUsers(
  db: Database,
  page: number,
  pageSize: number,
  search?: string,
): Promise<{ items: UserWithOrg[]; total: number }> {
  const offset = (page - 1) * pageSize
  const term = search?.trim().toLowerCase()
  const now = new Date()
  const filter = term
    ? or(
        sql`lower(${user.name}) like ${`%${term}%`}`,
        sql`lower(${user.username}) like ${`%${term}%`}`,
        sql`lower(${user.email}) like ${`%${term}%`}`,
      )
    : undefined

  const countRows = filter
    ? await db.select({ total: count() }).from(user).where(filter)
    : await db.select({ total: count() }).from(user)
  const total = countRows[0]?.total ?? 0

  const query = db
    .select({
      id: user.id,
      name: user.name,
      username: user.username,
      email: user.email,
      image: user.image,
      role: user.role,
      banned: user.banned,
      createdAt: user.createdAt,
      orgId: organization.id,
      orgName: organization.name,
      quotaUsed: orgQuotas.used,
      quotaDefault: sql<number>`0`,
      quotaTotal: activeStorageEntitlementBytesSql(now),
    })
    .from(user)
    .leftJoin(organization, eq(organization.slug, sql`'personal-' || ${user.id}`))
    .leftJoin(orgQuotas, eq(orgQuotas.orgId, organization.id))

  const rows = await (filter ? query.where(filter) : query).orderBy(desc(user.createdAt)).limit(pageSize).offset(offset)

  const items: UserWithOrg[] = rows.map((row) => ({
    ...row,
    username: row.username ?? '',
    quotaUsed: row.quotaUsed ?? 0,
    quotaDefault: row.quotaDefault ?? 0,
    quotaTotal: row.quotaTotal ?? 0,
  }))

  return { items, total }
}

async function getUser(db: Database, userId: string): Promise<UserWithOrg | UserOperationFailure> {
  const now = new Date()
  const rows = await db
    .select({
      id: user.id,
      name: user.name,
      username: user.username,
      email: user.email,
      image: user.image,
      role: user.role,
      banned: user.banned,
      createdAt: user.createdAt,
      orgId: organization.id,
      orgName: organization.name,
      quotaUsed: orgQuotas.used,
      quotaDefault: sql<number>`0`,
      quotaTotal: activeStorageEntitlementBytesSql(now),
    })
    .from(user)
    .leftJoin(organization, eq(organization.slug, sql`'personal-' || ${user.id}`))
    .leftJoin(orgQuotas, eq(orgQuotas.orgId, organization.id))
    .where(eq(user.id, userId))

  const row = rows[0]
  if (!row) return { error: `User not found: ${userId}`, status: 404 }
  return {
    ...row,
    username: row.username ?? '',
    quotaUsed: row.quotaUsed ?? 0,
    quotaDefault: row.quotaDefault ?? 0,
    quotaTotal: row.quotaTotal ?? 0,
  }
}

function activeStorageEntitlementBytesSql(now: Date) {
  const timestamp = now.getTime()
  return sql<number>`(
    SELECT COALESCE(SUM(${orgQuotaEntitlements.bytes}), 0)
    FROM ${orgQuotaEntitlements}
    WHERE ${orgQuotaEntitlements.orgId} = ${organization.id}
      AND ${orgQuotaEntitlements.resourceType} = 'storage'
      AND ${orgQuotaEntitlements.status} = 'active'
      AND ${orgQuotaEntitlements.startsAt} <= ${timestamp}
      AND (${orgQuotaEntitlements.expiresAt} IS NULL OR ${orgQuotaEntitlements.expiresAt} > ${timestamp})
  )`
}

async function setUserStatus(db: Database, userId: string, status: 'active' | 'disabled'): Promise<boolean> {
  const existing = await db.select({ id: user.id }).from(user).where(eq(user.id, userId))
  if (existing.length === 0) return false

  await db
    .update(user)
    .set({ banned: status === 'disabled' })
    .where(eq(user.id, userId))
  return true
}

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

async function deleteUser(db: Database, userId: string): Promise<boolean> {
  const existing = await db.select({ id: user.id }).from(user).where(eq(user.id, userId))
  if (existing.length === 0) return false

  await db.delete(user).where(eq(user.id, userId))
  return true
}

async function setUsersStatus(
  db: Database,
  userIds: string[],
  status: 'active' | 'disabled',
): Promise<{ updated: number; ids: string[] } | UserOperationFailure> {
  const existingIds = await requireUsers(db, userIds)
  if ('error' in existingIds) return existingIds

  await db
    .update(user)
    .set({ banned: status === 'disabled' })
    .where(inArray(user.id, existingIds))
  return { updated: existingIds.length, ids: existingIds }
}

async function deleteUsers(
  db: Database,
  userIds: string[],
): Promise<{ deleted: number; ids: string[] } | UserOperationFailure> {
  const existingIds = await requireUsers(db, userIds)
  if ('error' in existingIds) return existingIds

  await db.delete(user).where(inArray(user.id, existingIds))
  return { deleted: existingIds.length, ids: existingIds }
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
    .select({ orgId: organization.id })
    .from(user)
    .innerJoin(member, eq(member.userId, user.id))
    .innerJoin(
      organization,
      and(eq(organization.id, member.organizationId), eq(organization.slug, sql`'personal-' || ${user.id}`)),
    )
    .where(eq(user.id, userId))
  const orgId = rows[0]?.orgId
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
    listUsers: (page, pageSize, search) => listUsers(db, page, pageSize, search),
    getUser: (userId) => getUser(db, userId),
    isBanned: (userId) => isBanned(db, userId),
    matchesUsername: (userId, username) => matchesUsername(db, userId, username),
    setUserStatus: (userId, status) => setUserStatus(db, userId, status),
    deleteUser: (userId) => deleteUser(db, userId),
    setUsersStatus: (userIds, status) => setUsersStatus(db, userIds, status),
    deleteUsers: (userIds) => deleteUsers(db, userIds),
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
