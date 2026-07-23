import type { ConflictStrategy } from '@shared/schemas'

export type { ConflictStrategy } from '@shared/schemas'

// ─── DTOs ──────────────────────────────────────────────────────────────────
// Plain record mirroring the `matters` table. Timestamps stay Date (the http
// layer serializes them). Drizzle row types never cross this port.

export interface Matter {
  id: string
  orgId: string
  alias: string
  name: string
  type: string
  size: number | null
  dirtype: number | null
  parent: string
  object: string
  storageId: string
  status: string
  trashedAt: number | null
  purgedAt: number | null
  createdAt: Date
  updatedAt: Date
}

export interface CreateMatterInput {
  orgId: string
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

// Live-object listing only (status='active' AND trashedAt IS NULL); the recycle
// bin is served separately by listTrashedRoots.
export interface MatterListFilters {
  parent?: string
  page: number
  pageSize: number
  typeFilter?: string
  search?: string
}

export interface MatterListResult {
  items: Matter[]
  total: number
  page: number
  pageSize: number
}

export interface UpdateMatterInput {
  name?: string
  parent?: string
  onConflict?: ConflictStrategy
}

export interface CopyMatterOptions {
  onConflict?: ConflictStrategy
}

export interface ConflictResolveOptions {
  /** Exclude a specific row from the conflict check (rename/move cases). */
  excludeId?: string
  /** Incoming item is a folder — replace is disabled for folders. */
  isFolder?: boolean
}

/**
 * Planned resolution of a name conflict. Callers can inspect the plan, run their
 * own preconditions (quota, permissions), and commit it via `commitConflictPlan`.
 */
export interface ConflictPlan {
  finalName: string
  /** Row to trash when committing a 'replace' plan; null otherwise. */
  toTrash: Matter | null
}

// Thrown by conflict resolution when strategy='fail' or when 'replace' is
// rejected (folder source/target). Caught by lib/http-errors.ts and mapped to
// a 409 with the conflicting name/id.
export class NameConflictError extends Error {
  constructor(
    public readonly conflictingName: string,
    public readonly conflictingId: string,
  ) {
    super(`An item named '${conflictingName}' already exists in this location`)
    this.name = 'NameConflictError'
  }
}

export interface MatterRepo {
  create(input: CreateMatterInput): Promise<Matter>
  list(orgId: string, filters: MatterListFilters): Promise<MatterListResult>
  get(id: string, orgId: string): Promise<Matter | null>
  getMany(orgId: string, ids: string[]): Promise<Matter[]>
  update(id: string, orgId: string, input: UpdateMatterInput): Promise<Matter | null>
  copy(source: Matter, targetParent: string, newObject: string, opts?: CopyMatterOptions): Promise<Matter>
  cancelDraft(id: string, orgId: string): Promise<Matter | null>
  trash(orgId: string, id: string): Promise<Matter | null>
  restore(orgId: string, id: string, onConflict?: ConflictStrategy): Promise<Matter | null>
  collectForPurge(orgId: string, idOrMatter: string): Promise<Matter[] | null>
  collectForPurge(orgId: string, idOrMatter: Matter): Promise<Matter[]>
  purge(orgId: string, ids: string[]): Promise<void>
  // Active descendants of a folder path (parent LIKE `${parentPath}/%`). Used by the
  // WebDAV recursive COPY/MOVE to enumerate a subtree.
  listActiveDescendants(orgId: string, parentPath: string): Promise<Matter[]>
  // Raw bulk status flips for WebDAV COPY rollback/overwrite (no conflict handling).
  trashByIds(orgId: string, ids: string[]): Promise<void>
  restoreActiveByIds(orgId: string, ids: string[]): Promise<void>
  // Bump updatedAt only (WebDAV PROPPATCH touches the matter's mtime).
  touch(orgId: string, id: string): Promise<void>
  // Overwrite a file matter's content fields after a WebDAV PUT to an existing path.
  applyUpload(orgId: string, id: string, fields: { type: string; size: number; object: string }): Promise<void>
  listTrashedRoots(orgId: string): Promise<Matter[]>
  /** Distinct orgIds holding at least one trashed matter older than the cutoff (epoch ms). */
  listOrgIdsWithExpiredTrash(cutoff: number): Promise<string[]>
  // Conflict-resolution primitives the confirmUpload usecase composes between
  // its quota reservation and the draft→active flip.
  findActiveConflict(orgId: string, parent: string, name: string, excludeId?: string): Promise<Matter | null>
  planConflictResolution(
    orgId: string,
    parent: string,
    name: string,
    strategy: ConflictStrategy,
    options?: ConflictResolveOptions,
  ): Promise<ConflictPlan>
  commitConflictPlan(orgId: string, plan: ConflictPlan): Promise<void>
  applyConflictResolution(
    orgId: string,
    parent: string,
    name: string,
    strategy: ConflictStrategy,
    options?: ConflictResolveOptions,
  ): Promise<string>
  /**
   * Flips a draft row to active under `finalName`, scoped to status='draft' as a
   * concurrent-confirm safety net. Returns false when no draft row matched (race).
   */
  activateDraft(id: string, orgId: string, finalName: string, type: string, now: Date): Promise<boolean>
}
