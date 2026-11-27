import type { TorrentStatus } from '../../domain/torrent-cache'

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

export interface TorrentRepo {
  create(input: CreateTorrentInput): Promise<TorrentRecord>
  get(id: string): Promise<TorrentRecord | null>
  getByInfoHash(infoHash: string): Promise<TorrentRecord | null>
  listFiles(torrentId: string): Promise<TorrentFileRecord[]>
  // Records an access on a ready torrent. False when the torrent is not ready,
  // such as when eviction has claimed it.
  touchReady(id: string, now: Date): Promise<boolean>
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
}

export interface TorrentCacheConfigRepo {
  getFolder(orgId: string): Promise<string | null>
  setFolder(orgId: string, folder: string): Promise<void>
}
