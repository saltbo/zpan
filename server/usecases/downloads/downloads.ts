import type {
  CreateDownloaderInput,
  CreateDownloadTaskInput,
  DownloaderHeartbeatInput,
  DownloadTaskActionInput,
  UpdateDownloaderInput,
  UpdateDownloadTaskInput,
} from '@shared/schemas'
import { downloadTaskRuntimeSchema } from '@shared/schemas'
import type { Downloader, DownloadTask, DownloadTaskRuntime } from '@shared/types'
import { nanoid } from 'nanoid'
import { ZPAN_CLOUD_URL_DEFAULT } from '../../../shared/constants'
import type { Platform } from '../../platform/interface'
import type {
  DownloaderRecord,
  DownloaderRepo,
  DownloadTaskRecord,
  DownloadTaskRepo,
  DownloadTokenGateway,
  LicenseBindingRepo,
  LicensingCloudGateway,
  ListDownloadTasksFilters,
  RemoteDownloadUsageRepo,
} from '../ports'
import { DownloadError } from '../ports'
import { RemoteDownloadBillingBlockedError, reportRemoteDownloadUnit } from './remote-download-usage'

// Pure orchestration over the downloader / download-task repos: registration,
// the queue assignment + stale-lease recovery loop, the task state machine, and
// remote-download credit billing. Reaches the DB only through the repos; token
// signing and the cloud URL come from the platform (the download-token gateway
// is platform-per-call, mirroring auth.ts).

export type DownloadsDeps = {
  downloaders: DownloaderRepo
  downloadTasks: DownloadTaskRepo
  downloadTokens: DownloadTokenGateway
  licenseBinding: LicenseBindingRepo
  licensingCloud: LicensingCloudGateway
  remoteDownloadUsage: RemoteDownloadUsageRepo
}

const DEFAULT_REMOTE_DOWNLOAD_UNIT_BYTES = 100 * 1024 * 1024
const UPLOAD_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60
const DOWNLOADER_HEARTBEAT_LEASE_MS = 30_000
const QUEUE_ASSIGN_BATCH = 20

const PAUSABLE_TASK_STATUSES = ['queued', 'assigned', 'downloading'] as const
const CANCELABLE_TASK_STATUSES = [
  'queued',
  'assigned',
  'downloading',
  'suspended',
  'paused',
  'interrupted',
  'uploading',
  'pausing',
] as const
const TERMINAL_TASK_STATUSES = ['completed', 'failed', 'canceled'] as const
const EXECUTABLE_TASK_STATUSES = ['queued', 'assigned', 'downloading', 'uploading'] as const
const RESTARTABLE_TASK_STATUSES = [
  'queued',
  'assigned',
  'paused',
  'interrupted',
  'suspended',
  'failed',
  'canceled',
  'completed',
] as const
const DOWNLOADER_TOKEN_TASK_STATUSES = ['assigned', 'downloading', 'uploading', 'interrupted'] as const
const DELETE_DOWNLOADER_REQUEUE_STATUSES = [
  'queued',
  'assigned',
  'downloading',
  'suspended',
  'pausing',
  'paused',
  'interrupted',
  'uploading',
  'canceling',
]
const STALE_REQUEUE_STATUSES = ['assigned', 'downloading', 'uploading', 'interrupted']

// ─── Downloader registration / admin CRUD ───────────────────────────────────

export async function createDownloader(
  deps: DownloadsDeps,
  platform: Platform,
  input: CreateDownloaderInput,
  userId: string,
): Promise<{ downloader: Downloader; token: string }> {
  const now = new Date()
  const id = nanoid()
  const jti = nanoid()
  const token = await deps.downloadTokens.signDownloadToken(platform, {
    v: 1,
    typ: 'downloader',
    downloaderId: id,
    jti,
    iat: Math.floor(now.getTime() / 1000),
  })
  await deps.downloaders.insert({
    id,
    name: input.name,
    tokenHash: await deps.downloadTokens.hashDownloadToken(platform, token),
    tokenJti: jti,
    version: input.heartbeat.version,
    hostname: input.heartbeat.hostname,
    platform: input.heartbeat.platform,
    arch: input.heartbeat.arch,
    engine: input.heartbeat.engine,
    capabilities: input.heartbeat.capabilities,
    maxConcurrentTasks: input.heartbeat.maxConcurrentTasks,
    currentTasks: input.heartbeat.currentTasks,
    downloadBps: input.heartbeat.downloadBps,
    uploadBps: input.heartbeat.uploadBps,
    freeDiskBytes: input.heartbeat.freeDiskBytes,
    remoteDownloadCreditUnitBytes: DEFAULT_REMOTE_DOWNLOAD_UNIT_BYTES,
    createdBy: userId,
    now,
  })
  return { downloader: await deps.downloaders.get(id), token }
}

export async function listDownloaders(deps: DownloadsDeps): Promise<Downloader[]> {
  await recoverStaleDownloaderAssignments(deps)
  return deps.downloaders.list()
}

export function getDownloader(deps: DownloadsDeps, id: string): Promise<Downloader> {
  return deps.downloaders.get(id)
}

export async function updateDownloader(
  deps: DownloadsDeps,
  id: string,
  input: UpdateDownloaderInput,
): Promise<Downloader> {
  await deps.downloaders.getRecord(id) // throws not_found
  await deps.downloaders.update(id, input, new Date())
  return deps.downloaders.get(id)
}

export async function deleteDownloader(deps: DownloadsDeps, id: string): Promise<{ id: string; deleted: true }> {
  await deps.downloaders.getRecord(id) // throws not_found
  const now = new Date()
  await deps.downloadTasks.requeueAssignedTo(id, DELETE_DOWNLOADER_REQUEUE_STATUSES, now)
  await deps.downloaders.delete(id)
  return { id, deleted: true }
}

export async function recordDownloaderHeartbeat(
  deps: DownloadsDeps,
  downloaderId: string,
  heartbeat: DownloaderHeartbeatInput,
): Promise<Downloader> {
  const downloader = await deps.downloaders.getRecord(downloaderId) // throws not_found
  await deps.downloaders.recordHeartbeat(downloaderId, heartbeat, downloader.enabled, new Date())
  await assignQueuedTasks(deps)
  return deps.downloaders.get(downloaderId)
}

// ─── Download task CRUD ──────────────────────────────────────────────────────

export async function createDownloadTask(
  deps: DownloadsDeps,
  orgId: string,
  userId: string,
  input: CreateDownloadTaskInput,
): Promise<DownloadTask> {
  const now = new Date()
  const id = nanoid()
  await recoverStaleDownloaderAssignments(deps)
  const assigned = await selectDownloader(deps, input.source.type)
  await deps.downloadTasks.insert({
    id,
    orgId,
    createdByUserId: userId,
    sourceType: input.source.type,
    sourceUri: input.source.uri,
    displayName: input.name ?? null,
    targetFolder: input.targetFolder,
    category: input.category ?? null,
    tags: input.tags ?? [],
    assignedDownloaderId: assigned?.id ?? null,
    status: assigned ? 'assigned' : 'queued',
    assignedAt: assigned ? now : null,
    now,
  })
  return deps.downloadTasks.get(orgId, id)
}

export async function listDownloadTasks(
  deps: DownloadsDeps,
  platform: Platform,
  opts: ListDownloadTasksFilters & { includeUploadToken?: boolean },
): Promise<{ items: DownloadTask[]; total: number }> {
  const { items, total, rows } = await deps.downloadTasks.list(opts)
  if (!opts.includeUploadToken) return { items, total }
  const decorated = await Promise.all(
    items.map((task, index) => decorateWithUploadToken(deps, platform, task, rows[index])),
  )
  return { items: decorated, total }
}

export function getDownloadTask(deps: DownloadsDeps, orgId: string, id: string): Promise<DownloadTask> {
  return deps.downloadTasks.get(orgId, id)
}

export async function updateDownloadTask(
  deps: DownloadsDeps,
  platform: Platform,
  id: string,
  input: UpdateDownloadTaskInput,
  actor: { orgId?: string; downloaderId?: string },
): Promise<DownloadTask> {
  const task = await deps.downloadTasks.findRecord(id)
  if (!task) throw new DownloadError('not_found')
  if (actor.orgId && task.orgId !== actor.orgId) throw new DownloadError('not_found')
  if (actor.downloaderId && task.assignedDownloaderId !== actor.downloaderId) throw new DownloadError('forbidden')

  const now = new Date()
  if (actor.downloaderId && task.status === 'pausing' && input.status === 'paused') {
    await deps.downloadTasks.setFields(id, {
      status: 'paused',
      runtime: serializeTaskRuntime(stoppedRuntime(task.runtime)),
      updatedAt: now,
    })
    return deps.downloadTasks.get(task.orgId, id)
  }
  if (actor.downloaderId && task.status === 'canceling' && input.status === 'canceled') {
    await deps.downloadTasks.setFields(id, {
      status: 'canceled',
      runtime: serializeTaskRuntime(stoppedRuntime(task.runtime)),
      finishedAt: task.finishedAt ?? now,
      updatedAt: now,
    })
    return deps.downloadTasks.get(task.orgId, id)
  }
  if (actor.downloaderId && ['pausing', 'paused', 'canceling', 'canceled'].includes(task.status)) {
    throw new DownloadError('invalid_state', `Task is ${task.status}`)
  }
  if (actor.orgId && !actor.downloaderId) {
    const onlyCancel =
      input.status === 'canceled' &&
      input.progress === undefined &&
      input.errorMessage === undefined &&
      input.resultObjectId === undefined &&
      input.runtime === undefined
    if (!onlyCancel) throw new DownloadError('forbidden')
  }
  if (actor.downloaderId && isRetainedSeedReport(input) && task.status !== 'completed') {
    return deps.downloadTasks.get(task.orgId, id)
  }

  let status = input.status ?? task.status
  let billingAuthorizedBytes = task.billingAuthorizedBytes
  let billingChargedBytes = task.billingChargedBytes
  let billingChargedCredits = task.billingChargedCredits
  let billingStatus = task.billingStatus
  const currentRuntime = parseTaskRuntime(task.runtime)
  const nextRuntime = nextTaskRuntime(currentRuntime, input.runtime, input.progress, status, now)
  const currentDownloadedBytes = currentRuntime?.progress?.download.bytes ?? 0
  const nextDownloadedBytes = nextRuntime?.progress?.download.bytes ?? currentDownloadedBytes

  if (actor.downloaderId && nextDownloadedBytes > currentDownloadedBytes) {
    const downloader = await deps.downloaders.getRecord(actor.downloaderId)
    const targetUnits = Math.ceil(nextDownloadedBytes / downloader.remoteDownloadCreditUnitBytes)
    const currentUnits = Math.ceil(task.billingChargedBytes / downloader.remoteDownloadCreditUnitBytes)
    const cloudBaseUrl = platform.getEnv('ZPAN_CLOUD_URL') ?? ZPAN_CLOUD_URL_DEFAULT
    try {
      for (let unit = currentUnits + 1; unit <= targetUnits; unit += 1) {
        await reportRemoteDownloadUnit(deps, {
          cloudBaseUrl,
          orgId: task.orgId,
          downloaderId: actor.downloaderId,
          taskId: task.id,
          unitIndex: unit,
          unitBytes: downloader.remoteDownloadCreditUnitBytes,
          creditsPerUnit: downloader.remoteDownloadCreditPerUnit,
          enabled: downloader.remoteDownloadCreditBillingEnabled,
        })
        billingChargedCredits += downloader.remoteDownloadCreditBillingEnabled
          ? downloader.remoteDownloadCreditPerUnit
          : 0
      }
      if (targetUnits > currentUnits) {
        billingChargedBytes = targetUnits * downloader.remoteDownloadCreditUnitBytes
        billingAuthorizedBytes = billingChargedBytes
        billingStatus = 'ok'
      }
    } catch (error) {
      if (error instanceof RemoteDownloadBillingBlockedError) {
        status = 'suspended'
        billingStatus = 'insufficient_credits'
      } else {
        throw error
      }
    }
  }

  const nextFinishedAt =
    task.finishedAt ?? (input.status !== undefined && ['completed', 'failed', 'canceled'].includes(status) ? now : null)

  await deps.downloadTasks.setFields(id, {
    status,
    billingAuthorizedBytes,
    billingChargedBytes,
    billingChargedCredits,
    billingStatus,
    errorMessage: input.errorMessage === undefined ? task.errorMessage : input.errorMessage,
    resultObjectId: input.resultObjectId === undefined ? task.resultObjectId : input.resultObjectId,
    runtime: serializeTaskRuntime(nextRuntime),
    startedAt: task.startedAt ?? (status === 'downloading' ? now : null),
    finishedAt: nextFinishedAt,
    updatedAt: now,
  })

  return deps.downloadTasks.get(task.orgId, id)
}

// ─── Task action state machine ───────────────────────────────────────────────

// The action determines the response shape: `delete` removes the task and returns
// a tombstone, every other action returns the task's new state. Overloads make
// that precise so callers don't have to narrow a union.
export function performDownloadTaskAction(
  deps: DownloadsDeps,
  orgId: string,
  id: string,
  action: 'delete',
): Promise<{ id: string; deleted: true }>
export function performDownloadTaskAction(
  deps: DownloadsDeps,
  orgId: string,
  id: string,
  action: Exclude<DownloadTaskActionInput['action'], 'delete'>,
): Promise<DownloadTask>
export async function performDownloadTaskAction(
  deps: DownloadsDeps,
  orgId: string,
  id: string,
  action: DownloadTaskActionInput['action'],
): Promise<DownloadTask | { id: string; deleted: true }> {
  const task = await deps.downloadTasks.getRecord(orgId, id)

  if (action === 'delete') {
    if (!TERMINAL_TASK_STATUSES.includes(task.status as (typeof TERMINAL_TASK_STATUSES)[number])) {
      throw new DownloadError('invalid_state', 'Only completed, failed, or canceled tasks can be deleted')
    }
    await deps.downloadTasks.delete(id)
    return { id, deleted: true }
  }

  const now = new Date()
  if (action === 'pause') {
    if (task.status === 'paused') return deps.downloadTasks.get(orgId, id)
    if (!PAUSABLE_TASK_STATUSES.includes(task.status as (typeof PAUSABLE_TASK_STATUSES)[number])) {
      throw new DownloadError('invalid_state', 'Only queued, assigned, or downloading tasks can be paused')
    }
    const status = task.status === 'downloading' ? 'pausing' : 'paused'
    await deps.downloadTasks.setFields(id, {
      status,
      runtime: serializeTaskRuntime(stoppedRuntime(task.runtime)),
      updatedAt: now,
    })
    return deps.downloadTasks.get(orgId, id)
  }

  if (action === 'resume') {
    if (!['paused', 'suspended'].includes(task.status)) {
      throw new DownloadError('invalid_state', 'Only paused or suspended tasks can be resumed')
    }
    await deps.downloadTasks.setFields(id, {
      status: 'queued',
      assignedDownloaderId: null,
      assignedAt: null,
      runtime: clearTaskRuntimeMessageJson(task.runtime),
      updatedAt: now,
    })
    await assignQueuedTasks(deps)
    return deps.downloadTasks.get(orgId, id)
  }

  if (action === 'cancel') {
    if (task.status === 'canceled') return deps.downloadTasks.get(orgId, id)
    if (!CANCELABLE_TASK_STATUSES.includes(task.status as (typeof CANCELABLE_TASK_STATUSES)[number])) {
      throw new DownloadError('invalid_state', 'Only active, interrupted, suspended, or paused tasks can be canceled')
    }
    const status =
      task.assignedDownloaderId &&
      ['assigned', 'downloading', 'uploading', 'pausing', 'interrupted'].includes(task.status)
        ? 'canceling'
        : 'canceled'
    await deps.downloadTasks.setFields(id, {
      status,
      runtime: serializeTaskRuntime(stoppedRuntime(task.runtime)),
      finishedAt: status === 'canceled' ? (task.finishedAt ?? now) : task.finishedAt,
      updatedAt: now,
    })
    return deps.downloadTasks.get(orgId, id)
  }

  if (action === 'retry') {
    if (task.status !== 'failed') {
      throw new DownloadError('invalid_state', 'Only failed tasks can be retried')
    }
    await deps.downloadTasks.setFields(id, {
      status: 'queued',
      assignedDownloaderId: null,
      errorCode: null,
      errorMessage: null,
      resultObjectId: null,
      runtime: clearTaskRuntimeMessageJson(task.runtime),
      assignedAt: null,
      startedAt: null,
      finishedAt: null,
      updatedAt: now,
    })
    await assignQueuedTasks(deps)
    return deps.downloadTasks.get(orgId, id)
  }

  if (action === 'restart') {
    if (!RESTARTABLE_TASK_STATUSES.includes(task.status as (typeof RESTARTABLE_TASK_STATUSES)[number])) {
      throw new DownloadError('invalid_state', 'Only inactive tasks can be restarted')
    }
    await deps.downloadTasks.setFields(id, {
      status: 'queued',
      assignedDownloaderId: null,
      attempt: task.attempt + 1,
      billingAuthorizedBytes: 0,
      billingChargedBytes: 0,
      billingChargedCredits: 0,
      billingStatus: 'none',
      errorCode: null,
      errorMessage: null,
      resultObjectId: null,
      runtime: null,
      assignedAt: null,
      startedAt: null,
      finishedAt: null,
      updatedAt: now,
    })
    await assignQueuedTasks(deps)
    return deps.downloadTasks.get(orgId, id)
  }

  throw new DownloadError('invalid_state')
}

export async function assertTaskUploadAllowed(
  deps: DownloadsDeps,
  params: { taskId: string; downloaderId: string },
): Promise<DownloadTaskRecord> {
  const task = await deps.downloadTasks.findRecord(params.taskId)
  if (!task || task.assignedDownloaderId !== params.downloaderId) throw new DownloadError('forbidden')
  if (!['assigned', 'downloading', 'uploading'].includes(task.status)) throw new DownloadError('invalid_state')
  return task
}

// ─── Assignment / recovery ───────────────────────────────────────────────────

async function assignQueuedTasks(deps: DownloadsDeps): Promise<void> {
  await recoverStaleDownloaderAssignments(deps)
  const tasks = await deps.downloadTasks.listQueued(QUEUE_ASSIGN_BATCH)
  for (const task of tasks) {
    const downloader = await selectDownloader(deps, task.sourceType)
    if (!downloader) continue
    const now = new Date()
    await deps.downloadTasks.setFields(task.id, {
      status: 'assigned',
      assignedDownloaderId: downloader.id,
      assignedAt: now,
      updatedAt: now,
    })
  }
}

async function selectDownloader(deps: DownloadsDeps, sourceType: string): Promise<DownloaderRecord | null> {
  const needed = sourceType === 'http' ? ['http'] : ['magnet', 'torrent']
  const leaseCutoff = new Date(Date.now() - DOWNLOADER_HEARTBEAT_LEASE_MS)
  const candidates = await deps.downloaders.listAssignmentCandidates(leaseCutoff)
  return candidates.find((c) => needed.some((capability) => c.capabilities.includes(capability))) ?? null
}

async function recoverStaleDownloaderAssignments(deps: DownloadsDeps): Promise<void> {
  const now = new Date()
  const leaseCutoff = new Date(now.getTime() - DOWNLOADER_HEARTBEAT_LEASE_MS)
  const staleIds = await deps.downloaders.listStaleIds(leaseCutoff)
  if (staleIds.length === 0) return
  await deps.downloadTasks.requeueAssignedToMany(staleIds, STALE_REQUEUE_STATUSES, now)
  await deps.downloaders.markStaleOffline(staleIds, now)
}

// ─── Upload-token minting ────────────────────────────────────────────────────

async function decorateWithUploadToken(
  deps: DownloadsDeps,
  platform: Platform,
  task: DownloadTask,
  row: DownloadTaskRecord,
): Promise<DownloadTask> {
  const include = DOWNLOADER_TOKEN_TASK_STATUSES.includes(row.status as (typeof DOWNLOADER_TOKEN_TASK_STATUSES)[number])
  if (!include || !task.status.assignment || !row.assignedAt) return task
  task.status.assignment.uploadToken = await createTaskUploadToken(deps, platform, {
    taskId: row.id,
    downloaderId: task.status.assignment.downloaderId,
    orgId: row.orgId,
    targetFolder: row.targetFolder,
    createdByUserId: row.createdByUserId,
    assignedAt: row.assignedAt,
  })
  return task
}

function createTaskUploadToken(
  deps: DownloadsDeps,
  platform: Platform,
  params: {
    taskId: string
    downloaderId: string
    orgId: string
    targetFolder: string
    createdByUserId: string
    assignedAt: Date
  },
): Promise<string> {
  const issuedAt = Math.floor(params.assignedAt.getTime() / 1000)
  const exp = issuedAt + UPLOAD_TOKEN_TTL_SECONDS
  return deps.downloadTokens.signDownloadToken(platform, {
    v: 1,
    typ: 'download-task-upload',
    taskId: params.taskId,
    downloaderId: params.downloaderId,
    orgId: params.orgId,
    targetFolder: params.targetFolder,
    createdByUserId: params.createdByUserId,
    scopes: ['objects:create', 'objects:upload', 'objects:confirm'],
    jti: `${params.taskId}:${params.downloaderId}:${params.assignedAt.getTime()}`,
    iat: issuedAt,
    exp,
  })
}

// ─── Runtime merge helpers ───────────────────────────────────────────────────

function isRetainedSeedReport(input: UpdateDownloadTaskInput): boolean {
  return input.status === undefined && input.runtime?.phase === 'seeding'
}

function nextTaskRuntime(
  current: DownloadTaskRuntime | null,
  input: UpdateDownloadTaskInput['runtime'],
  progress: UpdateDownloadTaskInput['progress'],
  status: string,
  now: Date,
): DownloadTaskRuntime | null {
  const runtime = input === undefined ? current : input
  const merged = mergeTaskRuntime(runtime, progress, now)
  if (!EXECUTABLE_TASK_STATUSES.includes(status as (typeof EXECUTABLE_TASK_STATUSES)[number])) {
    return merged
  }
  return clearTaskRuntimeMessage(merged)
}

function mergeTaskRuntime(
  runtime: DownloadTaskRuntime | null | undefined,
  progress: UpdateDownloadTaskInput['progress'],
  now: Date,
): DownloadTaskRuntime | null {
  const next = runtime ? { ...runtime } : null
  if (!progress) return next
  const base = next ?? {}
  return {
    ...base,
    updatedAt: now.toISOString(),
    progress: mergeTaskProgress(base.progress, progress),
  }
}

function mergeTaskProgress(
  current: DownloadTaskRuntime['progress'] | undefined,
  patch: UpdateDownloadTaskInput['progress'] | DownloadTaskRuntime['progress'] | undefined,
): NonNullable<DownloadTaskRuntime['progress']> {
  return {
    download: {
      bytes: Math.max(patch?.download?.bytes ?? 0, current?.download.bytes ?? 0),
      totalBytes: patch?.download?.totalBytes ?? current?.download.totalBytes ?? null,
      bytesPerSecond: patch?.download?.bytesPerSecond ?? current?.download.bytesPerSecond ?? 0,
    },
    upload: {
      bytes: Math.max(patch?.upload?.bytes ?? 0, current?.upload.bytes ?? 0),
      totalBytes: patch?.upload?.totalBytes ?? current?.upload.totalBytes ?? null,
      bytesPerSecond: patch?.upload?.bytesPerSecond ?? current?.upload.bytesPerSecond ?? 0,
    },
  }
}

function stoppedRuntime(value: string | null): DownloadTaskRuntime | null {
  const runtime = parseTaskRuntime(value)
  if (!runtime?.progress) return runtime
  return {
    ...runtime,
    progress: {
      download: { ...runtime.progress.download, bytesPerSecond: 0 },
      upload: { ...runtime.progress.upload, bytesPerSecond: 0 },
    },
    seeding: runtime.seeding ? { ...runtime.seeding, uploadBytesPerSecond: 0 } : runtime.seeding,
  }
}

function clearTaskRuntimeMessageJson(value: string | null): string | null {
  return serializeTaskRuntime(clearTaskRuntimeMessage(parseTaskRuntime(value)))
}

function clearTaskRuntimeMessage(runtime: DownloadTaskRuntime | null): DownloadTaskRuntime | null {
  if (!runtime?.message) return runtime
  const { message: _message, ...rest } = runtime
  return Object.keys(rest).length > 0 ? rest : null
}

function parseTaskRuntime(value: string | null): DownloadTaskRuntime | null {
  if (!value) return null
  return downloadTaskRuntimeSchema.parse(JSON.parse(value))
}

function serializeTaskRuntime(runtime: DownloadTaskRuntime | null | undefined): string | null {
  return runtime && Object.keys(runtime).length > 0 ? JSON.stringify(runtime) : null
}
