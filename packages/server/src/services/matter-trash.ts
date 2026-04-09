import { DirType } from '@zpan/shared/constants'
import { sql } from 'drizzle-orm'
import type { Database } from '../platform/interface'
import { getMatter, type Matter } from './matter'

export interface TrashedMatterForDeletion {
  id: string
  object: string
  size: number
  storageId: string
  dirtype: number
}

export async function trashMatter(db: Database, id: string, orgId: string): Promise<Matter | null> {
  const existing = await getMatter(db, id, orgId)
  if (!existing) return null
  if (existing.status !== 'active') return null

  const now = Date.now()
  await db.run(sql`
    UPDATE matters SET status = 'trashed', updated_at = ${now}
    WHERE id = ${id} AND org_id = ${orgId}
  `)

  if (existing.dirtype !== DirType.FILE) {
    await trashDescendants(db, id, orgId, now)
  }

  return { ...existing, status: 'trashed', updatedAt: now }
}

async function trashDescendants(db: Database, parentId: string, orgId: string, now: number): Promise<void> {
  const children = await db.all<{ id: string; dirtype: number }>(sql`
    SELECT id, dirtype FROM matters
    WHERE org_id = ${orgId} AND parent = ${parentId} AND status = 'active'
  `)

  for (const child of children) {
    await db.run(sql`
      UPDATE matters SET status = 'trashed', updated_at = ${now}
      WHERE id = ${child.id} AND org_id = ${orgId}
    `)
    if (child.dirtype !== DirType.FILE) {
      await trashDescendants(db, child.id, orgId, now)
    }
  }
}

export async function restoreMatter(db: Database, id: string, orgId: string): Promise<Matter | null> {
  const existing = await getMatter(db, id, orgId)
  if (!existing) return null
  if (existing.status !== 'trashed') return null

  const now = Date.now()
  await db.run(sql`
    UPDATE matters SET status = 'active', updated_at = ${now}
    WHERE id = ${id} AND org_id = ${orgId}
  `)

  if (existing.dirtype !== DirType.FILE) {
    await restoreDescendants(db, id, orgId, now)
  }

  return { ...existing, status: 'active', updatedAt: now }
}

async function restoreDescendants(db: Database, parentId: string, orgId: string, now: number): Promise<void> {
  const children = await db.all<{ id: string; dirtype: number }>(sql`
    SELECT id, dirtype FROM matters
    WHERE org_id = ${orgId} AND parent = ${parentId} AND status = 'trashed'
  `)

  for (const child of children) {
    await db.run(sql`
      UPDATE matters SET status = 'active', updated_at = ${now}
      WHERE id = ${child.id} AND org_id = ${orgId}
    `)
    if (child.dirtype !== DirType.FILE) {
      await restoreDescendants(db, child.id, orgId, now)
    }
  }
}

export async function permanentDeleteMatter(
  db: Database,
  id: string,
  orgId: string,
): Promise<TrashedMatterForDeletion[] | null> {
  const existing = await getMatter(db, id, orgId)
  if (!existing) return null
  if (existing.status !== 'trashed') return null

  const collected: TrashedMatterForDeletion[] = []
  await collectDescendants(db, id, orgId, collected)
  collected.push({
    id: existing.id,
    object: existing.object,
    size: existing.size,
    storageId: existing.storageId,
    dirtype: existing.dirtype,
  })

  for (const m of collected) {
    await db.run(sql`DELETE FROM matters WHERE id = ${m.id} AND org_id = ${orgId}`)
  }

  await decrementQuotas(db, orgId, collected)
  return collected
}

async function collectDescendants(
  db: Database,
  parentId: string,
  orgId: string,
  collected: TrashedMatterForDeletion[],
): Promise<void> {
  const children = await db.all<TrashedMatterForDeletion>(sql`
    SELECT id, object, size, storage_id AS storageId, dirtype
    FROM matters
    WHERE org_id = ${orgId} AND parent = ${parentId} AND status = 'trashed'
  `)

  for (const child of children) {
    if (child.dirtype !== DirType.FILE) {
      await collectDescendants(db, child.id, orgId, collected)
    }
    collected.push(child)
  }
}

export async function emptyTrash(db: Database, orgId: string): Promise<TrashedMatterForDeletion[]> {
  const collected = await db.all<TrashedMatterForDeletion>(sql`
    SELECT id, object, size, storage_id AS storageId, dirtype
    FROM matters
    WHERE org_id = ${orgId} AND status = 'trashed'
  `)

  if (collected.length === 0) return collected

  await db.run(sql`DELETE FROM matters WHERE org_id = ${orgId} AND status = 'trashed'`)
  await decrementQuotas(db, orgId, collected)
  return collected
}

async function decrementQuotas(db: Database, orgId: string, items: TrashedMatterForDeletion[]): Promise<void> {
  const byStorage = new Map<string, number>()
  let totalSize = 0
  for (const m of items) {
    totalSize += m.size
    byStorage.set(m.storageId, (byStorage.get(m.storageId) ?? 0) + m.size)
  }

  for (const [storageId, size] of byStorage) {
    if (size > 0) {
      await db.run(sql`
        UPDATE storages SET used = MAX(0, used - ${size})
        WHERE id = ${storageId}
      `)
    }
  }

  if (totalSize > 0) {
    await db.run(sql`
      UPDATE org_quotas SET used = MAX(0, used - ${totalSize})
      WHERE org_id = ${orgId}
    `)
  }
}
