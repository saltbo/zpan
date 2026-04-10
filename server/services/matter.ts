import { sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { DirType } from '../../shared/constants'
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
  trashedAt: number | null
  createdAt: number
  updatedAt: number
}

interface CreateMatterInput {
  orgId: string
  name: string
  type: string
  size?: number
  dirtype?: number
  parent?: string
  object: string
  storageId: string
  status: string
}

export async function createMatter(db: Database, input: CreateMatterInput): Promise<Matter> {
  const id = nanoid()
  const alias = nanoid(10)
  const now = Date.now()
  const size = input.size ?? 0
  const dirtype = input.dirtype ?? 0
  const parent = input.parent ?? ''

  await db.run(sql`
    INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, created_at, updated_at)
    VALUES (${id}, ${input.orgId}, ${alias}, ${input.name}, ${input.type}, ${size}, ${dirtype}, ${parent}, ${input.object}, ${input.storageId}, ${input.status}, ${now}, ${now})
  `)

  return {
    id,
    orgId: input.orgId,
    alias,
    name: input.name,
    type: input.type,
    size,
    dirtype,
    parent,
    object: input.object,
    storageId: input.storageId,
    status: input.status,
    trashedAt: null,
    createdAt: now,
    updatedAt: now,
  }
}

export async function listMatters(
  db: Database,
  orgId: string,
  filters: { parent: string; status: string; page: number; pageSize: number },
): Promise<{ items: Matter[]; total: number; page: number; pageSize: number }> {
  const offset = (filters.page - 1) * filters.pageSize

  const countRows = await db.all<{ count: number }>(sql`
    SELECT COUNT(*) AS count FROM matters
    WHERE org_id = ${orgId} AND parent = ${filters.parent} AND status = ${filters.status}
  `)
  const total = countRows[0]?.count ?? 0

  const items = await db.all<Matter>(sql`
    SELECT id, org_id AS orgId, alias, name, type, size, dirtype,
           parent, object, storage_id AS storageId, status,
           trashed_at AS trashedAt,
           created_at AS createdAt, updated_at AS updatedAt
    FROM matters
    WHERE org_id = ${orgId} AND parent = ${filters.parent} AND status = ${filters.status}
    ORDER BY dirtype DESC, created_at ASC
    LIMIT ${filters.pageSize} OFFSET ${offset}
  `)

  return { items, total, page: filters.page, pageSize: filters.pageSize }
}

export async function getMatter(db: Database, id: string, orgId: string): Promise<Matter | null> {
  const rows = await db.all<Matter>(sql`
    SELECT id, org_id AS orgId, alias, name, type, size, dirtype,
           parent, object, storage_id AS storageId, status,
           trashed_at AS trashedAt,
           created_at AS createdAt, updated_at AS updatedAt
    FROM matters
    WHERE id = ${id} AND org_id = ${orgId}
  `)
  return rows[0] ?? null
}

export async function updateMatter(
  db: Database,
  id: string,
  orgId: string,
  input: { name?: string; parent?: string },
): Promise<Matter | null> {
  const existing = await getMatter(db, id, orgId)
  if (!existing) return null

  const now = Date.now()
  const name = input.name ?? existing.name
  const parent = input.parent ?? existing.parent

  await db.run(sql`
    UPDATE matters SET name = ${name}, parent = ${parent}, updated_at = ${now}
    WHERE id = ${id} AND org_id = ${orgId}
  `)

  return { ...existing, name, parent, updatedAt: now }
}

export async function confirmUpload(db: Database, id: string, orgId: string): Promise<Matter | null> {
  const existing = await getMatter(db, id, orgId)
  if (!existing) return null
  if (existing.status !== 'draft') return null

  const now = Date.now()
  await db.run(sql`
    UPDATE matters SET status = 'active', updated_at = ${now}
    WHERE id = ${id} AND org_id = ${orgId}
  `)

  return { ...existing, status: 'active', updatedAt: now }
}

export async function copyMatter(
  db: Database,
  source: Matter,
  targetParent: string,
  newObject: string,
): Promise<Matter> {
  const id = nanoid()
  const alias = nanoid(10)
  const now = Date.now()

  await db.run(sql`
    INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, created_at, updated_at)
    VALUES (${id}, ${source.orgId}, ${alias}, ${source.name}, ${source.type}, ${source.size}, ${source.dirtype}, ${targetParent}, ${newObject}, ${source.storageId}, 'active', ${now}, ${now})
  `)

  return {
    id,
    orgId: source.orgId,
    alias,
    name: source.name,
    type: source.type,
    size: source.size,
    dirtype: source.dirtype,
    parent: targetParent,
    object: newObject,
    storageId: source.storageId,
    status: 'active',
    trashedAt: null,
    createdAt: now,
    updatedAt: now,
  }
}

export async function deleteMatter(db: Database, id: string, orgId: string): Promise<Matter | null> {
  const existing = await getMatter(db, id, orgId)
  if (!existing) return null

  await db.run(sql`DELETE FROM matters WHERE id = ${id} AND org_id = ${orgId}`)
  return existing
}

// ─── Batch Operations ────────────────────────────────────────────────────────

export async function getMatters(db: Database, orgId: string, ids: string[]): Promise<Matter[]> {
  if (ids.length === 0) return []

  const idList = sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  )
  return db.all<Matter>(sql`
    SELECT id, org_id AS orgId, alias, name, type, size, dirtype,
           parent, object, storage_id AS storageId, status,
           trashed_at AS trashedAt,
           created_at AS createdAt, updated_at AS updatedAt
    FROM matters
    WHERE org_id = ${orgId} AND id IN (${idList})
  `)
}

export async function batchMove(db: Database, orgId: string, ids: string[], newParent: string): Promise<Matter[]> {
  const uniqueIds = [...new Set(ids)]
  const matters = await getMatters(db, orgId, uniqueIds)
  if (matters.length !== uniqueIds.length) {
    throw new Error('Some IDs do not belong to this organization')
  }

  const now = Date.now()
  for (const matter of matters) {
    await db.run(sql`
      UPDATE matters SET parent = ${newParent}, updated_at = ${now}
      WHERE id = ${matter.id} AND org_id = ${orgId}
    `)
  }

  return matters.map((m) => ({ ...m, parent: newParent, updatedAt: now }))
}

const MAX_RECURSION_DEPTH = 20

async function getChildrenRecursive(db: Database, orgId: string, parentIds: string[], depth = 0): Promise<Matter[]> {
  if (parentIds.length === 0 || depth >= MAX_RECURSION_DEPTH) return []

  const idList = sql.join(
    parentIds.map((id) => sql`${id}`),
    sql`, `,
  )
  const children = await db.all<Matter>(sql`
    SELECT id, org_id AS orgId, alias, name, type, size, dirtype,
           parent, object, storage_id AS storageId, status,
           trashed_at AS trashedAt,
           created_at AS createdAt, updated_at AS updatedAt
    FROM matters
    WHERE org_id = ${orgId} AND parent IN (${idList})
  `)
  if (children.length === 0) return []

  const folderIds = children.filter((c) => c.dirtype !== DirType.FILE).map((c) => c.id)
  const deeper = await getChildrenRecursive(db, orgId, folderIds, depth + 1)
  return [...children, ...deeper]
}

export async function batchTrash(db: Database, orgId: string, ids: string[]): Promise<Matter[]> {
  const uniqueIds = [...new Set(ids)]
  const matters = await getMatters(db, orgId, uniqueIds)
  if (matters.length !== uniqueIds.length) {
    throw new Error('Some IDs do not belong to this organization')
  }

  const folderIds = matters.filter((m) => m.dirtype !== DirType.FILE).map((m) => m.id)
  const children = await getChildrenRecursive(db, orgId, folderIds)
  const allMatters = [...matters, ...children]

  const now = Date.now()
  for (const matter of allMatters) {
    await db.run(sql`
      UPDATE matters SET status = 'trashed', trashed_at = ${now}, updated_at = ${now}
      WHERE id = ${matter.id} AND org_id = ${orgId}
    `)
  }

  return allMatters.map((m) => ({ ...m, status: 'trashed', trashedAt: now, updatedAt: now }))
}

export async function batchDelete(db: Database, orgId: string, ids: string[]): Promise<Matter[]> {
  const uniqueIds = [...new Set(ids)]
  const matters = await getMatters(db, orgId, uniqueIds)
  if (matters.length !== uniqueIds.length) {
    throw new Error('Some IDs do not belong to this organization')
  }

  const nonTrashed = matters.filter((m) => m.status !== 'trashed')
  if (nonTrashed.length > 0) {
    throw new Error('Only trashed items can be permanently deleted')
  }

  for (const matter of matters) {
    await db.run(sql`DELETE FROM matters WHERE id = ${matter.id} AND org_id = ${orgId}`)
  }

  return matters
}

// ─── Recycle Bin ─────────────────────────────────────────────────────────────

async function collectDescendants(db: Database, orgId: string, rootId: string): Promise<Matter[]> {
  const result: Matter[] = []
  let frontier = [rootId]
  while (frontier.length > 0) {
    const next: string[] = []
    for (const parentId of frontier) {
      const children = await db.all<Matter>(sql`
        SELECT id, org_id AS orgId, alias, name, type, size, dirtype,
               parent, object, storage_id AS storageId, status,
               trashed_at AS trashedAt,
               created_at AS createdAt, updated_at AS updatedAt
        FROM matters
        WHERE org_id = ${orgId} AND parent = ${parentId}
      `)
      for (const child of children) {
        result.push(child)
        if (child.dirtype !== 0) next.push(child.id)
      }
    }
    frontier = next
  }
  return result
}

export async function trashMatter(db: Database, orgId: string, id: string): Promise<Matter | null> {
  const existing = await getMatter(db, id, orgId)
  if (!existing) return null
  if (existing.status === 'trashed') return existing

  const now = Date.now()
  const descendants = await collectDescendants(db, orgId, existing.id)
  const ids = [existing.id, ...descendants.map((m) => m.id)]
  for (const targetId of ids) {
    await db.run(sql`
      UPDATE matters SET status = 'trashed', trashed_at = ${now}, updated_at = ${now}
      WHERE id = ${targetId} AND org_id = ${orgId} AND status = 'active'
    `)
  }
  return { ...existing, status: 'trashed', trashedAt: now, updatedAt: now }
}

export async function restoreMatter(db: Database, orgId: string, id: string): Promise<Matter | null> {
  const existing = await getMatter(db, id, orgId)
  if (!existing) return null
  if (existing.status !== 'trashed') return existing

  const now = Date.now()
  const descendants = await collectDescendants(db, orgId, existing.id)
  const ids = [existing.id, ...descendants.map((m) => m.id)]
  for (const targetId of ids) {
    await db.run(sql`
      UPDATE matters SET status = 'active', trashed_at = NULL, updated_at = ${now}
      WHERE id = ${targetId} AND org_id = ${orgId} AND status = 'trashed'
    `)
  }
  return { ...existing, status: 'active', trashedAt: null, updatedAt: now }
}

export async function collectForPurge(db: Database, orgId: string, id: string): Promise<Matter[] | null> {
  const existing = await getMatter(db, id, orgId)
  if (!existing) return null
  const descendants = await collectDescendants(db, orgId, existing.id)
  return [existing, ...descendants]
}

export async function purgeMatters(db: Database, orgId: string, ids: string[]): Promise<void> {
  for (const id of ids) {
    await db.run(sql`DELETE FROM matters WHERE id = ${id} AND org_id = ${orgId}`)
  }
}

export async function listTrashedRoots(db: Database, orgId: string): Promise<Matter[]> {
  return db.all<Matter>(sql`
    SELECT id, org_id AS orgId, alias, name, type, size, dirtype,
           parent, object, storage_id AS storageId, status,
           trashed_at AS trashedAt,
           created_at AS createdAt, updated_at AS updatedAt
    FROM matters
    WHERE org_id = ${orgId} AND status = 'trashed'
  `)
}

export async function decrementUsage(
  db: Database,
  orgId: string,
  bytesByStorage: Map<string, number>,
  totalBytes: number,
): Promise<void> {
  for (const [storageId, bytes] of bytesByStorage) {
    if (bytes <= 0) continue
    await db.run(sql`UPDATE storages SET used = MAX(0, used - ${bytes}) WHERE id = ${storageId}`)
  }
  if (totalBytes > 0) {
    await db.run(sql`UPDATE org_quotas SET used = MAX(0, used - ${totalBytes}) WHERE org_id = ${orgId}`)
  }
}
