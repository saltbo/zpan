import type { SQL } from 'drizzle-orm'
import { and, asc, count, desc, eq, inArray, like, or, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { DirType } from '../../shared/constants'
import { matters } from '../db/schema'
import type { Database } from '../platform/interface'
import { recordActivity } from './activity'
import {
  applyConflictResolution,
  type ConflictStrategy,
  commitConflictPlan,
  planConflictResolution,
} from './matter-name-conflict'
import { StorageQuotaExceededError, withStorageUsageReservation } from './storage-usage'

export type Matter = typeof matters.$inferSelect

interface CreateMatterInput {
  orgId: string
  userId?: string
  name: string
  type: string
  size?: number
  dirtype?: number
  parent?: string
  object: string
  storageId: string
  status: string
  /** How to handle name collision with an existing active sibling. Default 'fail'. */
  onConflict?: ConflictStrategy
}

export async function createMatter(db: Database, input: CreateMatterInput): Promise<Matter> {
  const now = new Date()
  const isFolder = (input.dirtype ?? 0) !== DirType.FILE
  const parent = input.parent ?? ''

  // Resolve name collisions against existing active siblings BEFORE inserting —
  // for folders this prevents duplicates at creation; for files it catches the
  // conflict before the client wastes a large S3 upload. confirmUpload does a
  // second check to guard against draft-vs-active races during upload.
  const finalName = await applyConflictResolution(db, input.orgId, parent, input.name, input.onConflict ?? 'fail', {
    isFolder,
    userId: input.userId,
  })

  const row: Matter = {
    id: nanoid(),
    orgId: input.orgId,
    alias: nanoid(10),
    name: finalName,
    type: input.type,
    size: input.size ?? 0,
    dirtype: input.dirtype ?? 0,
    parent,
    object: input.object,
    storageId: input.storageId,
    status: input.status,
    trashedAt: null,
    createdAt: now,
    updatedAt: now,
  }

  await db.insert(matters).values(row)

  if (input.userId) {
    await recordActivity(db, {
      orgId: input.orgId,
      userId: input.userId,
      action: isFolder ? 'create' : 'upload',
      targetType: isFolder ? 'folder' : 'file',
      targetId: row.id,
      targetName: row.name,
    })
  }

  return row
}

function typeFilterCondition(typeFilter: string): SQL | undefined {
  switch (typeFilter) {
    case 'photos':
      return like(matters.type, 'image/%')
    case 'videos':
      return like(matters.type, 'video/%')
    case 'music':
      return like(matters.type, 'audio/%')
    case 'documents':
      return or(
        like(matters.type, 'application/pdf'),
        like(matters.type, 'application/msword'),
        like(matters.type, 'application/vnd.%'),
        like(matters.type, 'text/%'),
      )
    default:
      return undefined
  }
}

interface ListFilters {
  parent?: string
  status: string
  page: number
  pageSize: number
  typeFilter?: string
  search?: string
}

export async function listMatters(
  db: Database,
  orgId: string,
  filters: ListFilters,
): Promise<{ items: Matter[]; total: number; page: number; pageSize: number }> {
  const offset = (filters.page - 1) * filters.pageSize
  if (filters.status === 'trashed' && !filters.search && !filters.typeFilter) {
    const roots = await listTrashedRoots(db, orgId)
    return {
      items: roots.slice(offset, offset + filters.pageSize),
      total: roots.length,
      page: filters.page,
      pageSize: filters.pageSize,
    }
  }

  const conditions = [eq(matters.orgId, orgId), eq(matters.status, filters.status)]
  const typeCond = filters.typeFilter ? typeFilterCondition(filters.typeFilter) : undefined
  if (filters.search) {
    conditions.push(like(matters.name, `%${filters.search}%`))
  } else if (typeCond) {
    conditions.push(typeCond)
    conditions.push(eq(matters.dirtype, DirType.FILE))
  } else {
    conditions.push(eq(matters.parent, filters.parent ?? ''))
  }
  const where = and(...conditions)

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

function buildPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name
}

function descendantParentCondition(folderPath: string): SQL {
  const prefix = `${folderPath}/`
  return sql`SUBSTR(${matters.parent}, 1, LENGTH(${prefix})) = ${prefix}`
}

export async function updateMatter(
  db: Database,
  id: string,
  orgId: string,
  input: { name?: string; parent?: string; onConflict?: ConflictStrategy },
  userId?: string,
): Promise<Matter | null> {
  const existing = await getMatter(db, id, orgId)
  if (!existing) return null

  const now = new Date()
  const requestedName = input.name ?? existing.name
  const newParent = input.parent ?? existing.parent
  const isFolder = existing.dirtype !== DirType.FILE
  const renamed = input.name && input.name !== existing.name
  const moved = input.parent !== undefined && input.parent !== existing.parent

  // Guard: reject before touching descendants. Must happen after rename/move
  // detection but before cascading path updates.
  if (isFolder && (renamed || moved)) {
    const oldPath = buildPath(existing.parent, existing.name)
    if (newParent === oldPath || newParent.startsWith(`${oldPath}/`)) {
      throw new Error('Cannot move a folder into itself or its subfolder')
    }
  }

  // Resolve name conflict in the destination parent. Excludes self so a no-op
  // rename (A → A) is allowed.
  const newName =
    renamed || moved
      ? await applyConflictResolution(db, orgId, newParent, requestedName, input.onConflict ?? 'fail', {
          excludeId: existing.id,
          isFolder,
          userId,
        })
      : requestedName

  if (isFolder && (renamed || moved)) {
    const oldPath = buildPath(existing.parent, existing.name)
    const newPath = buildPath(newParent, newName)
    await cascadeParentPath(db, orgId, oldPath, newPath)
  }

  await db
    .update(matters)
    .set({ name: newName, parent: newParent, updatedAt: now })
    .where(and(eq(matters.id, id), eq(matters.orgId, orgId)))

  const updated = { ...existing, name: newName, parent: newParent, updatedAt: now }

  if (userId) {
    const targetType = isFolder ? 'folder' : 'file'
    // Compare the final persisted state so auto-renames (from conflict resolution)
    // are recorded even when the user only asked to move.
    if (newName !== existing.name) {
      await recordActivity(db, {
        orgId,
        userId,
        action: 'rename',
        targetType,
        targetId: id,
        targetName: newName,
        metadata: { from: existing.name },
      })
    }
    if (newParent !== existing.parent) {
      await recordActivity(db, {
        orgId,
        userId,
        action: 'move',
        targetType,
        targetId: id,
        targetName: newName,
        metadata: { from: existing.parent, to: newParent },
      })
    }
  }

  return updated
}

async function cascadeParentPath(db: Database, orgId: string, oldPath: string, newPath: string): Promise<void> {
  // Direct children: parent = oldPath → parent = newPath
  await db
    .update(matters)
    .set({ parent: newPath, updatedAt: new Date() })
    .where(and(eq(matters.orgId, orgId), eq(matters.parent, oldPath)))

  // Deeper descendants: parent starts with 'oldPath/' → replace prefix.
  await db
    .update(matters)
    .set({
      parent: sql`${newPath} || SUBSTR(${matters.parent}, LENGTH(${oldPath}) + 1)`,
      updatedAt: new Date(),
    })
    .where(and(eq(matters.orgId, orgId), descendantParentCondition(oldPath)))
}

export async function confirmUpload(
  db: Database,
  id: string,
  orgId: string,
  opts: { onConflict?: ConflictStrategy; userId?: string; teamQuotaEnabled?: boolean } = {},
): Promise<{ matter: Matter | null; quotaExceeded?: boolean }> {
  try {
    const existing = await getMatter(db, id, orgId)
    if (!existing) return { matter: null }
    if (existing.status !== 'draft') return { matter: null }

    // Plan-then-commit: between draft creation and now, another user may have
    // created a conflicting active row. We plan (side-effect-free) first so the
    // quota check below can short-circuit without ever trashing an incumbent
    // file. The DB's partial unique index fires on the status update as a final
    // safety net against concurrent confirms.
    const plan = await planConflictResolution(db, orgId, existing.parent, existing.name, opts.onConflict ?? 'fail', {
      excludeId: existing.id,
      isFolder: false,
      userId: opts.userId,
    })

    const bytes = existing.size ?? 0
    return await withStorageUsageReservation(
      db,
      { orgId, storageId: existing.storageId, bytes, teamQuotaEnabled: opts.teamQuotaEnabled ?? true },
      async () => {
        // Quota reserved — now safe to execute the replace (if any).
        await commitConflictPlan(db, orgId, plan, opts.userId)

        const now = new Date()
        const updated = await db
          .update(matters)
          .set({ name: plan.finalName, status: 'active', updatedAt: now })
          .where(and(eq(matters.id, id), eq(matters.orgId, orgId), eq(matters.status, 'draft')))
          .returning({ id: matters.id })

        if (updated.length === 0) {
          throw new Error('CONFIRM_UPLOAD_RACE')
        }

        const confirmed = { ...existing, name: plan.finalName, status: 'active', updatedAt: now }

        if (opts.userId) {
          await recordActivity(db, {
            orgId,
            userId: opts.userId,
            action: 'upload_confirm',
            targetType: 'file',
            targetId: confirmed.id,
            targetName: confirmed.name,
          })
        }

        return { matter: confirmed }
      },
    )
  } catch (error) {
    if (error instanceof StorageQuotaExceededError) return { matter: null, quotaExceeded: true }
    if (error instanceof Error && error.message === 'CONFIRM_UPLOAD_RACE') return { matter: null }
    throw error
  }
}

export async function copyMatter(
  db: Database,
  source: Matter,
  targetParent: string,
  newObject: string,
  opts: { onConflict?: ConflictStrategy; userId?: string } = {},
): Promise<Matter> {
  const now = new Date()
  const isFolder = source.dirtype !== DirType.FILE
  // Default to 'rename' for copy — copying "foo.pdf" into the same folder almost
  // always means "make a duplicate", so the Finder-style auto-rename is the
  // intuitive default when the caller didn't pick a strategy.
  const finalName = await applyConflictResolution(
    db,
    source.orgId,
    targetParent,
    source.name,
    opts.onConflict ?? 'rename',
    { isFolder, userId: opts.userId },
  )

  const row: Matter = {
    id: nanoid(),
    orgId: source.orgId,
    alias: nanoid(10),
    name: finalName,
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

  if (opts.userId) {
    await recordActivity(db, {
      orgId: source.orgId,
      userId: opts.userId,
      action: 'object_copy',
      targetType: isFolder ? 'folder' : 'file',
      targetId: row.id,
      targetName: row.name,
      metadata: { from: source.name, to: targetParent },
    })
  }

  return row
}

export async function deleteMatter(db: Database, id: string, orgId: string): Promise<Matter | null> {
  const existing = await getMatter(db, id, orgId)
  if (!existing) return null

  await db.delete(matters).where(and(eq(matters.id, id), eq(matters.orgId, orgId)))
  return existing
}

export async function cancelDraftMatter(
  db: Database,
  id: string,
  orgId: string,
  userId?: string,
): Promise<Matter | null> {
  const existing = await getMatter(db, id, orgId)
  if (!existing || existing.status !== 'draft') return null

  await db.delete(matters).where(and(eq(matters.id, id), eq(matters.orgId, orgId), eq(matters.status, 'draft')))

  if (userId) {
    await recordActivity(db, {
      orgId,
      userId,
      action: 'upload_cancel',
      targetType: 'file',
      targetId: existing.id,
      targetName: existing.name,
    })
  }

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

function getDescendants(db: Database, orgId: string, folderPath: string): Promise<Matter[]> {
  return db
    .select()
    .from(matters)
    .where(and(eq(matters.orgId, orgId), descendantParentCondition(folderPath)))
}

function getDirectChildren(db: Database, orgId: string, folderPath: string): Promise<Matter[]> {
  return db
    .select()
    .from(matters)
    .where(and(eq(matters.orgId, orgId), eq(matters.parent, folderPath)))
}

// ─── Recycle Bin ─────────────────────────────────────────────────────────────

export async function trashMatter(db: Database, orgId: string, id: string, userId?: string): Promise<Matter | null> {
  const existing = await getMatter(db, id, orgId)
  if (!existing) return null
  if (existing.status === 'trashed') return existing

  const now = new Date()
  const nowTs = now.getTime()
  const allIds = [existing.id]

  if (existing.dirtype !== DirType.FILE) {
    const path = buildPath(existing.parent, existing.name)
    const children = await getDirectChildren(db, orgId, path)
    const descendants = await getDescendants(db, orgId, path)
    allIds.push(...children.map((m) => m.id), ...descendants.map((m) => m.id))
  }

  for (const targetId of allIds) {
    await db
      .update(matters)
      .set({ status: 'trashed', trashedAt: nowTs, updatedAt: now })
      .where(and(eq(matters.id, targetId), eq(matters.orgId, orgId), eq(matters.status, 'active')))
  }
  const trashed = { ...existing, status: 'trashed', trashedAt: nowTs, updatedAt: now }

  if (userId) {
    await recordActivity(db, {
      orgId,
      userId,
      action: 'delete',
      targetType: existing.dirtype !== DirType.FILE ? 'folder' : 'file',
      targetId: existing.id,
      targetName: existing.name,
    })
  }

  return trashed
}

export async function restoreMatter(
  db: Database,
  orgId: string,
  id: string,
  userId?: string,
  onConflict: ConflictStrategy = 'fail',
): Promise<Matter | null> {
  const existing = await getMatter(db, id, orgId)
  if (!existing) return null
  if (existing.status !== 'trashed') return existing

  // A same-named active item may have been created in the original parent
  // while this one sat in trash. Resolve before touching descendants so a
  // rejection doesn't leave folders half-restored.
  const isFolder = existing.dirtype !== DirType.FILE
  const finalName = await applyConflictResolution(db, orgId, existing.parent, existing.name, onConflict, {
    excludeId: existing.id,
    isFolder,
    userId,
  })

  const now = new Date()
  const allIds = [existing.id]

  if (isFolder) {
    const path = buildPath(existing.parent, existing.name)
    const children = await getDirectChildren(db, orgId, path)
    const descendants = await getDescendants(db, orgId, path)
    allIds.push(...children.map((m) => m.id), ...descendants.map((m) => m.id))
  }

  // Rename + cascade parent paths BEFORE activation. While everything is still
  // trashed, these writes cannot violate the active-name unique index, and no
  // reader ever sees descendants with stale paths in an active state.
  if (finalName !== existing.name) {
    await db
      .update(matters)
      .set({ name: finalName, updatedAt: now })
      .where(and(eq(matters.id, existing.id), eq(matters.orgId, orgId)))
    if (isFolder) {
      const oldPath = buildPath(existing.parent, existing.name)
      const newPath = buildPath(existing.parent, finalName)
      await cascadeParentPath(db, orgId, oldPath, newPath)
    }
  }

  for (const targetId of allIds) {
    await db
      .update(matters)
      .set({ status: 'active', trashedAt: null, updatedAt: now })
      .where(and(eq(matters.id, targetId), eq(matters.orgId, orgId), eq(matters.status, 'trashed')))
  }

  const restored = { ...existing, name: finalName, status: 'active', trashedAt: null, updatedAt: now }

  if (userId) {
    await recordActivity(db, {
      orgId,
      userId,
      action: 'restore',
      targetType: isFolder ? 'folder' : 'file',
      targetId: existing.id,
      targetName: finalName,
    })
  }

  return restored
}

export async function collectForPurge(db: Database, orgId: string, id: string): Promise<Matter[] | null>
export async function collectForPurge(db: Database, orgId: string, existing: Matter): Promise<Matter[]>
export async function collectForPurge(
  db: Database,
  orgId: string,
  idOrMatter: string | Matter,
): Promise<Matter[] | null> {
  const existing = typeof idOrMatter === 'string' ? await getMatter(db, idOrMatter, orgId) : idOrMatter
  if (!existing) return null

  if (existing.dirtype === DirType.FILE) return [existing]

  const path = buildPath(existing.parent, existing.name)
  const children = await getDirectChildren(db, orgId, path)
  const descendants = await getDescendants(db, orgId, path)
  return [existing, ...children, ...descendants]
}

export async function purgeMatters(db: Database, orgId: string, ids: string[]): Promise<void> {
  for (const id of ids) {
    await db.delete(matters).where(and(eq(matters.id, id), eq(matters.orgId, orgId)))
  }
}

export async function listTrashedRoots(db: Database, orgId: string): Promise<Matter[]> {
  const all = await db
    .select()
    .from(matters)
    .where(and(eq(matters.orgId, orgId), eq(matters.status, 'trashed')))

  const trashedPaths = new Set(all.map((m) => buildPath(m.parent, m.name)))
  return all
    .filter((m) => !trashedPaths.has(m.parent))
    .sort((a, b) => {
      const aTrashedAt = a.trashedAt ?? 0
      const bTrashedAt = b.trashedAt ?? 0
      if (aTrashedAt !== bTrashedAt) return bTrashedAt - aTrashedAt
      return b.createdAt.getTime() - a.createdAt.getTime()
    })
}
