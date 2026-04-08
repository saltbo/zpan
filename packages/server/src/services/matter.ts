import { sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
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
