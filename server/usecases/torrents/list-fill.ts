// A StremThru add that has to download its torrent runs a fill task that lands
// only in the workspace's Torrents list (docs/design/torrents.md §4): its uploads
// go to bt/ and torrent_files, and no drive rows are written. The downloader is
// unchanged, so under that task's upload token the object API serves the
// torrent's own layout: the ids it returns name torrent_files entries, folder
// lookups and conflicts read the entries' layout paths, and media writes land
// on the entries. The task folder of such a task is the workspace root, so a
// layout path is the drive path the downloader asks for.

import { DirType } from '@shared/constants'
import type { CompleteObjectUploadInput, ConflictStrategy, MediaMetadata } from '@shared/schemas'
import type { ObjectUploadInstructions } from '@shared/types'
import { generateId } from '../../../shared/ids'
import { torrentFileMime } from '../../domain/torrent-info'
import { normalizeTorrentFolder, torrentEntryObjectKey } from '../../domain/torrents'
import type { Deps } from '../deps'
import { assertTaskUploadAllowed } from '../downloads/task-upload-guard'
import { MAX_OBJECT_BYTES, prepareUpload, uploadPartCount, validateCompletionParts } from '../object'
import {
  badRequest,
  conflict,
  type DownloadTaskRecord,
  forbidden,
  type Matter,
  type MatterListItem,
  NameConflictError,
  notFound,
  ObjectUploadSessionError,
  type StorageRecord,
  type TorrentEntryRecord,
  type TorrentRecord,
} from '../ports'
import { fillingTorrent } from './fill'
import { markFillObjectUploaded } from './fill-upload'

export type ListFillDeps = Pick<Deps, 'torrents' | 'downloadTasks' | 'storages' | 's3' | 'objectUploadSessions'>

export interface ListFillActor {
  taskId: string
  downloaderId: string
}

export interface ListFill {
  task: DownloadTaskRecord
  torrent: TorrentRecord
  storage: StorageRecord
}

// The list-only fill the upload token acts for, or null when its task writes
// into the drive. A list-only task that fills no torrent (a downloader that
// never reported the info dictionary) has nowhere to put its uploads.
export async function listFillFor(deps: ListFillDeps, actor: ListFillActor): Promise<ListFill | null> {
  // Any other task's token goes through the drive's own checks.
  if (!(await deps.downloadTasks.findRecord(actor.taskId))?.listOnly) return null
  const task = await assertTaskUploadAllowed(deps, actor)
  const torrent = await fillingTorrent(deps, task)
  if (!torrent) throw conflict('The task is not filling a torrent', 'TORRENT_NOT_FILLING')
  const storage = await deps.storages.get(torrent.storageId)
  if (!storage) throw notFound('Torrent not found')
  return { task, torrent, storage }
}

function joinPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name
}

function parentOf(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash < 0 ? '' : path.slice(0, slash)
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

// A folder always exists; a file or sidecar exists once its upload landed.
function isLive(entry: TorrentEntryRecord): boolean {
  return entry.kind === 'folder' || entry.uploadedAt !== null
}

// The entry as the object API shows it.
export function entryAsMatter(entry: TorrentEntryRecord, fill: ListFill): MatterListItem {
  const folder = entry.kind === 'folder'
  const now = fill.task.updatedAt
  return {
    id: entry.id,
    orgId: fill.task.orgId,
    alias: entry.id,
    name: baseName(entry.layoutPath),
    type: folder ? 'folder' : entry.mime,
    size: folder ? 0 : entry.size,
    dirtype: folder ? DirType.USER_FOLDER : DirType.FILE,
    parent: parentOf(entry.layoutPath),
    object: entry.objectKey ?? '',
    storageId: entry.storageId,
    status: isLive(entry) ? 'active' : 'draft',
    trashedAt: null,
    purgedAt: null,
    createdByActorType: 'device',
    createdByActorRef: fill.task.assignedDownloaderId,
    createdByActorIssuer: null,
    createdByTaskId: fill.task.id,
    metadata: entry.media ? { media: entry.media as MediaMetadata } : null,
    createdAt: fill.task.createdAt,
    updatedAt: now,
    hasChildren: false,
  }
}

async function liveEntries(deps: ListFillDeps, fill: ListFill): Promise<TorrentEntryRecord[]> {
  return (await deps.torrents.listEntries(fill.torrent.id)).filter(isLive)
}

function atPath(entries: readonly TorrentEntryRecord[], path: string): TorrentEntryRecord | undefined {
  const key = path.toLowerCase()
  return entries.find((entry) => entry.layoutPath.toLowerCase() === key)
}

// ─── List ────────────────────────────────────────────────────────────────────

// The live entries in a folder of the layout, or the one named `name`
// (compared case-insensitively, as the drive does).
export async function listFillEntries(
  deps: ListFillDeps,
  fill: ListFill,
  params: { parent: string; name?: string; pageSize: number },
): Promise<MatterListItem[]> {
  const parent = normalizeTorrentFolder(params.parent)
  const entries = await liveEntries(deps, fill)
  if (params.name !== undefined) {
    const found = atPath(entries, joinPath(parent, params.name))
    return found ? [entryAsMatter(found, fill)] : []
  }
  return entries
    .filter((entry) => parentOf(entry.layoutPath).toLowerCase() === parent.toLowerCase())
    .slice(0, params.pageSize)
    .map((entry) => entryAsMatter(entry, fill))
}

// ─── Create ──────────────────────────────────────────────────────────────────

// `name (1).ext`, `name (2).ext`, … the first one free in the folder.
function freeName(entries: readonly TorrentEntryRecord[], parent: string, name: string): string {
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  for (let n = 1; ; n++) {
    const candidate = `${stem} (${n})${ext}`
    if (!atPath(entries, joinPath(parent, candidate))) return candidate
  }
}

// A folder of the layout. Every folder in the layout is this torrent's, so one
// already there (a retried request) is returned as it is; a file at the name
// conflicts.
export async function createFillFolder(
  deps: ListFillDeps,
  fill: ListFill,
  params: { parent: string; name: string },
): Promise<Matter> {
  const path = joinPath(normalizeTorrentFolder(params.parent), params.name)
  const existing = atPath(await liveEntries(deps, fill), path)
  if (existing) {
    if (existing.kind !== 'folder') throw new NameConflictError(params.name, existing.id)
    return entryAsMatter(existing, fill)
  }
  const entry = await deps.torrents.insertEntry({
    id: generateId(),
    torrentId: fill.torrent.id,
    kind: 'folder',
    layoutPath: path,
    size: 0,
    mime: '',
    storageId: fill.torrent.storageId,
    objectKey: null,
  })
  return entryAsMatter(entry, fill)
}

// A file of the layout: a file of the torrent when created with its
// `torrentPath`, a sidecar otherwise. Its bytes go to its bt/ object through an
// ordinary upload session whose object id is the entry id.
export async function createFillFile(
  deps: ListFillDeps,
  fill: ListFill,
  params: {
    parent: string
    name: string
    size: number
    torrentPath?: string
    onConflict: ConflictStrategy
    actorId: string
  },
): Promise<{ matter: Matter; upload: ObjectUploadInstructions }> {
  if (params.size > MAX_OBJECT_BYTES) throw badRequest('File exceeds the 5 TiB maximum', 'FILE_TOO_LARGE')
  const parent = normalizeTorrentFolder(params.parent)
  const entries = await liveEntries(deps, fill)
  let name = params.name
  const taken = atPath(entries, joinPath(parent, name))
  if (taken) {
    if (params.onConflict === 'rename') name = freeName(entries, parent, name)
    else if (params.onConflict === 'replace' && taken.kind === 'sidecar') await deps.torrents.deleteEntry(taken.id)
    else throw new NameConflictError(name, taken.id)
  }
  const layoutPath = joinPath(parent, name)

  let entry: TorrentEntryRecord
  if (params.torrentPath !== undefined) {
    const file = (await deps.torrents.listFiles(fill.torrent.id)).find((item) => item.path === params.torrentPath)
    if (!file) throw badRequest('Torrent file not found', 'TORRENT_FILE_NOT_FOUND')
    if (file.size !== params.size) {
      throw badRequest('Uploaded file size does not match the torrent', 'TORRENT_FILE_SIZE_MISMATCH')
    }
    if (file.uploadedAt !== null) throw conflict('Torrent file is already uploaded', 'TORRENT_FILE_UPLOADED')
    // No drive file can end up under two names here, so a repeated create just
    // moves the file to where it was created last.
    await deps.torrents.updateEntry(file.id, { layoutPath })
    entry = { ...file, layoutPath }
  } else {
    const id = generateId()
    entry = await deps.torrents.insertEntry({
      id,
      torrentId: fill.torrent.id,
      kind: 'sidecar',
      layoutPath,
      size: params.size,
      mime: torrentFileMime(name),
      storageId: fill.torrent.storageId,
      objectKey: torrentEntryObjectKey(fill.torrent.infoHash, id),
    })
  }

  const upload = await prepareUpload(deps, {
    orgId: fill.task.orgId,
    objectId: entry.id,
    storage: fill.storage,
    storageKey: entry.objectKey as string,
    // Unsigned, so a re-presigned part needs no type either.
    contentType: undefined,
    size: params.size,
    onConflict: 'fail',
    actorId: params.actorId,
  })
  return { matter: entryAsMatter(entry, fill), upload }
}

// ─── Upload sessions ─────────────────────────────────────────────────────────

async function sessionEntry(deps: ListFillDeps, fill: ListFill, objectId: string, sessionId: string) {
  const entry = (await deps.torrents.listEntries(fill.torrent.id)).find((item) => item.id === objectId)
  if (!entry?.objectKey) throw forbidden()
  const session = await deps.objectUploadSessions.get(fill.task.orgId, objectId, sessionId)
  if (!session || session.storageKey !== entry.objectKey) throw new ObjectUploadSessionError('not_found')
  return { entry, session }
}

const PRESIGN_TTL_SECONDS = 15 * 60

export async function presignFillParts(
  deps: ListFillDeps,
  fill: ListFill,
  params: { objectId: string; sessionId: string; partNumbers: number[] },
) {
  const { entry, session } = await sessionEntry(deps, fill, params.objectId, params.sessionId)
  if (session.status !== 'active' || session.expiresAt.getTime() <= Date.now()) {
    throw new ObjectUploadSessionError('invalid_state')
  }
  const partCount = uploadPartCount(entry.size, session.partSize)
  if (new Set(params.partNumbers).size !== params.partNumbers.length) {
    throw new ObjectUploadSessionError('invalid_state', 'Duplicate part numbers are not allowed')
  }
  if (params.partNumbers.some((n) => n < 1 || n > partCount)) {
    throw new ObjectUploadSessionError('invalid_state', 'Part number is outside this upload session')
  }
  const presignedExpiresAt = new Date(Date.now() + PRESIGN_TTL_SECONDS * 1000).toISOString()
  const key = session.storageKey
  const uploadId = session.uploadId
  const parts = await Promise.all(
    params.partNumbers.map(async (partNumber) => ({
      partNumber,
      url:
        uploadId == null
          ? await deps.s3.presignUpload(fill.storage, key, undefined, PRESIGN_TTL_SECONDS)
          : await deps.s3.presignUploadPart(fill.storage, key, uploadId, partNumber, PRESIGN_TTL_SECONDS),
      expiresAt: presignedExpiresAt,
      headers: {},
      offset: uploadId == null ? 0 : (partNumber - 1) * session.partSize,
      length:
        uploadId == null ? entry.size : Math.min(session.partSize, entry.size - (partNumber - 1) * session.partSize),
    })),
  )
  return {
    uploadId,
    mode: uploadId == null ? ('single' as const) : ('multipart' as const),
    partSize: session.partSize,
    partCount,
    presignedExpiresAt,
    requiredHeaders: {},
    parts,
  }
}

// The bytes landed: the entry is uploaded. A file of the torrent counts only at
// the size the info dictionary gives it, so check 2 catches a short upload.
export async function completeFillUpload(
  deps: ListFillDeps,
  fill: ListFill,
  params: { objectId: string; sessionId: string; parts: CompleteObjectUploadInput['parts'] },
): Promise<Matter> {
  const { entry, session } = await sessionEntry(deps, fill, params.objectId, params.sessionId)
  const retrying = session.status === 'completed'
  if (retrying && entry.uploadedAt !== null) return entryAsMatter(entry, fill)
  if ((session.status !== 'active' && !retrying) || session.expiresAt.getTime() <= Date.now()) {
    throw new ObjectUploadSessionError('invalid_state')
  }
  const parts = validateCompletionParts(params.parts, uploadPartCount(entry.size, session.partSize))
  if (session.uploadId != null && !retrying) {
    try {
      await deps.s3.completeMultipartUpload(fill.storage, session.storageKey, session.uploadId, parts)
    } catch (error) {
      throw new ObjectUploadSessionError(
        'storage_failure',
        `Storage multipart upload complete failed: ${(error as Error).message}`,
      )
    }
  }
  let head: { size: number; etag: string }
  try {
    head = await deps.s3.headObject(fill.storage, session.storageKey)
  } catch (error) {
    throw new ObjectUploadSessionError(
      'invalid_state',
      `Uploaded object not found: ${(error as Error).message}`,
      'object_not_found',
    )
  }
  if (session.uploadId == null && parts[0]?.etag !== head.etag) {
    throw new ObjectUploadSessionError('invalid_state', 'Uploaded object ETag does not match', 'etag_mismatch')
  }
  await deps.objectUploadSessions.setStatus(session.id, 'completed')
  const now = new Date()
  await markFillObjectUploaded(
    deps,
    { storageId: fill.storage.id, objectKey: session.storageKey, size: head.size },
    now,
  )
  const after = (await deps.torrents.listEntries(fill.torrent.id)).find((item) => item.id === entry.id) ?? entry
  return entryAsMatter(after, fill)
}

export async function abortFillUpload(
  deps: ListFillDeps,
  fill: ListFill,
  params: { objectId: string; sessionId: string },
): Promise<void> {
  const { entry, session } = await sessionEntry(deps, fill, params.objectId, params.sessionId)
  if (session.status === 'aborted') return
  if (session.status === 'completed' && entry.uploadedAt !== null) {
    throw new ObjectUploadSessionError('invalid_state', 'Upload already completed')
  }
  try {
    if (session.uploadId != null && session.status === 'active') {
      await deps.s3.abortMultipartUpload(fill.storage, session.storageKey, session.uploadId)
    }
  } catch (error) {
    throw new ObjectUploadSessionError(
      'storage_failure',
      `Storage multipart upload abort failed: ${(error as Error).message}`,
    )
  }
  await deps.objectUploadSessions.setStatus(session.id, 'aborted')
  // Bytes already under bt/ are left to eviction.
  if (entry.kind === 'sidecar') await deps.torrents.deleteEntry(entry.id)
}

// The downloader's cleanup after a failed upload: a sidecar goes, and a file of
// the torrent is no longer uploaded, so the fill cannot complete without it.
export async function deleteFillEntry(deps: ListFillDeps, fill: ListFill, objectId: string): Promise<void> {
  const entry = (await deps.torrents.listEntries(fill.torrent.id)).find((item) => item.id === objectId)
  if (!entry) throw notFound()
  if (entry.kind === 'folder') return
  if (entry.kind === 'sidecar') await deps.torrents.deleteEntry(entry.id)
  else await deps.torrents.updateEntry(entry.id, { uploadedAt: null })
}

const MEDIA_IMAGE_FIELDS = ['poster', 'fanart', 'still'] as const

// The `media` the downloader writes on an entry. Images name entries already, so
// one that is not an uploaded sidecar of this torrent is left out.
export async function setFillMedia(
  deps: ListFillDeps,
  fill: ListFill,
  params: { objectId: string; media: MediaMetadata },
): Promise<void> {
  const entries = await deps.torrents.listEntries(fill.torrent.id)
  const entry = entries.find((item) => item.id === params.objectId)
  if (!entry || !isLive(entry)) throw notFound()
  if ((params.media.kind === 'tvshow') !== (entry.kind === 'folder')) {
    throw badRequest(
      params.media.kind === 'tvshow' ? 'Show media belongs on a folder' : 'Video media belongs on a file',
    )
  }
  const sidecars = new Set(
    entries.filter((item) => item.kind === 'sidecar' && item.uploadedAt !== null).map((item) => item.id),
  )
  const recorded: Record<string, unknown> = { ...params.media }
  for (const field of MEDIA_IMAGE_FIELDS) {
    const ref = recorded[field]
    if (typeof ref === 'string' && !sidecars.has(ref)) delete recorded[field]
  }
  await deps.torrents.updateEntry(entry.id, { media: recorded })
}
