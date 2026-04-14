import { eq } from 'drizzle-orm'
import { user } from '../db/auth-schema'
import type { Database } from '../platform/interface'
import { findPersonalOrg } from './org'

export interface PublicUser {
  username: string
  name: string
  image: string | null
}

export async function getUserByUsername(db: Database, username: string): Promise<PublicUser | null> {
  const rows = await db
    .select({ username: user.username, name: user.name, image: user.image })
    .from(user)
    .where(eq(user.username, username))
    .limit(1)

  const row = rows[0]
  if (!row?.username) return null
  return { username: row.username, name: row.name, image: row.image ?? null }
}

export async function getUserOrgId(db: Database, username: string): Promise<string | null> {
  const rows = await db.select({ id: user.id }).from(user).where(eq(user.username, username)).limit(1)
  const userId = rows[0]?.id
  if (!userId) return null
  return findPersonalOrg(db, userId)
}

export function buildBreadcrumb(dir: string): string[] {
  if (!dir) return []
  return dir.split('/')
}
