// A workspace's Torrents list (docs/design/torrents.md §2 decisions 4, 5, 8; §9;
// §10): what the Torrents page and the StremThru API read and change. An entry
// costs no quota; its files play and download through presigned links to the
// torrent's bt/ objects, and Save to drive writes drive files by instant
// transfer, which costs quota like any file.

import type { Deps } from '../deps'
import { performDownloadTaskAction } from '../downloads/downloads'
import {
  type AppError,
  conflict,
  insufficientCredits,
  type KeysetPage,
  type KeysetPageOpts,
  type Matter,
  notFound,
  quotaExceeded,
  type TorrentFileRecord,
  type WorkspaceTorrentView,
} from '../ports'
import { confirmDownloadTraffic, meterDownloadTraffic, reverseDownloadTraffic } from '../store/traffic-metering'
import { createTrafficEventId, recordDownloadIssued } from '../transfer-activity'
import { type EntryState, entryState, loadStateTasks, recordEntryPlayed, stateOf } from './entries'
import { transferTorrent } from './instant-transfer'
import { loadTorrentPolicy } from './policy'
import { canStream } from './stream'

// Playback links are valid for 12 hours, and an issued link is handed out again
// while it has more than an hour left (§10).
export const TORRENT_LINK_TTL_SECONDS = 12 * 60 * 60
export const TORRENT_LINK_REUSE_MIN_REMAINING_MS = 60 * 60 * 1000

const TERMINAL_STATUSES = ['completed', 'failed', 'canceled']
const EXPIRY_BATCH = 200

export interface WorkspaceTorrentItem {
  view: WorkspaceTorrentView
  state: EntryState
}

export interface WorkspaceTorrentDetail extends WorkspaceTorrentItem {
  // The torrent's own tree, by file index; empty before the torrent is known.
  files: TorrentFileRecord[]
  playable: boolean
  // Not playable yet, but its downloader uploads pieces for streaming
  // (docs/design/torrents.md §14), so a stream link plays it.
  streamable: boolean
}

async function withStates(
  deps: Pick<Deps, 'downloadTasks'>,
  views: readonly WorkspaceTorrentView[],
): Promise<WorkspaceTorrentItem[]> {
  const tasks = await loadStateTasks(deps, views)
  return views.map((view) => ({ view, state: entryState(view, tasks) }))
}

export async function listWorkspaceTorrents(
  deps: Pick<Deps, 'workspaceTorrents' | 'downloadTasks'>,
  orgId: string,
  opts: KeysetPageOpts & { search?: string },
): Promise<KeysetPage<WorkspaceTorrentItem>> {
  const page = await deps.workspaceTorrents.list(orgId, opts)
  return { items: await withStates(deps, page.items), nextBoundary: page.nextBoundary }
}

export async function listWorkspaceTorrentsByOffset(
  deps: Pick<Deps, 'workspaceTorrents' | 'downloadTasks'>,
  orgId: string,
  opts: { limit: number; offset: number },
): Promise<{ items: WorkspaceTorrentItem[]; total: number }> {
  const page = await deps.workspaceTorrents.listByOffset(orgId, opts)
  return { items: await withStates(deps, page.items), total: page.total }
}

// Files play once the torrent is ready, and for the workspace whose download
// filled it from the moment the download completed (verification gates sharing,
// not ownership).
export function isPlayable(view: WorkspaceTorrentView, state: EntryState): boolean {
  if (state.status === 'ready') return true
  return state.status === 'verifying' && !!view.taskId && view.torrent?.sourceTaskId === view.taskId
}

export async function getWorkspaceTorrent(
  deps: Pick<Deps, 'workspaceTorrents' | 'downloadTasks' | 'torrents' | 'downloaders'>,
  orgId: string,
  id: string,
): Promise<WorkspaceTorrentDetail> {
  const view = await deps.workspaceTorrents.get(orgId, id)
  if (!view) throw notFound('Torrent not found')
  const state = await stateOf(deps, view)
  const files = view.torrent ? await deps.torrents.listFiles(view.torrent.id) : []
  const playable = isPlayable(view, state)
  const streamable =
    !playable &&
    files.length > 0 &&
    (state.status === 'downloading' || state.status === 'verifying') &&
    (await canStream(deps, view.torrent))
  return { view, state, files, playable, streamable }
}

// ─── Playback and download links (§10) ───────────────────────────────────────

export interface IssueLinkParams {
  orgId: string
  userId: string
  // Who the audit event names: the user, or the StremThru key acting for them.
  actor: { actorType: 'user' | 'api_key'; actorRef: string }
  entryId: string
  fileId: string
  cloudBaseUrl: string
  source: 'stremthru' | 'torrents'
  // Builds the stream link of a file of a torrent that is not playable yet but
  // streams (docs/design/torrents.md §14). Without it, such a file is refused.
  streamUrl?: (torrentFileId: string, expiresAt: Date) => Promise<string>
  now?: Date
}

// A presigned URL for a file of a list entry, valid for 12 hours. The file's
// size is charged to the workspace when a link is issued; while the link issued
// to the user in this workspace has more than an hour left it is returned again
// without another charge, because players reconnect and addons regenerate
// links. Once a link is handed out, the entry is played now and its torrent
// accessed now; a refused charge plays nothing.
export async function issueTorrentFileLink(
  deps: Deps,
  params: IssueLinkParams,
): Promise<{ url: string; expiresAt: Date } | { error: AppError }> {
  const now = params.now ?? new Date()
  const detail = await getWorkspaceTorrent(deps, params.orgId, params.entryId)
  const torrent = detail.view.torrent
  const file = detail.files.find((item) => item.id === params.fileId)
  if (!torrent || !file) throw notFound('Torrent file not found')
  const streams = !detail.playable && detail.streamable && !!params.streamUrl
  if (!detail.playable && !streams) throw conflict('Torrent file is not playable yet', 'TORRENT_NOT_READY')

  const issued = await deps.stremthruLinks.get(params.userId, params.orgId, file.id)
  if (issued && issued.expiresAt.getTime() - now.getTime() > TORRENT_LINK_REUSE_MIN_REMAINING_MS) {
    await recordEntryPlayed(deps, detail.view, now)
    return { url: issued.url, expiresAt: issued.expiresAt }
  }

  const storage = await deps.storages.get(torrent.storageId)
  if (!storage) throw notFound('Torrent file not found')
  const bytes = file.size
  const trafficEventId = createTrafficEventId()
  const metered = await meterDownloadTraffic(deps, {
    cloudBaseUrl: params.cloudBaseUrl,
    orgId: params.orgId,
    bytes,
    storage,
    source: 'object_download',
    sourceId: file.id,
    eventId: trafficEventId,
  })
  if (!metered.ok) {
    return {
      error:
        metered.reason === 'quota_exceeded'
          ? quotaExceeded('Traffic quota exceeded')
          : insufficientCredits('Insufficient credits', { metadata: { resource: 'storage_egress' } }),
    }
  }

  const name = file.path.slice(file.path.lastIndexOf('/') + 1)
  const expiresAt = new Date(now.getTime() + TORRENT_LINK_TTL_SECONDS * 1000)
  let url: string
  try {
    url =
      streams && params.streamUrl
        ? await params.streamUrl(file.id, expiresAt)
        : await deps.s3.presignDownload(storage, file.objectKey, name, TORRENT_LINK_TTL_SECONDS)
    await confirmDownloadTraffic(deps, { eventId: trafficEventId, now })
  } catch (error) {
    await reverseDownloadTraffic(deps, { orgId: params.orgId, bytes, eventId: trafficEventId, now })
    throw error
  }
  await recordEntryPlayed(deps, detail.view, now)
  await deps.stremthruLinks.save({
    userId: params.userId,
    orgId: params.orgId,
    torrentFileId: file.id,
    url,
    expiresAt,
    now,
  })
  await recordDownloadIssued(
    deps,
    { userId: params.userId, ...params.actor },
    'object_download',
    {
      orgId: params.orgId,
      targetType: 'file',
      targetId: file.id,
      targetName: name,
      bytes,
      source: params.source,
      metadata: { storageId: storage.id, torrentId: torrent.id, workspaceTorrentId: detail.view.id },
    },
    trafficEventId,
  )
  return { url, expiresAt }
}

// ─── Remove ──────────────────────────────────────────────────────────────────

// Takes the entry off the list. Links already issued keep playing, because only
// eviction deletes bytes. A download that fills the torrent for Torrents lists
// alone is canceled once nobody holds the torrent any more; a remote download
// goes on, because its drive files are the user's own request.
export async function removeWorkspaceTorrent(deps: Deps, orgId: string, id: string): Promise<void> {
  const view = await deps.workspaceTorrents.get(orgId, id)
  if (!view) throw notFound('Torrent not found')
  await deps.workspaceTorrents.delete(view.id)
  if (view.torrent) await cancelUnheldFill(deps, view.torrent.id)
  else if (view.taskId) await cancelListOnlyTask(deps, view.taskId)
}

// A list-only task still resolving its torrent URL holds nothing else.
async function cancelListOnlyTask(deps: Deps, taskId: string): Promise<void> {
  const task = await deps.downloadTasks.findRecord(taskId)
  if (!task?.listOnly || task.deletedAt || TERMINAL_STATUSES.includes(task.status) || task.status === 'canceling') {
    return
  }
  await performDownloadTaskAction(deps, task.orgId, task.id, 'cancel')
}

// A fill that runs only for Torrents lists stops when the torrent loses every
// holder before it completes (docs/design/torrents.md §4).
export async function cancelUnheldFill(deps: Deps, torrentId: string): Promise<void> {
  const torrent = await deps.torrents.get(torrentId)
  if (!torrent || torrent.status !== 'downloading' || !torrent.sourceTaskId) return
  if ((await deps.torrents.countHolders(torrent.id)) > 0) return
  const task = await deps.downloadTasks.findRecord(torrent.sourceTaskId)
  if (!task?.listOnly || task.torrentId !== torrent.id || task.torrentRole !== 'fill') return
  if (task.deletedAt || TERMINAL_STATUSES.includes(task.status) || task.status === 'canceling') return
  await performDownloadTaskAction(deps, task.orgId, task.id, 'cancel')
}

// ─── Save to drive (§5) ──────────────────────────────────────────────────────

export async function saveWorkspaceTorrentToDrive(
  deps: Deps,
  params: { orgId: string; userId: string; id: string; folder: string; now?: Date },
): Promise<Matter[]> {
  const view = await deps.workspaceTorrents.get(params.orgId, params.id)
  if (!view) throw notFound('Torrent not found')
  if (!view.torrent || view.torrent.status !== 'ready') throw conflict('Torrent is not ready', 'TORRENT_NOT_READY')
  const outcome = await transferTorrent(deps, {
    torrentId: view.torrent.id,
    orgId: params.orgId,
    userId: params.userId,
    targetFolder: params.folder,
    now: params.now,
  })
  if (!outcome.ok) throw outcome.error
  return outcome.files
}

// ─── Expiry (§11) ────────────────────────────────────────────────────────────

// Stremthru entries expire once they have not been played (or, never played,
// added) within the retention period. A download entry does not expire: the
// drive files it brought hold its torrent, and removing it is the user's choice.
export async function expireStremThruEntries(deps: Deps, now = new Date()): Promise<number> {
  const { retentionDays } = await loadTorrentPolicy(deps)
  const before = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000)
  const expired = await deps.workspaceTorrents.expireStremThru(before, EXPIRY_BATCH)
  for (const torrentId of new Set(expired.flatMap((entry) => (entry.torrentId ? [entry.torrentId] : [])))) {
    await cancelUnheldFill(deps, torrentId)
  }
  return expired.length
}
