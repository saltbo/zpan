import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { DirType } from '../../shared/constants'
import { matters, orgQuotas, storages } from '../db/schema'
import type { Database } from '../platform/interface'

export type Matter = typeof matters.$inferSelect

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
  const now = new Date()
  const row: Matter = {
    id: nanoid(),
    orgId: input.orgId,
    alias: nanoid(10),
    name: input.name,
    type: input.type,
    size: input.size ?? 0,
    dirtype: input.dirtype ?? 0,
    parent: input.parent ?? '',
    object: input.object,
    storageId: input.storageId,
    status: input.status,
    trashedAt: null,
    createdAt: now,
    updatedAt: now,
  }

  await db.insert(matters).values(row)
  return row
}

export async function listMatters(
  db: Database,
  orgId: string,
  filters: { parent: string; status: string; page: number; pageSize: number },
): Promise<{ items: Matter[]; total: number; page: number; pageSize: number }> {
  const offset = (filters.page - 1) * filters.pageSize
  const where = and(eq(matters.orgId, orgId), eq(matters.parent, filters.parent), eq(matters.status, filters.status))

  const countRows = await db.select({ count: count() }).from(matters).where(where)
  const total = countRows[0]?.count ?? 0

  const items = await db
    .select()
    .from(matters)
    .where(where)
    .orderBy(desc(matters.dirtype), asc(matters.createdAt))
    .limit(filters.pageSize)
    .offset(offset)

  return { items, total, page: filters.page, pageSize: filters.pageSize }
}

export async function getMatter(db: Database, id: string, orgId: string): Promise<Matter | null> {
  const rows = await db
    .select()
    .from(matters)
    .where(and(eq(matters.id, id), eq(matters.orgId, orgId)))
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

  const now = new Date()
  const name = input.name ?? existing.name
  const parent = input.parent ?? existing.parent

  await db
    .update(matters)
    .set({ name, parent, updatedAt: now })
    .where(and(eq(matters.id, id), eq(matters.orgId, orgId)))

  return { ...existing, name, parent, updatedAt: now }
}

export async function confirmUpload(db: Database, id: string, orgId: string): Promise<Matter | null> {
  const existing = await getMatter(db, id, orgId)
  if (!existing) return null
  if (existing.status !== 'draft') return null

  const now = new Date()
  await db
    .update(matters)
    .set({ status: 'active', updatedAt: now })
    .where(and(eq(matters.id, id), eq(matters.orgId, orgId)))

  return { ...existing, status: 'active', updatedAt: now }
}

export async function copyMatter(
  db: Database,
  source: Matter,
  targetParent: string,
  newObject: string,
): Promise<Matter> {
  const now = new Date()
  const row: Matter = {
    id: nanoid(),
    orgId: source.orgId,
    alias: nanoid(10),
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

  await db.insert(matters).values(row)
  return row
}

export async function deleteMatter(db: Database, id: string, orgId: string): Promise<Matter | null> {
  const existing = await getMatter(db, id, orgId)
  if (!existing) return null

  await db.delete(matters).where(and(eq(matters.id, id), eq(matters.orgId, orgId)))
  return existing
}

// ─── Batch Operations ────────────────────────────────────────────────────────

export async function getMatters(db: Database, orgId: string, ids: string[]): Promise<Matter[]> {
  if (ids.length === 0) return []

  return db
    .select()
    .from(matters)
    .where(and(eq(matters.orgId, orgId), inArray(matters.id, ids)))
}

export async function batchMove(db: Database, orgId: string, ids: string[], newParent: string): Promise<Matter[]> {
  const uniqueIds = [...new Set(ids)]
  const items = await getMatters(db, orgId, uniqueIds)
  if (items.length !== uniqueIds.length) {
    throw new Error('Some IDs do not belong to this organization')
  }

  const now = new Date()
  for (const matter of items) {
    await db
      .update(matters)
      .set({ parent: newParent, updatedAt: now })
      .where(and(eq(matters.id, matter.id), eq(matters.orgId, orgId)))
  }

  return items.map((m) => ({ ...m, parent: newParent, updatedAt: now }))
}

const MAX_RECURSION_DEPTH = 20

async function getChildrenRecursive(db: Database, orgId: string, parentIds: string[], depth = 0): Promise<Matter[]> {
  if (parentIds.length === 0 || depth >= MAX_RECURSION_DEPTH) return []

  const children = await db
    .select()
    .from(matters)
    .where(and(eq(matters.orgId, orgId), inArray(matters.parent, parentIds)))

  if (children.length === 0) return []

  const folderIds = children.filter((c) => (c.dirtype ?? 0) !== DirType.FILE).map((c) => c.id)
  const deeper = await getChildrenRecursive(db, orgId, folderIds, depth + 1)
  return [...children, ...deeper]
}

export async function batchTrash(db: Database, orgId: string, ids: string[]): Promise<Matter[]> {
  const uniqueIds = [...new Set(ids)]
  const items = await getMatters(db, orgId, uniqueIds)
  if (items.length !== uniqueIds.length) {
    throw new Error('Some IDs do not belong to this organization')
  }

  const folderIds = items.filter((m) => (m.dirtype ?? 0) !== DirType.FILE).map((m) => m.id)
  const children = await getChildrenRecursive(db, orgId, folderIds)
  const allMatters = [...items, ...children]

  const now = new Date()
  const nowTs = now.getTime()
  for (const matter of allMatters) {
    await db
      .update(matters)
      .set({ status: 'trashed', trashedAt: nowTs, updatedAt: now })
      .where(and(eq(matters.id, matter.id), eq(matters.orgId, orgId)))
  }

  return allMatters.map((m) => ({ ...m, status: 'trashed', trashedAt: nowTs, updatedAt: now }))
}

export async function batchDelete(db: Database, orgId: string, ids: string[]): Promise<Matter[]> {
  const uniqueIds = [...new Set(ids)]
  const items = await getMatters(db, orgId, uniqueIds)
  if (items.length !== uniqueIds.length) {
    throw new Error('Some IDs do not belong to this organization')
  }

  const nonTrashed = items.filter((m) => m.status !== 'trashed')
  if (nonTrashed.length > 0) {
    throw new Error('Only trashed items can be permanently deleted')
  }

  for (const matter of items) {
    await db.delete(matters).where(and(eq(matters.id, matter.id), eq(matters.orgId, orgId)))
  }

  return items
}

// ─── Recycle Bin ─────────────────────────────────────────────────────────────

async function collectDescendants(db: Database, orgId: string, rootId: string): Promise<Matter[]> {
  const result: Matter[] = []
  let frontier = [rootId]
  while (frontier.length > 0) {
    const next: string[] = []
    for (const parentId of frontier) {
      const children = await db
        .select()
        .from(matters)
        .where(and(eq(matters.orgId, orgId), eq(matters.parent, parentId)))
      for (const child of children) {
        result.push(child)
        if ((child.dirtype ?? 0) !== 0) next.push(child.id)
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

  const now = new Date()
  const nowTs = now.getTime()
  const descendants = await collectDescendants(db, orgId, existing.id)
  const ids = [existing.id, ...descendants.map((m) => m.id)]
  for (const targetId of ids) {
    await db
      .update(matters)
      .set({ status: 'trashed', trashedAt: nowTs, updatedAt: now })
      .where(and(eq(matters.id, targetId), eq(matters.orgId, orgId), eq(matters.status, 'active')))
  }
  return { ...existing, status: 'trashed', trashedAt: nowTs, updatedAt: now }
}

export async function restoreMatter(db: Database, orgId: string, id: string): Promise<Matter | null> {
  const existing = await getMatter(db, id, orgId)
  if (!existing) return null
  if (existing.status !== 'trashed') return existing

  const now = new Date()
  const descendants = await collectDescendants(db, orgId, existing.id)
  const ids = [existing.id, ...descendants.map((m) => m.id)]
  for (const targetId of ids) {
    await db
      .update(matters)
      .set({ status: 'active', trashedAt: null, updatedAt: now })
      .where(and(eq(matters.id, targetId), eq(matters.orgId, orgId), eq(matters.status, 'trashed')))
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
    await db.delete(matters).where(and(eq(matters.id, id), eq(matters.orgId, orgId)))
  }
}

export async function listTrashedRoots(db: Database, orgId: string): Promise<Matter[]> {
  return db
    .select()
    .from(matters)
    .where(and(eq(matters.orgId, orgId), eq(matters.status, 'trashed')))
}

export async function decrementUsage(
  db: Database,
  orgId: string,
  bytesByStorage: Map<string, number>,
  totalBytes: number,
): Promise<void> {
  for (const [storageId, bytes] of bytesByStorage) {
    if (bytes <= 0) continue
    await db
      .update(storages)
      .set({ used: sql`MAX(0, ${storages.used} - ${bytes})` })
      .where(eq(storages.id, storageId))
  }
  if (totalBytes > 0) {
    await db
      .update(orgQuotas)
      .set({ used: sql`MAX(0, ${orgQuotas.used} - ${totalBytes})` })
      .where(eq(orgQuotas.orgId, orgId))
  }
}
