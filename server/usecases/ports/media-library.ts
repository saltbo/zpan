import type { ActorIdentity } from './audit'
import type { Matter } from './matter'

export interface MediaLibraryRecord {
  id: string
  orgId: string
  folderId: string
  // Subtree fingerprint of the last successful scan or deterministic failure.
  fingerprint: string | null
  lastScannedAt: Date | null
  createdByUserId: string
  createdBy: ActorIdentity
  createdAt: Date
  updatedAt: Date
}

export interface MediaLibraryFolder {
  path: string
  name: string
  trashed: boolean
}

export interface MediaLibraryState extends MediaLibraryRecord {
  // null once the folder row is purged.
  folder: MediaLibraryFolder | null
  // A scan job for this library is queued or running within the scan lease.
  scanning: boolean
}

export type MediaLibraryView = MediaLibraryState & { folder: MediaLibraryFolder }

// What the sweep needs to decide on a library, read for every library at once.
export interface MediaLibrarySweepState extends MediaLibraryState {
  // The live library.json index exists in the library root.
  indexed: boolean
  // fingerprint() of the folder subtree as it is now; meaningless once the folder is purged.
  subtreeFingerprint: string
}

export interface CreateMediaLibraryInput {
  orgId: string
  folderId: string
  createdByUserId: string
  createdBy: ActorIdentity
}

export type MediaLibraryFileCursor = Pick<Matter, 'parent' | 'name'>

export interface MediaLibraryRepo {
  // null when the folder already is a media library.
  create(input: CreateMediaLibraryInput): Promise<MediaLibraryRecord | null>
  get(orgId: string, id: string): Promise<MediaLibraryState | null>
  // Libraries whose folder still exists, newest first.
  list(
    orgId: string,
    opts: { pageSize: number; after?: { createdAt: Date; id: string } },
  ): Promise<{ items: MediaLibraryView[]; nextBoundary: { createdAt: Date; id: string } | null }>
  listByOrg(orgId: string): Promise<MediaLibraryState[]>
  // Every library on the instance, in one query whose bound parameters do not grow with the count.
  listForSweep(): Promise<MediaLibrarySweepState[]>
  delete(orgId: string, id: string): Promise<boolean>
  deleteMany(ids: readonly string[]): Promise<void>
  recordScan(orgId: string, id: string, scan: { fingerprint: string; scannedAt?: Date }): Promise<void>
  // Cheap change detector over the live subtree, excluding the library.json index.
  fingerprint(orgId: string, folderPath: string): Promise<string>
  // One page of the live files in the subtree with a video MIME type or
  // extension, ordered by (parent, name) under binary collation and starting
  // after the `after` file.
  listVideoFilesPage(
    orgId: string,
    folderPath: string,
    extensions: readonly string[],
    page: { after: MediaLibraryFileCursor | null; limit: number },
  ): Promise<Matter[]>
}
