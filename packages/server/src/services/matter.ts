import { sql } from 'drizzle-orm'
import type { Database } from '../platform/interface'

export interface Matter {
  id: string
  orgId: string
  alias: string
  name: string
  type: string
  size: number
  dirtype: number
  parent: string
  object: string
  storageId: string
  status: string
  createdAt: number
  updatedAt: number
}

export async function batchMove(db: Database, orgId: string, ids: string[], newParent: string): Promise<void> {
  const matters = await findMattersByIds(db, orgId, ids)
  if (matters.length !== ids.length) {
    throw new MatterNotFoundError()
  }

  const now = Date.now()
  for (const matter of matters) {
    await db.run(sql`
      UPDATE matters SET parent = ${newParent}, updated_at = ${now}
      WHERE id = ${matter.id} AND org_id = ${orgId}
    `)
  }
}

export async function batchTrash(db: Database, orgId: string, ids: string[]): Promise<void> {
  const matters = await findMattersByIds(db, orgId, ids)
  if (matters.length !== ids.length) {
    throw new MatterNotFoundError()
  }

  const now = Date.now()
  const allIds = await collectWithChildren(db, orgId, matters)

  for (const id of allIds) {
    await db.run(sql`
      UPDATE matters SET status = 'trashed', updated_at = ${now}
      WHERE id = ${id} AND org_id = ${orgId}
    `)
  }
}

export async function batchDelete(
  db: Database,
  orgId: string,
  ids: string[],
): Promise<{ objectKeys: string[]; storageId: string } | null> {
  const matters = await findMattersByIds(db, orgId, ids)
  if (matters.length !== ids.length) {
    throw new MatterNotFoundError()
  }

  const nonTrashed = matters.find((m) => m.status !== 'trashed')
  if (nonTrashed) {
    throw new MatterNotTrashedError()
  }

  const allIds = await collectWithChildren(db, orgId, matters)
  const allMatters = await findMattersByIdsUnchecked(db, allIds)

  const objectKeys = allMatters.filter((m) => m.object).map((m) => m.object)
  const storageId = allMatters.find((m) => m.storageId)?.storageId ?? ''

  for (const id of allIds) {
    await db.run(sql`DELETE FROM matters WHERE id = ${id} AND org_id = ${orgId}`)
  }

  if (objectKeys.length === 0) return null
  return { objectKeys, storageId }
}

async function findMattersByIds(db: Database, orgId: string, ids: string[]): Promise<Matter[]> {
  const results: Matter[] = []
  for (const id of ids) {
    const rows = await db.all<Matter>(sql`
      SELECT id, org_id AS orgId, alias, name, type, size, dirtype, parent, object,
             storage_id AS storageId, status, created_at AS createdAt, updated_at AS updatedAt
      FROM matters
      WHERE id = ${id} AND org_id = ${orgId}
    `)
    if (rows[0]) results.push(rows[0])
  }
  return results
}

async function findMattersByIdsUnchecked(db: Database, ids: string[]): Promise<Matter[]> {
  const results: Matter[] = []
  for (const id of ids) {
    const rows = await db.all<Matter>(sql`
      SELECT id, org_id AS orgId, alias, name, type, size, dirtype, parent, object,
             storage_id AS storageId, status, created_at AS createdAt, updated_at AS updatedAt
      FROM matters
      WHERE id = ${id}
    `)
    if (rows[0]) results.push(rows[0])
  }
  return results
}

async function collectWithChildren(db: Database, orgId: string, matters: Matter[]): Promise<string[]> {
  const allIds = new Set<string>()
  const queue = [...matters]

  while (queue.length > 0) {
    const current = queue.pop()!
    allIds.add(current.id)

    if (current.dirtype !== 0) {
      const children = await db.all<Matter>(sql`
        SELECT id, org_id AS orgId, alias, name, type, size, dirtype, parent, object,
               storage_id AS storageId, status, created_at AS createdAt, updated_at AS updatedAt
        FROM matters
        WHERE parent = ${current.id} AND org_id = ${orgId}
      `)
      queue.push(...children)
    }
  }

  return Array.from(allIds)
}

export class MatterNotFoundError extends Error {
  constructor() {
    super('One or more items not found or do not belong to this organization')
    this.name = 'MatterNotFoundError'
  }
}

export class MatterNotTrashedError extends Error {
  constructor() {
    super('Only trashed items can be permanently deleted')
    this.name = 'MatterNotTrashedError'
  }
}
