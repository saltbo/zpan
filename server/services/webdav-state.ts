import { and, eq, or, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { webdavDeadProperties, webdavLocks } from '../db/schema'
import type { Database } from '../platform/interface'
import { type AtomicQuery, executeWriteTransaction } from './db-transaction'

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
  const queries: AtomicQuery[] = []
  for (const operation of operations) {
    if (operation.action === 'remove') {
      queries.push(
        db
          .delete(webdavDeadProperties)
          .where(
            and(
              eq(webdavDeadProperties.orgId, orgId),
              eq(webdavDeadProperties.resourcePath, resourcePath),
              eq(webdavDeadProperties.namespace, operation.property.namespace),
              eq(webdavDeadProperties.name, operation.property.name),
            ),
          ),
      )
      continue
    }

    const property = operation.property
    queries.push(
      db
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
        }),
    )
  }
  await executeWriteTransaction(db, queries)
}

export async function deleteWebDavState(db: Database, orgId: string, resourcePath: string): Promise<void> {
  await executeWriteTransaction(db, [
    db
      .delete(webdavDeadProperties)
      .where(
        and(
          eq(webdavDeadProperties.orgId, orgId),
          or(
            eq(webdavDeadProperties.resourcePath, resourcePath),
            sql`${webdavDeadProperties.resourcePath} LIKE ${`${resourcePath}/%`}`,
          ),
        ),
      ),
    db
      .delete(webdavLocks)
      .where(
        and(
          eq(webdavLocks.orgId, orgId),
          or(eq(webdavLocks.resourcePath, resourcePath), sql`${webdavLocks.resourcePath} LIKE ${`${resourcePath}/%`}`),
        ),
      ),
  ])
}

export async function moveWebDavState(db: Database, orgId: string, oldPath: string, newPath: string): Promise<void> {
  const now = new Date()
  await executeWriteTransaction(db, [
    db
      .update(webdavDeadProperties)
      .set({
        resourcePath: sql`CASE WHEN ${webdavDeadProperties.resourcePath} = ${oldPath} THEN ${newPath} ELSE ${newPath} || SUBSTR(${webdavDeadProperties.resourcePath}, ${oldPath.length + 1}) END`,
        updatedAt: now,
      })
      .where(
        and(
          eq(webdavDeadProperties.orgId, orgId),
          or(
            eq(webdavDeadProperties.resourcePath, oldPath),
            sql`${webdavDeadProperties.resourcePath} LIKE ${`${oldPath}/%`}`,
          ),
        ),
      ),
    db
      .update(webdavLocks)
      .set({
        resourcePath: sql`CASE WHEN ${webdavLocks.resourcePath} = ${oldPath} THEN ${newPath} ELSE ${newPath} || SUBSTR(${webdavLocks.resourcePath}, ${oldPath.length + 1}) END`,
        updatedAt: now,
      })
      .where(
        and(
          eq(webdavLocks.orgId, orgId),
          or(eq(webdavLocks.resourcePath, oldPath), sql`${webdavLocks.resourcePath} LIKE ${`${oldPath}/%`}`),
        ),
      ),
  ])
}

export async function copyDeadProperties(
  db: Database,
  orgId: string,
  sourcePath: string,
  targetPath: string,
): Promise<void> {
  const rows = await db
    .select()
    .from(webdavDeadProperties)
    .where(and(eq(webdavDeadProperties.orgId, orgId), eq(webdavDeadProperties.resourcePath, sourcePath)))
  if (rows.length === 0) return

  const now = new Date()
  await executeWriteTransaction(
    db,
    rows.map((row) =>
      db
        .insert(webdavDeadProperties)
        .values({
          id: nanoid(),
          orgId,
          resourcePath: targetPath,
          namespace: row.namespace,
          name: row.name,
          value: row.value,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [
            webdavDeadProperties.orgId,
            webdavDeadProperties.resourcePath,
            webdavDeadProperties.namespace,
            webdavDeadProperties.name,
          ],
          set: { value: row.value, updatedAt: now },
        }),
    ),
  )
}

export async function activeLocks(db: Database, orgId: string, resourcePath: string): Promise<DavLock[]> {
  await purgeExpiredLocks(db)
  const now = Date.now()
  const rows = await db
    .select()
    .from(webdavLocks)
    .where(and(eq(webdavLocks.orgId, orgId), sql`${webdavLocks.expiresAt} > ${now}`))
  return rows.filter((lock) => lockAppliesToResource(lock, resourcePath))
}

export async function conflictingLocks(db: Database, orgId: string, resourcePath: string): Promise<DavLock[]> {
  await purgeExpiredLocks(db)
  const now = Date.now()
  const rows = await db
    .select()
    .from(webdavLocks)
    .where(and(eq(webdavLocks.orgId, orgId), sql`${webdavLocks.expiresAt} > ${now}`))
  return rows.filter((lock) => lockConflictsWithResource(lock, resourcePath))
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

export async function refreshLock(
  db: Database,
  orgId: string,
  resourcePath: string,
  token: string,
  timeoutSeconds: number,
): Promise<DavLock | null> {
  await purgeExpiredLocks(db)
  const now = new Date()
  const expiresAt = new Date(now.getTime() + timeoutSeconds * 1000)
  const rows = await db
    .select()
    .from(webdavLocks)
    .where(
      and(eq(webdavLocks.orgId, orgId), eq(webdavLocks.token, token), sql`${webdavLocks.expiresAt} > ${now.getTime()}`),
    )
  const lock = rows.find((row) => lockAppliesToResource(row, resourcePath))
  if (!lock) return null
  await db.update(webdavLocks).set({ expiresAt, updatedAt: now }).where(eq(webdavLocks.id, lock.id))
  return { ...lock, expiresAt, updatedAt: now }
}

export async function removeLock(db: Database, orgId: string, resourcePath: string, token: string): Promise<boolean> {
  await purgeExpiredLocks(db)
  const rows = await db
    .select()
    .from(webdavLocks)
    .where(
      and(eq(webdavLocks.orgId, orgId), eq(webdavLocks.token, token), sql`${webdavLocks.expiresAt} > ${Date.now()}`),
    )
  const lock = rows.find((row) => lockAppliesToResource(row, resourcePath))
  if (!lock) return false
  await db.delete(webdavLocks).where(eq(webdavLocks.id, lock.id))
  return true
}

async function purgeExpiredLocks(db: Database): Promise<void> {
  await db.delete(webdavLocks).where(sql`${webdavLocks.expiresAt} <= ${Date.now()}`)
}

function lockAppliesToResource(lock: DavLock, resourcePath: string): boolean {
  if (lock.resourcePath === resourcePath) return true
  if (lock.depth !== 'infinity') return false
  if (lock.resourcePath === '') return true
  return resourcePath.startsWith(`${lock.resourcePath}/`)
}

function lockConflictsWithResource(lock: DavLock, resourcePath: string): boolean {
  if (lockAppliesToResource(lock, resourcePath)) return true
  if (resourcePath === '') return lock.resourcePath !== ''
  return lock.resourcePath.startsWith(`${resourcePath}/`)
}
