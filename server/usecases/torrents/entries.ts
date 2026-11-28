// Torrents list entries as downloads move them along (docs/design/torrents.md
// §3 workspace_torrents, §4). A remote download of a magnet or torrent URL and a
// StremThru add each create an entry; a torrent URL entry learns its torrent
// when its downloader reports the info dictionary, and merges into an entry the
// workspace already holds for it. Once an entry has a torrent, the status shown
// follows the torrent's, and before that its own task's. An entry stores only
// whether it failed; entryState() derives the rest.

import { parseMagnetDisplayName } from '../../domain/torrent-info'
import type { Deps } from '../deps'
import type {
  ActorIdentity,
  DownloadTaskRecord,
  TorrentRecord,
  WorkspaceTorrentRecord,
  WorkspaceTorrentUpdate,
  WorkspaceTorrentView,
} from '../ports'

export const TORRENT_INVALID_MESSAGE = 'The torrent failed verification'
export const TORRENT_STOPPED_MESSAGE = 'The download stopped before the torrent was complete'
export const TORRENT_EVICTED_MESSAGE = 'The torrent was evicted'
export const TORRENT_EVICTING_MESSAGE = 'The torrent was being evicted when the download began; add it again'
export const TORRENT_NOT_KEPT_MESSAGE = 'The downloader did not report the torrent, so it was not kept'

const TERMINAL_STATUSES = ['completed', 'failed', 'canceled']
const STOPPED_STATUSES = ['failed', 'canceled']
// A task in one of these goes nowhere until someone resumes it.
const HALTED_STATUSES = ['suspended', 'pausing', 'paused']

export type EntryDeps = Pick<Deps, 'workspaceTorrents' | 'torrents' | 'downloadTasks'>

export type EntryStatus = 'resolving' | 'downloading' | 'verifying' | 'paused' | 'ready' | 'failed'

// Why a paused entry waits: its download ran out of remote-download credits, or
// it was paused.
export type EntryPauseReason = 'insufficient_credits' | 'paused'

export interface EntryState {
  status: EntryStatus
  error: string | null
  pauseReason?: EntryPauseReason
}

function active(task: DownloadTaskRecord | null | undefined): boolean {
  return !!task && !task.deletedAt && !TERMINAL_STATUSES.includes(task.status)
}

function halted(task: DownloadTaskRecord | null | undefined): boolean {
  return !!task && active(task) && HALTED_STATUSES.includes(task.status)
}

// A paused entry of the workspace's own download says why; one waiting on a
// download another workspace paused only says that it waits.
function pausedState(task: DownloadTaskRecord, own: boolean): EntryState {
  const credits = own && task.status === 'suspended' && task.billingStatus === 'insufficient_credits'
  return { status: 'paused', error: null, pauseReason: credits ? 'insufficient_credits' : 'paused' }
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
  const ids = stateTaskIds(views)
  const tasks = ids.length > 0 ? await deps.downloadTasks.findRecords(ids) : []
  return new Map(tasks.map((task) => [task.id, task] as const))
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
        const fills = active(filler) && (filler?.torrentId == null || filler.torrentId === torrent.id)
        if (active(own) && !halted(own)) return { status: 'downloading', error: null }
        if (fills && !halted(filler)) return { status: 'downloading', error: null }
        if (own && halted(own)) return pausedState(own, true)
        if (filler && fills && halted(filler)) return pausedState(filler, filler.orgId === view.orgId)
        if (stopped(own)) return { status: 'failed', error: own?.errorMessage ?? TORRENT_STOPPED_MESSAGE }
        return { status: 'failed', error: TORRENT_STOPPED_MESSAGE }
      }
    }
  }
  if (stopped(own)) return { status: 'failed', error: own?.errorMessage ?? TORRENT_STOPPED_MESSAGE }
  if (own && halted(own)) return pausedState(own, true)
  if (own?.status === 'completed') return { status: 'failed', error: TORRENT_NOT_KEPT_MESSAGE }
  return { status: 'resolving', error: null }
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
// list. Adding a torrent the workspace already holds reuses its entry, which
// becomes a download one, so it no longer expires and capacity eviction passes
// its torrent by. An entry whose task still fills the torrent for the list alone
// keeps that task, which tells how the torrent's uploads are stored.
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
    if (runningFill && active(runningFill)) {
      await deps.workspaceTorrents.update(existing.id, { source: 'download', updatedAt: now })
      return { ...existing, source: 'download' }
    }
    await deps.workspaceTorrents.update(existing.id, {
      source: 'download',
      taskId: task.id,
      torrentId: existing.torrentId ?? torrent?.id ?? null,
      status: 'active',
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
    status: 'active',
    createdBy: { type: createdBy.type, ref: createdBy.ref ?? task.createdByUserId, issuer: createdBy.issuer },
    now,
  })
  if (entry.taskId !== task.id) {
    // The workspace already held the torrent: its entry now tracks this download.
    await deps.workspaceTorrents.update(entry.id, { source: 'download', taskId: task.id, updatedAt: now })
  }
  return entry
}

// Two entries of one workspace turned out to hold the same torrent: `drop` goes
// and `keep` stays. The merged entry is a download one when either was, so a
// remote download never loses its "never expires".
async function mergeEntries(
  deps: EntryDeps,
  keep: WorkspaceTorrentRecord,
  drop: WorkspaceTorrentRecord,
  fields: { torrent: TorrentRecord; taskId: string | null; now: Date },
): Promise<void> {
  await deps.workspaceTorrents.delete(drop.id)
  await deps.workspaceTorrents.update(keep.id, {
    infoHash: fields.torrent.infoHash,
    torrentId: fields.torrent.id,
    source: keep.source === 'download' || drop.source === 'download' ? 'download' : 'stremthru',
    taskId: fields.taskId,
    updatedAt: fields.now,
  })
}

// The workspace's other entry for the torrent, if any.
async function otherHolder(
  deps: EntryDeps,
  entry: WorkspaceTorrentRecord,
  torrent: TorrentRecord,
): Promise<WorkspaceTorrentRecord | null> {
  const byTorrent = (await deps.workspaceTorrents.listByTorrent(torrent.id)).find(
    (item) => item.orgId === entry.orgId && item.id !== entry.id,
  )
  if (byTorrent) return byTorrent
  const byHash = await deps.workspaceTorrents.findByInfoHash(entry.orgId, torrent.infoHash)
  return byHash && byHash.id !== entry.id ? byHash : null
}

// Gives the entry its torrent, unless the workspace holds the torrent in
// another entry (a concurrent add won the unique (org_id, torrent_id) or
// (org_id, info_hash)): then returns that entry, and nothing changed.
async function attachEntry(
  deps: EntryDeps,
  entry: WorkspaceTorrentRecord,
  torrent: TorrentRecord,
  fields: WorkspaceTorrentUpdate,
): Promise<WorkspaceTorrentRecord | null> {
  const before = await otherHolder(deps, entry, torrent)
  if (before) return before
  try {
    await deps.workspaceTorrents.update(entry.id, { ...fields, infoHash: torrent.infoHash, torrentId: torrent.id })
    return null
  } catch (error) {
    const winner = await otherHolder(deps, entry, torrent)
    if (!winner) throw error
    return winner
  }
}

// The torrent reached the instance: every entry waiting on its infoHash now
// holds it. An entry whose workspace already holds the torrent merges into
// that entry.
export async function attachWaitingEntries(deps: EntryDeps, torrent: TorrentRecord, now = new Date()) {
  for (const entry of await deps.workspaceTorrents.listWaiting(torrent.infoHash)) {
    const holder = await attachEntry(deps, entry, torrent, { updatedAt: now })
    if (holder) await mergeEntries(deps, holder, entry, { torrent, taskId: holder.taskId ?? entry.taskId, now })
  }
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
  const holder = await attachEntry(deps, entry, torrent, { status: 'active', updatedAt: now })
  if (!holder) return
  if (torrent.sourceTaskId === task.id) {
    await mergeEntries(deps, entry, holder, { torrent, taskId: task.id, now })
    await deps.workspaceTorrents.update(entry.id, { status: 'active', updatedAt: now })
    return
  }
  await mergeEntries(deps, holder, entry, { torrent, taskId: task.id, now })
  await deps.workspaceTorrents.update(holder.id, { error: null, updatedAt: now })
}

// A task that fills a torrent stopped (failed or canceled) before it completed:
// the entries waiting on that download, and the task's own unless its torrent
// is ready, are failed. A
// remote download waiting with a task of its own goes on by downloading itself.
// The downloader's error text belongs to the task's workspace, so entries of
// other workspaces get the generic message.
export async function failWaitingEntries(
  deps: EntryDeps,
  task: DownloadTaskRecord,
  error: string | null,
  now = new Date(),
): Promise<void> {
  const own = await deps.workspaceTorrents.findByTask(task.id)
  const ownTorrent = own?.torrentId ? await deps.torrents.get(own.torrentId) : null
  if (own && ownTorrent?.status !== 'ready') {
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
      error: entry.orgId === task.orgId ? (error ?? TORRENT_STOPPED_MESSAGE) : TORRENT_STOPPED_MESSAGE,
      updatedAt: now,
    })
  }
}

// A failed task runs again: its entry waits for it again.
export async function reopenTaskEntry(deps: EntryDeps, taskId: string, now = new Date()): Promise<void> {
  const entry = await deps.workspaceTorrents.findByTask(taskId)
  if (!entry || entry.status !== 'failed') return
  await deps.workspaceTorrents.update(entry.id, {
    status: 'active',
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
