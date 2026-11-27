// Filling the torrent cache from downloads (docs/design/torrent-cache.md §6, §7).
//
// A magnet task knows its infoHash at submit; a torrent_url task learns it when
// its downloader registers the info dictionary. With the infoHash known, a ready
// torrent completes the task at once by instant transfer, a downloading or
// verifying one attaches the task as a 'join', and otherwise a downloader that
// reports the `torrent-cache` capability downloads it into the cache as a 'fill':
// it registers the info dictionary (check 1), uploads every file to
// bt/<infoHash>/<fileIdx> through presigned uploads, and completes the torrent
// (check 2). When the download was scraped, its sidecars and upload layout go up
// before completion (layout.ts). Completion moves the torrent to verifying, queues torrent_verify
// (check 3), and gives the requester its files by instant transfer.

import type { CompleteTorrentFileUploadInput, TaskTorrentRegistration, TorrentFileUpload } from '@shared/schemas'
import { hasFeature } from '../../domain/licensing'
import { torrentInfoObjectKey } from '../../domain/torrent-cache'
import {
  parseMagnetInfoHash,
  parseTorrentInfo,
  TorrentInfoError,
  toHex,
  torrentFileMime,
} from '../../domain/torrent-info'
import type { Deps } from '../deps'
import { badRequest, conflict, type DownloadTaskRecord, forbidden, notFound, type TorrentRecord } from '../ports'
import { loadBindingState } from '../site/licensing'
import { transferTorrent } from './instant-transfer'
import { clearTorrentExtras } from './layout'

export const TORRENT_CACHE_CAPABILITY = 'torrent-cache'
export const TORRENT_CACHE_INVALID_MESSAGE = 'The cached download failed verification'

const TORRENT_SOURCE_TYPES = ['magnet', 'torrent_url']
const TERMINAL_STATUSES = ['completed', 'failed', 'canceled']
const FILL_UPLOAD_STATUSES = ['assigned', 'downloading', 'uploading']
const SINGLE_UPLOAD_MAX_BYTES = 64 * 1024 * 1024
const MULTIPART_PART_SIZE_BYTES = 64 * 1024 * 1024
const MAX_UPLOAD_PARTS = 10_000
const UPLOAD_URL_TTL_SECONDS = 6 * 60 * 60

export type TorrentFillDeps = Pick<
  Deps,
  | 'torrents'
  | 'matter'
  | 'quota'
  | 'storageUsage'
  | 'storages'
  | 's3'
  | 'backgroundJobs'
  | 'jobQueue'
  | 'downloadTasks'
  | 'licenseBinding'
  | 'licenseCloudBaseUrl'
>

export function isTorrentSource(sourceType: string): boolean {
  return TORRENT_SOURCE_TYPES.includes(sourceType)
}

export function submittedInfoHash(source: { type: string; uri: string }): string | null {
  return source.type === 'magnet' ? parseMagnetInfoHash(source.uri) : null
}

export async function torrentCacheEnabled(deps: Pick<Deps, 'licenseBinding' | 'licenseCloudBaseUrl'>) {
  return hasFeature('torrent_cache', await loadBindingState(deps))
}

// ─── Serving tasks from the cache ────────────────────────────────────────────

export type CacheServeOutcome = 'completed' | 'failed' | 'joined' | 'miss'

// A downloading torrent whose filling task stopped filling it is abandoned: the
// next download of the same infoHash takes it over instead of waiting.
async function fillerActive(deps: TorrentFillDeps, torrent: TorrentRecord): Promise<boolean> {
  if (!torrent.sourceTaskId) return false
  const source = await deps.downloadTasks.findRecord(torrent.sourceTaskId)
  return (
    !!source &&
    source.torrentId === torrent.id &&
    source.torrentCacheRole === 'fill' &&
    !TERMINAL_STATUSES.includes(source.status)
  )
}

async function joinTorrent(deps: TorrentFillDeps, task: DownloadTaskRecord, torrent: TorrentRecord, now: Date) {
  await deps.downloadTasks.setFields(task.id, {
    status: 'queued',
    assignedDownloaderId: null,
    assignedAt: null,
    infoHash: torrent.infoHash,
    torrentId: torrent.id,
    torrentCacheRole: 'join',
    torrentCacheEvent: 'cache_joined',
    updatedAt: now,
  })
}

// Completes a task by instant transfer of a cached torrent into its target
// folder, or fails it with the transfer's error (such as the quota error).
export async function completeFromCache(
  deps: TorrentFillDeps,
  task: DownloadTaskRecord,
  torrent: TorrentRecord,
  now: Date,
  options: { source?: boolean } = {},
): Promise<'completed' | 'failed'> {
  const outcome = await transferTorrent(deps, {
    torrentId: torrent.id,
    orgId: task.orgId,
    userId: task.createdByUserId,
    targetFolder: task.targetFolder,
    taskId: task.id,
    sourceTaskId: options.source ? task.id : undefined,
    now,
  })
  if (!outcome.ok) {
    await deps.downloadTasks.setFields(task.id, {
      status: 'failed',
      infoHash: torrent.infoHash,
      torrentId: torrent.id,
      errorCode: outcome.error.meta.reason ?? 'TORRENT_TRANSFER_FAILED',
      errorMessage: outcome.error.message,
      finishedAt: now,
      updatedAt: now,
    })
    return 'failed'
  }
  await deps.downloadTasks.setFields(task.id, {
    status: 'completed',
    infoHash: torrent.infoHash,
    torrentId: torrent.id,
    ...(options.source ? {} : { torrentCacheEvent: 'cache_hit' as const }),
    errorCode: null,
    errorMessage: null,
    downloadCompletedAt: task.downloadCompletedAt ?? now,
    ingestCompletedAt: now,
    finishedAt: now,
    updatedAt: now,
  })
  return 'completed'
}

// At submit and before assignment: completes the task from a ready torrent, or
// joins it to one in progress. 'miss' leaves the task to be downloaded.
export async function serveTaskFromCache(
  deps: TorrentFillDeps,
  task: DownloadTaskRecord,
  now = new Date(),
): Promise<CacheServeOutcome> {
  if (!task.infoHash || !isTorrentSource(task.sourceType)) return 'miss'
  const torrent = await deps.torrents.getByInfoHash(task.infoHash)
  if (!torrent || torrent.sourceTaskId === task.id) return 'miss'
  if (torrent.status === 'ready') return completeFromCache(deps, task, torrent, now)
  if (torrent.status === 'verifying' || (torrent.status === 'downloading' && (await fillerActive(deps, torrent)))) {
    await joinTorrent(deps, task, torrent, now)
    return 'joined'
  }
  return 'miss'
}

// Joined tasks whose torrent settled: ready completes them, invalid fails them,
// and anything else (evicted, abandoned) releases them to download on their own.
export async function settleJoinedTasks(deps: TorrentFillDeps, now = new Date(), limit = 20): Promise<void> {
  const tasks = await deps.downloadTasks.listSettledJoins(limit)
  for (const task of tasks) await settleJoinedTask(deps, task, now)
}

async function settleJoinedTask(deps: TorrentFillDeps, task: DownloadTaskRecord, now: Date): Promise<void> {
  const torrent = task.torrentId ? await deps.torrents.get(task.torrentId) : null
  if (torrent?.status === 'ready') {
    await completeFromCache(deps, task, torrent, now)
    return
  }
  if (torrent?.status === 'invalid') {
    await failInvalid(deps, task, now)
    return
  }
  if (torrent?.status === 'downloading' && (await fillerActive(deps, torrent))) return
  await deps.downloadTasks.setFields(task.id, { torrentId: null, torrentCacheRole: null, updatedAt: now })
}

async function failInvalid(deps: TorrentFillDeps, task: DownloadTaskRecord, now: Date): Promise<void> {
  await deps.downloadTasks.setFields(task.id, {
    status: 'failed',
    errorCode: 'TORRENT_CACHE_INVALID',
    errorMessage: TORRENT_CACHE_INVALID_MESSAGE,
    finishedAt: now,
    updatedAt: now,
  })
}

// ─── Cache upload API ────────────────────────────────────────────────────────

export async function fillingTask(
  deps: TorrentFillDeps,
  params: { taskId: string; downloaderId: string },
): Promise<DownloadTaskRecord> {
  const task = await deps.downloadTasks.findRecord(params.taskId)
  if (!task || task.assignedDownloaderId !== params.downloaderId) throw forbidden()
  if (task.torrentCacheRole !== 'fill' || !FILL_UPLOAD_STATUSES.includes(task.status)) {
    throw conflict('Task is not filling the torrent cache', 'TORRENT_CACHE_NOT_FILLING')
  }
  return task
}

export async function fillingTorrent(deps: TorrentFillDeps, task: DownloadTaskRecord): Promise<TorrentRecord> {
  const torrent = task.torrentId ? await deps.torrents.get(task.torrentId) : null
  if (!torrent || torrent.sourceTaskId !== task.id || torrent.status !== 'downloading') {
    throw conflict('Torrent is not being downloaded', 'TORRENT_NOT_DOWNLOADING')
  }
  return torrent
}

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  try {
    return Uint8Array.from(atob(value), (char) => char.charCodeAt(0))
  } catch {
    throw badRequest('Torrent metadata is invalid', 'TORRENT_INFO_INVALID')
  }
}

async function sha1Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-1', bytes)))
}

function registration(
  outcome: TaskTorrentRegistration['outcome'],
  infoHash: string,
  info: ReturnType<typeof parseTorrentInfo>,
): TaskTorrentRegistration {
  return {
    outcome,
    infoHash,
    name: info.name,
    files: info.files
      .filter((file) => !file.padding)
      .map((file) => ({ fileIdx: file.fileIdx, path: file.path, size: file.size })),
  }
}

// Check 1: the info dictionary's SHA-1 must be the task's infoHash. A magnet
// task carries it from submit; a torrent_url task learns it here.
export async function registerTaskTorrent(
  deps: TorrentFillDeps,
  params: { taskId: string; downloaderId: string; info: string },
  now = new Date(),
): Promise<TaskTorrentRegistration> {
  const task = await fillingTask(deps, params)
  const bytes = decodeBase64(params.info)
  const infoHash = await sha1Hex(bytes)
  if (task.infoHash && task.infoHash !== infoHash) {
    throw badRequest('Torrent metadata does not match the infoHash', 'TORRENT_INFO_MISMATCH')
  }
  let info: ReturnType<typeof parseTorrentInfo>
  try {
    info = parseTorrentInfo(bytes)
  } catch (error) {
    if (error instanceof TorrentInfoError) throw badRequest('Torrent metadata is invalid', 'TORRENT_INFO_INVALID')
    throw error
  }

  let torrent = await deps.torrents.getByInfoHash(infoHash)
  if (!torrent) {
    const storage = await deps.storages.select()
    const result = await deps.torrents.createIfAbsent({
      infoHash,
      storageId: storage.id,
      name: info.name,
      private: info.private,
      status: 'downloading',
      sourceTaskId: task.id,
      sourceDownloaderId: params.downloaderId,
      files: info.files
        .filter((file) => !file.padding)
        .map((file) => ({ fileIdx: file.fileIdx, path: file.path, size: file.size, mime: torrentFileMime(file.path) })),
      now,
    })
    torrent = result.torrent
    if (result.created) return startFill(deps, task, torrent, bytes, info, now)
  }

  if (torrent.status === 'downloading' && torrent.sourceTaskId === task.id) {
    await deps.torrents.setSource(torrent.id, { taskId: task.id, downloaderId: params.downloaderId }, now)
    return startFill(deps, task, torrent, bytes, info, now)
  }
  if (torrent.status === 'ready') {
    await completeFromCache(deps, task, torrent, now)
    return registration('completed', infoHash, info)
  }
  if (torrent.status === 'verifying' || (torrent.status === 'downloading' && (await fillerActive(deps, torrent)))) {
    await joinTorrent(deps, task, torrent, now)
    return registration('joined', infoHash, info)
  }
  if (torrent.status === 'downloading') {
    // The download that started this torrent stopped; this one takes it over
    // and lays it out itself. The clear comes first: if it fails, the torrent
    // still names the stopped download, so the retry takes over and clears again
    // instead of continuing as this task's own fill over the old layout.
    await clearTorrentExtras(deps, torrent)
    await deps.torrents.setSource(torrent.id, { taskId: task.id, downloaderId: params.downloaderId }, now)
    return startFill(deps, task, torrent, bytes, info, now)
  }
  // Invalid or being evicted: the cache cannot take it, so the task uploads into
  // the drive the way a downloader without the capability does.
  await deps.downloadTasks.setFields(task.id, { infoHash, torrentId: null, torrentCacheRole: null, updatedAt: now })
  return registration('drive', infoHash, info)
}

async function startFill(
  deps: TorrentFillDeps,
  task: DownloadTaskRecord,
  torrent: TorrentRecord,
  bytes: Uint8Array,
  info: ReturnType<typeof parseTorrentInfo>,
  now: Date,
): Promise<TaskTorrentRegistration> {
  const storage = await deps.storages.get(torrent.storageId)
  if (!storage) throw notFound('Torrent not found')
  await deps.s3.putObject(
    storage,
    torrentInfoObjectKey(torrent.infoHash),
    bytes,
    'application/x-bittorrent',
    bytes.length,
  )
  await deps.downloadTasks.setFields(task.id, { infoHash: torrent.infoHash, torrentId: torrent.id, updatedAt: now })
  return registration('fill', torrent.infoHash, info)
}

async function fillTarget(deps: TorrentFillDeps, params: { taskId: string; downloaderId: string; fileIdx: number }) {
  const task = await fillingTask(deps, params)
  const torrent = await fillingTorrent(deps, task)
  const file = (await deps.torrents.listFiles(torrent.id)).find((item) => item.fileIdx === params.fileIdx)
  if (!file) throw notFound('Torrent file not found')
  const storage = await deps.storages.get(torrent.storageId)
  if (!storage) throw notFound('Torrent not found')
  return { task, torrent, file, storage }
}

export async function createTorrentFileUpload(
  deps: TorrentFillDeps,
  params: { taskId: string; downloaderId: string; fileIdx: number },
): Promise<TorrentFileUpload> {
  const { file, storage } = await fillTarget(deps, params)
  const expiresAt = new Date(Date.now() + UPLOAD_URL_TTL_SECONDS * 1000).toISOString()
  if (file.size <= SINGLE_UPLOAD_MAX_BYTES) {
    const url = await deps.s3.presignUpload(storage, file.objectKey, undefined, UPLOAD_URL_TTL_SECONDS)
    return {
      uploadId: null,
      partSize: file.size,
      expiresAt,
      parts: [{ partNumber: 1, url, offset: 0, length: file.size }],
    }
  }
  const partSize = Math.max(MULTIPART_PART_SIZE_BYTES, Math.ceil(file.size / MAX_UPLOAD_PARTS))
  const partCount = Math.ceil(file.size / partSize)
  const uploadId = await deps.s3.createMultipartUpload(storage, file.objectKey, file.mime || undefined)
  const parts = await Promise.all(
    Array.from({ length: partCount }, async (_, i) => ({
      partNumber: i + 1,
      url: await deps.s3.presignUploadPart(storage, file.objectKey, uploadId, i + 1, UPLOAD_URL_TTL_SECONDS),
      offset: i * partSize,
      length: Math.min(partSize, file.size - i * partSize),
    })),
  )
  return { uploadId, partSize, expiresAt, parts }
}

export async function completeTorrentFileUpload(
  deps: TorrentFillDeps,
  params: { taskId: string; downloaderId: string; fileIdx: number; input: CompleteTorrentFileUploadInput },
  now = new Date(),
): Promise<{ fileIdx: number; size: number }> {
  const { torrent, file, storage } = await fillTarget(deps, params)
  const { uploadId, parts } = params.input
  if (uploadId) {
    if (!parts?.length) throw badRequest('Uploaded file size does not match the torrent', 'TORRENT_FILE_PARTS_MISSING')
    await deps.s3.completeMultipartUpload(storage, file.objectKey, uploadId, parts)
  }
  const head = await deps.s3.headObject(storage, file.objectKey).catch(() => null)
  if (!head || head.size !== file.size) {
    throw badRequest('Uploaded file size does not match the torrent', 'TORRENT_FILE_SIZE_MISMATCH')
  }
  await deps.torrents.markFileUploaded(torrent.id, file.fileIdx, now)
  return { fileIdx: file.fileIdx, size: file.size }
}

// ─── After verification ──────────────────────────────────────────────────────

// Verification passed: the torrent is shared, and the tasks waiting for it
// complete by instant transfer.
export async function completeJoinedTasks(deps: TorrentFillDeps, torrent: TorrentRecord, now = new Date()) {
  const tasks = await deps.downloadTasks.listByTorrent(torrent.id, 'join', ['queued'])
  for (const task of tasks) await completeFromCache(deps, task, torrent, now)
}

// Verification failed: the torrent never reaches another workspace, and the tasks
// waiting for it fail with a clear error.
export async function failJoinedTasks(deps: TorrentFillDeps, torrent: TorrentRecord, now = new Date()) {
  const tasks = await deps.downloadTasks.listByTorrent(torrent.id, 'join', ['queued'])
  for (const task of tasks) await failInvalid(deps, task, now)
}
