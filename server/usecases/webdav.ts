// The WebDAV resource usecase. WebDAV is special: the http handler owns the
// full protocol surface — XML parsing/rendering, every status code, and all
// header parsing (Depth, Destination, Range, If, Lock-Token, Overwrite, the
// basic-auth header). What lives here is every business decision that reaches a
// port: identity resolution, path/lock/dead-property state, matter
// create/move/copy/delete/touch, storage selection, the upload-body
// persistence, and the download metering + refund.
//
// All port access lives here: the handler never reaches into `deps.<port>`. The
// handler calls these functions (passing `deps` whole) and maps the returned
// data / outcomes to WebDAV responses. Response objects never leave this file —
// for streaming, a usecase returns the body (and the size the handler needs to
// frame it), and the handler wraps it in a Response.

import { DirType, ObjectStatus } from '@shared/constants'
import { joinMatterPath } from '../domain/webdav'
import { buildObjectKey, fileExt } from '../lib/path-template'
import type { Database } from '../platform/interface'
import type { Deps } from './deps'
import {
  type ApiKeyAuth,
  ApiKeyRateLimitError,
  type DavDeadProperty,
  type DavLock,
  type DeadPropertyUpdate,
  type Matter,
  type StorageRecord,
  WebDavPathError,
  type WebDavTarget,
  type WebDavWorkspace,
} from './ports'
import { withStorageUsageReservation } from './storage-usage'
import { type DownloadTrafficStorage, meterDownloadTraffic, type TrafficReportSource } from './store/traffic-metering'

// ─── Auth resolution ──────────────────────────────────────────────────────────
// The middleware parses the Authorization header (http) and renders the 401 / 429;
// this resolves identity via the api-key gateway + the username match (deps).

export type WebDavAuthOutcome =
  | { ok: true; userId: string }
  | { ok: false; reason: 'unauthorized' }
  | { ok: false; reason: 'rate_limited'; retryAfterMs?: number; message: string }

export async function resolveWebDavAuth(
  deps: Pick<Deps, 'apiKeys' | 'userAdmin'>,
  params: {
    auth: ApiKeyAuth
    db: Database
    username: string
    password: string
    resource: string
    action: 'read' | 'write'
    configId: string
  },
): Promise<WebDavAuthOutcome> {
  try {
    const key = await deps.apiKeys.verifyApiKeyForPermission(
      params.auth,
      params.db,
      params.password,
      params.resource,
      params.action,
      params.configId,
    )
    if (!key) return { ok: false, reason: 'unauthorized' }
    if (!(await deps.userAdmin.matchesUsername(key.referenceId, params.username))) {
      return { ok: false, reason: 'unauthorized' }
    }
    return { ok: true, userId: key.referenceId }
  } catch (error) {
    if (error instanceof ApiKeyRateLimitError)
      return { ok: false, reason: 'rate_limited', retryAfterMs: error.retryAfterMs, message: error.message }
    return { ok: false, reason: 'unauthorized' }
  }
}

// ─── Path resolution ──────────────────────────────────────────────────────────

export function resolveWebDavPath(
  deps: Pick<Deps, 'webdavPath'>,
  params: { userId: string; rawPath: string },
): Promise<WebDavTarget> {
  return deps.webdavPath.resolveWebDavPath(params.userId, params.rawPath)
}

export function resolveExistingWebDavPath(
  deps: Pick<Deps, 'webdavPath'>,
  params: { userId: string; rawPath: string },
): Promise<WebDavTarget> {
  return deps.webdavPath.resolveExistingWebDavPath(params.userId, params.rawPath)
}

export function listUserWebDavWorkspaces(deps: Pick<Deps, 'webdavPath'>, userId: string): Promise<WebDavWorkspace[]> {
  return deps.webdavPath.listUserWorkspaces(userId)
}

export function listWebDavChildren(
  deps: Pick<Deps, 'webdavPath'>,
  params: { orgId: string; parent: string },
): Promise<Matter[]> {
  return deps.webdavPath.listChildren(params.orgId, params.parent)
}

// Ensures a non-empty parent path resolves to an existing collection. Throws the
// same WebDavPathError statuses the handler maps (409 missing parent, 405 file).
export async function ensureParentCollection(
  deps: Pick<Deps, 'webdavPath'>,
  params: { userId: string; workspaceSlug: string; parent: string },
): Promise<void> {
  if (!params.parent) return
  const target = await deps.webdavPath.resolveWebDavPath(params.userId, `/dav/${params.workspaceSlug}/${params.parent}`)
  if (!target.matter) throw new WebDavPathError('Parent collection not found', 409)
  if (target.matter.dirtype === DirType.FILE) throw new WebDavPathError('Not a collection', 405)
}

// ─── Lock + dead-property state ────────────────────────────────────────────────

export function activeLocks(
  deps: Pick<Deps, 'webdavState'>,
  params: { orgId: string; resourcePath: string },
): Promise<DavLock[]> {
  return deps.webdavState.activeLocks(params.orgId, params.resourcePath)
}

export function listDeadPropertiesForResources(
  deps: Pick<Deps, 'webdavState'>,
  params: { orgId: string; resourcePaths: string[] },
): Promise<Map<string, DavDeadProperty[]>> {
  return deps.webdavState.listDeadPropertiesForResources(params.orgId, params.resourcePaths)
}

export function activeLocksForResources(
  deps: Pick<Deps, 'webdavState'>,
  params: { orgId: string; resourcePaths: string[] },
): Promise<Map<string, DavLock[]>> {
  return deps.webdavState.activeLocksForResources(params.orgId, params.resourcePaths)
}

// ─── PROPPATCH ─────────────────────────────────────────────────────────────────

export async function applyWebDavDeadProperties(
  deps: Pick<Deps, 'webdavState' | 'matter'>,
  params: { orgId: string; resourcePath: string; operations: DeadPropertyUpdate[]; matterId: string | null },
): Promise<void> {
  await deps.webdavState.applyDeadPropertyUpdate(params.orgId, params.resourcePath, params.operations)
  if (params.matterId) await deps.matter.touch(params.orgId, params.matterId)
}

// ─── GET download (metering + streaming) ───────────────────────────────────────
// The handler frames every Response (FixedLengthStream, single/multi range,
// status, headers); it only ever obtains the underlying body through these.

export type ResolveDownloadOutcome =
  | { ok: true; matter: Matter; workspace: WebDavWorkspace; storage: StorageRecord }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'workspace_not_found' }
  | { ok: false; reason: 'not_a_file' }
  | { ok: false; reason: 'storage_not_found' }

// Resolves a GET/HEAD target to its matter + storage. Mirrors readFile's guards
// (404 missing, 404 missing workspace, 405 collection, 404 storage). No metering
// happens here — HEAD must not meter — so the handler meters separately.
export async function resolveWebDavDownload(
  deps: Pick<Deps, 'webdavPath' | 'storages'>,
  params: { userId: string; rawPath: string },
): Promise<ResolveDownloadOutcome> {
  const { matter, workspace } = await deps.webdavPath.resolveExistingWebDavPath(params.userId, params.rawPath)
  if (!matter) return { ok: false, reason: 'not_found' }
  if (!workspace) return { ok: false, reason: 'workspace_not_found' }
  if (matter.dirtype !== DirType.FILE) return { ok: false, reason: 'not_a_file' }
  const storage = await deps.storages.get(matter.storageId)
  if (!storage) return { ok: false, reason: 'storage_not_found' }
  return { ok: true, matter, workspace, storage }
}

export type WebDavTrafficOutcome =
  | { ok: true }
  | { ok: false; reason: 'quota_exceeded' }
  | { ok: false; reason: 'insufficient_credits' }

// Meters a download: consume the org's traffic quota, then report egress to
// Cloud (refunding the quota on a block). Skips zero-byte reads (HEAD/empty
// ranges) exactly like the former reserveWebDavTraffic did. The handler renders
// the 422 / 402.
export async function meterWebDavDownload(
  deps: Pick<Deps, 'quota' | 'licenseBinding' | 'licensingCloud' | 'cloudTrafficReports'>,
  params: {
    cloudBaseUrl: string
    orgId: string
    matterId: string
    storage: DownloadTrafficStorage
    bytes: number
  },
): Promise<WebDavTrafficOutcome> {
  if (params.bytes <= 0) return { ok: true }
  return meterDownloadTraffic(deps, {
    cloudBaseUrl: params.cloudBaseUrl,
    orgId: params.orgId,
    bytes: params.bytes,
    storage: params.storage,
    source: WEBDAV_DOWNLOAD_SOURCE,
    sourceId: params.matterId,
  })
}

const WEBDAV_DOWNLOAD_SOURCE: TrafficReportSource = 'webdav_download'

// Refunds previously-consumed traffic quota when an S3 read throws after metering.
export function refundWebDavTraffic(
  deps: Pick<Deps, 'quota'>,
  params: { orgId: string; bytes: number },
): Promise<void> {
  return deps.quota.refundTraffic(params.orgId, params.bytes)
}

// Returns the S3 body for streaming (optionally a byte range). The handler wraps
// it in the Response; the underlying deps.s3 call never escapes the usecase.
export function getWebDavObjectBody(
  deps: Pick<Deps, 's3'>,
  params: { storage: StorageRecord; object: string; range?: string },
): Promise<BodyInit> {
  // Omit the range arg entirely for full downloads — getObjectBody(storage,
  // object) vs (storage, object, range), matching the original call shape.
  return params.range === undefined
    ? deps.s3.getObjectBody(params.storage, params.object)
    : deps.s3.getObjectBody(params.storage, params.object, params.range)
}

// ─── PUT ───────────────────────────────────────────────────────────────────────

export type PutWebDavOutcome = { ok: true; status: 201 | 204 } | { ok: false; reason: 'no_storage' }

// Persists a PUT body to storage and the matter row, reserving quota for the
// (known) size delta and rolling back the S3 write if the row write fails. When
// the size is unknown (no Content-Length) it reserves the measured size after
// the streamed upload completes; on a shrink it reconciles usage. Returns 201 on
// create, 204 on overwrite. Surfaces no_storage (404); quota / conflict errors
// throw (the handler maps them via mapDomainError).
export async function putWebDavFile(
  deps: Pick<Deps, 'matter' | 'storages' | 's3' | 'quota' | 'storageUsage'>,
  params: {
    orgId: string
    userId: string
    target: WebDavTarget
    fileName: string
    parent: string
    contentType: string
    contentLength: number | null
    body: ReadableStream | Uint8Array
  },
): Promise<PutWebDavOutcome> {
  const { orgId, userId, target, fileName, parent, contentType, contentLength, body } = params
  const storage = target.matter ? await deps.storages.get(target.matter.storageId) : await deps.storages.select()
  if (!storage) return { ok: false, reason: 'no_storage' }

  const objectKey =
    target.matter?.object && contentLength !== null
      ? target.matter.object
      : buildObjectKey({ uid: userId, orgId, rawExt: fileExt(fileName) })

  const knownSizeDelta =
    contentLength === null ? 0 : target.matter ? contentLength - (target.matter.size ?? 0) : contentLength

  const status = await withStorageUsageReservation(
    deps,
    { orgId, storageId: storage.id, bytes: Math.max(0, knownSizeDelta) },
    async (ctx) => {
      const uploadedSize = await deps.s3.putObject(storage, objectKey, body, contentType, contentLength ?? undefined)
      const sizeDelta = target.matter ? uploadedSize - (target.matter.size ?? 0) : uploadedSize

      if (!target.matter || objectKey !== target.matter.object) {
        ctx.onRollback(() => deps.s3.deleteObject(storage, objectKey))
      }

      if (contentLength === null && sizeDelta > 0) {
        return withStorageUsageReservation(deps, { orgId, storageId: storage.id, bytes: sizeDelta }, () =>
          persistWebDavUpload(deps, {
            orgId,
            userId,
            target,
            fileName,
            parent,
            storage,
            objectKey,
            contentType,
            uploadedSize,
          }),
        )
      }

      const result = await persistWebDavUpload(deps, {
        orgId,
        userId,
        target,
        fileName,
        parent,
        storage,
        objectKey,
        contentType,
        uploadedSize,
      })
      if (sizeDelta < 0) await deps.storageUsage.reconcile(orgId, [storage.id])
      return result
    },
  )
  return { ok: true, status }
}

async function persistWebDavUpload(
  deps: Pick<Deps, 'matter' | 's3'>,
  params: {
    orgId: string
    userId: string
    target: WebDavTarget
    fileName: string
    parent: string
    storage: StorageRecord
    objectKey: string
    contentType: string
    uploadedSize: number
  },
): Promise<201 | 204> {
  const { orgId, userId, target, fileName, parent, storage, objectKey, contentType, uploadedSize } = params
  if (target.matter) {
    await deps.matter.applyUpload(orgId, target.matter.id, { type: contentType, size: uploadedSize, object: objectKey })
    if (objectKey !== target.matter.object) await deps.s3.deleteObject(storage, target.matter.object)
    return 204
  }

  await deps.matter.create({
    orgId,
    userId,
    name: fileName,
    type: contentType,
    size: uploadedSize,
    dirtype: DirType.FILE,
    parent,
    object: objectKey,
    storageId: storage.id,
    status: ObjectStatus.ACTIVE,
  })
  return 201
}

// ─── MKCOL ───────────────────────────────────────────────────────────────────

export async function createWebDavCollection(
  deps: Pick<Deps, 'matter' | 'storages'>,
  params: { orgId: string; userId: string; name: string; parent: string },
): Promise<void> {
  const storage = await deps.storages.select()
  await deps.matter.create({
    orgId: params.orgId,
    userId: params.userId,
    name: params.name,
    type: 'folder',
    size: 0,
    dirtype: DirType.USER_FOLDER,
    parent: params.parent,
    object: '',
    storageId: storage.id,
    status: ObjectStatus.ACTIVE,
  })
}

// ─── DELETE ────────────────────────────────────────────────────────────────────

export async function deleteWebDavMatter(
  deps: Pick<Deps, 'webdavState' | 'matter'>,
  params: { orgId: string; resourcePath: string; matterId: string; userId: string },
): Promise<void> {
  await deps.webdavState.deleteWebDavState(params.orgId, params.resourcePath)
  await deps.matter.trash(params.orgId, params.matterId, params.userId)
}

// ─── MOVE ──────────────────────────────────────────────────────────────────────

// Commits a MOVE: trashes an overwritten destination (with its dav state), then
// renames/reparents the source matter and moves its dav state. The handler has
// already validated workspace scope, locks, If/preconditions, and the
// self/descendant guards.
export async function moveWebDavMatter(
  deps: Pick<Deps, 'webdavState' | 'matter'>,
  params: {
    orgId: string
    userId: string
    sourceMatterId: string
    sourceResourcePath: string
    targetName: string
    targetParent: string
    targetResourcePath: string
    replacedMatterId: string | null
  },
): Promise<void> {
  const newPath = joinMatterPath(params.targetParent, params.targetName)
  if (params.replacedMatterId) {
    await deps.webdavState.deleteWebDavState(params.orgId, params.targetResourcePath)
    await deps.matter.trash(params.orgId, params.replacedMatterId, params.userId)
  }
  await deps.matter.update(
    params.sourceMatterId,
    params.orgId,
    { name: params.targetName, parent: params.targetParent },
    params.userId,
  )
  await deps.webdavState.moveWebDavState(params.orgId, params.sourceResourcePath, newPath)
}

// ─── COPY (file) ───────────────────────────────────────────────────────────────

export type CopyWebDavFileOutcome =
  | { ok: true; status: 201 | 204; location: string }
  | { ok: false; reason: 'storage_not_found' }

// Copies a single file matter: reserves quota for the source size, copies the S3
// object (rolling it back on failure), trashes an overwritten destination, then
// copies the matter row + its dead properties. Returns the new resource path so
// the handler can build the Location header. Conflict/quota errors throw.
export async function copyWebDavFile(
  deps: Pick<Deps, 'matter' | 'storages' | 's3' | 'quota' | 'storageUsage' | 'webdavState'>,
  params: {
    orgId: string
    userId: string
    sourceMatter: Matter
    sourceResourcePath: string
    targetName: string
    targetParent: string
    targetResourcePath: string
    replacedMatterId: string | null
    replacingTarget: boolean
  },
): Promise<CopyWebDavFileOutcome> {
  const { orgId, userId, sourceMatter } = params
  const storage = sourceMatter.object ? await deps.storages.get(sourceMatter.storageId) : null
  if (sourceMatter.object && !storage) return { ok: false, reason: 'storage_not_found' }
  const bytes = sourceMatter.size ?? 0

  return withStorageUsageReservation(deps, { orgId, storageId: sourceMatter.storageId, bytes }, async (ctx) => {
    let newObject = ''
    if (sourceMatter.object && storage) {
      newObject = buildObjectKey({ uid: userId, orgId, rawExt: fileExt(params.targetName) })
      await deps.s3.copyObject(storage, sourceMatter.object, storage, newObject)
      ctx.onRollback(() => deps.s3.deleteObject(storage, newObject))
    }

    if (params.replacedMatterId) {
      await deps.webdavState.deleteWebDavState(orgId, params.targetResourcePath)
      await deps.matter.trash(orgId, params.replacedMatterId, userId)
    }
    const copy = await deps.matter.copy({ ...sourceMatter, name: params.targetName }, params.targetParent, newObject, {
      onConflict: 'fail',
      userId,
    })
    const copyPath = joinMatterPath(copy.parent, copy.name)
    await deps.webdavState.copyDeadProperties(orgId, params.sourceResourcePath, copyPath)
    return { ok: true, status: params.replacingTarget ? 204 : 201, location: copyPath } as const
  })
}

// ─── COPY (collection, recursive) ──────────────────────────────────────────────

export type CopyWebDavCollectionOutcome =
  | { ok: true; status: 201 | 204; location: string }
  | { ok: false; reason: 'storage_not_found' }

// Recursively copies a collection subtree. Reserves quota for every file's
// bytes, copies each S3 object (rolling back on failure), trashes an overwritten
// destination subtree, then copies the root + descendants + their dead
// properties. On failure it trashes anything it created and restores the
// overwritten destination rows. The handler validated depth, locks, and the
// self/descendant guard. depth='0' copies only the root (ordered is empty).
export async function copyWebDavCollection(
  deps: Pick<Deps, 'matter' | 'storages' | 's3' | 'quota' | 'storageUsage' | 'webdavPath' | 'webdavState'>,
  params: {
    orgId: string
    userId: string
    sourceMatter: Matter
    sourceRoot: string
    targetName: string
    targetParent: string
    targetResourcePath: string
    targetMatter: Matter | null
    replacingTarget: boolean
    depth: '0' | 'infinity'
  },
): Promise<CopyWebDavCollectionOutcome> {
  const { orgId, userId, sourceMatter, sourceRoot, targetMatter } = params
  const targetRoot = joinMatterPath(params.targetParent, params.targetName)
  const children = await deps.webdavPath.listChildren(orgId, sourceRoot)
  const descendants = await deps.matter.listActiveDescendants(orgId, sourceRoot)
  const ordered =
    params.depth === 'infinity' ? [...children, ...descendants].sort((a, b) => a.parent.length - b.parent.length) : []
  const preparedCopies: Array<{ item: Matter; targetParent: string; objectKey: string }> = []
  const createdIds: string[] = []
  const targetRows =
    targetMatter && targetMatter.dirtype !== DirType.FILE
      ? [
          targetMatter,
          ...(await deps.webdavPath.listChildren(orgId, params.targetResourcePath)),
          ...(await deps.matter.listActiveDescendants(orgId, params.targetResourcePath)),
        ]
      : targetMatter
        ? [targetMatter]
        : []
  const reservationInputs = ordered
    .filter((item) => item.dirtype === DirType.FILE && item.object && (item.size ?? 0) > 0)
    .map((item) => ({ orgId, storageId: item.storageId, bytes: item.size ?? 0 }))

  let missingStorage = false
  try {
    const result = await withStorageUsageReservation(deps, reservationInputs, async (ctx) => {
      for (const item of ordered) {
        const targetParent =
          item.parent === sourceRoot ? targetRoot : `${targetRoot}${item.parent.slice(sourceRoot.length)}`
        let objectKey = ''
        if (item.dirtype === DirType.FILE && item.object) {
          const storage = await deps.storages.get(item.storageId)
          if (!storage) {
            missingStorage = true
            return null
          }
          objectKey = buildObjectKey({ uid: userId, orgId, rawExt: fileExt(item.name) })
          await deps.s3.copyObject(storage, item.object, storage, objectKey)
          ctx.onRollback(() => deps.s3.deleteObject(storage, objectKey))
        }
        preparedCopies.push({ item, targetParent, objectKey })
      }

      if (targetMatter) {
        await deps.webdavState.deleteWebDavState(orgId, params.targetResourcePath)
        await deps.matter.trash(orgId, targetMatter.id, userId)
      }

      const rootCopy = await deps.matter.copy({ ...sourceMatter, name: params.targetName }, params.targetParent, '', {
        onConflict: 'fail',
        userId,
      })
      createdIds.push(rootCopy.id)
      await deps.webdavState.copyDeadProperties(orgId, sourceRoot, joinMatterPath(rootCopy.parent, rootCopy.name))

      for (const prepared of preparedCopies) {
        const copy = await deps.matter.copy(prepared.item, prepared.targetParent, prepared.objectKey, {
          onConflict: 'fail',
          userId,
        })
        createdIds.push(copy.id)
        await deps.webdavState.copyDeadProperties(
          orgId,
          joinMatterPath(prepared.item.parent, prepared.item.name),
          joinMatterPath(copy.parent, copy.name),
        )
      }

      return joinMatterPath(rootCopy.parent, rootCopy.name)
    })
    if (missingStorage) return { ok: false, reason: 'storage_not_found' }
    return { ok: true, status: params.replacingTarget ? 204 : 201, location: result as string }
  } catch (error) {
    if (createdIds.length > 0) {
      await deps.matter.trashByIds(orgId, createdIds)
      await deps.webdavState.deleteWebDavState(orgId, targetRoot)
    }
    if (targetRows.length > 0) {
      await deps.matter.restoreActiveByIds(
        orgId,
        targetRows.map((r) => r.id),
      )
    }
    throw error
  }
}

// ─── LOCK / UNLOCK ─────────────────────────────────────────────────────────────

export function conflictingLocks(
  deps: Pick<Deps, 'webdavState'>,
  params: { orgId: string; resourcePath: string },
): Promise<DavLock[]> {
  return deps.webdavState.conflictingLocks(params.orgId, params.resourcePath)
}

export function refreshWebDavLock(
  deps: Pick<Deps, 'webdavState'>,
  params: { orgId: string; resourcePath: string; token: string; timeoutSeconds: number },
): Promise<DavLock | null> {
  return deps.webdavState.refreshLock(params.orgId, params.resourcePath, params.token, params.timeoutSeconds)
}

export function removeWebDavLock(
  deps: Pick<Deps, 'webdavState'>,
  params: { orgId: string; resourcePath: string; token: string },
): Promise<boolean> {
  return deps.webdavState.removeLock(params.orgId, params.resourcePath, params.token)
}

// Lazily creates the empty file a LOCK targets when it does not yet exist (LOCK
// on an unmapped URL creates a zero-byte resource), then acquires the lock.
// Returns the lock + whether the resource was created (201 vs 200).
export async function createWebDavLock(
  deps: Pick<Deps, 'webdavState' | 'matter' | 'storages' | 's3'>,
  params: {
    orgId: string
    userId: string
    resourcePath: string
    target: WebDavTarget
    owner: string
    depth: string
    timeoutSeconds: number
  },
): Promise<{ lock: DavLock; created: boolean }> {
  const { orgId, userId, target } = params
  const created = !target.matter && Boolean(target.name)
  if (created) {
    const storage = await deps.storages.select()
    const objectKey = buildObjectKey({ uid: userId, orgId, rawExt: fileExt(target.name) })
    await deps.s3.putObject(storage, objectKey, new Uint8Array(), 'application/octet-stream')
    await deps.matter.create({
      orgId,
      userId,
      name: target.name,
      type: 'application/octet-stream',
      size: 0,
      dirtype: DirType.FILE,
      parent: target.parent,
      object: objectKey,
      storageId: storage.id,
      status: ObjectStatus.ACTIVE,
    })
  }
  const lock = await deps.webdavState.createLock({
    orgId,
    resourcePath: params.resourcePath,
    owner: params.owner,
    depth: params.depth,
    timeoutSeconds: params.timeoutSeconds,
  })
  return { lock, created }
}
