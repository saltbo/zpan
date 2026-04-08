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

export async function getMatter(db: Database, orgId: string, matterId: string): Promise<Matter | null> {
  const rows = await db.all<Matter>(sql`
    SELECT id, org_id AS orgId, alias, name, type, size, dirtype,
           parent, object, storage_id AS storageId, status,
           created_at AS createdAt, updated_at AS updatedAt
    FROM matters WHERE id = ${matterId} AND org_id = ${orgId}
  `)
  return rows[0] ?? null
}

export async function getDescendants(db: Database, orgId: string, matterId: string): Promise<Matter[]> {
  return db.all<Matter>(sql`
    WITH RECURSIVE descendants AS (
      SELECT id, org_id AS orgId, alias, name, type, size, dirtype,
             parent, object, storage_id AS storageId, status,
             created_at AS createdAt, updated_at AS updatedAt
      FROM matters WHERE parent = ${matterId} AND org_id = ${orgId}
      UNION ALL
      SELECT m.id, m.org_id AS orgId, m.alias, m.name, m.type, m.size, m.dirtype,
             m.parent, m.object, m.storage_id AS storageId, m.status,
             m.created_at AS createdAt, m.updated_at AS updatedAt
      FROM matters m
      INNER JOIN descendants d ON m.parent = d.id
    )
    SELECT * FROM descendants
  `)
}

export async function trash(
  db: Database,
  orgId: string,
  matterId: string,
): Promise<'ok' | 'not_found' | 'already_trashed'> {
  const matter = await getMatter(db, orgId, matterId)
  if (!matter) return 'not_found'
  if (matter.status === 'trashed') return 'already_trashed'

  const now = Date.now()
  const ids = [matterId]

  if (matter.dirtype !== 0) {
    const descendants = await getDescendants(db, orgId, matterId)
    ids.push(...descendants.map((d) => d.id))
  }

  for (const id of ids) {
    await db.run(sql`
      UPDATE matters SET status = 'trashed', updated_at = ${now}
      WHERE id = ${id} AND org_id = ${orgId}
    `)
  }

  return 'ok'
}

export async function restore(
  db: Database,
  orgId: string,
  matterId: string,
): Promise<'ok' | 'not_found' | 'not_trashed'> {
  const matter = await getMatter(db, orgId, matterId)
  if (!matter) return 'not_found'
  if (matter.status !== 'trashed') return 'not_trashed'

  const now = Date.now()
  const ids = [matterId]

  if (matter.dirtype !== 0) {
    const descendants = await getDescendants(db, orgId, matterId)
    ids.push(...descendants.filter((d) => d.status === 'trashed').map((d) => d.id))
  }

  for (const id of ids) {
    await db.run(sql`
      UPDATE matters SET status = 'active', updated_at = ${now}
      WHERE id = ${id} AND org_id = ${orgId}
    `)
  }

  return 'ok'
}

export async function collectForDeletion(
  db: Database,
  orgId: string,
  matterId: string,
): Promise<{ result: 'not_found' | 'not_trashed' } | { result: 'ok'; matters: Matter[] }> {
  const matter = await getMatter(db, orgId, matterId)
  if (!matter) return { result: 'not_found' }
  if (matter.status !== 'trashed') return { result: 'not_trashed' }

  const toDelete = [matter]
  if (matter.dirtype !== 0) {
    const descendants = await getDescendants(db, orgId, matterId)
    toDelete.push(...descendants)
  }

  return { result: 'ok', matters: toDelete }
}

export async function permanentDelete(db: Database, matters: Matter[]): Promise<void> {
  const sizeByStorage = new Map<string, number>()
  const orgIds = new Set<string>()
  let totalSize = 0

  for (const m of matters) {
    if (m.dirtype === 0 && m.size > 0) {
      sizeByStorage.set(m.storageId, (sizeByStorage.get(m.storageId) ?? 0) + m.size)
      totalSize += m.size
    }
    orgIds.add(m.orgId)
    await db.run(sql`DELETE FROM matters WHERE id = ${m.id}`)
  }

  for (const [storageId, size] of sizeByStorage) {
    await db.run(sql`UPDATE storages SET used = used - ${size} WHERE id = ${storageId}`)
  }

  for (const orgId of orgIds) {
    if (totalSize > 0) {
      await db.run(sql`UPDATE org_quotas SET used = used - ${totalSize} WHERE org_id = ${orgId}`)
    }
  }
}

export async function collectTrash(db: Database, orgId: string): Promise<Matter[]> {
  return db.all<Matter>(sql`
    SELECT id, org_id AS orgId, alias, name, type, size, dirtype,
           parent, object, storage_id AS storageId, status,
           created_at AS createdAt, updated_at AS updatedAt
    FROM matters WHERE org_id = ${orgId} AND status = 'trashed'
  `)
}
