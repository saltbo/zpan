import { and, count, desc, eq, inArray, or, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { member, organization, user } from '../db/auth-schema'
import { orgQuotas } from '../db/schema'
import type { Database } from '../platform/interface'
import { currentTrafficPeriod } from './effective-quota'

export interface UserWithOrg {
  id: string
  name: string
  username: string
  email: string
  image: string | null
  role: string | null
  banned: boolean | null
  createdAt: Date
  orgId: string | null
  orgName: string | null
  quotaUsed: number
  quotaTotal: number
}

export interface UserOperationFailure {
  error: string
  status: 404
}

export async function listUsers(
  db: Database,
  page: number,
  pageSize: number,
  search?: string,
): Promise<{ items: UserWithOrg[]; total: number }> {
  const offset = (page - 1) * pageSize
  const term = search?.trim().toLowerCase()
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
      quotaTotal: orgQuotas.quota,
    })
    .from(user)
    .leftJoin(organization, eq(organization.slug, sql`'personal-' || ${user.id}`))
    .leftJoin(orgQuotas, eq(orgQuotas.orgId, organization.id))

  const rows = await (filter ? query.where(filter) : query).orderBy(desc(user.createdAt)).limit(pageSize).offset(offset)

  const items: UserWithOrg[] = rows.map((row) => ({
    ...row,
    username: row.username ?? '',
    quotaUsed: row.quotaUsed ?? 0,
    quotaTotal: row.quotaTotal ?? 0,
  }))

  return { items, total }
}

export async function setUserStatus(db: Database, userId: string, status: 'active' | 'disabled'): Promise<boolean> {
  const existing = await db.select({ id: user.id }).from(user).where(eq(user.id, userId))
  if (existing.length === 0) return false

  await db
    .update(user)
    .set({ banned: status === 'disabled' })
    .where(eq(user.id, userId))
  return true
}

export async function deleteUser(db: Database, userId: string): Promise<boolean> {
  const existing = await db.select({ id: user.id }).from(user).where(eq(user.id, userId))
  if (existing.length === 0) return false

  await db.delete(user).where(eq(user.id, userId))
  return true
}

export async function setUsersStatus(
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

export async function deleteUsers(
  db: Database,
  userIds: string[],
): Promise<{ deleted: number; ids: string[] } | UserOperationFailure> {
  const existingIds = await requireUsers(db, userIds)
  if ('error' in existingIds) return existingIds

  await db.delete(user).where(inArray(user.id, existingIds))
  return { deleted: existingIds.length, ids: existingIds }
}

export async function setUsersPersonalQuota(
  db: Database,
  userIds: string[],
  quota: number,
): Promise<{ updated: number; userIds: string[]; orgIds: string[]; quota: number } | UserOperationFailure> {
  const existingIds = await requireUsers(db, userIds)
  if ('error' in existingIds) return existingIds

  const rows = await db
    .select({ userId: user.id, orgId: organization.id })
    .from(user)
    .innerJoin(member, eq(member.userId, user.id))
    .innerJoin(
      organization,
      and(eq(organization.id, member.organizationId), eq(organization.slug, sql`'personal-' || ${user.id}`)),
    )
    .where(inArray(user.id, existingIds))

  if (rows.length !== existingIds.length) {
    const found = new Set(rows.map((row) => row.userId))
    const missing = existingIds.filter((id) => !found.has(id))
    return { error: `Personal organization not found for user(s): ${missing.join(', ')}`, status: 404 }
  }

  const orgIds = rows.map((row) => row.orgId)
  const existingQuotaRows = await db
    .select({ orgId: orgQuotas.orgId })
    .from(orgQuotas)
    .where(inArray(orgQuotas.orgId, orgIds))
  const existingOrgIds = new Set(existingQuotaRows.map((row) => row.orgId))
  const nowMissing = orgIds.filter((orgId) => !existingOrgIds.has(orgId))

  if (existingOrgIds.size > 0) {
    await db
      .update(orgQuotas)
      .set({ quota })
      .where(inArray(orgQuotas.orgId, [...existingOrgIds]))
  }

  for (const orgId of nowMissing) {
    await db.insert(orgQuotas).values({
      id: nanoid(),
      orgId,
      quota,
      used: 0,
      trafficQuota: 0,
      trafficUsed: 0,
      trafficPeriod: currentTrafficPeriod(),
    })
  }

  return { updated: rows.length, userIds: existingIds, orgIds, quota }
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
