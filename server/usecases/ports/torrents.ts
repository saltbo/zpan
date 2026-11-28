import type { TorrentStatus } from '../../domain/torrents'
import type { Matter } from './matter'
import type { KeysetPage, KeysetPageOpts } from './pagination'

export interface TorrentRecord {
  id: string
  infoHash: string
  storageId: string
  name: string
  totalSize: number
  fileCount: number
  private: boolean
  status: TorrentStatus
  verified: 'full' | 'sampled' | null
  sourceTaskId: string | null
  sourceDownloaderId: string | null
  lastAccessedAt: Date
  createdAt: Date
  updatedAt: Date
}

export type TorrentEntryKind = 'file' | 'sidecar' | 'folder'

// One entry of a torrent as its first download uploaded it
// (docs/design/torrents.md §3): a file of the torrent, a scraper sidecar, or a
// folder the scraper placed files in.
export interface TorrentEntryRecord {
  id: string
  torrentId: string
  kind: TorrentEntryKind
  // file: position in the info dictionary and path inside the torrent.
  fileIdx: number | null
  path: string | null
  // Where the first download put it, relative to the task folder.
  layoutPath: string
  size: number
  mime: string
  storageId: string
  // bt/<infoHash>/<id> for files and sidecars, null for folders.
  objectKey: string | null
  media: Record<string, unknown> | null
  uploadedAt: Date | null
}

// A file of the torrent's own tree.
export interface TorrentFileRecord extends TorrentEntryRecord {
  kind: 'file'
  fileIdx: number
  path: string
  objectKey: string
}

export interface NewTorrentEntryInput {
  id: string
  torrentId: string
  kind: 'sidecar' | 'folder'
  layoutPath: string
  size: number
  mime: string
  storageId: string
  objectKey: string | null
  media?: Record<string, unknown> | null
}

export interface TorrentEntryUpdate {
  layoutPath?: string
  size?: number
  mime?: string
  media?: Record<string, unknown> | null
  uploadedAt?: Date | null
}

export interface CreateTorrentInput {
  infoHash: string
  storageId: string
  name: string
  private: boolean
  status: TorrentStatus
  verified?: 'full' | 'sampled' | null
  sourceTaskId?: string | null
  sourceDownloaderId?: string | null
  // The torrent's files. `layoutPath` defaults to the file's place in the
  // torrent's own tree (under a folder named after the torrent).
  files: Array<{ fileIdx: number; path: string; layoutPath?: string; size: number; mime: string }>
  now?: Date
}

// A torrent no drive file (live, trashed, or draft) and no Torrents list entry holds.
export interface EvictionCandidate {
  id: string
  infoHash: string
  storageId: string
  size: number
  lastAccessedAt: Date
}

// A downloading torrent whose fill stopped and that nothing holds any more.
export interface AbandonedFill extends EvictionCandidate {
  sourceTaskId: string | null
}

// A torrent as the admin Torrents page lists it.
export interface AdminTorrentRecord extends TorrentRecord {
  // Drive files, live or in trash, that reference the torrent, plus the
  // Torrents list entries that hold it.
  holders: number
  sourceDownloaderName: string | null
}

export interface TorrentRepo {
  create(input: CreateTorrentInput): Promise<TorrentRecord>
  get(id: string): Promise<TorrentRecord | null>
  getByInfoHash(infoHash: string): Promise<TorrentRecord | null>
  // Torrents for the infoHashes on the instance, in no particular order.
  listByInfoHashes(infoHashes: readonly string[]): Promise<TorrentRecord[]>
  // Files of several torrents at once, by file index.
  listFilesOf(torrentIds: readonly string[]): Promise<TorrentFileRecord[]>
  // A workspace's live (not trashed) drive files that reference the torrent.
  listWorkspaceReferences(orgId: string, torrent: Pick<TorrentRecord, 'infoHash' | 'storageId'>): Promise<Matter[]>
  // Inserts the torrent unless its infoHash is already on the instance; the unique
  // info_hash makes a concurrent second insert return the first one.
  createIfAbsent(input: CreateTorrentInput): Promise<{ created: boolean; torrent: TorrentRecord }>
  // Hands a downloading torrent to the download that now fills it; false when the
  // torrent is no longer downloading (an abandoned fill swept meanwhile).
  setSource(id: string, source: { taskId: string; downloaderId: string }, now: Date): Promise<boolean>
  // Moves a torrent between statuses; false when it was not in one of `from`.
  transition(
    id: string,
    from: readonly TorrentStatus[],
    to: TorrentStatus,
    fields?: { verified?: 'full' | 'sampled' | null; now?: Date },
  ): Promise<boolean>
  // Records an access on a torrent in one of the statuses; false otherwise.
  touch(id: string, statuses: readonly TorrentStatus[], now: Date): Promise<boolean>
  // The entry stored at an object of the storage, if any.
  findEntryByObject(storageId: string, objectKey: string): Promise<TorrentEntryRecord | null>
  // The folder entry at a layout path of the torrent, if any.
  findFolderEntry(torrentId: string, layoutPath: string): Promise<TorrentEntryRecord | null>
  // Records a sidecar or folder the filling download uploaded or created.
  insertEntry(input: NewTorrentEntryInput): Promise<TorrentEntryRecord>
  updateEntry(id: string, fields: TorrentEntryUpdate): Promise<void>
  // Forgets what an earlier fill uploaded, before another download fills the
  // torrent anew: sidecars and folders go, and files are no longer uploaded.
  resetEntries(torrentId: string): Promise<void>
  // Drops the sidecars whose upload never completed.
  deleteIncompleteSidecars(torrentId: string): Promise<void>
  // Drops one sidecar or folder entry.
  deleteEntry(id: string): Promise<void>
  // The torrent's own tree: its file entries by file index.
  listFiles(torrentId: string): Promise<TorrentFileRecord[]>
  // A file of a torrent's own tree by its entry id, with its torrent.
  findFile(id: string): Promise<{ torrent: TorrentRecord; file: TorrentFileRecord } | null>
  // Every entry of the torrent, files, sidecars, and folders, by layout path.
  listEntries(torrentId: string): Promise<TorrentEntryRecord[]>
  // Torrents in a final state that no matter row (purged_at IS NULL) references
  // and no Torrents list entry holds, oldest access first.
  listEvictionCandidates(limit: number): Promise<EvictionCandidate[]>
  // Sum of total_size over every torrent.
  totalSize(): Promise<number>
  // Claims a torrent for eviction in one statement that re-counts its references
  // and checks that it was not accessed since it was listed. False when it lost.
  claimForEviction(candidate: EvictionCandidate): Promise<boolean>
  // Downloading torrents whose download was abandoned: nothing holds them, and
  // no task that fills or waits for them is active or changed after `before`.
  listAbandonedFills(before: Date, limit: number): Promise<AbandonedFill[]>
  // Claims an abandoned fill for eviction, re-checking all of the above and that
  // no other download took it over since it was listed. False when it lost.
  claimAbandonedFill(candidate: AbandonedFill, before: Date): Promise<boolean>
  // Deletes the torrent row and its entry rows.
  delete(id: string): Promise<void>
  // Every torrent, newest first, with its holder count.
  listForAdmin(opts: KeysetPageOpts): Promise<KeysetPage<AdminTorrentRecord>>
  // Drive files, live or in trash, that reference the torrent, plus the
  // Torrents list entries that hold it.
  countHolders(id: string): Promise<number>
}

// The playback link last issued to a user for a torrent file (docs/design/torrents.md §10).
export interface IssuedLink {
  url: string
  expiresAt: Date
}

export interface StremThruLinkRepo {
  // The link issued to the user for the file in the workspace: a link is metered
  // to one workspace, so it is never handed out in another.
  get(userId: string, orgId: string, torrentFileId: string): Promise<IssuedLink | null>
  // Replaces the user's link for the file in the workspace.
  save(input: {
    userId: string
    orgId: string
    torrentFileId: string
    url: string
    expiresAt: Date
    now: Date
  }): Promise<void>
}

// ─── Streaming a downloading torrent (docs/design/torrents.md §14) ──────────

// Whole pieces [firstPiece, firstPiece + pieceCount) of a torrent, verified and
// stored as one object of the torrent's concatenated bytes.
export interface TorrentStreamChunkRecord {
  torrentId: string
  firstPiece: number
  pieceCount: number
  objectKey: string
  size: number
}

export interface TorrentStreamRepo {
  // The torrent's chunks, by first piece.
  listChunks(torrentId: string): Promise<TorrentStreamChunkRecord[]>
  // A chunk holding the piece, if any.
  findChunk(torrentId: string, piece: number): Promise<TorrentStreamChunkRecord | null>
  // Records a chunk; a chunk already at that first piece stays.
  insertChunk(input: TorrentStreamChunkRecord & { now: Date }): Promise<void>
  // Records that a player waits for or reads from the piece now.
  want(torrentId: string, piece: number, now: Date): Promise<void>
  // Pieces wanted since `since`, ascending.
  listWants(torrentId: string, since: Date): Promise<number[]>
  // Forgets the torrent's chunks and wants and returns the chunks it had.
  purge(torrentId: string): Promise<TorrentStreamChunkRecord[]>
}

// ─── Torrents lists (docs/design/torrents.md §3 workspace_torrents) ──────────

export const WORKSPACE_TORRENT_SOURCES = ['download', 'stremthru'] as const
export type WorkspaceTorrentSource = (typeof WORKSPACE_TORRENT_SOURCES)[number]

// What the entry records of its own: `failed` when it failed (its download
// stopped, or the torrent it was added for is invalid), otherwise `active`.
// Every other status the list shows (resolving, downloading, verifying, paused,
// ready) is derived from its torrent and tasks by entryState(), never stored, so
// it cannot fall behind them.
export const WORKSPACE_TORRENT_STATUSES = ['active', 'failed'] as const
export type WorkspaceTorrentStatus = (typeof WORKSPACE_TORRENT_STATUSES)[number]

export interface WorkspaceTorrentRecord {
  id: string
  orgId: string
  torrentId: string | null
  infoHash: string | null
  source: WorkspaceTorrentSource
  sourceUri: string
  displayName: string | null
  taskId: string | null
  status: WorkspaceTorrentStatus
  error: string | null
  createdByActorType: string
  createdByActorRef: string
  createdByActorIssuer: string | null
  lastPlayedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

// An entry with the torrent it holds, if it has one yet.
export interface WorkspaceTorrentView extends WorkspaceTorrentRecord {
  torrent: TorrentRecord | null
}

export interface NewWorkspaceTorrentInput {
  orgId: string
  torrentId: string | null
  infoHash: string | null
  source: WorkspaceTorrentSource
  sourceUri: string
  displayName: string | null
  taskId: string | null
  status: WorkspaceTorrentStatus
  error?: string | null
  createdBy: { type: string; ref: string; issuer: string | null }
  now: Date
}

export interface WorkspaceTorrentUpdate {
  torrentId?: string | null
  infoHash?: string | null
  source?: WorkspaceTorrentSource
  taskId?: string | null
  status?: WorkspaceTorrentStatus
  error?: string | null
  lastPlayedAt?: Date
  updatedAt: Date
}

// A torrent held only by stremthru entries, as capacity eviction ranks them:
// least recently played first.
export interface StremThruHeldTorrent extends EvictionCandidate {
  lastPlayedAt: Date
}

export interface WorkspaceTorrentRepo {
  // Inserts the entry; when the workspace already has an entry for its torrent or
  // its infoHash (the unique (org_id, torrent_id) and (org_id, info_hash)),
  // returns that entry instead.
  insert(input: NewWorkspaceTorrentInput): Promise<{ created: boolean; entry: WorkspaceTorrentRecord }>
  get(orgId: string, id: string): Promise<WorkspaceTorrentView | null>
  findByInfoHash(orgId: string, infoHash: string): Promise<WorkspaceTorrentRecord | null>
  // The workspace's entry added from a link, resolved or not.
  findBySourceUri(orgId: string, sourceUri: string): Promise<WorkspaceTorrentRecord | null>
  findByTask(taskId: string): Promise<WorkspaceTorrentRecord | null>
  // The workspace's entries, newest first, each with its torrent; `search`
  // matches the name or the infoHash.
  list(orgId: string, opts: KeysetPageOpts & { search?: string }): Promise<KeysetPage<WorkspaceTorrentView>>
  // Offset paging for the StremThru list.
  listByOffset(
    orgId: string,
    opts: { limit: number; offset: number },
  ): Promise<{ items: WorkspaceTorrentView[]; total: number }>
  // Entries of every workspace that hold the torrent.
  listByTorrent(torrentId: string): Promise<WorkspaceTorrentRecord[]>
  // Entries, in any workspace, still waiting for a torrent whose infoHash just
  // reached the instance.
  listWaiting(infoHash: string): Promise<WorkspaceTorrentRecord[]>
  update(id: string, fields: WorkspaceTorrentUpdate): Promise<void>
  delete(id: string): Promise<void>
  // Entries that hold the torrent, from any workspace.
  countByTorrent(torrentId: string): Promise<number>
  // Deletes stremthru entries not played (or, never played, not created) since
  // `before`, and returns the torrents they held.
  expireStremThru(before: Date, limit: number): Promise<Array<{ id: string; torrentId: string | null }>>
  // Torrents in a final state that no drive file and no download entry holds
  // but some stremthru entry does, least recently played first.
  listStremThruHeld(limit: number): Promise<StremThruHeldTorrent[]>
  // Claims a torrent held only by stremthru entries for eviction and deletes
  // those entries, in one batch that re-counts the holders. False when it lost.
  claimStremThruHeldForEviction(candidate: StremThruHeldTorrent): Promise<boolean>
}
