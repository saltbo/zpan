// The objects resource usecase. Owns every business decision behind the
// /api/objects routes — upload sessions, listing, detail/download, rename/move,
// trash/restore, permanent purge, copy, and cross-space transfer — so the http
// handlers only parse the request, call these functions, and serialize the
// result.
//
// All port access lives here: the handler never reaches into `deps.<port>`.
// Expected failures the handler maps to a status code are returned as
// discriminated-union outcomes; the multipart upload-session validation keeps
// throwing ObjectUploadSessionError because the handler already maps its code to
// 404 / 409 / 502.

import { DirType } from '@shared/constants'
import { attachmentContentDisposition } from '@shared/content-disposition'
import type {
  ConflictStrategy,
  CreateMatterInput,
  PatchMatterInput,
  PatchObjectUploadSessionInput,
  PresignObjectUploadPartsInput,
  TransferMatterInput,
} from '@shared/schemas'
import type { ObjectUploadSession } from '@shared/types'
import { buildObjectKey, fileExt } from '../lib/path-template'
import type { Deps } from './deps'
import { assertTaskUploadAllowed } from './downloads/downloads'
import {
  type ActivityRepo,
  type Matter,
  type MatterListFilters,
  type MatterRepo,
  ObjectUploadSessionError,
  type ObjectUploadSessionRecord,
  type ObjectUploadSessionRepo,
  type QuotaRepo,
  type S3Gateway,
  type ShareRepo,
  type StorageRecord,
  type StorageRepo,
  type StorageUsageRepo,
} from './ports'
import { StorageQuotaExceededError, withStorageUsageReservation } from './storage-usage'
import { meterDownloadTraffic } from './store/traffic-metering'

export { ObjectUploadSessionError } from './ports'

// The copy request shape (mirrors copyMatterSchema; no shared type is exported).
export interface CopyObjectInput {
  copyFrom: string
  parent: string
  onConflict?: ConflictStrategy
}

// The caller identity, derived from the request principal. A download-task
// upload token acts on behalf of the task creator but is logged as the
// downloader and is constrained to its authorized target folder.
export type ObjectActor =
  | { kind: 'user'; userId: string }
  | {
      kind: 'download-task-upload'
      downloaderId: string
      taskId: string
      targetFolder: string
      createdByUserId: string
    }

// The user id used to build object keys (whose owner is the task creator for
// agent uploads).
function ownerUserId(actor: ObjectActor): string {
  return actor.kind === 'download-task-upload' ? actor.createdByUserId : actor.userId
}

// The id recorded in the matter/activity log.
function actorLogId(actor: ObjectActor): string {
  return actor.kind === 'download-task-upload' ? `downloader:${actor.downloaderId}` : actor.userId
}

const ROLE_LEVELS: Record<string, number> = { owner: 3, editor: 2, viewer: 1, member: 1 }

// Whether the user may write (editor+) in the org. Personal orgs grant full
// access to their owner even without a member row.
export async function hasEditorAccess(
  deps: Pick<Deps, 'org'>,
  params: { orgId: string | null; userId: string | null },
): Promise<boolean> {
  const { orgId, userId } = params
  if (!orgId || !userId) return false
  const role = await deps.org.getMemberRole(orgId, userId)
  if (role !== null) return (ROLE_LEVELS[role] ?? 0) >= ROLE_LEVELS.editor
  return deps.org.isPersonalOrg(orgId)
}

function normalizeMatterPath(path: string): string {
  return path
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean)
    .join('/')
}

function isWithinDownloadTarget(parent: string, targetFolder: string): boolean {
  const normalizedParent = normalizeMatterPath(parent)
  const normalizedTarget = normalizeMatterPath(targetFolder)
  if (!normalizedTarget) return true
  return normalizedParent === normalizedTarget || normalizedParent.startsWith(`${normalizedTarget}/`)
}

// ─── List ────────────────────────────────────────────────────────────────────

export type ListObjectsOutcome =
  | { ok: true; result: Awaited<ReturnType<Deps['matter']['list']>> }
  | { ok: false; reason: 'forbidden' }

export async function listObjects(
  deps: Pick<Deps, 'matter' | 'org'>,
  params: {
    orgId: string
    userId: string
    orgOverride?: string
    filters: MatterListFilters
  },
): Promise<ListObjectsOutcome> {
  let orgId = params.orgId
  // Optional org override so pickers (e.g. cross-space transfer) can browse
  // folders of another space the user has access to.
  if (params.orgOverride && params.orgOverride !== orgId) {
    if (!(await deps.org.canReadOrg(params.userId, params.orgOverride))) {
      return { ok: false, reason: 'forbidden' }
    }
    orgId = params.orgOverride
  }
  const result = await deps.matter.list(orgId, params.filters)
  return { ok: true, result }
}

// ─── Create (folder or file draft + presigned upload) ─────────────────────────

export type CreateObjectOutcome =
  | { ok: true; matter: Matter }
  | { ok: true; matter: Matter; uploadUrl: string; contentDisposition: string }
  | { ok: false; reason: 'target_outside_authorization' }
  | { ok: false; reason: 'no_storage' }

export async function createObject(
  deps: Pick<Deps, 'matter' | 'storages' | 's3' | 'downloaders' | 'downloadTasks'>,
  params: { orgId: string; actor: ObjectActor; input: CreateMatterInput },
): Promise<CreateObjectOutcome> {
  const { orgId, actor, input } = params
  const { name, type, size, parent, dirtype, onConflict } = input
  const isFolder = dirtype !== DirType.FILE

  if (actor.kind === 'download-task-upload') {
    if (!isWithinDownloadTarget(parent, actor.targetFolder)) {
      return { ok: false, reason: 'target_outside_authorization' }
    }
    await assertTaskUploadAllowed(deps as Deps, { taskId: actor.taskId, downloaderId: actor.downloaderId })
  }

  let storage: StorageRecord
  try {
    storage = await deps.storages.select('private')
  } catch (error) {
    if (error instanceof Error && error.message === 'No available storage') {
      return { ok: false, reason: 'no_storage' }
    }
    throw error
  }

  const objectKey = isFolder ? '' : buildObjectKey({ uid: ownerUserId(actor), orgId, rawExt: fileExt(name) })

  const matter = await deps.matter.create({
    orgId,
    name,
    type: isFolder ? 'folder' : type,
    size: isFolder ? 0 : size,
    dirtype,
    parent,
    object: objectKey,
    storageId: storage.id,
    status: isFolder ? 'active' : 'draft',
    onConflict,
    userId: actorLogId(actor),
  })

  if (isFolder) return { ok: true, matter }
  const contentDisposition = attachmentContentDisposition(name)
  const uploadUrl = await deps.s3.presignUpload(storage, objectKey, type, name)
  return { ok: true, matter, uploadUrl, contentDisposition }
}

// ─── Multipart upload sessions ────────────────────────────────────────────────
// These throw ObjectUploadSessionError (not_found / invalid_state /
// storage_failure); the handler maps the code to 404 / 409 / 502.

async function loadDraftForUploadSession(
  deps: Pick<Deps, 'matter' | 'storages'>,
  orgId: string,
  objectId: string,
): Promise<{ matter: Matter; storage: StorageRecord }> {
  const matter = await deps.matter.get(objectId, orgId)
  if (!matter || matter.status !== 'draft' || matter.dirtype !== DirType.FILE || !matter.object) {
    throw new ObjectUploadSessionError('not_found')
  }
  const storage = await deps.storages.get(matter.storageId)
  if (!storage) throw new ObjectUploadSessionError('not_found')
  return { matter, storage }
}

async function loadObjectForUploadSession(
  deps: Pick<Deps, 'matter' | 'storages'>,
  orgId: string,
  objectId: string,
): Promise<{ matter: Matter; storage: StorageRecord }> {
  const matter = await deps.matter.get(objectId, orgId)
  if (!matter) throw new ObjectUploadSessionError('not_found')
  const storage = await deps.storages.get(matter.storageId)
  if (!storage) throw new ObjectUploadSessionError('not_found')
  return { matter, storage }
}

export async function createUploadSession(
  deps: Pick<Deps, 'matter' | 'storages' | 's3' | 'objectUploadSessions' | 'downloaders' | 'downloadTasks'>,
  params: { orgId: string; objectId: string; actor: ObjectActor; partSize?: number },
): Promise<ObjectUploadSession> {
  const { matter, storage } = await loadDraftForUploadSession(deps, params.orgId, params.objectId)
  if (params.actor.kind === 'download-task-upload') {
    if (!isWithinDownloadTarget(matter.parent, params.actor.targetFolder)) {
      throw new ObjectUploadSessionError('invalid_state')
    }
    await assertTaskUploadAllowed(deps as Deps, {
      taskId: params.actor.taskId,
      downloaderId: params.actor.downloaderId,
    })
  }
  return createObjectUploadSession(deps, {
    orgId: params.orgId,
    objectId: matter.id,
    storage,
    storageKey: matter.object,
    contentType: matter.type,
    partSize: params.partSize,
    actorId: actorLogId(params.actor),
  })
}

export async function presignUploadSessionParts(
  deps: Pick<Deps, 'matter' | 'storages' | 's3' | 'objectUploadSessions'>,
  params: {
    orgId: string
    objectId: string
    sessionId: string
    partNumbers: PresignObjectUploadPartsInput['partNumbers']
  },
): Promise<Awaited<ReturnType<typeof presignObjectUploadParts>>> {
  const { matter, storage } = await loadObjectForUploadSession(deps, params.orgId, params.objectId)
  return presignObjectUploadParts(deps, {
    orgId: params.orgId,
    objectId: matter.id,
    sessionId: params.sessionId,
    storage,
    partNumbers: params.partNumbers,
  })
}

export async function patchUploadSession(
  deps: Pick<Deps, 'matter' | 'storages' | 's3' | 'objectUploadSessions'>,
  params: { orgId: string; objectId: string; sessionId: string; input: PatchObjectUploadSessionInput },
): Promise<ObjectUploadSession> {
  const { matter, storage } = await loadObjectForUploadSession(deps, params.orgId, params.objectId)
  return patchObjectUploadSession(deps, {
    orgId: params.orgId,
    objectId: matter.id,
    sessionId: params.sessionId,
    storage,
    input: params.input,
  })
}

// ─── Detail / download ────────────────────────────────────────────────────────

export type GetObjectOutcome =
  | { ok: true; matter: Matter }
  | { ok: true; matter: Matter; downloadUrl: string }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'storage_not_found' }
  | { ok: false; reason: 'quota_exceeded' }
  | { ok: false; reason: 'insufficient_credits' }

// Loads an object; for files it meters egress (consume traffic quota → report to
// Cloud, refunding on a block) before presigning the download URL, refunding the
// quota if signing fails. The handler renders the JSON / 404 / 422 / 402
// responses; the metering decision and rollback live here.
export async function getObject(
  deps: Pick<
    Deps,
    'matter' | 'storages' | 's3' | 'quota' | 'licenseBinding' | 'licensingCloud' | 'cloudTrafficReports'
  >,
  params: { orgId: string; objectId: string; cloudBaseUrl: string },
): Promise<GetObjectOutcome> {
  const matter = await deps.matter.get(params.objectId, params.orgId)
  if (!matter) return { ok: false, reason: 'not_found' }
  if (matter.dirtype !== DirType.FILE || !matter.object) return { ok: true, matter }

  const storage = await deps.storages.get(matter.storageId)
  if (!storage) return { ok: false, reason: 'storage_not_found' }

  const bytes = matter.size ?? 0
  const metered = await meterDownloadTraffic(deps, {
    cloudBaseUrl: params.cloudBaseUrl,
    orgId: params.orgId,
    bytes,
    storage,
    source: 'object_download',
    sourceId: matter.id,
  })
  if (!metered.ok) return { ok: false, reason: metered.reason }

  let downloadUrl: string
  try {
    downloadUrl = await deps.s3.presignDownload(storage, matter.object, matter.name)
  } catch (error) {
    await deps.quota.refundTraffic(params.orgId, bytes)
    throw error
  }
  return { ok: true, matter, downloadUrl }
}

// ─── Update / confirm / cancel / trash / restore ──────────────────────────────

export type UpdateObjectOutcome = { ok: true; matter: Matter } | { ok: false; reason: 'not_found' }

export async function updateObject(
  deps: Pick<Deps, 'matter'>,
  params: { orgId: string; objectId: string; actorId: string; input: PatchMatterInput },
): Promise<UpdateObjectOutcome> {
  const { name, parent, onConflict } = params.input
  const matter = await deps.matter.update(params.objectId, params.orgId, { name, parent, onConflict }, params.actorId)
  return matter ? { ok: true, matter } : { ok: false, reason: 'not_found' }
}

export type ConfirmObjectOutcome =
  | { ok: true; matter: Matter }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'quota_exceeded' }

export async function confirmObject(
  deps: Pick<Deps, 'matter' | 'quota' | 'storageUsage' | 'activity' | 's3' | 'storages' | 'share'>,
  params: { orgId: string; objectId: string; actorId: string; onConflict?: ConflictStrategy },
): Promise<ConfirmObjectOutcome> {
  const { matter, quotaExceeded } = await confirmUpload(deps, params.objectId, params.orgId, {
    onConflict: params.onConflict,
    userId: params.actorId,
    purgeReplaced: (incumbent) => purgeRecursively(deps, params.orgId, [incumbent]).then(() => undefined),
  })
  if (quotaExceeded) return { ok: false, reason: 'quota_exceeded' }
  if (!matter) return { ok: false, reason: 'not_found' }
  return { ok: true, matter }
}

export type CancelObjectOutcome = { ok: true; id: string } | { ok: false; reason: 'not_found' }

export async function cancelObject(
  deps: Pick<Deps, 'matter' | 'storages' | 's3'>,
  params: { orgId: string; objectId: string; actorId: string },
): Promise<CancelObjectOutcome> {
  const matter = await deps.matter.cancelDraft(params.objectId, params.orgId, params.actorId)
  if (!matter) return { ok: false, reason: 'not_found' }
  if (matter.object) {
    const storage = await deps.storages.get(matter.storageId)
    if (storage) {
      try {
        await deps.s3.deleteObject(storage, matter.object)
      } catch {
        // Best-effort cleanup: the browser may abort before S3 writes anything.
      }
    }
  }
  return { ok: true, id: matter.id }
}

export type TrashObjectOutcome = { ok: true; matter: Matter } | { ok: false; reason: 'not_found' }

export async function trashObject(
  deps: Pick<Deps, 'matter'>,
  params: { orgId: string; objectId: string; actorId: string },
): Promise<TrashObjectOutcome> {
  const matter = await deps.matter.trash(params.orgId, params.objectId, params.actorId)
  return matter ? { ok: true, matter } : { ok: false, reason: 'not_found' }
}

export type RestoreObjectOutcome = { ok: true; matter: Matter } | { ok: false; reason: 'not_found' }

export async function restoreObject(
  deps: Pick<Deps, 'matter'>,
  params: { orgId: string; objectId: string; actorId: string; onConflict?: ConflictStrategy },
): Promise<RestoreObjectOutcome> {
  const matter = await deps.matter.restore(params.orgId, params.objectId, params.actorId, params.onConflict ?? 'fail')
  return matter ? { ok: true, matter } : { ok: false, reason: 'not_found' }
}

// Authorizes a download-task-upload token to confirm a specific object: it may
// only confirm its draft (PUT /status {active}) and only within its target folder.
export type ConfirmAuthorizationOutcome = { ok: true } | { ok: false; reason: 'forbidden' }

export async function authorizeTaskUploadConfirm(
  deps: Pick<Deps, 'matter' | 'downloaders' | 'downloadTasks'>,
  params: {
    orgId: string
    objectId: string
    taskId: string
    downloaderId: string
    targetFolder: string
  },
): Promise<ConfirmAuthorizationOutcome> {
  const matter = await deps.matter.get(params.objectId, params.orgId)
  if (!matter || !isWithinDownloadTarget(matter.parent, params.targetFolder)) {
    return { ok: false, reason: 'forbidden' }
  }
  await assertTaskUploadAllowed(deps as Deps, { taskId: params.taskId, downloaderId: params.downloaderId })
  return { ok: true }
}

// ─── Permanent delete (purge) ─────────────────────────────────────────────────

export type DeleteObjectOutcome =
  | { ok: true; id: string; purged: number }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'not_trashed' }

export async function deleteObject(
  deps: Pick<Deps, 'matter' | 'storages' | 's3' | 'storageUsage' | 'share' | 'activity'>,
  params: { orgId: string; objectId: string; userId: string },
): Promise<DeleteObjectOutcome> {
  const ms = await deps.matter.collectForPurge(params.orgId, params.objectId)
  if (!ms) return { ok: false, reason: 'not_found' }
  if (ms[0].status !== 'trashed') return { ok: false, reason: 'not_trashed' }
  const purged = await purgeRecursively(deps, params.orgId, ms)
  await deps.activity.record({
    orgId: params.orgId,
    userId: params.userId,
    action: 'object_purge',
    targetType: ms[0].dirtype !== DirType.FILE ? 'folder' : 'file',
    targetId: ms[0].id,
    targetName: ms[0].name,
    metadata: { count: purged },
  })
  return { ok: true, id: ms[0].id, purged }
}

// ─── Copy (same org, quota-reserved) ──────────────────────────────────────────

export type CopyObjectOutcome = { ok: true; matter: Matter } | { ok: false; reason: 'not_found' | 'storage_not_found' }

export async function copyObject(
  deps: Pick<Deps, 'matter' | 'storages' | 's3' | 'quota' | 'storageUsage'>,
  params: { orgId: string; userId: string; input: CopyObjectInput },
): Promise<CopyObjectOutcome> {
  const { orgId, userId, input } = params
  const { copyFrom, parent, onConflict } = input
  const source = await deps.matter.get(copyFrom, orgId)
  if (!source) return { ok: false, reason: 'not_found' }

  const sourceSize = source.size ?? 0
  const storage = source.object ? await deps.storages.get(source.storageId) : null
  if (source.object && !storage) return { ok: false, reason: 'storage_not_found' }

  const copy = await withStorageUsageReservation(
    deps,
    { orgId, storageId: source.storageId, bytes: sourceSize },
    async (ctx) => {
      let newObject = ''
      if (source.object) {
        // storage is non-null here: a missing storage for an object-backed source
        // returns storage_not_found above.
        const objectStorage = storage as StorageRecord
        newObject = buildObjectKey({ uid: userId, orgId, rawExt: fileExt(source.name) })
        await deps.s3.copyObject(objectStorage, source.object, objectStorage, newObject)
        ctx.onRollback(() => deps.s3.deleteObject(objectStorage, newObject))
      }
      return deps.matter.copy(source, parent, newObject, { onConflict, userId })
    },
  )
  return { ok: true, matter: copy }
}

// ─── Cross-space transfer (copy / move into another org) ──────────────────────

export type TransferObjectResult = Awaited<ReturnType<typeof copyMatterToOrg>> & { sourceDeleted: boolean }

export type TransferObjectOutcome =
  | { ok: true; result: TransferObjectResult }
  | { ok: false; reason: 'same_org' }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'forbidden' }
  | { ok: false; reason: 'quota_exceeded' }

export async function transferObject(
  deps: Pick<Deps, 'matter' | 'storages' | 's3' | 'quota' | 'storageUsage' | 'share' | 'org' | 'activity'>,
  params: { orgId: string; userId: string; objectId: string; input: TransferMatterInput },
): Promise<TransferObjectOutcome> {
  const { orgId, userId, objectId, input } = params
  const { targetOrgId, targetParent, mode } = input
  if (targetOrgId === orgId) return { ok: false, reason: 'same_org' }

  const source = await deps.matter.get(objectId, orgId)
  if (!source || source.status !== 'active') return { ok: false, reason: 'not_found' }

  // Copying out only needs read access on the source space (granted by the route
  // middleware); moving also trashes the source, which needs editor.
  if (mode === 'move' && !(await hasEditorAccess(deps, { orgId, userId }))) {
    return { ok: false, reason: 'forbidden' }
  }
  if (!(await deps.org.canWriteToOrg(userId, targetOrgId))) {
    return { ok: false, reason: 'forbidden' }
  }

  const totalBytes = await deps.share.computeSourceBytes(source)
  if (!(await deps.share.hasQuotaForBytes(targetOrgId, totalBytes))) {
    return { ok: false, reason: 'quota_exceeded' }
  }

  const result = await copyMatterToOrg(deps, {
    sourceMatter: source,
    currentUserId: userId,
    targetOrgId,
    targetParent,
    activity: {
      action: mode === 'move' ? 'moved_from_org' : 'copied_from_org',
      metadata: { sourceOrgId: orgId, sourceMatterId: source.id },
    },
  })

  // Move = copy + delete source. Only delete when every file copied — a partial
  // copy must never destroy the originals. The source is purged (not trashed) so
  // its quota is actually released: trashed files still count toward usage, which
  // would otherwise double-charge the moved bytes in both spaces. The independent
  // copy already lives in the target space.
  let sourceDeleted = false
  if (mode === 'move' && result.skipped.length === 0) {
    const subtree = await deps.matter.collectForPurge(orgId, source)
    await purgeRecursively(deps, orgId, subtree)
    sourceDeleted = true
    await deps.activity.record({
      orgId,
      userId,
      action: 'moved_to_org',
      targetType: source.dirtype === DirType.FILE ? 'file' : 'folder',
      targetId: source.id,
      targetName: source.name,
      metadata: { targetOrgId },
    })
  }

  return { ok: true, result: { ...result, sourceDeleted } }
}

// ── upload confirmation (draft → active) ─────────────────────────────────────

// Quota-guarded draft→active confirmation. Composes the matter repo (conflict
// plan + draft activation) with the storage-usage reservation usecase, reaching
// the DB only through deps. Behavior preserved from the former matter service.
export type ConfirmUploadDeps = {
  matter: MatterRepo
  quota: QuotaRepo
  storageUsage: StorageUsageRepo
  activity: ActivityRepo
}

export interface ConfirmUploadOptions {
  onConflict?: ConflictStrategy
  userId?: string
  teamQuotaEnabled?: boolean
  /**
   * Overwrites the file being replaced: hard-purge it (delete row, S3 object,
   * shares). With it, a 'replace' frees the incumbent's quota so the upload is
   * charged as a net-size change — matching normal overwrite semantics. Without
   * it, replace falls back to trashing the incumbent.
   */
  purgeReplaced?: (incumbent: Matter) => Promise<void>
}

export async function confirmUpload(
  deps: ConfirmUploadDeps,
  id: string,
  orgId: string,
  opts: ConfirmUploadOptions = {},
): Promise<{ matter: Matter | null; quotaExceeded?: boolean }> {
  try {
    const existing = await deps.matter.get(id, orgId)
    if (!existing) return { matter: null }
    if (existing.status !== 'draft') return { matter: null }

    // Plan the overwrite now (side-effect-free). createMatter deferred it for
    // draft 'replace', so the incumbent is still active and the quota check
    // below accounts for its bytes being freed. The DB's partial unique index
    // fires on the status update as a final safety net against concurrent confirms.
    const plan = await deps.matter.planConflictResolution(
      orgId,
      existing.parent,
      existing.name,
      opts.onConflict ?? 'fail',
      { excludeId: existing.id, isFolder: false, userId: opts.userId },
    )

    const bytes = existing.size ?? 0
    // Purging the incumbent frees its bytes, so only the net size increase needs
    // headroom; a final reconcile then sets usage to the exact active+trashed sum.
    const overwrites = plan.toTrash != null && opts.purgeReplaced != null
    const reserveBytes = overwrites ? Math.max(0, bytes - (plan.toTrash?.size ?? 0)) : bytes

    return await withStorageUsageReservation(
      { quota: deps.quota, storageUsage: deps.storageUsage },
      { orgId, storageId: existing.storageId, bytes: reserveBytes, teamQuotaEnabled: opts.teamQuotaEnabled ?? true },
      async () => {
        // Quota reserved — now safe to execute the overwrite (if any).
        if (plan.toTrash && opts.purgeReplaced) {
          await opts.purgeReplaced(plan.toTrash)
          if (opts.userId) {
            await deps.activity.record({
              orgId,
              userId: opts.userId,
              action: 'replace',
              targetType: 'file',
              targetId: plan.toTrash.id,
              targetName: plan.toTrash.name,
            })
          }
        } else {
          await deps.matter.commitConflictPlan(orgId, plan, opts.userId)
        }

        const now = new Date()
        const activated = await deps.matter.activateDraft(id, orgId, plan.finalName, now)
        if (!activated) {
          throw new Error('CONFIRM_UPLOAD_RACE')
        }

        // The purge reconciled usage before this row became active; recompute
        // once more so the new file's bytes are reflected.
        if (overwrites) await deps.storageUsage.reconcile(orgId, [existing.storageId])

        const confirmed = { ...existing, name: plan.finalName, status: 'active', updatedAt: now }

        if (opts.userId) {
          await deps.activity.record({
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

// ── upload sessions ──────────────────────────────────────────────────────────

export type ObjectUploadSessionDeps = { s3: S3Gateway; objectUploadSessions: ObjectUploadSessionRepo }

const DEFAULT_PART_SIZE = 16 * 1024 * 1024

function toDto(record: ObjectUploadSessionRecord): ObjectUploadSession {
  return {
    id: record.id,
    objectId: record.objectId,
    uploadId: record.uploadId,
    partSize: record.partSize,
    status: record.status,
    expiresAt: record.expiresAt.toISOString(),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  }
}

export async function createObjectUploadSession(
  deps: ObjectUploadSessionDeps,
  params: {
    orgId: string
    objectId: string
    storage: StorageRecord
    storageKey: string
    contentType: string
    partSize?: number
    actorId: string
  },
): Promise<ObjectUploadSession> {
  let uploadId: string
  try {
    uploadId = await deps.s3.createMultipartUpload(params.storage, params.storageKey, params.contentType)
  } catch (error) {
    throw new ObjectUploadSessionError(
      'storage_failure',
      `Storage multipart upload failed: ${(error as Error).message}`,
    )
  }
  const record = await deps.objectUploadSessions.create({
    orgId: params.orgId,
    objectId: params.objectId,
    storageId: params.storage.id,
    storageKey: params.storageKey,
    uploadId,
    partSize: params.partSize ?? DEFAULT_PART_SIZE,
    actorId: params.actorId,
  })
  return toDto(record)
}

export async function getObjectUploadSession(
  deps: ObjectUploadSessionDeps,
  orgId: string,
  objectId: string,
  id: string,
): Promise<ObjectUploadSession> {
  const record = await deps.objectUploadSessions.get(orgId, objectId, id)
  if (!record) throw new ObjectUploadSessionError('not_found')
  return toDto(record)
}

export async function presignObjectUploadParts(
  deps: ObjectUploadSessionDeps,
  params: {
    orgId: string
    objectId: string
    sessionId: string
    storage: StorageRecord
    partNumbers: number[]
  },
): Promise<{ uploadId: string; partSize: number; parts: Array<{ partNumber: number; url: string }> }> {
  const record = await deps.objectUploadSessions.get(params.orgId, params.objectId, params.sessionId)
  if (!record) throw new ObjectUploadSessionError('not_found')
  if (record.status !== 'active' || record.expiresAt.getTime() <= Date.now()) {
    throw new ObjectUploadSessionError('invalid_state')
  }
  const parts = await Promise.all(
    params.partNumbers.map(async (partNumber) => ({
      partNumber,
      url: await deps.s3.presignUploadPart(params.storage, record.storageKey, record.uploadId, partNumber),
    })),
  )
  return { uploadId: record.uploadId, partSize: record.partSize, parts }
}

export async function patchObjectUploadSession(
  deps: ObjectUploadSessionDeps,
  params: {
    orgId: string
    objectId: string
    sessionId: string
    storage: StorageRecord
    input: PatchObjectUploadSessionInput
  },
): Promise<ObjectUploadSession> {
  const record = await deps.objectUploadSessions.get(params.orgId, params.objectId, params.sessionId)
  if (!record) throw new ObjectUploadSessionError('not_found')
  if (record.status !== 'active') throw new ObjectUploadSessionError('invalid_state')
  if (params.input.action === 'complete') {
    try {
      await deps.s3.completeMultipartUpload(params.storage, record.storageKey, record.uploadId, params.input.parts)
    } catch (error) {
      throw new ObjectUploadSessionError(
        'storage_failure',
        `Storage multipart upload complete failed: ${(error as Error).message}`,
      )
    }
    await deps.objectUploadSessions.setStatus(record.id, 'completed')
  } else {
    try {
      await deps.s3.abortMultipartUpload(params.storage, record.storageKey, record.uploadId)
    } catch (error) {
      throw new ObjectUploadSessionError(
        'storage_failure',
        `Storage multipart upload abort failed: ${(error as Error).message}`,
      )
    }
    await deps.objectUploadSessions.setStatus(record.id, 'aborted')
  }
  return getObjectUploadSession(deps, params.orgId, params.objectId, params.sessionId)
}

// ── recursive purge ──────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000
export const DEFAULT_TRASH_RETENTION_DAYS = 30

export type PurgeDeps = {
  s3: S3Gateway
  storages: StorageRepo
  storageUsage: StorageUsageRepo
  share: ShareRepo
  matter: MatterRepo
}

export async function purgeRecursively(deps: PurgeDeps, orgId: string, matters: Matter[]): Promise<number> {
  const keysByStorage = new Map<string, { storage: StorageRecord | null; keys: string[] }>()
  const bytesByStorage = new Map<string, number>()
  let totalBytes = 0

  for (const m of matters) {
    const size = m.size ?? 0
    if (m.dirtype === DirType.FILE && size > 0) {
      bytesByStorage.set(m.storageId, (bytesByStorage.get(m.storageId) ?? 0) + size)
      totalBytes += size
    }
    if (!m.object) continue
    let entry = keysByStorage.get(m.storageId)
    if (!entry) {
      const storage = await deps.storages.get(m.storageId)
      entry = { storage, keys: [] }
      keysByStorage.set(m.storageId, entry)
    }
    entry.keys.push(m.object)
  }

  for (const { storage, keys } of keysByStorage.values()) {
    if (storage && keys.length > 0) await deps.s3.deleteObjects(storage, keys)
  }

  for (const m of matters) {
    await deps.share.cascadeDeleteByMatter(m.id)
  }

  await deps.matter.purge(
    orgId,
    matters.map((m) => m.id),
  )
  if (totalBytes > 0) await deps.storageUsage.reconcile(orgId, bytesByStorage.keys())
  return matters.length
}

/** Parses ZPAN_TRASH_RETENTION_DAYS; falls back to the default, 0 disables purge. */
export function resolveTrashRetentionDays(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_TRASH_RETENTION_DAYS
  const days = Number(raw)
  if (!Number.isFinite(days) || days < 0) return DEFAULT_TRASH_RETENTION_DAYS
  return Math.floor(days)
}

/**
 * Permanently purges trashed items older than `retentionDays` across all orgs,
 * reclaiming their quota. Retention of 0 disables auto-purge. Runs subtree at a
 * time via the same purge path as emptying the trash manually.
 */
export async function purgeExpiredTrash(deps: PurgeDeps, retentionDays: number, now = Date.now()): Promise<number> {
  if (retentionDays <= 0) return 0
  const cutoff = now - retentionDays * DAY_MS
  const orgIds = await deps.matter.listOrgIdsWithExpiredTrash(cutoff)

  let purged = 0
  for (const orgId of orgIds) {
    const roots = await deps.matter.listTrashedRoots(orgId)
    for (const root of roots) {
      if ((root.trashedAt ?? 0) >= cutoff) continue
      const matters = await deps.matter.collectForPurge(orgId, root.id)
      if (!matters) continue
      purged += await purgeRecursively(deps, orgId, matters)
    }
  }
  return purged
}

// ── save to drive ────────────────────────────────────────────────────────────

// Pure orchestration: copies a shared matter (file or folder) into another org,
// reserving target-org quota per file via withStorageUsageReservation. Reaches
// the outside world only through deps; matter creation goes through the matter
// repo port.

export type SaveToDriveDeps = {
  s3: S3Gateway
  storages: StorageRepo
  storageUsage: StorageUsageRepo
  quota: QuotaRepo
  activity: ActivityRepo
  share: ShareRepo
  matter: MatterRepo
}

export interface SaveShareInput {
  share: { id: string }
  matter: Matter
  currentUserId: string
  targetOrgId: string
  targetParent: string
  teamQuotaEnabled?: boolean
}

export interface SaveShareResult {
  saved: Matter[]
  skipped: Array<{ name: string; reason: string }>
}

interface CopyActivity {
  action: string
  metadata: Record<string, unknown>
}

export interface CopyMatterToOrgInput {
  sourceMatter: Matter
  currentUserId: string
  targetOrgId: string
  targetParent: string
  activity: CopyActivity
  teamQuotaEnabled?: boolean
}

function buildPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name
}

async function saveFile(
  deps: SaveToDriveDeps,
  sourceMatter: Matter,
  sourceStorage: StorageRecord,
  targetStorage: StorageRecord,
  currentUserId: string,
  targetOrgId: string,
  targetParent: string,
  activity: CopyActivity,
  teamQuotaEnabled = true,
): Promise<Matter> {
  const bytes = sourceMatter.size ?? 0
  const dstKey = buildObjectKey({ uid: currentUserId, orgId: targetOrgId, rawExt: fileExt(sourceMatter.name) })

  return withStorageUsageReservation(
    { quota: deps.quota, storageUsage: deps.storageUsage },
    { orgId: targetOrgId, storageId: targetStorage.id, bytes, teamQuotaEnabled },
    async (ctx) => {
      if (sourceStorage.id === targetStorage.id) {
        await deps.s3.copyObject(sourceStorage, sourceMatter.object, targetStorage, dstKey)
      } else {
        await deps.s3.streamCopy(sourceStorage, sourceMatter.object, targetStorage, dstKey)
      }
      ctx.onRollback(() => deps.s3.deleteObject(targetStorage, dstKey))

      const newMatter = await deps.matter.create({
        orgId: targetOrgId,
        name: sourceMatter.name,
        type: sourceMatter.type,
        size: bytes,
        dirtype: DirType.FILE,
        parent: targetParent,
        object: dstKey,
        storageId: targetStorage.id,
        status: 'active',
        onConflict: 'rename',
      })

      await deps.activity.record({
        orgId: targetOrgId,
        userId: currentUserId,
        action: activity.action,
        targetType: 'file',
        targetId: newMatter.id,
        targetName: newMatter.name,
        metadata: activity.metadata,
      })

      return newMatter
    },
  )
}

async function saveFolderRecursive(
  deps: SaveToDriveDeps,
  sourceFolderMatter: Matter,
  sourceStorage: StorageRecord,
  targetStorage: StorageRecord,
  currentUserId: string,
  targetOrgId: string,
  targetParent: string,
  activity: CopyActivity,
  teamQuotaEnabled = true,
): Promise<SaveShareResult> {
  const saved: Matter[] = []
  const skipped: Array<{ name: string; reason: string }> = []

  const rootFolder = await deps.matter.create({
    orgId: targetOrgId,
    name: sourceFolderMatter.name,
    type: 'folder',
    size: 0,
    dirtype: sourceFolderMatter.dirtype ?? undefined,
    parent: targetParent,
    object: '',
    storageId: targetStorage.id,
    status: 'active',
    onConflict: 'rename',
  })
  saved.push(rootFolder)

  const sourceRootPath = buildPath(sourceFolderMatter.parent, sourceFolderMatter.name)
  const targetRootPath = buildPath(targetParent, rootFolder.name)

  const queue: Array<{ sourcePath: string; targetPath: string }> = [
    { sourcePath: sourceRootPath, targetPath: targetRootPath },
  ]

  while (queue.length > 0) {
    const { sourcePath, targetPath } = queue.shift()!
    const children = await deps.share.listDirectActiveChildren(sourceFolderMatter.orgId, sourcePath)

    for (const child of children) {
      if (child.dirtype === DirType.FILE) {
        try {
          const newFile = await saveFile(
            deps,
            child,
            sourceStorage,
            targetStorage,
            currentUserId,
            targetOrgId,
            targetPath,
            activity,
            teamQuotaEnabled,
          )
          saved.push(newFile)
        } catch (e) {
          skipped.push({ name: child.name, reason: (e as Error).message })
        }
      } else {
        const newFolder = await deps.matter.create({
          orgId: targetOrgId,
          name: child.name,
          type: 'folder',
          size: 0,
          dirtype: child.dirtype ?? undefined,
          parent: targetPath,
          object: '',
          storageId: targetStorage.id,
          status: 'active',
          onConflict: 'rename',
        })
        saved.push(newFolder)
        queue.push({
          sourcePath: buildPath(child.parent, child.name),
          targetPath: buildPath(targetPath, newFolder.name),
        })
      }
    }
  }

  return { saved, skipped }
}

// Copy a file or folder (recursively) into another org. Quota is reserved in the
// target org per file; files that fail (e.g. quota) are reported in `skipped`
// rather than failing the whole operation.
export async function copyMatterToOrg(deps: SaveToDriveDeps, input: CopyMatterToOrgInput): Promise<SaveShareResult> {
  const { sourceMatter, currentUserId, targetOrgId, targetParent, activity, teamQuotaEnabled = true } = input

  const sourceStorage = await deps.storages.get(sourceMatter.storageId)
  if (!sourceStorage) throw new Error('Source storage not found')

  const targetStorage = await deps.storages.select('private')

  if (sourceMatter.dirtype === DirType.FILE) {
    const newMatter = await saveFile(
      deps,
      sourceMatter,
      sourceStorage,
      targetStorage,
      currentUserId,
      targetOrgId,
      targetParent,
      activity,
      teamQuotaEnabled,
    )
    return { saved: [newMatter], skipped: [] }
  }

  return saveFolderRecursive(
    deps,
    sourceMatter,
    sourceStorage,
    targetStorage,
    currentUserId,
    targetOrgId,
    targetParent,
    activity,
    teamQuotaEnabled,
  )
}

export async function saveShareToDrive(deps: SaveToDriveDeps, input: SaveShareInput): Promise<SaveShareResult> {
  const { share, matter: sourceMatter, ...rest } = input
  return copyMatterToOrg(deps, {
    ...rest,
    sourceMatter,
    activity: { action: 'save_from_share', metadata: { sourceShareId: share.id } },
  })
}
