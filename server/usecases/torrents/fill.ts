// Filling Torrents from downloads (docs/design/torrents.md §4, §7).
//
// A magnet task knows its infoHash at submit; a torrent_url task learns it when
// its downloader reports the info dictionary on the task. With the infoHash
// known, a ready torrent completes the task at once by instant transfer, a
// downloading or verifying one attaches the task as a 'join', and otherwise the
// reporting task becomes the torrent's 'fill' (check 1 runs on the report). A
// fill uploads through the object API like any task (./fill-upload.ts): the
// server stores its uploads under bt/<infoHash>/ and records them in
// torrent_files. Completing the task runs check 2 and queues piece verification
// (./complete.ts). A downloader that never reports a dictionary uploads ordinary
// drive files.

import { hasFeature } from '../../domain/licensing'
import {
  parseMagnetInfoHash,
  parseTorrentInfo,
  TorrentInfoError,
  toHex,
  torrentFileMime,
} from '../../domain/torrent-info'
import { torrentInfoObjectKey } from '../../domain/torrents'
import type { Deps } from '../deps'
import { badRequest, type DownloadTaskRecord, notFound, type TorrentRecord } from '../ports'
import { loadBindingState } from '../site/licensing'
import { resolveTaskEntry, TORRENT_EVICTING_MESSAGE, TORRENT_INVALID_MESSAGE } from './entries'
import { transferTorrent } from './instant-transfer'

export { TORRENT_INVALID_MESSAGE }

const TORRENT_SOURCE_TYPES = ['magnet', 'torrent_url']
const TERMINAL_STATUSES = ['completed', 'failed', 'canceled']

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
  | 'workspaceTorrents'
  | 'licenseBinding'
  | 'licenseCloudBaseUrl'
>

export function isTorrentSource(sourceType: string): boolean {
  return TORRENT_SOURCE_TYPES.includes(sourceType)
}

export function submittedInfoHash(source: { type: string; uri: string }): string | null {
  return source.type === 'magnet' ? parseMagnetInfoHash(source.uri) : null
}

export async function torrentsEnabled(deps: Pick<Deps, 'licenseBinding' | 'licenseCloudBaseUrl'>) {
  return hasFeature('torrents', await loadBindingState(deps))
}

// ─── Serving tasks from torrents on the instance ─────────────────────────────

export type TorrentServeOutcome = 'completed' | 'failed' | 'joined' | 'miss'

// A downloading torrent whose filling task stopped filling it is abandoned: the
// next download of the same infoHash takes it over instead of waiting. A source
// task that has not finished still fills it, even before its fill role is
// recorded (the report that created the torrent is still running) or while it
// runs again after losing its downloader.
export async function fillerActive(
  deps: Pick<TorrentFillDeps, 'downloadTasks'>,
  torrent: TorrentRecord,
): Promise<boolean> {
  if (!torrent.sourceTaskId) return false
  const source = await deps.downloadTasks.findRecord(torrent.sourceTaskId)
  return (
    !!source &&
    !TERMINAL_STATUSES.includes(source.status) &&
    (source.torrentId == null || source.torrentId === torrent.id)
  )
}

async function joinTorrent(deps: TorrentFillDeps, task: DownloadTaskRecord, torrent: TorrentRecord, now: Date) {
  await deps.downloadTasks.setFields(task.id, {
    status: 'queued',
    assignedDownloaderId: null,
    assignedAt: null,
    infoHash: torrent.infoHash,
    torrentId: torrent.id,
    torrentRole: 'join',
    torrentEvent: 'cache_joined',
    updatedAt: now,
  })
}

// A task a StremThru add started needs no drive files: once its torrent is on
// the instance, or downloading for someone else, its entry holds the torrent and
// the task is done (docs/design/torrents.md §4 steps 1 and 2).
async function finishListOnlyTask(
  deps: TorrentFillDeps,
  task: DownloadTaskRecord,
  torrent: TorrentRecord,
  now: Date,
): Promise<'completed'> {
  await deps.downloadTasks.setFields(task.id, {
    status: 'completed',
    assignedDownloaderId: null,
    assignedAt: null,
    infoHash: torrent.infoHash,
    torrentId: torrent.id,
    torrentRole: null,
    torrentEvent: torrent.status === 'ready' ? 'cache_hit' : 'cache_joined',
    errorCode: null,
    errorMessage: null,
    downloadCompletedAt: task.downloadCompletedAt ?? now,
    ingestCompletedAt: now,
    finishedAt: now,
    updatedAt: now,
  })
  return 'completed'
}

// Completes a task by instant transfer of a torrent into its target
// folder, or fails it with the transfer's error (such as the quota error).
export async function completeByTransfer(
  deps: TorrentFillDeps,
  task: DownloadTaskRecord,
  torrent: TorrentRecord,
  now: Date,
): Promise<'completed' | 'failed'> {
  if (task.listOnly) return finishListOnlyTask(deps, task, torrent, now)
  const outcome = await transferTorrent(deps, {
    torrentId: torrent.id,
    orgId: task.orgId,
    userId: task.createdByUserId,
    targetFolder: task.targetFolder,
    taskId: task.id,
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
    torrentEvent: 'cache_hit',
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
export async function serveTaskFromTorrents(
  deps: TorrentFillDeps,
  task: DownloadTaskRecord,
  now = new Date(),
): Promise<TorrentServeOutcome> {
  if (!task.infoHash || !isTorrentSource(task.sourceType)) return 'miss'
  const torrent = await deps.torrents.getByInfoHash(task.infoHash)
  if (!torrent || torrent.sourceTaskId === task.id) return 'miss'
  if (torrent.status === 'ready') return completeByTransfer(deps, task, torrent, now)
  if (torrent.status === 'verifying' || (torrent.status === 'downloading' && (await fillerActive(deps, torrent)))) {
    if (task.listOnly) return finishListOnlyTask(deps, task, torrent, now)
    await joinTorrent(deps, task, torrent, now)
    return 'joined'
  }
  if (torrent.status === 'invalid' && task.listOnly) {
    await failInvalid(deps, task, now)
    return 'failed'
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
    await completeByTransfer(deps, task, torrent, now)
    return
  }
  if (torrent?.status === 'invalid') {
    await failInvalid(deps, task, now)
    return
  }
  if (torrent?.status === 'downloading' && (await fillerActive(deps, torrent))) return
  await deps.downloadTasks.setFields(task.id, { torrentId: null, torrentRole: null, updatedAt: now })
}

async function failEvicting(deps: TorrentFillDeps, task: DownloadTaskRecord, now: Date): Promise<void> {
  await deps.downloadTasks.setFields(task.id, {
    status: 'failed',
    errorCode: 'TORRENT_EVICTING',
    errorMessage: TORRENT_EVICTING_MESSAGE,
    finishedAt: now,
    updatedAt: now,
  })
}

async function failInvalid(deps: TorrentFillDeps, task: DownloadTaskRecord, now: Date): Promise<void> {
  await deps.downloadTasks.setFields(task.id, {
    status: 'failed',
    errorCode: 'TORRENT_INVALID',
    errorMessage: TORRENT_INVALID_MESSAGE,
    finishedAt: now,
    updatedAt: now,
  })
}

// ─── Reporting the info dictionary ──────────────────────────────────────────

// The torrent a task is filling, while it still fills it: downloading, with the
// task as its source. Null for any other task.
export async function fillingTorrent(
  deps: Pick<TorrentFillDeps, 'torrents'>,
  task: DownloadTaskRecord,
): Promise<TorrentRecord | null> {
  if (task.torrentRole !== 'fill' || !task.torrentId) return null
  const torrent = await deps.torrents.get(task.torrentId)
  if (!torrent || torrent.sourceTaskId !== task.id || torrent.status !== 'downloading') return null
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

// The downloader reported the bencoded info dictionary of the torrent its task
// downloads. Check 1: its SHA-1 must be the task's infoHash; a torrent_url task
// learns its infoHash here. The task then fills the torrent, completes from a
// ready one, joins one in progress, or (an invalid or evicting torrent) carries
// on uploading into the drive. A completed or joined task is no longer assigned
// to the downloader, which drops its download. Without the entitlement, or for
// a source that is not a torrent, the report is ignored.
export async function reportTaskTorrentInfo(
  deps: TorrentFillDeps,
  params: { task: DownloadTaskRecord; downloaderId: string; info: string },
  now = new Date(),
): Promise<void> {
  const { task } = params
  if (!isTorrentSource(task.sourceType) || !(await torrentsEnabled(deps))) return
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
  // Reported again (a retried request): the task already fills the torrent.
  if (await fillingTorrent(deps, task)) return

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
    if (result.created) {
      await startFill(deps, task, torrent, bytes, now)
      await resolveTaskEntry(deps, task, torrent, now)
      return
    }
  }

  if (torrent.status === 'ready') {
    await resolveTaskEntry(deps, task, torrent, now)
    await completeByTransfer(deps, task, torrent, now)
    return
  }
  if (torrent.status === 'verifying' || (torrent.status === 'downloading' && (await fillerActive(deps, torrent)))) {
    if (torrent.sourceTaskId !== task.id) {
      await resolveTaskEntry(deps, task, torrent, now)
      if (task.listOnly) await finishListOnlyTask(deps, task, torrent, now)
      else await joinTorrent(deps, task, torrent, now)
      return
    }
  }
  // The download that started this torrent stopped (or this task runs again):
  // this one takes it over and uploads every entry anew, unless the sweep of
  // abandoned fills claimed it meanwhile.
  if (
    torrent.status === 'downloading' &&
    (await deps.torrents.setSource(torrent.id, { taskId: task.id, downloaderId: params.downloaderId }, now))
  ) {
    await deps.torrents.resetEntries(torrent.id)
    await startFill(deps, task, { ...torrent, sourceTaskId: task.id }, bytes, now)
    await resolveTaskEntry(deps, task, { ...torrent, sourceTaskId: task.id }, now)
    return
  }
  // Invalid or being evicted: the torrent cannot be filled. A task for the list
  // alone has nowhere else to go and fails, saying which it was; any other
  // uploads into the drive the way a downloader that reports nothing does.
  if (task.listOnly) {
    if (torrent.status !== 'invalid') await failEvicting(deps, task, now)
    else await failInvalid(deps, { ...task, infoHash }, now)
    return
  }
  await deps.downloadTasks.setFields(task.id, { infoHash, torrentId: null, torrentRole: null, updatedAt: now })
}

async function startFill(
  deps: TorrentFillDeps,
  task: DownloadTaskRecord,
  torrent: TorrentRecord,
  bytes: Uint8Array,
  now: Date,
): Promise<void> {
  const storage = await deps.storages.get(torrent.storageId)
  if (!storage) throw notFound('Torrent not found')
  // The role is recorded before the slower storage write, so the task is the
  // torrent's active filler for every report that arrives meanwhile.
  await deps.downloadTasks.setFields(task.id, {
    infoHash: torrent.infoHash,
    torrentId: torrent.id,
    torrentRole: 'fill',
    updatedAt: now,
  })
  await deps.s3.putObject(
    storage,
    torrentInfoObjectKey(torrent.infoHash),
    bytes,
    'application/x-bittorrent',
    bytes.length,
  )
}

// ─── After verification ──────────────────────────────────────────────────────

// Verification passed: the torrent is shared, and the tasks waiting for it
// complete by instant transfer.
export async function completeJoinedTasks(deps: TorrentFillDeps, torrent: TorrentRecord, now = new Date()) {
  const tasks = await deps.downloadTasks.listByTorrent(torrent.id, 'join', ['queued'])
  for (const task of tasks) await completeByTransfer(deps, task, torrent, now)
}

// Verification failed: the torrent never reaches another workspace, and the tasks
// waiting for it fail with a clear error.
export async function failJoinedTasks(deps: TorrentFillDeps, torrent: TorrentRecord, now = new Date()) {
  const tasks = await deps.downloadTasks.listByTorrent(torrent.id, 'join', ['queued'])
  for (const task of tasks) await failInvalid(deps, task, now)
}
