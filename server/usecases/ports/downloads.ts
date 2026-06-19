import type { Downloader, DownloadTask } from '@shared/types'

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
  createdAt: Date
  updatedAt: Date
  assignedAt: Date | null
  startedAt: Date | null
  finishedAt: Date | null
}

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
  category?: string
  tag?: string
  sortBy?: 'createdAt' | 'source' | 'category' | 'tags' | 'status' | 'progress' | 'eta'
  sortDir?: 'asc' | 'desc'
  page: number
  pageSize: number
}

export interface CreateDownloadTaskRecordInput {
  id: string
  orgId: string
  createdByUserId: string
  sourceType: string
  sourceUri: string
  displayName: string | null
  targetFolder: string
  category: string | null
  tags: string[]
  assignedDownloaderId: string | null
  status: string
  assignedAt: Date | null
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
  recordHeartbeat(id: string, fields: DownloaderHeartbeatFields, online: boolean, now: Date): Promise<void>
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
  list(filters: ListDownloadTasksFilters): Promise<{ items: DownloadTask[]; total: number; rows: DownloadTaskRecord[] }>
  /** API DTO scoped to org; throws DownloadError('not_found') when missing. */
  get(orgId: string, id: string): Promise<DownloadTask>
  /** Raw record scoped to org; throws DownloadError('not_found') when missing. */
  getRecord(orgId: string, id: string): Promise<DownloadTaskRecord>
  findRecord(id: string): Promise<DownloadTaskRecord | null>
  setFields(id: string, fields: UpdateDownloadTaskFields): Promise<void>
  delete(id: string): Promise<void>
  /** Oldest queued tasks awaiting assignment. */
  listQueued(limit: number): Promise<DownloadTaskRecord[]>
  /** Re-queue a downloader's in-flight tasks (delete-downloader requeue). */
  requeueAssignedTo(downloaderId: string, statuses: string[], now: Date): Promise<void>
  /** Re-queue in-flight tasks held by stale downloaders. */
  requeueAssignedToMany(downloaderIds: string[], statuses: string[], now: Date): Promise<void>
  /** Resolve control states (canceling→canceled, pausing→paused) held by stale downloaders. */
  resolveControlAssignedToMany(downloaderIds: string[], now: Date): Promise<void>
  /** Drop the stale 'seeding' runtime on completed tasks of unreachable downloaders. */
  clearStaleSeedingRuntime(downloaderIds: string[], now: Date): Promise<void>
}

export interface UpdateDownloadTaskFields {
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
  assignedAt?: Date | null
  startedAt?: Date | null
  finishedAt?: Date | null
  updatedAt: Date
}
