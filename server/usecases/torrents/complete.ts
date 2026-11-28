// Completing a fill task (docs/design/torrents.md §7): check 2, then piece
// verification (check 3). The task's drive files are the ones it uploaded, so
// the requester needs no transfer; later holders replay its entries by layout
// path once the torrent is verified.

import type { TorrentVerifyJobRequest } from '@shared/schemas'
import type { ActorIdentity, BackgroundJobMessage, DownloadTaskRecord, TorrentRecord } from '../ports'
import { failJoinedTasks, fillingTorrent } from './fill'
import { purgeStreamChunks } from './stream'
import { processTorrentVerify, type TorrentVerifyDeps } from './verify'

// The fill task completed its upload. Sidecars whose upload never completed
// are dropped, and check 2 requires every file of the torrent to have landed at
// its size (padding files have no rows and are not uploaded). A torrent that
// fails it is invalid and never reaches another workspace, while the task
// still completes with the drive files it uploaded. Otherwise the torrent
// verifies on the background job queue; where no queue runs (background jobs
// disabled, as on Worker Previews), a sample of pieces is verified within the
// request instead, so the torrent never stays unverified.
export async function completeFillTask(
  deps: TorrentVerifyDeps,
  params: { task: DownloadTaskRecord; backgroundJobs: boolean },
  now = new Date(),
): Promise<void> {
  const { task } = params
  const torrent = await fillingTorrent(deps, task)
  if (!torrent) return
  await deps.torrents.deleteIncompleteSidecars(torrent.id)
  const files = await deps.torrents.listFiles(torrent.id)
  const complete = files.length === torrent.fileCount && files.every((file) => file.uploadedAt !== null)
  if (!complete) {
    if (await deps.torrents.transition(torrent.id, ['downloading'], 'invalid', { now })) {
      await failJoinedTasks(deps, { ...torrent, status: 'invalid' }, now)
      await purgeStreamChunks(deps, torrent)
    }
    await deps.storageUsage.reconcileStorages([torrent.storageId])
    return
  }
  if (!(await deps.torrents.transition(torrent.id, ['downloading'], 'verifying', { now }))) return
  try {
    // The torrent's objects landed in the storage: count them once.
    await deps.storageUsage.reconcileStorages([torrent.storageId])
    const message = await createVerifyJob(deps, torrent, task, !params.backgroundJobs)
    if (params.backgroundJobs) await deps.jobQueue.dispatch(message)
    else await processTorrentVerify(deps, message)
  } catch (error) {
    // Verification never started: back to downloading, so the retried
    // completion starts it again instead of leaving joiners waiting.
    await deps.torrents.transition(torrent.id, ['verifying'], 'downloading', { now })
    throw error
  }
}

async function createVerifyJob(
  deps: TorrentVerifyDeps,
  torrent: TorrentRecord,
  task: DownloadTaskRecord,
  sample: boolean,
): Promise<BackgroundJobMessage<TorrentVerifyJobRequest>> {
  const request: TorrentVerifyJobRequest = {
    type: 'torrent_verify',
    torrentId: torrent.id,
    ...(sample ? { sample } : {}),
  }
  const job = await deps.backgroundJobs.create({
    orgId: task.orgId,
    userId: task.createdByUserId,
    type: 'torrent_verify',
    targetFolder: task.targetFolder,
    targetPath: torrent.name,
    metadata: request,
    cancelable: false,
    retryable: true,
  })
  const createdBy: ActorIdentity = { type: 'user', ref: task.createdByUserId, issuer: null }
  return { jobId: job.id, orgId: task.orgId, userId: task.createdByUserId, createdBy, request }
}
