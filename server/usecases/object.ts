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
import type {
  CompleteObjectUploadInput,
  ConflictStrategy,
  CreateMatterInput,
  PatchMatterInput,
  PresignObjectUploadPartsInput,
  TransferMatterInput,
} from '@shared/schemas'
import type { ObjectUploadInstructions } from '@shared/types'
import { buildObjectKey, fileExt } from '../lib/path-template'
import type { Deps } from './deps'
import { assertTaskUploadAllowed } from './downloads/downloads'
import {
  type ActivityRepo,
  type AppError,
  badRequest,
  forbidden,
  insufficientCredits,
  type Matter,
  type MatterListFilters,
  type MatterRepo,
  noStorage,
  notFound,
  ObjectUploadSessionError,
  type QuotaRepo,
  quotaExceeded,
  type S3Gateway,
  type ShareRepo,
  type StorageRecord,
  type StorageRepo,
  type StorageUsageRepo,
  storageNotFound,
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
  | { ok: false; error: AppError }

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
      return { ok: false, error: forbidden() }
    }
    orgId = params.orgOverride
  }
  const result = await deps.matter.list(orgId, params.filters)
  return { ok: true, result }
}

// ─── Create (folder, or file draft + size-decided upload) ─────────────────────

// The server picks the S3 mechanism by size: ≤5 GiB → single PutObject (1 URL),
// >5 GiB → multipart with 5 GiB parts (N URLs), >5 TiB → rejected (S3's hard
// single-object ceiling). The client's flow is uniform: PUT each slice, read the
// ETag, then POST them to .../completions.
const PART_SIZE_BYTES = 5 * 1024 * 1024 * 1024 // 5 GiB
const MAX_OBJECT_BYTES = 5 * 1024 * 1024 * 1024 * 1024 // 5 TiB

export type CreateObjectOutcome =
  | { ok: true; matter: Matter }
  | { ok: true; matter: Matter; upload: ObjectUploadInstructions }
  | { ok: false; error: AppError }

export async function createObject(
  deps: Pick<Deps, 'matter' | 'storages' | 's3' | 'objectUploadSessions' | 'downloaders' | 'downloadTasks'>,
  params: { orgId: string; actor: ObjectActor; input: CreateMatterInput },
): Promise<CreateObjectOutcome> {
  const { orgId, actor, input } = params
  const { name, type, parent, dirtype, onConflict } = input
  const isFolder = dirtype !== DirType.FILE
  const size = input.size ?? 0

  if (actor.kind === 'download-task-upload') {
    if (input.storageId) {
      return { ok: false, error: forbidden('Storage selection is not allowed for task uploads') }
    }
    if (!isWithinDownloadTarget(parent, actor.targetFolder)) {
      return { ok: false, error: forbidden('Target folder is outside task authorization') }
    }
    await assertTaskUploadAllowed(deps as Deps, { taskId: actor.taskId, downloaderId: actor.downloaderId })
  }

  // Reject oversize before creating anything, so no orphan draft is left behind.
  if (!isFolder && size > MAX_OBJECT_BYTES) {
    return { ok: false, error: badRequest('File exceeds the 5 TiB maximum', 'FILE_TOO_LARGE') }
  }

  let storage: StorageRecord
  try {
    storage = await deps.storages.select(input.storageId)
  } catch (error) {
    if (error instanceof Error && error.message === 'No available storage') {
      return {
        ok: false,
        error: input.storageId ? noStorage('Storage is not active or has no available capacity') : noStorage(),
      }
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

  const upload = await prepareUpload(deps, {
    orgId,
    objectId: matter.id,
    storage,
    storageKey: objectKey,
    contentType: type,
    size,
    onConflict: onConflict ?? 'fail',
    actorId: actorLogId(actor),
  })
  return { ok: true, matter, upload }
}

// Decides the S3 mechanism, presigns every URL up front, and records the upload
// session. The chosen onConflict is stored on the session so completion can apply
// a deferred 'replace' (createMatter keeps the incumbent until bytes land).
async function prepareUpload(
  deps: Pick<Deps, 's3' | 'objectUploadSessions'>,
  params: {
    orgId: string
    objectId: string
    storage: StorageRecord
    storageKey: string
    contentType: string
    size: number
    onConflict: ConflictStrategy
    actorId: string
  },
): Promise<ObjectUploadInstructions> {
  const { storage, storageKey, contentType, size } = params
  let uploadId: string | null = null
  let partSize: number
  let urls: string[]

  if (size <= PART_SIZE_BYTES) {
    // Single PutObject — one presigned PUT, no S3 multipart overhead. Presign a
    // bare PUT (no signed ContentType) so the uniform slice uploader can PUT raw
    // bytes with no headers, exactly like a multipart part. The object's
    // content-type is applied at download/view time (presignDownload/Inline).
    partSize = size
    urls = [await deps.s3.presignUpload(storage, storageKey, '')]
  } else {
    partSize = PART_SIZE_BYTES
    const partCount = Math.ceil(size / partSize)
    try {
      uploadId = await deps.s3.createMultipartUpload(storage, storageKey, contentType)
    } catch (error) {
      throw new ObjectUploadSessionError(
        'storage_failure',
        `Storage multipart upload failed: ${(error as Error).message}`,
      )
    }
    const mpId = uploadId
    urls = await Promise.all(
      Array.from({ length: partCount }, (_, i) => deps.s3.presignUploadPart(storage, storageKey, mpId, i + 1)),
    )
  }

  const record = await deps.objectUploadSessions.create({
    orgId: params.orgId,
    objectId: params.objectId,
    storageId: storage.id,
    storageKey,
    uploadId,
    partSize,
    onConflict: params.onConflict,
    actorId: params.actorId,
  })
  return { sessionId: record.id, partSize, urls }
}

// ─── Upload finalize / abort / re-presign ─────────────────────────────────────
// These throw ObjectUploadSessionError (not_found / invalid_state /
// storage_failure); the handler maps the code to 404 / 409 / 502.

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

// Re-presign expired part URLs mid-upload (multipart sessions only). The happy
// path uses the URLs returned by createObject; this is the fallback.
export async function presignUploadSessionParts(
  deps: Pick<Deps, 'matter' | 'storages' | 's3' | 'objectUploadSessions'>,
  params: {
    orgId: string
    objectId: string
    sessionId: string
    partNumbers: PresignObjectUploadPartsInput['partNumbers']
  },
): Promise<{ uploadId: string; partSize: number; parts: Array<{ partNumber: number; url: string }> }> {
  const { storage } = await loadObjectForUploadSession(deps, params.orgId, params.objectId)
  const record = await deps.objectUploadSessions.get(params.orgId, params.objectId, params.sessionId)
  if (!record) throw new ObjectUploadSessionError('not_found')
  if (record.status !== 'active' || record.expiresAt.getTime() <= Date.now()) {
    throw new ObjectUploadSessionError('invalid_state')
  }
  // Only multipart sessions have re-presignable parts; a single PutObject does not.
  if (record.uploadId == null) throw new ObjectUploadSessionError('invalid_state')
  const uploadId = record.uploadId
  const parts = await Promise.all(
    params.partNumbers.map(async (partNumber) => ({
      partNumber,
      url: await deps.s3.presignUploadPart(storage, record.storageKey, uploadId, partNumber),
    })),
  )
  return { uploadId, partSize: record.partSize, parts }
}

export type CompleteUploadOutcome =
  | { ok: true; matter: Matter }
  | { ok: false; reason: 'not_found' }
  | { ok: false; error: AppError }

// Finalizes a draft upload (draft → live). For a single PutObject it HEADs the
// object and checks the reported ETag; for multipart it calls
// CompleteMultipartUpload. Then it runs the quota-guarded activation (reusing the
// session's stored conflict strategy) and returns the live object.
export async function completeUpload(
  deps: Pick<
    Deps,
    'matter' | 'storages' | 's3' | 'objectUploadSessions' | 'quota' | 'storageUsage' | 'activity' | 'share'
  >,
  params: {
    orgId: string
    objectId: string
    sessionId: string
    parts: CompleteObjectUploadInput['parts']
    actorId: string
  },
): Promise<CompleteUploadOutcome> {
  const { storage } = await loadObjectForUploadSession(deps, params.orgId, params.objectId)
  const record = await deps.objectUploadSessions.get(params.orgId, params.objectId, params.sessionId)
  if (!record) throw new ObjectUploadSessionError('not_found')
  if (record.status !== 'active') throw new ObjectUploadSessionError('invalid_state')

  if (record.uploadId == null) {
    // Single PutObject: confirm the object landed and matches the reported ETag.
    let head: { size: number; contentType: string; etag: string }
    try {
      head = await deps.s3.headObject(storage, record.storageKey)
    } catch (error) {
      throw new ObjectUploadSessionError('invalid_state', `Uploaded object not found: ${(error as Error).message}`)
    }
    const reported = params.parts[0]?.etag.replace(/"/g, '')
    if (!reported || reported !== head.etag) {
      throw new ObjectUploadSessionError('invalid_state', 'Uploaded object ETag does not match')
    }
  } else {
    try {
      await deps.s3.completeMultipartUpload(storage, record.storageKey, record.uploadId, params.parts)
    } catch (error) {
      throw new ObjectUploadSessionError(
        'storage_failure',
        `Storage multipart upload complete failed: ${(error as Error).message}`,
      )
    }
  }
  await deps.objectUploadSessions.setStatus(record.id, 'completed')

  // Draft → live: reserve quota, apply the stored conflict strategy, activate.
  const { matter, quotaExceeded: exceeded } = await confirmUpload(deps, params.objectId, params.orgId, {
    onConflict: record.onConflict,
    userId: params.actorId,
    purgeReplaced: (incumbent) => purgeRecursively(deps, params.orgId, [incumbent]).then(() => undefined),
  })
  if (exceeded) return { ok: false, error: quotaExceeded() }
  if (!matter) return { ok: false, reason: 'not_found' }
  return { ok: true, matter }
}

// Aborts an in-progress upload and discards the draft. Idempotent for an
// already-aborted session; rejects completing one.
export async function abortUpload(
  deps: Pick<Deps, 'matter' | 'storages' | 's3' | 'objectUploadSessions'>,
  params: { orgId: string; objectId: string; sessionId: string; actorId: string; strictStorageCleanup?: boolean },
): Promise<void> {
  const { storage } = await loadObjectForUploadSession(deps, params.orgId, params.objectId)
  const record = await deps.objectUploadSessions.get(params.orgId, params.objectId, params.sessionId)
  if (!record) throw new ObjectUploadSessionError('not_found')
  if (record.status === 'completed') throw new ObjectUploadSessionError('invalid_state', 'Upload already completed')
  if (record.status === 'aborted') return

  if (record.uploadId != null) {
    try {
      await deps.s3.abortMultipartUpload(storage, record.storageKey, record.uploadId)
    } catch (error) {
      throw new ObjectUploadSessionError(
        'storage_failure',
        `Storage multipart upload abort failed: ${(error as Error).message}`,
      )
    }
  } else {
    // Single PutObject: best-effort cleanup; the browser may abort before any
    // bytes reach S3.
    try {
      await deps.s3.deleteObject(storage, record.storageKey)
    } catch (error) {
      if (params.strictStorageCleanup) {
        throw new ObjectUploadSessionError('storage_failure', `Storage cleanup failed: ${(error as Error).message}`)
      }
    }
  }
  await deps.objectUploadSessions.setStatus(record.id, 'aborted')
  await deps.matter.cancelDraft(params.objectId, params.orgId, params.actorId)
}

// ─── Detail / download ────────────────────────────────────────────────────────

export type GetObjectOutcome =
  | { ok: true; matter: Matter }
  | { ok: true; matter: Matter; downloadUrl: string }
  | { ok: false; error: AppError }

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
  // Live objects only — a trashed object is fetched via GET /trash/objects/{id}.
  if (!matter || matter.trashedAt != null) return { ok: false, error: notFound() }
  if (matter.dirtype !== DirType.FILE || !matter.object) return { ok: true, matter }

  const storage = await deps.storages.get(matter.storageId)
  if (!storage) return { ok: false, error: storageNotFound() }

  const bytes = matter.size ?? 0
  const metered = await meterDownloadTraffic(deps, {
    cloudBaseUrl: params.cloudBaseUrl,
    orgId: params.orgId,
    bytes,
    storage,
    source: 'object_download',
    sourceId: matter.id,
  })
  if (!metered.ok)
    return {
      ok: false,
      error:
        metered.reason === 'quota_exceeded'
          ? quotaExceeded('Traffic quota exceeded')
          : insufficientCredits('Insufficient credits', { metadata: { resource: 'storage_egress' } }),
    }

  let downloadUrl: string
  try {
    downloadUrl = await deps.s3.presignDownload(storage, matter.object, matter.name)
  } catch (error) {
    await deps.quota.refundTraffic(params.orgId, bytes)
    throw error
  }
  return { ok: true, matter, downloadUrl }
}

// ─── Trash listing / detail ─────────────────────────────────────────────────

// Lists trashed objects, ROOTS ONLY (a trashed folder shows one entry, not its
// cascade-marked subtree). Paginated over the root set.
export async function listTrashedObjects(
  deps: Pick<Deps, 'matter'>,
  params: { orgId: string; page: number; pageSize: number },
): Promise<{ ok: true; result: { items: Matter[]; total: number; page: number; pageSize: number } }> {
  const roots = await deps.matter.listTrashedRoots(params.orgId)
  const offset = (params.page - 1) * params.pageSize
  return {
    ok: true,
    result: {
      items: roots.slice(offset, offset + params.pageSize),
      total: roots.length,
      page: params.page,
      pageSize: params.pageSize,
    },
  }
}

// Loads a single trashed object (GET /trash/objects/{id}); a live object is 404
// here (use GET /objects/{id}).
export async function getTrashObject(
  deps: Pick<Deps, 'matter'>,
  params: { orgId: string; objectId: string },
): Promise<{ ok: true; matter: Matter } | { ok: false; error: AppError }> {
  const matter = await deps.matter.get(params.objectId, params.orgId)
  if (!matter || matter.trashedAt == null) return { ok: false, error: notFound() }
  return { ok: true, matter }
}

// ─── Update / trash / restore ──────────────────────────────────────────────────

export type UpdateObjectOutcome = { ok: true; matter: Matter } | { ok: false; error: AppError }

export async function updateObject(
  deps: Pick<Deps, 'matter'>,
  params: { orgId: string; objectId: string; actorId: string; input: PatchMatterInput },
): Promise<UpdateObjectOutcome> {
  const { name, parent, onConflict } = params.input
  const matter = await deps.matter.update(params.objectId, params.orgId, { name, parent, onConflict }, params.actorId)
  return matter ? { ok: true, matter } : { ok: false, error: notFound() }
}

export type TrashObjectOutcome = { ok: true; matter: Matter } | { ok: false; error: AppError }

export async function trashObject(
  deps: Pick<Deps, 'matter'>,
  params: { orgId: string; objectId: string; actorId: string },
): Promise<TrashObjectOutcome> {
  const matter = await deps.matter.trash(params.orgId, params.objectId, params.actorId)
  return matter ? { ok: true, matter } : { ok: false, error: notFound() }
}

export type RestoreObjectOutcome = { ok: true; matter: Matter } | { ok: false; error: AppError }

export async function restoreObject(
  deps: Pick<Deps, 'matter'>,
  params: { orgId: string; objectId: string; actorId: string; onConflict?: ConflictStrategy },
): Promise<RestoreObjectOutcome> {
  const matter = await deps.matter.restore(params.orgId, params.objectId, params.actorId, params.onConflict ?? 'fail')
  return matter ? { ok: true, matter } : { ok: false, error: notFound() }
}

// Authorizes a download-task-upload token to finalize a specific object: it may
// only complete its own draft (POST .../completions) and only within its target
// folder.
export type ConfirmAuthorizationOutcome = { ok: true } | { ok: false; error: AppError }

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
    return { ok: false, error: forbidden() }
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
  // Only a trashed object can be permanently purged.
  if (ms[0].trashedAt == null) return { ok: false, reason: 'not_trashed' }
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

export type CopyObjectOutcome = { ok: true; matter: Matter } | { ok: false; error: AppError }

export async function copyObject(
  deps: Pick<Deps, 'matter' | 'storages' | 's3' | 'quota' | 'storageUsage'>,
  params: { orgId: string; userId: string; input: CopyObjectInput },
): Promise<CopyObjectOutcome> {
  const { orgId, userId, input } = params
  const { copyFrom, parent, onConflict } = input
  const source = await deps.matter.get(copyFrom, orgId)
  if (!source || source.trashedAt != null) return { ok: false, error: notFound() }

  const sourceSize = source.size ?? 0
  const storage = source.object ? await deps.storages.get(source.storageId) : null
  if (source.object && !storage) return { ok: false, error: storageNotFound() }

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

export type TransferObjectOutcome = { ok: true; result: TransferObjectResult } | { ok: false; error: AppError }

export async function transferObject(
  deps: Pick<Deps, 'matter' | 'storages' | 's3' | 'quota' | 'storageUsage' | 'share' | 'org' | 'activity'>,
  params: { orgId: string; userId: string; objectId: string; input: TransferMatterInput },
): Promise<TransferObjectOutcome> {
  const { orgId, userId, objectId, input } = params
  const { targetOrgId, targetParent, mode } = input
  if (targetOrgId === orgId) return { ok: false, error: badRequest('Target must be a different space', 'SAME_ORG') }

  const source = await deps.matter.get(objectId, orgId)
  if (!source || source.status !== 'active' || source.trashedAt != null) return { ok: false, error: notFound() }

  // Copying out only needs read access on the source space (granted by the route
  // middleware); moving also trashes the source, which needs editor.
  if (mode === 'move' && !(await hasEditorAccess(deps, { orgId, userId }))) {
    return { ok: false, error: forbidden() }
  }
  if (!(await deps.org.canWriteToOrg(userId, targetOrgId))) {
    return { ok: false, error: forbidden() }
  }

  const totalBytes = await deps.share.computeSourceBytes(source)
  if (!(await deps.share.hasQuotaForBytes(targetOrgId, totalBytes))) {
    return { ok: false, error: quotaExceeded() }
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

  const targetStorage = await deps.storages.select()

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
