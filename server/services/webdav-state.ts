import { and, eq, or, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { webdavDeadProperties, webdavLocks } from '../db/schema'
import type { Database } from '../platform/interface'

export interface DavPropertyName {
  namespace: string
  name: string
}

export interface DavDeadProperty extends DavPropertyName {
  value: string
}

export interface DavLock {
  id: string
  token: string
  orgId: string
  resourcePath: string
  owner: string
  depth: string
  expiresAt: Date
  createdAt: Date
  updatedAt: Date
}

export async function listDeadProperties(
  db: Database,
  orgId: string,
  resourcePath: string,
): Promise<DavDeadProperty[]> {
  const rows = await db
    .select({
      namespace: webdavDeadProperties.namespace,
      name: webdavDeadProperties.name,
      value: webdavDeadProperties.value,
    })
    .from(webdavDeadProperties)
    .where(and(eq(webdavDeadProperties.orgId, orgId), eq(webdavDeadProperties.resourcePath, resourcePath)))
  return rows
}

export async function applyDeadPropertyUpdate(
  db: Database,
  orgId: string,
  resourcePath: string,
  operations: Array<{ action: 'set'; property: DavDeadProperty } | { action: 'remove'; property: DavPropertyName }>,
): Promise<void> {
  const now = new Date()
  for (const operation of operations) {
    if (operation.action === 'remove') {
      await db
        .delete(webdavDeadProperties)
        .where(
          and(
            eq(webdavDeadProperties.orgId, orgId),
            eq(webdavDeadProperties.resourcePath, resourcePath),
            eq(webdavDeadProperties.namespace, operation.property.namespace),
            eq(webdavDeadProperties.name, operation.property.name),
          ),
        )
      continue
    }

    const property = operation.property
    await db
      .insert(webdavDeadProperties)
      .values({
        id: nanoid(),
        orgId,
        resourcePath,
        namespace: property.namespace,
        name: property.name,
        value: property.value,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          webdavDeadProperties.orgId,
          webdavDeadProperties.resourcePath,
          webdavDeadProperties.namespace,
          webdavDeadProperties.name,
        ],
        set: { value: property.value, updatedAt: now },
      })
  }
}

export async function activeLocks(db: Database, orgId: string, resourcePath: string): Promise<DavLock[]> {
  await purgeExpiredLocks(db)
  const now = Date.now()
  return db
    .select()
    .from(webdavLocks)
    .where(
      and(
        eq(webdavLocks.orgId, orgId),
        sql`${webdavLocks.expiresAt} > ${now}`,
        or(
          eq(webdavLocks.resourcePath, resourcePath),
          sql`${webdavLocks.resourcePath} = '' AND ${webdavLocks.depth} = 'infinity'`,
          sql`${resourcePath} LIKE ${webdavLocks.resourcePath} || '/%' AND ${webdavLocks.depth} = 'infinity'`,
          sql`${webdavLocks.resourcePath} LIKE ${resourcePath} || '/%'`,
        ),
      ),
    )
}

export async function directLocks(db: Database, orgId: string, resourcePath: string): Promise<DavLock[]> {
  await purgeExpiredLocks(db)
  const now = Date.now()
  return db
    .select()
    .from(webdavLocks)
    .where(
      and(
        eq(webdavLocks.orgId, orgId),
        eq(webdavLocks.resourcePath, resourcePath),
        sql`${webdavLocks.expiresAt} > ${now}`,
      ),
    )
}

export async function createLock(
  db: Database,
  input: { orgId: string; resourcePath: string; owner: string; depth: string; timeoutSeconds: number },
): Promise<DavLock> {
  const now = new Date()
  const lock: DavLock = {
    id: nanoid(),
    token: `opaquelocktoken:${crypto.randomUUID()}`,
    orgId: input.orgId,
    resourcePath: input.resourcePath,
    owner: input.owner,
    depth: input.depth,
    expiresAt: new Date(now.getTime() + input.timeoutSeconds * 1000),
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(webdavLocks).values(lock)
  return lock
}

export async function refreshLock(db: Database, token: string, timeoutSeconds: number): Promise<DavLock | null> {
  await purgeExpiredLocks(db)
  const now = new Date()
  const expiresAt = new Date(now.getTime() + timeoutSeconds * 1000)
  const rows = await db
    .update(webdavLocks)
    .set({ expiresAt, updatedAt: now })
    .where(and(eq(webdavLocks.token, token), sql`${webdavLocks.expiresAt} > ${now.getTime()}`))
    .returning()
  return rows[0] ?? null
}

export async function removeLock(db: Database, orgId: string, resourcePath: string, token: string): Promise<boolean> {
  await purgeExpiredLocks(db)
  const rows = await db
    .delete(webdavLocks)
    .where(
      and(
        eq(webdavLocks.orgId, orgId),
        eq(webdavLocks.resourcePath, resourcePath),
        eq(webdavLocks.token, token),
        sql`${webdavLocks.expiresAt} > ${Date.now()}`,
      ),
    )
    .returning({ id: webdavLocks.id })
  return rows.length > 0
}

async function purgeExpiredLocks(db: Database): Promise<void> {
  await db.delete(webdavLocks).where(sql`${webdavLocks.expiresAt} <= ${Date.now()}`)
}
