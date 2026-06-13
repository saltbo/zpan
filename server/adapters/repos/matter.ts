import { DirType, ObjectStatus } from '@shared/constants'
import type { SQL } from 'drizzle-orm'
import { and, asc, count, desc, eq, inArray, isNotNull, like, lt, ne, or, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { matters } from '../../db/schema'
import { suggestRenamed } from '../../domain/matter-name-conflict'
import type { Database } from '../../platform/interface'
import type {
  ConflictPlan,
  ConflictResolveOptions,
  ConflictStrategy,
  CopyMatterOptions,
  CreateMatterInput,
  Matter,
  MatterListFilters,
  MatterListResult,
  MatterRepo,
  UpdateMatterInput,
} from '../../usecases/ports'
import { NameConflictError } from '../../usecases/ports'
import { createActivityRepo } from './activity'

type MatterRow = typeof matters.$inferSelect

function toMatter(row: MatterRow): Matter {
  return row
}

function buildPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name
}

function descendantParentCondition(folderPath: string): SQL {
  const prefix = `${folderPath}/`
  return sql`SUBSTR(${matters.parent}, 1, LENGTH(${prefix})) = ${prefix}`
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

export function createMatterRepo(db: Database): MatterRepo {
  const activity = createActivityRepo(db)

  async function getMatter(id: string, orgId: string): Promise<Matter | null> {
    const rows = await db
      .select()
      .from(matters)
      .where(and(eq(matters.id, id), eq(matters.orgId, orgId)))
    return rows[0] ? toMatter(rows[0]) : null
  }

  function getDescendants(orgId: string, folderPath: string): Promise<MatterRow[]> {
    return db
      .select()
      .from(matters)
      .where(and(eq(matters.orgId, orgId), descendantParentCondition(folderPath)))
  }

  function getDirectChildren(orgId: string, folderPath: string): Promise<MatterRow[]> {
    return db
      .select()
      .from(matters)
      .where(and(eq(matters.orgId, orgId), eq(matters.parent, folderPath)))
  }

  async function cascadeParentPath(orgId: string, oldPath: string, newPath: string): Promise<void> {
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

  /**
   * Finds the active sibling that would collide with `name` under `parent`.
   * Matching is case-insensitive (mirrors the DB's partial unique index on
   * LOWER(name)). `excludeId` lets rename/move skip the row being modified.
   */
  async function findActiveConflict(
    orgId: string,
    parent: string,
    name: string,
    excludeId?: string,
  ): Promise<Matter | null> {
    const conditions = [
      eq(matters.orgId, orgId),
      eq(matters.parent, parent),
      eq(matters.status, ObjectStatus.ACTIVE),
      sql`lower(${matters.name}) = lower(${name})`,
    ]
    if (excludeId) conditions.push(ne(matters.id, excludeId))
    const rows = await db
      .select()
      .from(matters)
      .where(and(...conditions))
      .limit(1)
    return rows[0] ? toMatter(rows[0]) : null
  }

  async function findAvailableName(
    orgId: string,
    parent: string,
    name: string,
    excludeId: string | undefined,
  ): Promise<string> {
    for (let i = 1; i <= 999; i++) {
      const candidate = suggestRenamed(name, i)
      const conflict = await findActiveConflict(orgId, parent, candidate, excludeId)
      if (!conflict) return candidate
    }
    throw new Error('Too many name conflicts to auto-rename')
  }

  /**
   * Build a resolution plan WITHOUT side effects. Safe to call and discard.
   *
   * Throws NameConflictError when strategy='fail' or when 'replace' is rejected
   * because the incoming or existing row is a folder (not supported in v1).
   */
  async function planConflictResolution(
    orgId: string,
    parent: string,
    name: string,
    strategy: ConflictStrategy,
    options: ConflictResolveOptions = {},
  ): Promise<ConflictPlan> {
    const existing = await findActiveConflict(orgId, parent, name, options.excludeId)
    if (!existing) return { finalName: name, toTrash: null }

    if (strategy === 'fail') {
      throw new NameConflictError(existing.name, existing.id)
    }

    if (strategy === 'replace') {
      const incomingIsFolder = options.isFolder === true
      const existingIsFolder = existing.dirtype !== DirType.FILE
      if (incomingIsFolder || existingIsFolder) {
        throw new NameConflictError(existing.name, existing.id)
      }
      return { finalName: name, toTrash: existing }
    }

    const renamed = await findAvailableName(orgId, parent, name, options.excludeId)
    return { finalName: renamed, toTrash: null }
  }

  async function trashForReplace(orgId: string, existing: Matter, userId: string | undefined): Promise<void> {
    const now = new Date()
    await db
      .update(matters)
      .set({ status: ObjectStatus.TRASHED, trashedAt: now.getTime(), updatedAt: now })
      .where(and(eq(matters.id, existing.id), eq(matters.orgId, orgId)))

    if (userId) {
      await activity.record({
        orgId,
        userId,
        action: 'replace',
        targetType: 'file',
        targetId: existing.id,
        targetName: existing.name,
      })
    }
  }

  /** Execute the side effects of a plan (trash the replaced row, log activity). */
  async function commitConflictPlan(orgId: string, plan: ConflictPlan, userId?: string): Promise<void> {
    if (plan.toTrash) {
      await trashForReplace(orgId, plan.toTrash, userId)
    }
  }

  /**
   * Convenience for the common case: plan + commit back-to-back. Callers that
   * need to interleave checks (e.g. quota) between plan and commit should use
   * planConflictResolution / commitConflictPlan directly — see confirmUpload.
   */
  async function applyConflictResolution(
    orgId: string,
    parent: string,
    name: string,
    strategy: ConflictStrategy,
    options: ConflictResolveOptions = {},
  ): Promise<string> {
    const plan = await planConflictResolution(orgId, parent, name, strategy, options)
    await commitConflictPlan(orgId, plan, options.userId)
    return plan.finalName
  }

  function collectForPurge(orgId: string, idOrMatter: string): Promise<Matter[] | null>
  function collectForPurge(orgId: string, idOrMatter: Matter): Promise<Matter[]>
  async function collectForPurge(orgId: string, idOrMatter: string | Matter): Promise<Matter[] | null> {
    const existing = typeof idOrMatter === 'string' ? await getMatter(idOrMatter, orgId) : idOrMatter
    if (!existing) return null

    if (existing.dirtype === DirType.FILE) return [existing]

    const path = buildPath(existing.parent, existing.name)
    const children = await getDirectChildren(orgId, path)
    const descendants = await getDescendants(orgId, path)
    return [existing, ...children.map(toMatter), ...descendants.map(toMatter)]
  }

  const repo: MatterRepo = {
    async create(input: CreateMatterInput): Promise<Matter> {
      const now = new Date()
      const isFolder = (input.dirtype ?? 0) !== DirType.FILE
      const parent = input.parent ?? ''

      // Resolve name collisions against existing active siblings BEFORE inserting —
      // for folders this prevents duplicates at creation; for files it catches the
      // conflict before the client wastes a large S3 upload.
      const plan = await planConflictResolution(input.orgId, parent, input.name, input.onConflict ?? 'fail', {
        isFolder,
        userId: input.userId,
      })
      // Overwriting the incumbent for a draft-file 'replace' is deferred to
      // confirmUpload (which purges it after the new bytes land). That keeps a
      // failed/abandoned upload from destroying the existing file, and lets the
      // replace be charged as a net-size change. Folders, active creates, and
      // rename commit their plan immediately.
      const deferOverwrite = !isFolder && input.status === 'draft' && plan.toTrash !== null
      if (!deferOverwrite) {
        await commitConflictPlan(input.orgId, plan, input.userId)
      }
      const finalName = plan.finalName

      const row: MatterRow = {
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
        await activity.record({
          orgId: input.orgId,
          userId: input.userId,
          action: isFolder ? 'create' : 'upload',
          targetType: isFolder ? 'folder' : 'file',
          targetId: row.id,
          targetName: row.name,
        })
      }

      return toMatter(row)
    },

    async list(orgId: string, filters: MatterListFilters): Promise<MatterListResult> {
      const offset = (filters.page - 1) * filters.pageSize
      if (filters.status === 'trashed' && !filters.search && !filters.typeFilter) {
        const roots = await repo.listTrashedRoots(orgId)
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

      return { items: items.map(toMatter), total, page: filters.page, pageSize: filters.pageSize }
    },

    get(id, orgId) {
      return getMatter(id, orgId)
    },

    async getMany(orgId, ids) {
      if (ids.length === 0) return []
      const rows = await db
        .select()
        .from(matters)
        .where(and(eq(matters.orgId, orgId), inArray(matters.id, ids)))
      return rows.map(toMatter)
    },

    async update(id, orgId, input: UpdateMatterInput, userId?: string): Promise<Matter | null> {
      const existing = await getMatter(id, orgId)
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
          ? await applyConflictResolution(orgId, newParent, requestedName, input.onConflict ?? 'fail', {
              excludeId: existing.id,
              isFolder,
              userId,
            })
          : requestedName

      if (isFolder && (renamed || moved)) {
        const oldPath = buildPath(existing.parent, existing.name)
        const newPath = buildPath(newParent, newName)
        await cascadeParentPath(orgId, oldPath, newPath)
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
          await activity.record({
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
          await activity.record({
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
    },

    async copy(source, targetParent, newObject, opts: CopyMatterOptions = {}): Promise<Matter> {
      const now = new Date()
      const isFolder = source.dirtype !== DirType.FILE
      // Default to 'rename' for copy — copying "foo.pdf" into the same folder almost
      // always means "make a duplicate", so the Finder-style auto-rename is the
      // intuitive default when the caller didn't pick a strategy.
      const finalName = await applyConflictResolution(
        source.orgId,
        targetParent,
        source.name,
        opts.onConflict ?? 'rename',
        {
          isFolder,
          userId: opts.userId,
        },
      )

      const row: MatterRow = {
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
        await activity.record({
          orgId: source.orgId,
          userId: opts.userId,
          action: 'object_copy',
          targetType: isFolder ? 'folder' : 'file',
          targetId: row.id,
          targetName: row.name,
          metadata: { from: source.name, to: targetParent },
        })
      }

      return toMatter(row)
    },

    async delete(id, orgId): Promise<Matter | null> {
      const existing = await getMatter(id, orgId)
      if (!existing) return null

      await db.delete(matters).where(and(eq(matters.id, id), eq(matters.orgId, orgId)))
      return existing
    },

    async cancelDraft(id, orgId, userId?): Promise<Matter | null> {
      const existing = await getMatter(id, orgId)
      if (!existing || existing.status !== 'draft') return null

      await db.delete(matters).where(and(eq(matters.id, id), eq(matters.orgId, orgId), eq(matters.status, 'draft')))

      if (userId) {
        await activity.record({
          orgId,
          userId,
          action: 'upload_cancel',
          targetType: 'file',
          targetId: existing.id,
          targetName: existing.name,
        })
      }

      return existing
    },

    async trash(orgId, id, userId?): Promise<Matter | null> {
      const existing = await getMatter(id, orgId)
      if (!existing) return null
      if (existing.status === 'trashed') return existing

      const now = new Date()
      const nowTs = now.getTime()
      const allIds = [existing.id]

      if (existing.dirtype !== DirType.FILE) {
        const path = buildPath(existing.parent, existing.name)
        const children = await getDirectChildren(orgId, path)
        const descendants = await getDescendants(orgId, path)
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
        await activity.record({
          orgId,
          userId,
          action: 'delete',
          targetType: existing.dirtype !== DirType.FILE ? 'folder' : 'file',
          targetId: existing.id,
          targetName: existing.name,
        })
      }

      return trashed
    },

    async restore(orgId, id, userId?, onConflict: ConflictStrategy = 'fail'): Promise<Matter | null> {
      const existing = await getMatter(id, orgId)
      if (!existing) return null
      if (existing.status !== 'trashed') return existing

      // A same-named active item may have been created in the original parent
      // while this one sat in trash. Resolve before touching descendants so a
      // rejection doesn't leave folders half-restored.
      const isFolder = existing.dirtype !== DirType.FILE
      const finalName = await applyConflictResolution(orgId, existing.parent, existing.name, onConflict, {
        excludeId: existing.id,
        isFolder,
        userId,
      })

      const now = new Date()
      const allIds = [existing.id]

      if (isFolder) {
        const path = buildPath(existing.parent, existing.name)
        const children = await getDirectChildren(orgId, path)
        const descendants = await getDescendants(orgId, path)
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
          await cascadeParentPath(orgId, oldPath, newPath)
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
        await activity.record({
          orgId,
          userId,
          action: 'restore',
          targetType: isFolder ? 'folder' : 'file',
          targetId: existing.id,
          targetName: finalName,
        })
      }

      return restored
    },

    collectForPurge,

    async purge(orgId, ids): Promise<void> {
      for (const id of ids) {
        await db.delete(matters).where(and(eq(matters.id, id), eq(matters.orgId, orgId)))
      }
    },

    async listActiveDescendants(orgId, parentPath): Promise<Matter[]> {
      const rows = await db
        .select()
        .from(matters)
        .where(
          and(
            eq(matters.orgId, orgId),
            eq(matters.status, ObjectStatus.ACTIVE),
            like(matters.parent, `${parentPath}/%`),
          ),
        )
      return rows.map(toMatter)
    },

    async trashByIds(orgId, ids): Promise<void> {
      if (ids.length === 0) return
      await db
        .update(matters)
        .set({ status: ObjectStatus.TRASHED, trashedAt: Date.now(), updatedAt: new Date() })
        .where(and(eq(matters.orgId, orgId), inArray(matters.id, ids)))
    },

    async restoreActiveByIds(orgId, ids): Promise<void> {
      if (ids.length === 0) return
      await db
        .update(matters)
        .set({ status: ObjectStatus.ACTIVE, trashedAt: null, updatedAt: new Date() })
        .where(and(eq(matters.orgId, orgId), inArray(matters.id, ids)))
    },

    async touch(orgId, id): Promise<void> {
      await db
        .update(matters)
        .set({ updatedAt: new Date() })
        .where(and(eq(matters.id, id), eq(matters.orgId, orgId)))
    },

    async applyUpload(orgId, id, fields): Promise<void> {
      await db
        .update(matters)
        .set({ type: fields.type, size: fields.size, object: fields.object, updatedAt: new Date() })
        .where(and(eq(matters.id, id), eq(matters.orgId, orgId)))
    },

    async listTrashedRoots(orgId): Promise<Matter[]> {
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
        .map(toMatter)
    },

    async listOrgIdsWithExpiredTrash(cutoff): Promise<string[]> {
      const rows = await db
        .selectDistinct({ orgId: matters.orgId })
        .from(matters)
        .where(and(eq(matters.status, 'trashed'), isNotNull(matters.trashedAt), lt(matters.trashedAt, cutoff)))
      return rows.map((r) => r.orgId)
    },

    findActiveConflict(orgId, parent, name, excludeId) {
      return findActiveConflict(orgId, parent, name, excludeId)
    },

    planConflictResolution(orgId, parent, name, strategy, options) {
      return planConflictResolution(orgId, parent, name, strategy, options)
    },

    commitConflictPlan(orgId, plan, userId) {
      return commitConflictPlan(orgId, plan, userId)
    },

    applyConflictResolution(orgId, parent, name, strategy, options) {
      return applyConflictResolution(orgId, parent, name, strategy, options)
    },

    async activateDraft(id, orgId, finalName, now): Promise<boolean> {
      const updated = await db
        .update(matters)
        .set({ name: finalName, status: 'active', updatedAt: now })
        .where(and(eq(matters.id, id), eq(matters.orgId, orgId), eq(matters.status, 'draft')))
        .returning({ id: matters.id })
      return updated.length > 0
    },
  }

  return repo
}
