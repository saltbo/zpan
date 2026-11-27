import type { ActorType } from '@shared/schemas'
import type { Downloader, DownloadTask, DownloadTaskListItem } from '@shared/types'

// ─── Errors ──────────────────────────────────────────────────────────────────
// Thrown by the repos (not_found/forbidden) and the orchestration state machine
// (invalid_state/no_downloader/unsupported_source). Caught by the http layer
// (download-tasks.ts / downloaders.ts) and mapped to 404/403/409.
export class DownloadError extends Error {
  constructor(
    readonly code: 'not_found' | 'forbidden' | 'no_downloader' | 'invalid_state' | 'unsupported_source',
    message: string = code,
  ) {
    super(message)
    this.name = 'DownloadError'
  }
}

// ─── DTOs ──────────────────────────────────────────────────────────────────
// Plain records mirroring the `downloaders` / `download_tasks` tables. Timestamps
// stay Date (the http layer serializes the API-shaped Downloader/DownloadTask).
// Drizzle row types never cross this port; the orchestration state machine reads
// these records and composes the repo write primitives.

export interface DownloaderRecord {
  id: string
  name: string
  tokenHash: string
  tokenJti: string
  status: string
  enabled: boolean
  version: string
  hostname: string
  platform: string
  arch: string
  engine: string
  capabilities: string[]
  maxConcurrentTasks: number
  currentTasks: number
  downloadBps: number
  uploadBps: number
  freeDiskBytes: number
  remoteDownloadCreditBillingEnabled: boolean
  remoteDownloadCreditUnitBytes: number
  remoteDownloadCreditPerUnit: number
  lastHeartbeatAt: Date | null
  createdBy: string
  createdAt: Date
  updatedAt: Date
}

export interface DownloadTaskRecord {
  id: string
  orgId: string
  createdByUserId: string
  requestedByActorType?: ActorType | null
  requestedByActorRef?: string | null
  requestedByActorIssuer?: string | null
  sourceType: string
  sourceUri: string
  displayName: string | null
  targetFolder: string
  category: string | null
  tags: string
  assignedDownloaderId: string | null
  status: string
  attempt: number
  billingAuthorizedBytes: number
  billingChargedBytes: number
  billingChargedCredits: number
  billingStatus: string
  errorCode: string | null
  errorMessage: string | null
  resultObjectId: string | null
  runtime: string | null
  events: string
  resolveStartedAt: Date | null
  resolveCompletedAt: Date | null
  downloadCompletedAt: Date | null
  ingestStartedAt: Date | null
  ingestCompletedAt: Date | null
  seedingStartedAt: Date | null
  seedingStoppedAt: Date | null
  createdAt: Date
  updatedAt: Date
  assignedAt: Date | null
  startedAt: Date | null
  finishedAt: Date | null
  deletedAt: Date | null
  infoHash: string | null
  torrentId: string | null
  torrentRole: TorrentRole | null
  // A StremThru add's task: it fills a torrent for Torrents lists alone and
  // writes no drive rows (docs/design/torrents.md §4).
  listOnly: boolean
}

// How a download task uses Torrents: 'fill' for the task whose download is the
// torrent's first, 'join' while it waits for another task's download.
export type TorrentRole = 'fill' | 'join'

export interface CreateDownloaderRecordInput {
  id: string
  name: string
  tokenHash: string
  tokenJti: string
  version: string
  hostname: string
  platform: string
  arch: string
  engine: string
  capabilities: string[]
  maxConcurrentTasks: number
  currentTasks: number
  downloadBps: number
  uploadBps: number
  freeDiskBytes: number
  remoteDownloadCreditUnitBytes: number
  createdBy: string
  now: Date
}

export interface UpdateDownloaderFields {
  name?: string
  enabled?: boolean
  remoteDownloadCreditBillingEnabled?: boolean
  remoteDownloadCreditUnitBytes?: number
  remoteDownloadCreditPerUnit?: number
}

export interface DownloaderHeartbeatFields {
  version: string
  hostname: string
  platform: string
  arch: string
  engine: string
  capabilities: string[]
  maxConcurrentTasks: number
  currentTasks: number
  downloadBps: number
  uploadBps: number
  freeDiskBytes: number
}

export interface ListDownloadTasksFilters {
  orgId?: string
  downloaderId?: string
  status?: string
  statuses?: string[]
  category?: string
  tag?: string
  pageSize: number
  after?: {
    createdAt: Date
    id: string
  }
}

export interface CreateDownloadTaskRecordInput {
  id: string
  orgId: string
  createdByUserId: string
  requestedByActorType?: ActorType
  requestedByActorRef?: string
  requestedByActorIssuer?: string | null
  sourceType: string
  sourceUri: string
  displayName: string | null
  targetFolder: string
  category: string | null
  tags: string[]
  assignedDownloaderId: string | null
  status: string
  assignedAt: Date | null
  infoHash?: string | null
  listOnly?: boolean
  now: Date
}

// Owns the `downloaders` table: registration, admin CRUD, heartbeat persistence,
// candidate selection, and stale-lease recovery. Read methods return the API DTO
// (toDownloader folded in); the orchestration reads records for the state machine.
export interface DownloaderRepo {
  insert(input: CreateDownloaderRecordInput): Promise<void>
  list(): Promise<Downloader[]>
  /** API DTO by id; throws DownloadError('not_found') when missing. */
  get(id: string): Promise<Downloader>
  /** Raw record by id; throws DownloadError('not_found') when missing. */
  getRecord(id: string): Promise<DownloaderRecord>
  findRecord(id: string): Promise<DownloaderRecord | null>
  update(id: string, fields: UpdateDownloaderFields, now: Date): Promise<void>
  recordHeartbeat(
    id: string,
    fields: DownloaderHeartbeatFields,
    online: boolean,
    statusChanged: boolean,
    now: Date,
  ): Promise<void>
  delete(id: string): Promise<void>
  /** Online, enabled, under-capacity downloaders, ordered for assignment. */
  listAssignmentCandidates(leaseCutoff: Date): Promise<DownloaderRecord[]>
  /** Ids of online, enabled downloaders whose last heartbeat is older than the cutoff. */
  listStaleIds(leaseCutoff: Date): Promise<string[]>
  /** Ids of all downloaders past the heartbeat lease, including ones already offline. */
  listUnreachableIds(leaseCutoff: Date): Promise<string[]>
  markStaleOffline(ids: string[], now: Date): Promise<void>
}

// Owns the `download_tasks` table: CRUD, listing/ordering, and the write
// primitives the orchestration state machine composes. Read methods return the
// API DTO (toDownloadTask folded in); the orchestration reads records.
export interface DownloadTaskRepo {
  insert(input: CreateDownloadTaskRecordInput): Promise<void>
  list(filters: ListDownloadTasksFilters): Promise<{
    items: DownloadTask[]
    rows: DownloadTaskRecord[]
    nextBoundary: { createdAt: Date; id: string } | null
  }>
  listItems(filters: ListDownloadTasksFilters): Promise<{
    items: DownloadTaskListItem[]
    nextBoundary: { createdAt: Date; id: string } | null
  }>
  /** API DTO scoped to org; throws DownloadError('not_found') when missing. */
  get(orgId: string, id: string): Promise<DownloadTask>
  /** Raw record scoped to org; throws DownloadError('not_found') when missing. */
  getRecord(orgId: string, id: string): Promise<DownloadTaskRecord>
  findRecord(id: string): Promise<DownloadTaskRecord | null>
  // Several tasks at once, in no particular order; missing or deleted ones are left out.
  findRecords(ids: readonly string[]): Promise<DownloadTaskRecord[]>
  // The infoHash a task of the workspace learned for a link, if any did.
  findInfoHashBySourceUri(orgId: string, sourceUri: string): Promise<string | null>
  listPendingCleanup(downloaderId: string, limit: number): Promise<DownloadTask[]>
  completeCleanup(id: string, downloaderId: string, now: Date): Promise<DownloadTaskRecord>
  /** Active task whose target is `folderPath` or a descendant of it. */
  findActiveTargetWithin(orgId: string, folderPath: string): Promise<DownloadTaskRecord | null>
  setFields(id: string, fields: UpdateDownloadTaskFields): Promise<void>
  /** Assigns a queued task; `torrentRole` null clears a role left from an earlier run. */
  claimQueued(id: string, downloaderId: string, now: Date, options?: { torrentRole?: null }): Promise<boolean>
  /** A user's live tasks of the given source types in a workspace, newest first, with their total. */
  listByCreator(params: {
    orgId: string
    userId: string
    sourceTypes: readonly string[]
    limit: number
    offset: number
  }): Promise<{ items: DownloadTaskRecord[]; total: number }>
  /** The user's newest live task for an infoHash in a workspace, skipping the excluded statuses. */
  findLatestByInfoHash(params: {
    orgId: string
    userId: string
    infoHash: string
    excludeStatuses: readonly string[]
  }): Promise<DownloadTaskRecord | null>
  /** Tasks attached to a torrent in the given role and statuses. */
  listByTorrent(torrentId: string, role: TorrentRole, statuses: string[]): Promise<DownloadTaskRecord[]>
  /** Queued tasks joined to a torrent that is no longer pending: not verifying, nor downloading by a live filler. */
  listSettledJoins(limit: number): Promise<DownloadTaskRecord[]>
  delete(id: string, now: Date): Promise<void>
  /** Oldest queued tasks awaiting assignment. */
  listQueued(limit: number): Promise<DownloadTaskRecord[]>
  /** Re-queue a downloader's in-flight tasks (delete-downloader requeue). */
  requeueAssignedTo(downloaderId: string, statuses: string[], now: Date): Promise<void>
  /** Re-queue in-flight tasks held by stale downloaders. */
  requeueAssignedToMany(downloaderIds: string[], statuses: string[], now: Date): Promise<void>
  /** Resolve control states (canceling→canceled, pausing→paused) held by stale downloaders. */
  // Returns the tasks it settled to canceled.
  resolveControlAssignedToMany(downloaderIds: string[], now: Date): Promise<Array<{ id: string; orgId: string }>>
  /** Drop the stale 'seeding' runtime on completed tasks not owned by a live downloader. */
  clearStaleSeedingRuntime(leaseCutoff: Date, now: Date): Promise<void>
}

export interface UpdateDownloadTaskFields {
  // Appends a scrape_skipped event with this reason; not a column.
  scrapeSkippedReason?: string
  // Appends a torrent event; not a column.
  torrentEvent?: 'cache_hit' | 'cache_joined'
  infoHash?: string | null
  torrentId?: string | null
  torrentRole?: TorrentRole | null
  targetFolder?: string
  status?: string
  assignedDownloaderId?: string | null
  attempt?: number
  billingAuthorizedBytes?: number
  billingChargedBytes?: number
  billingChargedCredits?: number
  billingStatus?: string
  errorCode?: string | null
  errorMessage?: string | null
  resultObjectId?: string | null
  runtime?: string | null
  resolveStartedAt?: Date | null
  resolveCompletedAt?: Date | null
  downloadCompletedAt?: Date | null
  ingestStartedAt?: Date | null
  ingestCompletedAt?: Date | null
  seedingStartedAt?: Date | null
  seedingStoppedAt?: Date | null
  assignedAt?: Date | null
  startedAt?: Date | null
  finishedAt?: Date | null
  updatedAt: Date
}
