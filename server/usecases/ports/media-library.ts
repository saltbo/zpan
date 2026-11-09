import type { ActorIdentity } from './audit'
import type { Matter } from './matter'

export interface MediaLibraryRecord {
  id: string
  orgId: string
  folderId: string
  // Subtree fingerprint of the last scan attempt, successful or not.
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

export interface CreateMediaLibraryInput {
  orgId: string
  folderId: string
  createdByUserId: string
  createdBy: ActorIdentity
}

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
  listAll(): Promise<MediaLibraryState[]>
  delete(orgId: string, id: string): Promise<boolean>
  recordScan(orgId: string, id: string, scan: { fingerprint: string; scannedAt?: Date }): Promise<void>
  // Cheap change detector over the live subtree, excluding the .zpan index folder.
  fingerprint(orgId: string, folderPath: string): Promise<string>
  // Live files in the subtree (outside .zpan) with a video MIME type or extension.
  listVideoFiles(orgId: string, folderPath: string, extensions: readonly string[]): Promise<Matter[]>
}
