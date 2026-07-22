import { DirType, ObjectStatus } from '@shared/constants'
import type { SQL } from 'drizzle-orm'
import { and, asc, count, desc, eq, inArray, isNotNull, isNull, like, lt, ne, or, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { matters } from '../../db/schema'
import { type AtomicQuery, executeWriteTransaction, executeWriteTransactionWithResults } from '../../db/transaction'
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
import {
  matterActivationLedgerQuery,
  matterPurgeLedgerQuery,
  matterResizeLedgerQuery,
  storageUsageMutationQuery,
  storageUsageOpeningBalanceQuery,
} from './storage-usage-ledger'

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
  async function getMatter(id: string, orgId: string): Promise<Matter | null> {
    const rows = await db
      .select()
      .from(matters)
      .where(and(eq(matters.id, id), eq(matters.orgId, orgId), isNull(matters.purgedAt)))
    return rows[0] ? toMatter(rows[0]) : null
  }

  function getDescendants(orgId: string, folderPath: string): Promise<MatterRow[]> {
    return db
      .select()
      .from(matters)
      .where(and(eq(matters.orgId, orgId), isNull(matters.purgedAt), descendantParentCondition(folderPath)))
  }

  function getDirectChildren(orgId: string, folderPath: string): Promise<MatterRow[]> {
    return db
      .select()
      .from(matters)
      .where(and(eq(matters.orgId, orgId), eq(matters.parent, folderPath), isNull(matters.purgedAt)))
  }

  async function cascadeParentPath(orgId: string, oldPath: string, newPath: string): Promise<void> {
    // Direct children: parent = oldPath → parent = newPath
    await db
      .update(matters)
      .set({ parent: newPath, updatedAt: new Date() })
      .where(and(eq(matters.orgId, orgId), eq(matters.parent, oldPath), isNull(matters.purgedAt)))

    // Deeper descendants: parent starts with 'oldPath/' → replace prefix.
    await db
      .update(matters)
      .set({
        parent: sql`${newPath} || SUBSTR(${matters.parent}, LENGTH(${oldPath}) + 1)`,
        updatedAt: new Date(),
      })
      .where(and(eq(matters.orgId, orgId), isNull(matters.purgedAt), descendantParentCondition(oldPath)))
  }

  /**
   * Finds the live sibling that would collide with `name` under `parent`.
   * Matching is case-insensitive (mirrors the DB's partial unique index on
   * LOWER(name)). Trashed rows are also status='active', so `trashedAt IS NULL`
   * keeps the recycle bin from blocking names. `excludeId` lets rename/move skip
   * the row being modified.
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
      isNull(matters.trashedAt),
      isNull(matters.purgedAt),
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

  async function trashForReplace(orgId: string, existing: Matter): Promise<void> {
    const now = new Date()
    await db
      .update(matters)
      .set({ trashedAt: now.getTime(), updatedAt: now })
      .where(and(eq(matters.id, existing.id), eq(matters.orgId, orgId), isNull(matters.purgedAt)))
  }

  /** Execute the side effects of a plan (trash the replaced row). */
  async function commitConflictPlan(orgId: string, plan: ConflictPlan): Promise<void> {
    if (plan.toTrash) {
      await trashForReplace(orgId, plan.toTrash)
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
    await commitConflictPlan(orgId, plan)
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
      })
      // Overwriting the incumbent for a draft-file 'replace' is deferred to
      // confirmUpload (which purges it after the new bytes land). That keeps a
      // failed/abandoned upload from destroying the existing file, and lets the
      // replace be charged as a net-size change. Folders, active creates, and
      // rename commit their plan immediately.
      const deferOverwrite = !isFolder && input.status === 'draft' && plan.toTrash !== null
      if (!deferOverwrite) {
        await commitConflictPlan(input.orgId, plan)
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
        purgedAt: null,
        createdAt: now,
        updatedAt: now,
      }

      const isBillable = row.status === ObjectStatus.ACTIVE && row.dirtype === DirType.FILE
      if (isBillable) {
        const writes: AtomicQuery[] = [
          storageUsageOpeningBalanceQuery(db, row.orgId, row.storageId, now),
          db.insert(matters).values(row),
          ...(row.size && row.size > 0
            ? [
                storageUsageMutationQuery(db, {
                  eventKey: `matter:${row.id}:activated`,
                  orgId: row.orgId,
                  storageId: row.storageId,
                  resourceType: 'matter',
                  resourceId: row.id,
                  deltaBytes: row.size,
                  reason: 'matter_activated',
                  occurredAt: now,
                }),
              ]
            : []),
        ]
        await executeWriteTransaction(db, writes)
      } else {
        await db.insert(matters).values(row)
      }

      return toMatter(row)
    },

    async list(orgId: string, filters: MatterListFilters): Promise<MatterListResult> {
      const offset = (filters.page - 1) * filters.pageSize
      // Live objects only. Trashed rows are status='active' too, so exclude them
      // by trashedAt; the recycle bin is served by listTrashedRoots.
      const conditions = [
        eq(matters.orgId, orgId),
        eq(matters.status, ObjectStatus.ACTIVE),
        isNull(matters.trashedAt),
        isNull(matters.purgedAt),
      ]
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
        .where(and(eq(matters.orgId, orgId), inArray(matters.id, ids), isNull(matters.purgedAt)))
      return rows.map(toMatter)
    },

    async update(id, orgId, input: UpdateMatterInput): Promise<Matter | null> {
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
        .where(and(eq(matters.id, id), eq(matters.orgId, orgId), isNull(matters.purgedAt)))

      const updated = { ...existing, name: newName, parent: newParent, updatedAt: now }

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
        purgedAt: null,
        createdAt: now,
        updatedAt: now,
      }

      await executeWriteTransaction(db, [
        storageUsageOpeningBalanceQuery(db, row.orgId, row.storageId, now),
        db.insert(matters).values(row),
        ...(row.dirtype === DirType.FILE && row.size && row.size > 0
          ? [
              storageUsageMutationQuery(db, {
                eventKey: `matter:${row.id}:activated`,
                orgId: row.orgId,
                storageId: row.storageId,
                resourceType: 'matter',
                resourceId: row.id,
                deltaBytes: row.size,
                reason: 'matter_activated',
                occurredAt: now,
              }),
            ]
          : []),
      ])

      return toMatter(row)
    },

    async cancelDraft(id, orgId): Promise<Matter | null> {
      const existing = await getMatter(id, orgId)
      if (!existing || existing.status !== 'draft') return null

      const deleted = await db
        .delete(matters)
        .where(and(eq(matters.id, id), eq(matters.orgId, orgId), eq(matters.status, 'draft'), isNull(matters.purgedAt)))
        .returning({ id: matters.id })
      if (deleted.length !== 1) return null

      return existing
    },

    async trash(orgId, id): Promise<Matter | null> {
      const existing = await getMatter(id, orgId)
      if (!existing) return null
      if (existing.trashedAt != null) return existing // already in trash (idempotent)
      // Only live objects can be trashed; a draft is discarded via the upload session.
      if (existing.status !== ObjectStatus.ACTIVE) return null

      const now = new Date()
      const nowTs = now.getTime()
      const allIds = [existing.id]

      if (existing.dirtype !== DirType.FILE) {
        const path = buildPath(existing.parent, existing.name)
        const children = await getDirectChildren(orgId, path)
        const descendants = await getDescendants(orgId, path)
        allIds.push(...children.map((m) => m.id), ...descendants.map((m) => m.id))
      }

      // Soft delete: mark trashedAt, keep status='active'. Only mark live rows so a
      // child already trashed earlier keeps its own trashedAt (and restore later).
      for (const targetId of allIds) {
        await db
          .update(matters)
          .set({ trashedAt: nowTs, updatedAt: now })
          .where(
            and(
              eq(matters.id, targetId),
              eq(matters.orgId, orgId),
              eq(matters.status, ObjectStatus.ACTIVE),
              isNull(matters.trashedAt),
              isNull(matters.purgedAt),
            ),
          )
      }
      const trashed = { ...existing, trashedAt: nowTs, updatedAt: now }

      return trashed
    },

    async restore(orgId, id, onConflict: ConflictStrategy = 'fail'): Promise<Matter | null> {
      const existing = await getMatter(id, orgId)
      if (!existing) return null
      if (existing.trashedAt == null) return existing // not in trash → no-op

      // A same-named active item may have been created in the original parent
      // while this one sat in trash. Resolve before touching descendants so a
      // rejection doesn't leave folders half-restored.
      const isFolder = existing.dirtype !== DirType.FILE
      const finalName = await applyConflictResolution(orgId, existing.parent, existing.name, onConflict, {
        excludeId: existing.id,
        isFolder,
      })

      const now = new Date()
      const allIds = [existing.id]

      if (isFolder) {
        const path = buildPath(existing.parent, existing.name)
        const children = await getDirectChildren(orgId, path)
        const descendants = await getDescendants(orgId, path)
        allIds.push(...children.map((m) => m.id), ...descendants.map((m) => m.id))
      }

      // Rename + cascade parent paths BEFORE clearing trashedAt. While everything
      // is still in trash, these writes cannot violate the live-name unique index
      // (which excludes trashedAt IS NOT NULL), and no reader sees descendants with
      // stale paths in a live state.
      if (finalName !== existing.name) {
        await db
          .update(matters)
          .set({ name: finalName, updatedAt: now })
          .where(and(eq(matters.id, existing.id), eq(matters.orgId, orgId), isNull(matters.purgedAt)))
        if (isFolder) {
          const oldPath = buildPath(existing.parent, existing.name)
          const newPath = buildPath(existing.parent, finalName)
          await cascadeParentPath(orgId, oldPath, newPath)
        }
      }

      // Clear the trash mark on the whole subtree (status is already 'active').
      for (const targetId of allIds) {
        await db
          .update(matters)
          .set({ trashedAt: null, updatedAt: now })
          .where(
            and(
              eq(matters.id, targetId),
              eq(matters.orgId, orgId),
              isNotNull(matters.trashedAt),
              isNull(matters.purgedAt),
            ),
          )
      }

      const restored = { ...existing, name: finalName, trashedAt: null, updatedAt: now }

      return restored
    },

    collectForPurge,

    async purge(orgId, ids): Promise<void> {
      if (ids.length === 0) return
      const rows = await db
        .select()
        .from(matters)
        .where(and(eq(matters.orgId, orgId), inArray(matters.id, ids), isNull(matters.purgedAt)))
      if (rows.length === 0) return

      const now = new Date()
      const storageIds = new Set(
        rows
          .filter((row) => row.dirtype === DirType.FILE && row.status === ObjectStatus.ACTIVE)
          .map((row) => row.storageId),
      )
      await executeWriteTransaction(db, [
        ...[...storageIds].map((storageId) => storageUsageOpeningBalanceQuery(db, orgId, storageId, now)),
        ...rows.map((row) => matterPurgeLedgerQuery(db, orgId, row.id, now)),
        db
          .update(matters)
          .set({
            trashedAt: sql`COALESCE(${matters.trashedAt}, ${now.getTime()})`,
            purgedAt: now.getTime(),
            updatedAt: now,
          })
          .where(
            and(
              eq(matters.orgId, orgId),
              inArray(
                matters.id,
                rows.map((row) => row.id),
              ),
              isNull(matters.purgedAt),
            ),
          ),
      ])
    },

    async listActiveDescendants(orgId, parentPath): Promise<Matter[]> {
      // Exact-prefix match (SUBSTR), not LIKE — folder names can contain `_`/`%`,
      // which LIKE would treat as wildcards and over-match. Matches the rest of this repo.
      const rows = await db
        .select()
        .from(matters)
        .where(
          and(
            eq(matters.orgId, orgId),
            eq(matters.status, ObjectStatus.ACTIVE),
            isNull(matters.trashedAt),
            isNull(matters.purgedAt),
            descendantParentCondition(parentPath),
          ),
        )
      return rows.map(toMatter)
    },

    async trashByIds(orgId, ids): Promise<void> {
      if (ids.length === 0) return
      await db
        .update(matters)
        .set({ trashedAt: Date.now(), updatedAt: new Date() })
        .where(and(eq(matters.orgId, orgId), inArray(matters.id, ids), isNull(matters.purgedAt)))
    },

    async restoreActiveByIds(orgId, ids): Promise<void> {
      if (ids.length === 0) return
      await db
        .update(matters)
        .set({ trashedAt: null, updatedAt: new Date() })
        .where(and(eq(matters.orgId, orgId), inArray(matters.id, ids), isNull(matters.purgedAt)))
    },

    async touch(orgId, id): Promise<void> {
      await db
        .update(matters)
        .set({ updatedAt: new Date() })
        .where(and(eq(matters.id, id), eq(matters.orgId, orgId), isNull(matters.purgedAt)))
    },

    async applyUpload(orgId, id, fields): Promise<void> {
      const existing = await getMatter(id, orgId)
      if (!existing) return
      const now = new Date()
      const writes: AtomicQuery[] = [
        storageUsageOpeningBalanceQuery(db, orgId, existing.storageId, now),
        matterResizeLedgerQuery(db, orgId, id, fields.size, now),
        db
          .update(matters)
          .set({ type: fields.type, size: fields.size, object: fields.object, updatedAt: now })
          .where(and(eq(matters.id, id), eq(matters.orgId, orgId), isNull(matters.purgedAt))),
      ]
      await executeWriteTransaction(db, writes)
    },

    async listTrashedRoots(orgId): Promise<Matter[]> {
      const all = await db
        .select()
        .from(matters)
        .where(
          and(
            eq(matters.orgId, orgId),
            eq(matters.status, ObjectStatus.ACTIVE),
            isNotNull(matters.trashedAt),
            isNull(matters.purgedAt),
          ),
        )

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
        .where(and(isNotNull(matters.trashedAt), isNull(matters.purgedAt), lt(matters.trashedAt, cutoff)))
      return rows.map((r) => r.orgId)
    },

    findActiveConflict(orgId, parent, name, excludeId) {
      return findActiveConflict(orgId, parent, name, excludeId)
    },

    planConflictResolution(orgId, parent, name, strategy, options) {
      return planConflictResolution(orgId, parent, name, strategy, options)
    },

    commitConflictPlan(orgId, plan) {
      return commitConflictPlan(orgId, plan)
    },

    applyConflictResolution(orgId, parent, name, strategy, options) {
      return applyConflictResolution(orgId, parent, name, strategy, options)
    },

    async activateDraft(id, orgId, finalName, now): Promise<boolean> {
      const existing = await getMatter(id, orgId)
      if (!existing || existing.status !== 'draft') return false
      await executeWriteTransaction(db, [storageUsageOpeningBalanceQuery(db, orgId, existing.storageId, now)])
      const activateQuery = db
        .update(matters)
        .set({ name: finalName, status: 'active', updatedAt: now })
        .where(and(eq(matters.id, id), eq(matters.orgId, orgId), eq(matters.status, 'draft'), isNull(matters.purgedAt)))
        .returning({ id: matters.id })
      const writes: AtomicQuery[] = [activateQuery, matterActivationLedgerQuery(db, orgId, id, now)]
      const results = await executeWriteTransactionWithResults(db, writes, [0])
      const updated = results[0] as { id: string }[]
      return updated.length > 0
    },
  }

  return repo
}
