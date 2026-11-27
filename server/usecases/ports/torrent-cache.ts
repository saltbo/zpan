import type { TorrentStatus } from '../../domain/torrent-cache'
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

export interface TorrentFileRecord {
  torrentId: string
  fileIdx: number
  path: string
  size: number
  mime: string
  storageId: string
  objectKey: string
  uploadedAt: Date | null
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
  files: Array<{ fileIdx: number; path: string; size: number; mime: string }>
  now?: Date
}

// A torrent no live, trashed, or draft drive file references.
export interface EvictionCandidate {
  id: string
  infoHash: string
  storageId: string
  size: number
  lastAccessedAt: Date
}

// A cached torrent as the admin Torrents page lists it.
export interface AdminTorrentRecord extends TorrentRecord {
  // Drive files, live or in trash, that reference the torrent.
  holders: number
  sourceDownloaderName: string | null
}

export interface TorrentRepo {
  create(input: CreateTorrentInput): Promise<TorrentRecord>
  get(id: string): Promise<TorrentRecord | null>
  getByInfoHash(infoHash: string): Promise<TorrentRecord | null>
  // Torrents for the infoHashes that are cached, in no particular order.
  listByInfoHashes(infoHashes: readonly string[]): Promise<TorrentRecord[]>
  // Files for several torrents at once.
  listFilesOf(torrentIds: readonly string[]): Promise<TorrentFileRecord[]>
  // A workspace's live (not trashed) drive files that reference the torrent.
  listWorkspaceReferences(orgId: string, torrent: Pick<TorrentRecord, 'infoHash' | 'storageId'>): Promise<Matter[]>
  // Inserts the torrent unless its infoHash is already cached; the unique
  // info_hash makes a concurrent second insert return the first one.
  createIfAbsent(input: CreateTorrentInput): Promise<{ created: boolean; torrent: TorrentRecord }>
  // Hands a downloading torrent to the download that now fills it.
  setSource(id: string, source: { taskId: string; downloaderId: string }, now: Date): Promise<void>
  // Moves a torrent between statuses; false when it was not in one of `from`.
  transition(
    id: string,
    from: readonly TorrentStatus[],
    to: TorrentStatus,
    fields?: { verified?: 'full' | 'sampled' | null; now?: Date },
  ): Promise<boolean>
  // Records an access on a torrent in one of the statuses; false otherwise.
  touch(id: string, statuses: readonly TorrentStatus[], now: Date): Promise<boolean>
  markFileUploaded(torrentId: string, fileIdx: number, now: Date): Promise<void>
  listFiles(torrentId: string): Promise<TorrentFileRecord[]>
  // Torrents in a final state that no matter row (purged_at IS NULL) references,
  // oldest access first.
  listEvictionCandidates(limit: number): Promise<EvictionCandidate[]>
  // Sum of total_size over every cached torrent.
  totalSize(): Promise<number>
  // Claims a torrent for eviction in one statement that re-counts its references
  // and checks that it was not accessed since it was listed. False when it lost.
  claimForEviction(candidate: EvictionCandidate): Promise<boolean>
  // Deletes the torrent row and its file rows.
  delete(id: string): Promise<void>
  // Every cached torrent, newest first, with its holder count.
  listForAdmin(opts: KeysetPageOpts): Promise<KeysetPage<AdminTorrentRecord>>
  // Drive files, live or in trash, that reference the torrent.
  countHolders(id: string): Promise<number>
}

export interface TorrentCacheConfigRepo {
  getFolder(orgId: string): Promise<string | null>
  setFolder(orgId: string, folder: string): Promise<void>
}

// The playback link last issued to a user for a held file (docs/design/torrent-cache.md §10).
export interface IssuedLink {
  url: string
  expiresAt: Date
}

export interface StremThruLinkRepo {
  get(userId: string, matterId: string): Promise<IssuedLink | null>
  // Replaces the user's link for the file.
  save(input: {
    userId: string
    orgId: string
    matterId: string
    url: string
    expiresAt: Date
    now: Date
  }): Promise<void>
}
