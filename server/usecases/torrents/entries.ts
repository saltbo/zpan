// Torrents list entries as downloads move them along (docs/design/torrents.md
// §3 workspace_torrents, §4). A remote download of a magnet or torrent URL and a
// StremThru add each create an entry; a torrent URL entry learns its torrent
// when its downloader reports the info dictionary, and merges into an entry the
// workspace already holds for it. Once an entry has a torrent, the status shown
// follows the torrent's, and before that its own task's.

import { parseMagnetDisplayName } from '../../domain/torrent-info'
import type { Deps } from '../deps'
import type {
  ActorIdentity,
  DownloadTaskRecord,
  TorrentRecord,
  WorkspaceTorrentRecord,
  WorkspaceTorrentView,
} from '../ports'

export const TORRENT_INVALID_MESSAGE = 'The torrent failed verification'
export const TORRENT_STOPPED_MESSAGE = 'The download stopped before the torrent was complete'
export const TORRENT_EVICTED_MESSAGE = 'The torrent was evicted'
export const TORRENT_NOT_KEPT_MESSAGE = 'The downloader did not report the torrent, so it was not kept'

const TERMINAL_STATUSES = ['completed', 'failed', 'canceled']
const STOPPED_STATUSES = ['failed', 'canceled']

export type EntryDeps = Pick<Deps, 'workspaceTorrents' | 'torrents' | 'downloadTasks'>

export type EntryStatus = 'resolving' | 'downloading' | 'verifying' | 'ready' | 'failed'

export interface EntryState {
  status: EntryStatus
  error: string | null
}

function active(task: DownloadTaskRecord | null | undefined): boolean {
  return !!task && !task.deletedAt && !TERMINAL_STATUSES.includes(task.status)
}

function stopped(task: DownloadTaskRecord | null | undefined): boolean {
  return !!task && (!!task.deletedAt || STOPPED_STATUSES.includes(task.status))
}

// The task ids an entry's state depends on: its own task and its torrent's filler.
export function stateTaskIds(views: readonly WorkspaceTorrentView[]): string[] {
  const ids = new Set<string>()
  for (const view of views) {
    if (view.taskId) ids.add(view.taskId)
    if (view.torrent?.status === 'downloading' && view.torrent.sourceTaskId) ids.add(view.torrent.sourceTaskId)
  }
  return [...ids]
}

export async function loadStateTasks(
  deps: Pick<Deps, 'downloadTasks'>,
  views: readonly WorkspaceTorrentView[],
): Promise<Map<string, DownloadTaskRecord>> {
  const tasks = await Promise.all(stateTaskIds(views).map((id) => deps.downloadTasks.findRecord(id)))
  return new Map(tasks.flatMap((task) => (task ? [[task.id, task] as const] : [])))
}

// The status the Torrents list shows for an entry.
export function entryState(view: WorkspaceTorrentView, tasks: ReadonlyMap<string, DownloadTaskRecord>): EntryState {
  if (view.status === 'failed') return { status: 'failed', error: view.error }
  const own = view.taskId ? tasks.get(view.taskId) : undefined
  const torrent = view.torrent
  if (torrent) {
    switch (torrent.status) {
      case 'ready':
        return { status: 'ready', error: null }
      case 'verifying':
        return { status: 'verifying', error: null }
      case 'invalid':
        return { status: 'failed', error: TORRENT_INVALID_MESSAGE }
      case 'evicting':
        return { status: 'failed', error: TORRENT_EVICTED_MESSAGE }
      default: {
        const filler = torrent.sourceTaskId ? tasks.get(torrent.sourceTaskId) : undefined
        if (active(own) || (active(filler) && (filler?.torrentId == null || filler.torrentId === torrent.id))) {
          return { status: 'downloading', error: null }
        }
        if (stopped(own)) return { status: 'failed', error: own?.errorMessage ?? TORRENT_STOPPED_MESSAGE }
        return { status: 'failed', error: TORRENT_STOPPED_MESSAGE }
      }
    }
  }
  if (stopped(own)) return { status: 'failed', error: own?.errorMessage ?? TORRENT_STOPPED_MESSAGE }
  if (own?.status === 'completed') return { status: 'failed', error: TORRENT_NOT_KEPT_MESSAGE }
  return { status: view.status === 'ready' ? 'ready' : view.status, error: null }
}

export async function stateOf(deps: Pick<Deps, 'downloadTasks'>, view: WorkspaceTorrentView): Promise<EntryState> {
  return entryState(view, await loadStateTasks(deps, [view]))
}

// ─── Creating entries ────────────────────────────────────────────────────────

function displayNameOf(source: { type: string; uri: string }, fallback: string | null): string | null {
  if (fallback) return fallback
  return source.type === 'magnet' ? parseMagnetDisplayName(source.uri) : null
}

// A torrent a request can attach to: anything but one being evicted.
async function attachableTorrent(deps: EntryDeps, infoHash: string | null): Promise<TorrentRecord | null> {
  if (!infoHash) return null
  const torrent = await deps.torrents.getByInfoHash(infoHash)
  return torrent && torrent.status !== 'evicting' ? torrent : null
}

// A remote download of a magnet or torrent URL lands in the drive and in the
// list. Adding a torrent the workspace already holds reuses its entry: a
// stremthru entry becomes a download one, so it no longer expires, unless it
// still runs the task that fills the torrent for the list alone.
export async function addDownloadEntry(
  deps: EntryDeps,
  task: DownloadTaskRecord,
  createdBy: ActorIdentity,
  now = new Date(),
): Promise<WorkspaceTorrentRecord> {
  const torrent = await attachableTorrent(deps, task.infoHash)
  const existing = task.infoHash ? await deps.workspaceTorrents.findByInfoHash(task.orgId, task.infoHash) : null
  if (existing) {
    const runningFill =
      existing.source === 'stremthru' && existing.taskId ? await deps.downloadTasks.findRecord(existing.taskId) : null
    if (runningFill && active(runningFill)) return existing
    await deps.workspaceTorrents.update(existing.id, {
      source: 'download',
      taskId: task.id,
      torrentId: existing.torrentId ?? torrent?.id ?? null,
      status: torrent?.status === 'ready' ? 'ready' : torrent || existing.torrentId ? 'downloading' : 'resolving',
      error: null,
      updatedAt: now,
    })
    return { ...existing, source: 'download', taskId: task.id }
  }
  const { entry } = await deps.workspaceTorrents.insert({
    orgId: task.orgId,
    torrentId: torrent?.id ?? null,
    infoHash: task.infoHash,
    source: 'download',
    sourceUri: task.sourceUri,
    displayName: displayNameOf({ type: task.sourceType, uri: task.sourceUri }, task.displayName),
    taskId: task.id,
    status: torrent?.status === 'ready' ? 'ready' : torrent ? 'downloading' : 'resolving',
    createdBy: { type: createdBy.type, ref: createdBy.ref ?? task.createdByUserId, issuer: createdBy.issuer },
    now,
  })
  if (entry.taskId !== task.id) {
    // The workspace already held the torrent: its entry now tracks this download.
    await deps.workspaceTorrents.update(entry.id, { source: 'download', taskId: task.id, updatedAt: now })
  }
  return entry
}

// The torrent reached the instance: every entry waiting on its infoHash now
// holds it.
export async function attachWaitingEntries(deps: EntryDeps, torrent: TorrentRecord, now = new Date()) {
  await deps.workspaceTorrents.attachTorrent(torrent.infoHash, torrent.id, now)
}

// A task learned its torrent from the reported info dictionary. A torrent URL
// entry takes the infoHash and the torrent; if the workspace already holds that
// torrent in another entry, the two merge. The entry of the task that fills the
// torrent stays, because it tells how that task's uploads are stored; otherwise
// the older entry stays and takes this task.
export async function resolveTaskEntry(
  deps: EntryDeps,
  task: DownloadTaskRecord,
  torrent: TorrentRecord,
  now = new Date(),
): Promise<void> {
  await attachWaitingEntries(deps, torrent, now)
  const entry = await deps.workspaceTorrents.findByTask(task.id)
  if (!entry || entry.torrentId === torrent.id) return
  const holder = (await deps.workspaceTorrents.listByTorrent(torrent.id)).find((item) => item.orgId === task.orgId)
  if (!holder) {
    await deps.workspaceTorrents.update(entry.id, {
      infoHash: torrent.infoHash,
      torrentId: torrent.id,
      status: 'downloading',
      updatedAt: now,
    })
    return
  }
  const source = entry.source === 'download' || holder.source === 'download' ? 'download' : 'stremthru'
  if (torrent.sourceTaskId === task.id) {
    await deps.workspaceTorrents.delete(holder.id)
    await deps.workspaceTorrents.update(entry.id, {
      infoHash: torrent.infoHash,
      torrentId: torrent.id,
      status: 'downloading',
      updatedAt: now,
    })
    return
  }
  await deps.workspaceTorrents.delete(entry.id)
  await deps.workspaceTorrents.update(holder.id, { source, taskId: task.id, error: null, updatedAt: now })
}

// A task that fills a torrent stopped (failed or canceled) before it completed:
// the entries waiting on that download, and the task's own, are failed. A
// remote download waiting with a task of its own goes on by downloading itself.
export async function failWaitingEntries(
  deps: EntryDeps,
  task: DownloadTaskRecord,
  error: string | null,
  now = new Date(),
): Promise<void> {
  const own = await deps.workspaceTorrents.findByTask(task.id)
  if (own && own.status !== 'ready') {
    await deps.workspaceTorrents.update(own.id, {
      status: 'failed',
      error: error ?? TORRENT_STOPPED_MESSAGE,
      updatedAt: now,
    })
  }
  if (task.torrentRole !== 'fill' || !task.torrentId) return
  const torrent = await deps.torrents.get(task.torrentId)
  if (!torrent || torrent.status !== 'downloading' || torrent.sourceTaskId !== task.id) return
  for (const entry of await deps.workspaceTorrents.listByTorrent(torrent.id)) {
    if (entry.id === own?.id || entry.status === 'failed') continue
    const waitsAlone = !entry.taskId || entry.taskId === task.id
    if (!waitsAlone) {
      const other = await deps.downloadTasks.findRecord(entry.taskId as string)
      if (active(other)) continue
    }
    await deps.workspaceTorrents.update(entry.id, {
      status: 'failed',
      error: error ?? TORRENT_STOPPED_MESSAGE,
      updatedAt: now,
    })
  }
}

// A failed task runs again: its entry waits for it again.
export async function reopenTaskEntry(deps: EntryDeps, taskId: string, now = new Date()): Promise<void> {
  const entry = await deps.workspaceTorrents.findByTask(taskId)
  if (!entry || entry.status !== 'failed') return
  await deps.workspaceTorrents.update(entry.id, {
    status: entry.torrentId ? 'downloading' : 'resolving',
    error: null,
    updatedAt: now,
  })
}

// Playback or a download from the entry: it is played now, and its torrent was
// accessed now.
export async function recordEntryPlayed(deps: EntryDeps, view: WorkspaceTorrentView, now = new Date()) {
  await deps.workspaceTorrents.update(view.id, { lastPlayedAt: now, updatedAt: now })
  if (view.torrent) await deps.torrents.touch(view.torrent.id, ['ready', 'verifying'], now)
}
