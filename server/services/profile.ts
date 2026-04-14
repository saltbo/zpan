import { and, asc, desc, eq } from 'drizzle-orm'
import { user } from '../db/auth-schema'
import { matters, storages } from '../db/schema'
import type { Database } from '../platform/interface'
import type { Matter } from './matter'
import { findPersonalOrg } from './org'
import { S3Service } from './s3'

const s3 = new S3Service()

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

export async function listPublicShares(db: Database, orgId: string): Promise<Matter[]> {
  return db
    .select()
    .from(matters)
    .where(and(eq(matters.orgId, orgId), eq(matters.isPublic, true), eq(matters.status, 'active')))
    .orderBy(desc(matters.dirtype), asc(matters.createdAt))
}

export async function isPublicPath(db: Database, orgId: string, dir: string): Promise<boolean> {
  const segments = dir.split('/')
  for (let i = 0; i < segments.length; i++) {
    const pathToCheck = segments.slice(0, i + 1).join('/')
    const lastSlash = pathToCheck.lastIndexOf('/')
    const parent = lastSlash >= 0 ? pathToCheck.slice(0, lastSlash) : ''
    const name = lastSlash >= 0 ? pathToCheck.slice(lastSlash + 1) : pathToCheck

    const rows = await db
      .select({ id: matters.id })
      .from(matters)
      .where(
        and(
          eq(matters.orgId, orgId),
          eq(matters.parent, parent),
          eq(matters.name, name),
          eq(matters.isPublic, true),
          eq(matters.status, 'active'),
        ),
      )
      .limit(1)

    if (rows.length > 0) return true
  }
  return false
}

export async function browsePublicDir(db: Database, orgId: string, dir: string): Promise<Matter[]> {
  return db
    .select()
    .from(matters)
    .where(and(eq(matters.orgId, orgId), eq(matters.parent, dir), eq(matters.status, 'active')))
    .orderBy(desc(matters.dirtype), asc(matters.createdAt))
}

export async function getPresignedDownloadUrl(db: Database, matter: Matter): Promise<string | undefined> {
  if (!matter.object) return undefined

  const storageRows = await db.select().from(storages).where(eq(storages.id, matter.storageId)).limit(1)
  const storage = storageRows[0]
  if (!storage) return undefined

  return s3.presignDownload(storage as never, matter.object, matter.name)
}

export function buildBreadcrumb(dir: string): string[] {
  if (!dir) return []
  return dir.split('/')
}
