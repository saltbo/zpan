import { and, count, desc, eq, sql } from 'drizzle-orm'
import { member, organization, user } from '../db/auth-schema'
import type { Database } from '../platform/interface'

export interface UserWithOrg {
  id: string
  name: string
  username: string
  email: string
  role: string | null
  banned: boolean | null
  createdAt: Date
  orgId: string | null
  orgName: string | null
}

export async function listUsers(
  db: Database,
  page: number,
  pageSize: number,
): Promise<{ items: UserWithOrg[]; total: number }> {
  const offset = (page - 1) * pageSize

  const countRows = await db.select({ total: count() }).from(user)
  const total = countRows[0]?.total ?? 0

  const rows = await db
    .select({
      id: user.id,
      name: user.name,
      username: user.username,
      email: user.email,
      role: user.role,
      banned: user.banned,
      createdAt: user.createdAt,
      orgId: organization.id,
      orgName: organization.name,
    })
    .from(user)
    .leftJoin(member, eq(member.userId, user.id))
    .leftJoin(
      organization,
      and(eq(organization.id, member.organizationId), eq(organization.slug, sql`'personal-' || ${user.id}`)),
    )
    .groupBy(user.id)
    .orderBy(desc(user.createdAt))
    .limit(pageSize)
    .offset(offset)

  const items: UserWithOrg[] = rows.map((row) => ({
    ...row,
    username: row.username ?? '',
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
