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
import { meterDownloadTraffic } from './cloud-traffic-metering'
import type { Deps } from './deps'
import { assertTaskUploadAllowed } from './downloads/downloads'
import { confirmUpload } from './matter'
import {
  createObjectUploadSession,
  ObjectUploadSessionError,
  patchObjectUploadSession,
  presignObjectUploadParts,
} from './object-upload-session'
import type { Matter, MatterListFilters, StorageRecord } from './ports'
import { purgeRecursively } from './purge'
import { copyMatterToOrg } from './save-to-drive'
import { withStorageUsageReservation } from './storage-usage'

export { ObjectUploadSessionError } from './object-upload-session'

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
