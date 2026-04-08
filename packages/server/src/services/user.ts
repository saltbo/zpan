import { sql } from 'drizzle-orm'
import type { Database } from '../platform/interface'

export interface UserWithOrg {
  id: string
  name: string
  email: string
  role: string | null
  banned: boolean
  createdAt: number
  orgId: string | null
  orgName: string | null
}

export async function listUsers(
  db: Database,
  page: number,
  pageSize: number,
): Promise<{ items: UserWithOrg[]; total: number }> {
  const offset = (page - 1) * pageSize

  const countRows = await db.all<{ total: number }>(sql`SELECT COUNT(*) AS total FROM user`)
  const total = countRows[0]?.total ?? 0

  const items = await db.all<UserWithOrg>(sql`
    SELECT
      u.id,
      u.name,
      u.email,
      u.role,
      u.banned,
      u.created_at AS createdAt,
      o.id AS orgId,
      o.name AS orgName
    FROM user u
    LEFT JOIN member m ON m.user_id = u.id
    LEFT JOIN organization o ON o.id = m.organization_id
      AND o.metadata LIKE '%"type":"personal"%'
    GROUP BY u.id
    ORDER BY u.created_at DESC
    LIMIT ${pageSize} OFFSET ${offset}
  `)

  return { items, total }
}

export async function setUserStatus(db: Database, userId: string, status: 'active' | 'disabled'): Promise<boolean> {
  const existing = await db.all<{ id: string }>(sql`SELECT id FROM user WHERE id = ${userId}`)
  if (existing.length === 0) return false

  const banned = status === 'disabled'
  await db.run(sql`UPDATE user SET banned = ${banned ? 1 : 0} WHERE id = ${userId}`)
  return true
}

export async function deleteUser(db: Database, userId: string): Promise<boolean> {
  const existing = await db.all<{ id: string }>(sql`SELECT id FROM user WHERE id = ${userId}`)
  if (existing.length === 0) return false

  await db.run(sql`DELETE FROM user WHERE id = ${userId}`)
  return true
}
