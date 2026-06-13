import { and, eq, inArray, or, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { webdavDeadProperties, webdavLocks } from '../../db/schema'
import { type AtomicQuery, executeWriteTransaction } from '../../db/transaction'
import type { Database } from '../../platform/interface'
import type { DavDeadProperty, DavLock, WebDavStateRepo } from '../../usecases/ports'

export function createWebDavStateRepo(db: Database): WebDavStateRepo {
  return {
    async listDeadPropertiesForResources(orgId, resourcePaths) {
      const uniquePaths = [...new Set(resourcePaths)]
      const result = new Map(uniquePaths.map((path) => [path, [] as DavDeadProperty[]]))
      if (uniquePaths.length === 0) return result

      const rows = await db
        .select({
          resourcePath: webdavDeadProperties.resourcePath,
          namespace: webdavDeadProperties.namespace,
          name: webdavDeadProperties.name,
          value: webdavDeadProperties.value,
        })
        .from(webdavDeadProperties)
        .where(and(eq(webdavDeadProperties.orgId, orgId), inArray(webdavDeadProperties.resourcePath, uniquePaths)))

      for (const row of rows) {
        result.get(row.resourcePath)?.push({ namespace: row.namespace, name: row.name, value: row.value })
      }
      return result
    },

    async applyDeadPropertyUpdate(orgId, resourcePath, operations) {
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
    },

    async copyDeadProperties(orgId, sourcePath, targetPath) {
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
    },

    async deleteWebDavState(orgId, resourcePath) {
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
              or(
                eq(webdavLocks.resourcePath, resourcePath),
                sql`${webdavLocks.resourcePath} LIKE ${`${resourcePath}/%`}`,
              ),
            ),
          ),
      ])
    },

    async moveWebDavState(orgId, oldPath, newPath) {
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
    },

    async activeLocks(orgId, resourcePath) {
      await purgeExpiredLocks(db)
      const now = Date.now()
      const rows = await db
        .select()
        .from(webdavLocks)
        .where(and(eq(webdavLocks.orgId, orgId), sql`${webdavLocks.expiresAt} > ${now}`))
      return rows.filter((lock) => lockAppliesToResource(lock, resourcePath))
    },

    async activeLocksForResources(orgId, resourcePaths) {
      const uniquePaths = [...new Set(resourcePaths)]
      const result = new Map(uniquePaths.map((path) => [path, [] as DavLock[]]))
      if (uniquePaths.length === 0) return result

      await purgeExpiredLocks(db)
      const now = Date.now()
      const rows = await db
        .select()
        .from(webdavLocks)
        .where(and(eq(webdavLocks.orgId, orgId), sql`${webdavLocks.expiresAt} > ${now}`))

      for (const path of uniquePaths) {
        result.set(
          path,
          rows.filter((lock) => lockAppliesToResource(lock, path)),
        )
      }
      return result
    },

    async conflictingLocks(orgId, resourcePath) {
      await purgeExpiredLocks(db)
      const now = Date.now()
      const rows = await db
        .select()
        .from(webdavLocks)
        .where(and(eq(webdavLocks.orgId, orgId), sql`${webdavLocks.expiresAt} > ${now}`))
      return rows.filter((lock) => lockConflictsWithResource(lock, resourcePath))
    },

    async createLock(input) {
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
    },

    async refreshLock(orgId, resourcePath, token, timeoutSeconds) {
      await purgeExpiredLocks(db)
      const now = new Date()
      const expiresAt = new Date(now.getTime() + timeoutSeconds * 1000)
      const rows = await db
        .select()
        .from(webdavLocks)
        .where(
          and(
            eq(webdavLocks.orgId, orgId),
            eq(webdavLocks.token, token),
            sql`${webdavLocks.expiresAt} > ${now.getTime()}`,
          ),
        )
      const lock = rows.find((row) => lockAppliesToResource(row, resourcePath))
      if (!lock) return null
      await db.update(webdavLocks).set({ expiresAt, updatedAt: now }).where(eq(webdavLocks.id, lock.id))
      return { ...lock, expiresAt, updatedAt: now }
    },

    async removeLock(orgId, resourcePath, token) {
      await purgeExpiredLocks(db)
      const rows = await db
        .select()
        .from(webdavLocks)
        .where(
          and(
            eq(webdavLocks.orgId, orgId),
            eq(webdavLocks.token, token),
            sql`${webdavLocks.expiresAt} > ${Date.now()}`,
          ),
        )
      const lock = rows.find((row) => lockAppliesToResource(row, resourcePath))
      if (!lock) return false
      await db.delete(webdavLocks).where(eq(webdavLocks.id, lock.id))
      return true
    },
  }
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
