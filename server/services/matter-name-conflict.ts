import { and, eq, ne, sql } from 'drizzle-orm'
import { DirType, ObjectStatus } from '../../shared/constants'
import { matters } from '../db/schema'
import type { Database } from '../platform/interface'
import { recordActivity } from './activity'

export type ConflictStrategy = 'fail' | 'rename' | 'replace'

export class NameConflictError extends Error {
  constructor(
    public readonly conflictingName: string,
    public readonly conflictingId: string,
  ) {
    super(`An item named '${conflictingName}' already exists in this location`)
    this.name = 'NameConflictError'
  }
}

type MatterRow = typeof matters.$inferSelect

/**
 * Finds the active sibling that would collide with `name` under `parent` in `orgId`.
 * Matching is case-insensitive (mirrors the DB's partial unique index on LOWER(name)).
 * `excludeId` lets rename/move skip the row being modified.
 */
export async function findActiveConflict(
  db: Database,
  orgId: string,
  parent: string,
  name: string,
  excludeId?: string,
): Promise<MatterRow | null> {
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
  return rows[0] ?? null
}

/**
 * Windows-style auto-rename: "report.pdf" → "report (1).pdf", then " (2)", ...
 * For folders or dot-prefixed names the suffix is appended to the whole name.
 */
function suggestRenamed(name: string, index: number): string {
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return `${name} (${index})`
  return `${name.slice(0, dot)} (${index})${name.slice(dot)}`
}

async function findAvailableName(
  db: Database,
  orgId: string,
  parent: string,
  name: string,
  excludeId: string | undefined,
): Promise<string> {
  for (let i = 1; i <= 999; i++) {
    const candidate = suggestRenamed(name, i)
    const conflict = await findActiveConflict(db, orgId, parent, candidate, excludeId)
    if (!conflict) return candidate
  }
  throw new Error('Too many name conflicts to auto-rename')
}

export interface ResolveOptions {
  /** Exclude a specific row from the conflict check (rename/move cases). */
  excludeId?: string
  /** Incoming item is a folder — replace is disabled for folders. */
  isFolder?: boolean
  /** Activity log will record a 'replace' event for this user when replace trashes a row. */
  userId?: string
}

/**
 * Planned resolution of a name conflict. Callers can inspect the plan, run their
 * own preconditions (quota, permissions), and commit it via `commitConflictPlan`.
 */
export interface ConflictPlan {
  finalName: string
  /** Row to trash when committing a 'replace' plan; null otherwise. */
  toTrash: MatterRow | null
}

/**
 * Build a resolution plan WITHOUT side effects. Safe to call and discard.
 *
 * Throws NameConflictError when strategy='fail' or when 'replace' is rejected
 * because the incoming or existing row is a folder (not supported in v1).
 */
export async function planConflictResolution(
  db: Database,
  orgId: string,
  parent: string,
  name: string,
  strategy: ConflictStrategy,
  options: ResolveOptions = {},
): Promise<ConflictPlan> {
  const existing = await findActiveConflict(db, orgId, parent, name, options.excludeId)
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

  const renamed = await findAvailableName(db, orgId, parent, name, options.excludeId)
  return { finalName: renamed, toTrash: null }
}

/** Execute the side effects of a plan (trash the replaced row, log activity). */
export async function commitConflictPlan(
  db: Database,
  orgId: string,
  plan: ConflictPlan,
  userId?: string,
): Promise<void> {
  if (plan.toTrash) {
    await trashForReplace(db, orgId, plan.toTrash, userId)
  }
}

/**
 * Convenience for the common case: plan + commit back-to-back. Callers that
 * need to interleave checks (e.g. quota) between plan and commit should use
 * `planConflictResolution` / `commitConflictPlan` directly — see confirmUpload.
 */
export async function applyConflictResolution(
  db: Database,
  orgId: string,
  parent: string,
  name: string,
  strategy: ConflictStrategy,
  options: ResolveOptions = {},
): Promise<string> {
  const plan = await planConflictResolution(db, orgId, parent, name, strategy, options)
  await commitConflictPlan(db, orgId, plan, options.userId)
  return plan.finalName
}

async function trashForReplace(
  db: Database,
  orgId: string,
  existing: MatterRow,
  userId: string | undefined,
): Promise<void> {
  const now = new Date()
  await db
    .update(matters)
    .set({ status: ObjectStatus.TRASHED, trashedAt: now.getTime(), updatedAt: now })
    .where(and(eq(matters.id, existing.id), eq(matters.orgId, orgId)))

  if (userId) {
    await recordActivity(db, {
      orgId,
      userId,
      action: 'replace',
      targetType: 'file',
      targetId: existing.id,
      targetName: existing.name,
    })
  }
}
