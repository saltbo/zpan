// Completing a cache download (docs/design/torrent-cache.md §6, §7): check 2,
// then piece verification (check 3) and the requester's instant transfer.

import type { CompleteTaskTorrentInput, TorrentVerifyJobRequest } from '@shared/schemas'
import { type ActorIdentity, type BackgroundJobMessage, badRequest, conflict, type DownloadTaskRecord } from '../ports'
import { completeFromCache, fillingTask, fillingTorrent } from './fill'
import { processTorrentVerify, type TorrentVerifyDeps } from './verify'

// Check 2: the uploaded files' count, paths, and sizes match the dictionary
// (padding files have no rows and are not uploaded). The torrent then verifies
// on the background job queue, and the requester gets its files now. Where no
// queue runs (background jobs disabled, as on Worker Previews), a sample of
// pieces is verified within the request instead, so the torrent never stays
// unverified.
export async function completeTaskTorrent(
  deps: TorrentVerifyDeps,
  params: { taskId: string; downloaderId: string; input: CompleteTaskTorrentInput; backgroundJobs: boolean },
  now = new Date(),
): Promise<void> {
  const task = await fillingTask(deps, params)
  const torrent = await fillingTorrent(deps, task)
  const files = await deps.torrents.listFiles(torrent.id)
  const reported = new Map(params.input.files.map((file) => [file.path, file.size]))
  const matches =
    reported.size === params.input.files.length &&
    reported.size === files.length &&
    files.every((file) => reported.get(file.path) === file.size)
  if (!matches) throw badRequest('Uploaded files do not match the torrent', 'TORRENT_STRUCTURE_MISMATCH')
  if (files.some((file) => file.uploadedAt === null)) {
    throw badRequest('Some torrent files are not uploaded yet', 'TORRENT_FILES_MISSING')
  }
  if (!(await deps.torrents.transition(torrent.id, ['downloading'], 'verifying', { now }))) {
    throw conflict('Torrent is not being downloaded', 'TORRENT_NOT_DOWNLOADING')
  }
  // The cached objects landed in the storage: count them once.
  await deps.storageUsage.reconcileStorages([torrent.storageId])
  const message = await createVerifyJob(deps, torrent.id, torrent.name, task, !params.backgroundJobs)
  if (params.backgroundJobs) await deps.jobQueue.dispatch(message)
  else await processTorrentVerify(deps, message)
  const current = (await deps.torrents.get(torrent.id)) ?? { ...torrent, status: 'verifying' as const }
  await completeFromCache(deps, task, current, now, { source: true })
}

async function createVerifyJob(
  deps: TorrentVerifyDeps,
  torrentId: string,
  torrentName: string,
  task: DownloadTaskRecord,
  sample: boolean,
): Promise<BackgroundJobMessage<TorrentVerifyJobRequest>> {
  const request: TorrentVerifyJobRequest = { type: 'torrent_verify', torrentId, ...(sample ? { sample } : {}) }
  const job = await deps.backgroundJobs.create({
    orgId: task.orgId,
    userId: task.createdByUserId,
    type: 'torrent_verify',
    targetFolder: task.targetFolder,
    targetPath: torrentName,
    metadata: request,
    cancelable: false,
    retryable: true,
  })
  const createdBy: ActorIdentity = { type: 'user', ref: task.createdByUserId, issuer: null }
  return { jobId: job.id, orgId: task.orgId, userId: task.createdByUserId, createdBy, request }
}
