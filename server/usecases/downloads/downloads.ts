import type {
  CreateDownloaderInput,
  CreateDownloadTaskInput,
  DownloaderHeartbeatInput,
  DownloaderHeartbeatResult,
  DownloadTaskActionInput,
  UpdateDownloaderCreditBillingInput,
  UpdateDownloaderInput,
  UpdateDownloadTaskInput,
} from '@shared/schemas'
import { downloadTaskRuntimeSchema } from '@shared/schemas'
import type { Downloader, DownloadTask, DownloadTaskRuntime, DownloadTaskTimelineItem } from '@shared/types'
import { nanoid } from 'nanoid'
import { ZPAN_CLOUD_URL_DEFAULT } from '../../../shared/constants'
import { hasFeature } from '../../domain/licensing'
import type { Platform } from '../../platform/interface'
import type {
  ActivityActorType,
  ActivityEvent,
  ActivityRepo,
  DownloaderRepo,
  DownloadTaskRecord,
  DownloadTaskRepo,
  DownloadTokenGateway,
  LicenseBindingRepo,
  LicensingCloudGateway,
  ListDownloadTasksFilters,
  MatterRepo,
  RemoteDownloadUsageRepo,
  StorageRepo,
  UpdateDownloadTaskFields,
} from '../ports'
import { DownloadError, featureBlocked } from '../ports'
import { loadBindingState } from '../site/licensing'
import { ensureDownloadFolderPath } from './download-folders'
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
  activity: ActivityRepo
  matter: MatterRepo
  storages: StorageRepo
}

const DEFAULT_REMOTE_DOWNLOAD_UNIT_BYTES = 100 * 1024 * 1024
const UPLOAD_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60
const DOWNLOADER_HEARTBEAT_LEASE_MS = 90_000
const QUEUE_ASSIGN_BATCH = 20
const CONTROL_TASK_PAGE_SIZE = 100
const DOWNLOADER_ACTIVE_NEXT_POLL_SECONDS = 5
const DOWNLOADER_IDLE_NEXT_POLL_SECONDS = 60
const DOWNLOAD_TASK_TARGET_TYPE = 'download_task'
const TASK_EVENT_PAGE_SIZE = 100

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
const DELETE_REQUESTED_RUNTIME_STATE = 'delete_requested'
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
const LIFECYCLE_FIELDS = [
  'resolveStartedAt',
  'resolveCompletedAt',
  'downloadCompletedAt',
  'ingestStartedAt',
  'ingestCompletedAt',
  'seedingStartedAt',
  'seedingStoppedAt',
] as const

type LifecycleField = (typeof LIFECYCLE_FIELDS)[number]
type TaskLifecycleFields = Partial<Pick<UpdateDownloadTaskFields, LifecycleField>>

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

export async function updateDownloaderCreditBilling(
  deps: DownloadsDeps,
  id: string,
  input: UpdateDownloaderCreditBillingInput,
): Promise<Downloader> {
  await deps.downloaders.getRecord(id) // throws not_found
  if (input.enabled && !hasFeature('quota_store', await loadBindingState(deps))) {
    throw featureBlocked('Feature not available', {
      metadata: { feature: 'quota_store' },
    })
  }
  await deps.downloaders.update(
    id,
    {
      remoteDownloadCreditBillingEnabled: input.enabled,
      remoteDownloadCreditUnitBytes: input.unitBytes,
      remoteDownloadCreditPerUnit: input.creditsPerUnit,
    },
    new Date(),
  )
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
  platform: Platform,
  downloaderId: string,
  heartbeat: DownloaderHeartbeatInput,
): Promise<DownloaderHeartbeatResult> {
  const downloader = await deps.downloaders.getRecord(downloaderId) // throws not_found
  const now = new Date()
  await deps.downloaders.recordHeartbeat(downloaderId, heartbeat, downloader.enabled, now)
  await recoverStaleDownloaderAssignments(deps)
  if (downloader.enabled) {
    await claimQueuedTasksForDownloader(deps, {
      id: downloaderId,
      capabilities: heartbeat.capabilities,
      freeSlots: Math.max(0, heartbeat.maxConcurrentTasks - heartbeat.currentTasks),
      now,
    })
  }
  const [updated, assignments, controls] = await Promise.all([
    deps.downloaders.get(downloaderId),
    listDownloadTasks(deps, platform, {
      downloaderId,
      statuses: ['assigned', 'downloading', 'interrupted', 'uploading'],
      page: 1,
      pageSize: Math.max(heartbeat.maxConcurrentTasks, heartbeat.currentTasks, 1),
      includeUploadToken: true,
    }),
    listDownloadTasks(deps, platform, {
      downloaderId,
      statuses: ['pausing', 'canceling', 'suspended'],
      page: 1,
      pageSize: CONTROL_TASK_PAGE_SIZE,
      includeUploadToken: true,
    }),
  ])
  return {
    ...updated,
    assignments: assignments.items,
    controls: controls.items,
    nextPollAfterSeconds:
      assignments.items.length > 0 || controls.items.length > 0 || heartbeat.currentTasks > 0
        ? DOWNLOADER_ACTIVE_NEXT_POLL_SECONDS
        : DOWNLOADER_IDLE_NEXT_POLL_SECONDS,
  }
}

// ─── Download task CRUD ──────────────────────────────────────────────────────

export async function createDownloadTask(
  deps: DownloadsDeps,
  orgId: string,
  userId: string,
  input: CreateDownloadTaskInput,
): Promise<DownloadTask> {
  const targetFolder = await ensureDownloadFolderPath(deps, {
    orgId,
    folderPath: input.targetFolder,
    actorId: userId,
  })
  const now = new Date()
  const id = nanoid()
  await deps.downloadTasks.insert({
    id,
    orgId,
    createdByUserId: userId,
    sourceType: input.source.type,
    sourceUri: input.source.uri,
    displayName: input.name ?? null,
    targetFolder,
    category: input.category ?? null,
    tags: input.tags ?? [],
    assignedDownloaderId: null,
    status: 'queued',
    assignedAt: null,
    now,
  })
  await recordTaskActivity(deps, {
    task: {
      id,
      orgId,
      createdByUserId: userId,
      displayName: input.name ?? null,
      sourceUri: input.source.uri,
    },
    action: 'download_task_created',
    actorType: 'user',
    metadata: { sourceType: input.source.type, targetFolder },
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

export async function getDownloadTaskTimeline(
  deps: DownloadsDeps,
  orgId: string,
  id: string,
): Promise<{ items: DownloadTaskTimelineItem[] }> {
  const task = await deps.downloadTasks.getRecord(orgId, id)
  const activity = await deps.activity.listByTarget({
    orgId,
    targetType: DOWNLOAD_TASK_TARGET_TYPE,
    targetId: id,
    page: 1,
    pageSize: TASK_EVENT_PAGE_SIZE,
  })
  const activityItems = activity.items.map((event) => activityTimelineItem(task.id, event))
  const activityActions = new Set(activityItems.map((item) => item.action))
  const taskItems = taskLifecycleTimelineItems(task).filter((item) => !activityActions.has(item.action))
  return { items: [...activityItems, ...taskItems].sort((a, b) => Date.parse(b.time) - Date.parse(a.time)) }
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
    if (parseTaskRuntime(task.runtime)?.state === DELETE_REQUESTED_RUNTIME_STATE) {
      await deps.downloadTasks.delete(id)
      return downloadTaskFromRecord({
        ...task,
        status: 'canceled',
        runtime: null,
        finishedAt: task.finishedAt ?? now,
        updatedAt: now,
      })
    }
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
  let nextRuntime = nextTaskRuntime(currentRuntime, input.runtime, input.progress, status, now)
  const currentDownloadedBytes = currentRuntime?.progress?.download.bytes ?? 0
  const nextDownloadedBytes = nextRuntime?.progress?.download.bytes ?? currentDownloadedBytes
  const totalBytes = nextRuntime?.progress?.download.totalBytes ?? 0

  // Pre-authorize remote-download credits one unit ahead of the bytes pulled, so
  // the downloader never fetches bytes it hasn't paid for. The first unit is
  // charged on entry into 'downloading' (before any bytes), which gates a
  // no-credit task out of downloading entirely. Capped at the task's total size,
  // so the lifetime charge stays exactly ceil(total / unit) — same as before,
  // only billed earlier.
  if (actor.downloaderId && (status === 'downloading' || nextDownloadedBytes > currentDownloadedBytes)) {
    const downloader = await deps.downloaders.getRecord(actor.downloaderId)
    const unitBytes = downloader.remoteDownloadCreditUnitBytes
    const totalUnits = totalBytes > 0 ? Math.ceil(totalBytes / unitBytes) : Number.POSITIVE_INFINITY
    const targetUnits = Math.min(Math.ceil(nextDownloadedBytes / unitBytes) + 1, totalUnits)
    const currentUnits = Math.ceil(task.billingChargedBytes / unitBytes)
    const cloudBaseUrl = platform.getEnv('ZPAN_CLOUD_URL') ?? ZPAN_CLOUD_URL_DEFAULT
    try {
      for (let unit = currentUnits + 1; unit <= targetUnits; unit += 1) {
        await reportRemoteDownloadUnit(deps, {
          cloudBaseUrl,
          orgId: task.orgId,
          downloaderId: actor.downloaderId,
          taskId: task.id,
          unitIndex: unit,
          unitBytes,
          creditsPerUnit: downloader.remoteDownloadCreditPerUnit,
          enabled: downloader.remoteDownloadCreditBillingEnabled,
        })
        billingChargedCredits += downloader.remoteDownloadCreditBillingEnabled
          ? downloader.remoteDownloadCreditPerUnit
          : 0
      }
      if (targetUnits > currentUnits) {
        billingChargedBytes = targetUnits * unitBytes
        billingAuthorizedBytes = billingChargedBytes
        billingStatus = 'ok'
      }
    } catch (error) {
      if (error instanceof RemoteDownloadBillingBlockedError) {
        status = 'suspended'
        billingStatus = 'insufficient_credits'
        nextRuntime = { ...(nextRuntime ?? {}), message: 'Suspended: insufficient remote-download credits' }
      } else {
        throw error
      }
    }
  }

  const nextFinishedAt =
    task.finishedAt ?? (input.status !== undefined && ['completed', 'failed', 'canceled'].includes(status) ? now : null)

  const lifecycleFields = taskLifecycleFields(task, currentRuntime, nextRuntime, status, now)
  const fields = {
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
    ...lifecycleFields,
  }

  await deps.downloadTasks.setFields(id, fields)
  await recordUpdateActivity(deps, task, {
    input,
    status,
    previousStatus: task.status,
    runtime: nextRuntime,
    lifecycleFields,
    billingStatus,
    actorType: actor.downloaderId ? 'downloader' : 'user',
    actorRef: actor.downloaderId ?? null,
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
  const now = new Date()

  if (action === 'delete') {
    if (!TERMINAL_TASK_STATUSES.includes(task.status as (typeof TERMINAL_TASK_STATUSES)[number])) {
      throw new DownloadError('invalid_state', 'Only completed, failed, or canceled tasks can be deleted')
    }
    if (task.assignedDownloaderId) {
      await deps.downloadTasks.setFields(id, {
        status: 'canceling',
        runtime: serializeTaskRuntime({
          ...(parseTaskRuntime(task.runtime) ?? {}),
          state: DELETE_REQUESTED_RUNTIME_STATE,
        }),
        updatedAt: now,
      })
      await recordTaskActivity(deps, { task, action: 'download_task_deleted', actorType: 'user' })
      return { id, deleted: true }
    }
    await recordTaskActivity(deps, { task, action: 'download_task_deleted', actorType: 'user' })
    await deps.downloadTasks.delete(id)
    return { id, deleted: true }
  }

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
    await recordTaskActivity(deps, {
      task,
      action: status === 'pausing' ? 'download_task_pause_requested' : 'download_task_paused',
      actorType: 'user',
    })
    return deps.downloadTasks.get(orgId, id)
  }

  if (action === 'resume') {
    if (!['paused', 'suspended'].includes(task.status)) {
      throw new DownloadError('invalid_state', 'Only paused or suspended tasks can be resumed')
    }
    const targetFolder = await ensureTaskTargetFolder(deps, task)
    await deps.downloadTasks.setFields(id, {
      targetFolder,
      status: 'queued',
      assignedDownloaderId: null,
      assignedAt: null,
      runtime: clearTaskRuntimeMessageJson(task.runtime),
      updatedAt: now,
    })
    await recordTaskActivity(deps, { task, action: 'download_task_resume_requested', actorType: 'user' })
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
    await recordTaskActivity(deps, {
      task,
      action: status === 'canceling' ? 'download_task_cancel_requested' : 'download_task_canceled',
      actorType: 'user',
    })
    return deps.downloadTasks.get(orgId, id)
  }

  if (action === 'retry') {
    if (task.status !== 'failed') {
      throw new DownloadError('invalid_state', 'Only failed tasks can be retried')
    }
    const targetFolder = await ensureTaskTargetFolder(deps, task)
    await deps.downloadTasks.setFields(id, {
      targetFolder,
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
    await recordTaskActivity(deps, { task, action: 'download_task_retry_requested', actorType: 'user' })
    return deps.downloadTasks.get(orgId, id)
  }

  if (action === 'restart') {
    if (!RESTARTABLE_TASK_STATUSES.includes(task.status as (typeof RESTARTABLE_TASK_STATUSES)[number])) {
      throw new DownloadError('invalid_state', 'Only inactive tasks can be restarted')
    }
    const targetFolder = await ensureTaskTargetFolder(deps, task)
    await deps.downloadTasks.setFields(id, {
      targetFolder,
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
    await recordTaskActivity(deps, { task, action: 'download_task_restart_requested', actorType: 'user' })
    return deps.downloadTasks.get(orgId, id)
  }

  throw new DownloadError('invalid_state')
}

async function ensureTaskTargetFolder(deps: DownloadsDeps, task: DownloadTaskRecord): Promise<string> {
  return ensureDownloadFolderPath(deps, {
    orgId: task.orgId,
    folderPath: task.targetFolder,
    actorId: task.createdByUserId,
  })
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

async function claimQueuedTasksForDownloader(
  deps: DownloadsDeps,
  params: { id: string; capabilities: string[]; freeSlots: number; now: Date },
): Promise<void> {
  if (params.freeSlots <= 0) return
  const tasks = await deps.downloadTasks.listQueued(QUEUE_ASSIGN_BATCH)
  let remaining = params.freeSlots
  for (const task of tasks) {
    if (remaining <= 0) break
    if (!canDownloaderRunSource(params.capabilities, task.sourceType)) continue
    if (await deps.downloadTasks.claimQueued(task.id, params.id, params.now)) {
      remaining -= 1
      await recordTaskActivity(deps, {
        task,
        action: 'download_task_assigned',
        actorType: 'downloader',
        actorRef: params.id,
        metadata: { downloaderId: params.id },
      })
    }
  }
}

function canDownloaderRunSource(capabilities: string[], sourceType: string): boolean {
  const needed = sourceType === 'http' ? ['http'] : ['magnet', 'torrent']
  return needed.some((capability) => capabilities.includes(capability))
}

async function recoverStaleDownloaderAssignments(deps: DownloadsDeps): Promise<void> {
  const now = new Date()
  const leaseCutoff = new Date(now.getTime() - DOWNLOADER_HEARTBEAT_LEASE_MS)
  // Settle canceling/pausing tasks for any unreachable downloader — including ones
  // a prior sweep already marked offline — since their owner will never ack the
  // transition. Idempotent, so it runs every sweep regardless of new staleness.
  // Stale 'seeding' can also linger on a completed task whose downloader was
  // deleted — its id is gone from the table, so it never shows up in any stale
  // list. Clear by the live-downloader set instead, every sweep (idempotent).
  await deps.downloadTasks.clearStaleSeedingRuntime(leaseCutoff, now)
  const unreachableIds = await deps.downloaders.listUnreachableIds(leaseCutoff)
  if (unreachableIds.length > 0) {
    const controls = await listTasksForDownloaders(deps, unreachableIds, ['canceling', 'pausing'])
    await deps.downloadTasks.resolveControlAssignedToMany(unreachableIds, now)
    await Promise.all(
      controls.map((task) =>
        recordTaskActivity(deps, {
          task,
          action: 'download_stale_control_resolved',
          metadata: { previousStatus: task.status, downloaderId: task.assignedDownloaderId },
        }),
      ),
    )
  }
  // Requeue in-flight work and flip status to offline only on the online→offline
  // transition, so already-handled tasks are not re-queued repeatedly.
  const staleIds = await deps.downloaders.listStaleIds(leaseCutoff)
  if (staleIds.length === 0) return
  const requeued = await listTasksForDownloaders(deps, staleIds, STALE_REQUEUE_STATUSES)
  await deps.downloadTasks.requeueAssignedToMany(staleIds, STALE_REQUEUE_STATUSES, now)
  await deps.downloaders.markStaleOffline(staleIds, now)
  await Promise.all(
    requeued.map((task) =>
      recordTaskActivity(deps, {
        task,
        action: 'download_stale_requeued',
        metadata: { previousStatus: task.status, downloaderId: task.assignedDownloaderId },
      }),
    ),
  )
}

async function listTasksForDownloaders(
  deps: DownloadsDeps,
  downloaderIds: string[],
  statuses: readonly string[],
): Promise<DownloadTaskRecord[]> {
  const pages = await Promise.all(
    downloaderIds.map((downloaderId) =>
      deps.downloadTasks.list({ downloaderId, statuses: [...statuses], page: 1, pageSize: CONTROL_TASK_PAGE_SIZE }),
    ),
  )
  return pages.flatMap((page) => page.rows)
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
  let runtime = input === undefined ? current : input
  // Transfer progress is cumulative, not a per-report snapshot: a runtime report
  // that omits it (e.g. a seeding-stopped report carrying only phase) must not
  // erase the download/upload totals already recorded. Carry the current
  // progress forward; mergeTaskRuntime still applies any progress patch on top.
  if (input && !input.progress && current?.progress) {
    runtime = { ...input, progress: current.progress }
  }
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

function taskLifecycleFields(
  task: DownloadTaskRecord,
  current: DownloadTaskRuntime | null,
  next: DownloadTaskRuntime | null,
  status: string,
  now: Date,
): TaskLifecycleFields {
  const fields: TaskLifecycleFields = {}
  const currentPhase = current?.phase
  const nextPhase = next?.phase

  if (!task.resolveStartedAt && nextPhase === 'metadata') fields.resolveStartedAt = now
  if (!task.resolveCompletedAt && currentPhase === 'metadata' && nextPhase && nextPhase !== 'metadata') {
    fields.resolveCompletedAt = now
  }
  if (!task.downloadCompletedAt && (status === 'uploading' || status === 'completed' || nextPhase === 'uploading')) {
    fields.downloadCompletedAt = now
  }
  if (!task.ingestStartedAt && (status === 'uploading' || nextPhase === 'uploading')) fields.ingestStartedAt = now
  if (!task.ingestCompletedAt && status === 'completed') fields.ingestCompletedAt = now
  if (!task.seedingStartedAt && nextPhase === 'seeding') fields.seedingStartedAt = now
  if (!task.seedingStoppedAt && currentPhase === 'seeding' && nextPhase && nextPhase !== 'seeding') {
    fields.seedingStoppedAt = now
  }
  return fields
}

async function recordUpdateActivity(
  deps: DownloadsDeps,
  task: DownloadTaskRecord,
  params: {
    input: UpdateDownloadTaskInput
    status: string
    previousStatus: string
    runtime: DownloadTaskRuntime | null
    lifecycleFields: TaskLifecycleFields
    billingStatus: string
    actorType: ActivityActorType
    actorRef: string | null
  },
): Promise<void> {
  for (const field of LIFECYCLE_FIELDS) {
    if (!params.lifecycleFields[field]) continue
    await recordTaskActivity(deps, {
      task,
      action: lifecycleAction(field),
      actorType: params.actorType,
      actorRef: params.actorRef,
      metadata: runtimeMetadata(params.runtime),
    })
  }

  if (params.previousStatus !== params.status) {
    await recordTaskActivity(deps, {
      task,
      action: statusAction(params.status),
      actorType: params.actorType,
      actorRef: params.actorRef,
      metadata: {
        from: params.previousStatus,
        to: params.status,
        ...runtimeMetadata(params.runtime),
      },
    })
  }

  if (params.input.errorMessage) {
    await recordTaskActivity(deps, {
      task,
      action: 'download_task_error',
      actorType: params.actorType,
      actorRef: params.actorRef,
      metadata: { message: params.input.errorMessage },
    })
  }

  if (params.billingStatus === 'insufficient_credits' && task.billingStatus !== 'insufficient_credits') {
    await recordTaskActivity(deps, {
      task,
      action: 'download_task_billing_suspended',
      actorType: params.actorType,
      actorRef: params.actorRef,
      metadata: { reason: 'insufficient_credits' },
    })
  }
}

function lifecycleAction(field: LifecycleField): string {
  if (field === 'resolveStartedAt') return 'download_resolve_started'
  if (field === 'resolveCompletedAt') return 'download_resolve_completed'
  if (field === 'downloadCompletedAt') return 'download_completed'
  if (field === 'ingestStartedAt') return 'download_ingest_started'
  if (field === 'ingestCompletedAt') return 'download_ingest_completed'
  if (field === 'seedingStartedAt') return 'download_seeding_started'
  return 'download_seeding_stopped'
}

function statusAction(status: string): string {
  if (status === 'downloading') return 'download_task_started'
  if (status === 'uploading') return 'download_task_ingesting'
  if (status === 'completed') return 'download_task_completed'
  if (status === 'failed') return 'download_task_failed'
  if (status === 'canceled') return 'download_task_canceled'
  if (status === 'suspended') return 'download_task_suspended'
  if (status === 'paused') return 'download_task_paused'
  if (status === 'pausing') return 'download_task_pause_requested'
  if (status === 'canceling') return 'download_task_cancel_requested'
  if (status === 'queued') return 'download_task_queued'
  if (status === 'assigned') return 'download_task_assigned'
  return `download_task_${status}`
}

async function recordTaskActivity(
  deps: DownloadsDeps,
  input: {
    task: Pick<DownloadTaskRecord, 'id' | 'orgId' | 'createdByUserId' | 'displayName' | 'sourceUri'>
    action: string
    actorType?: ActivityActorType
    actorRef?: string | null
    metadata?: Record<string, unknown>
  },
): Promise<void> {
  await deps.activity.record({
    orgId: input.task.orgId,
    userId: input.task.createdByUserId,
    actorType: input.actorType ?? 'system',
    actorRef: input.actorRef ?? (input.actorType ? null : 'download-task-service'),
    action: input.action,
    targetType: DOWNLOAD_TASK_TARGET_TYPE,
    targetId: input.task.id,
    targetName: taskTargetName(input.task),
    metadata: input.metadata,
  })
}

function taskTargetName(task: Pick<DownloadTaskRecord, 'displayName' | 'sourceUri'>): string {
  return task.displayName || task.sourceUri
}

function runtimeMetadata(runtime: DownloadTaskRuntime | null): Record<string, unknown> {
  return {
    ...(runtime?.engine ? { engine: runtime.engine } : {}),
    ...(runtime?.phase ? { phase: runtime.phase } : {}),
    ...(runtime?.state ? { engineState: runtime.state } : {}),
    ...(runtime?.torrent?.infoHash ? { infoHash: runtime.torrent.infoHash } : {}),
    ...(runtime?.trackers ? { trackerCount: runtime.trackers.length } : {}),
    ...(runtime?.torrent?.seeders !== undefined ? { seeders: runtime.torrent.seeders } : {}),
    ...(runtime?.torrent?.peers !== undefined ? { peers: runtime.torrent.peers } : {}),
  }
}

function taskLifecycleTimelineItems(task: DownloadTaskRecord): DownloadTaskTimelineItem[] {
  const items = [
    lifecycleTimelineItem(task, 'download_task_created', task.createdAt),
    task.assignedAt && lifecycleTimelineItem(task, 'download_task_assigned', task.assignedAt),
    task.startedAt && lifecycleTimelineItem(task, 'download_task_started', task.startedAt),
    task.resolveStartedAt && lifecycleTimelineItem(task, 'download_resolve_started', task.resolveStartedAt),
    task.resolveCompletedAt && lifecycleTimelineItem(task, 'download_resolve_completed', task.resolveCompletedAt),
    task.downloadCompletedAt && lifecycleTimelineItem(task, 'download_completed', task.downloadCompletedAt),
    task.ingestStartedAt && lifecycleTimelineItem(task, 'download_ingest_started', task.ingestStartedAt),
    task.ingestCompletedAt && lifecycleTimelineItem(task, 'download_ingest_completed', task.ingestCompletedAt),
    task.seedingStartedAt && lifecycleTimelineItem(task, 'download_seeding_started', task.seedingStartedAt),
    task.seedingStoppedAt && lifecycleTimelineItem(task, 'download_seeding_stopped', task.seedingStoppedAt),
    task.finishedAt && lifecycleTimelineItem(task, statusAction(task.status), task.finishedAt),
  ].filter(Boolean) as DownloadTaskTimelineItem[]
  return items
}

function lifecycleTimelineItem(task: DownloadTaskRecord, action: string, time: Date): DownloadTaskTimelineItem {
  return {
    id: `task:${action}:${time.getTime()}`,
    taskId: task.id,
    time: time.toISOString(),
    source: 'task',
    action,
    title: actionTitle(action),
    detail: null,
    severity: actionSeverity(action),
    metadata: null,
  }
}

function activityTimelineItem(taskId: string, event: ActivityEvent): DownloadTaskTimelineItem {
  const metadata = parseActivityMetadata(event.metadata)
  return {
    id: event.id,
    taskId,
    time: event.createdAt.toISOString(),
    source: 'activity',
    action: event.action,
    title: actionTitle(event.action),
    detail: actionDetail(metadata),
    severity: actionSeverity(event.action),
    metadata,
  }
}

function parseActivityMetadata(value: string | null): Record<string, unknown> | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function actionTitle(action: string): string {
  const titles: Record<string, string> = {
    download_task_created: 'Task created',
    download_task_assigned: 'Assigned to downloader',
    download_task_queued: 'Queued',
    download_task_started: 'Download started',
    download_task_ingesting: 'Ingesting',
    download_task_completed: 'Task completed',
    download_task_failed: 'Task failed',
    download_task_canceled: 'Task canceled',
    download_task_suspended: 'Task suspended',
    download_task_paused: 'Task paused',
    download_task_pause_requested: 'Pause requested',
    download_task_resume_requested: 'Resume requested',
    download_task_cancel_requested: 'Cancel requested',
    download_task_retry_requested: 'Retry requested',
    download_task_restart_requested: 'Restart requested',
    download_task_deleted: 'Task deleted',
    download_task_error: 'Error reported',
    download_task_billing_suspended: 'Billing suspended',
    download_resolve_started: 'Resolving source',
    download_resolve_completed: 'Source resolved',
    download_completed: 'Download completed',
    download_ingest_started: 'Ingest started',
    download_ingest_completed: 'Ingest completed',
    download_seeding_started: 'Seeding started',
    download_seeding_stopped: 'Seeding stopped',
    download_stale_requeued: 'Requeued after downloader went offline',
    download_stale_control_resolved: 'Resolved after downloader went offline',
  }
  return titles[action] ?? action.replace(/_/g, ' ')
}

function actionDetail(metadata: Record<string, unknown> | null): string | null {
  if (!metadata) return null
  if (typeof metadata.message === 'string') return metadata.message
  if (typeof metadata.reason === 'string') return metadata.reason
  const parts = [
    typeof metadata.engine === 'string' ? metadata.engine : null,
    typeof metadata.phase === 'string' ? metadata.phase : null,
    typeof metadata.infoHash === 'string' ? `infoHash ${metadata.infoHash}` : null,
    typeof metadata.trackerCount === 'number' ? `${metadata.trackerCount} trackers` : null,
    typeof metadata.seeders === 'number' ? `${metadata.seeders} seeders` : null,
    typeof metadata.peers === 'number' ? `${metadata.peers} peers` : null,
  ].filter(Boolean)
  if (parts.length > 0) return parts.join(' · ')
  if (typeof metadata.from === 'string' && typeof metadata.to === 'string') return `${metadata.from} -> ${metadata.to}`
  return null
}

function actionSeverity(action: string): DownloadTaskTimelineItem['severity'] {
  if (action.includes('failed') || action.includes('error')) return 'error'
  if (action.includes('suspended') || action.includes('offline')) return 'warning'
  if (action.includes('completed')) return 'success'
  return 'info'
}

function downloadTaskFromRecord(row: DownloadTaskRecord): DownloadTask {
  const runtime = parseTaskRuntime(row.runtime)
  return {
    id: row.id,
    orgId: row.orgId,
    createdBy: row.createdByUserId,
    spec: {
      source: {
        type: row.sourceType as DownloadTask['spec']['source']['type'],
        uri: row.sourceUri,
      },
      destination: {
        folder: row.targetFolder,
        name: row.displayName,
      },
      labels: {
        category: row.category,
        tags: parseStringArray(row.tags),
      },
    },
    status: {
      state: row.status as DownloadTask['status']['state'],
      attempt: row.attempt,
      assignment: row.assignedDownloaderId
        ? { downloaderId: row.assignedDownloaderId, assignedAt: row.assignedAt?.toISOString() ?? null }
        : null,
      progress: runtime?.progress ?? {
        download: { bytes: 0, totalBytes: null, bytesPerSecond: 0 },
        upload: { bytes: 0, totalBytes: null, bytesPerSecond: 0 },
      },
      billing: {
        state: row.billingStatus as DownloadTask['status']['billing']['state'],
        authorizedBytes: row.billingAuthorizedBytes,
        chargedBytes: row.billingChargedBytes,
        chargedCredits: row.billingChargedCredits,
      },
      output: row.resultObjectId ? { objectId: row.resultObjectId } : null,
      runtime,
      error: row.errorMessage ? { code: row.errorCode, message: row.errorMessage } : null,
      resolveStartedAt: row.resolveStartedAt?.toISOString() ?? null,
      resolveCompletedAt: row.resolveCompletedAt?.toISOString() ?? null,
      downloadCompletedAt: row.downloadCompletedAt?.toISOString() ?? null,
      ingestStartedAt: row.ingestStartedAt?.toISOString() ?? null,
      ingestCompletedAt: row.ingestCompletedAt?.toISOString() ?? null,
      seedingStartedAt: row.seedingStartedAt?.toISOString() ?? null,
      seedingStoppedAt: row.seedingStoppedAt?.toISOString() ?? null,
      startedAt: row.startedAt?.toISOString() ?? null,
      finishedAt: row.finishedAt?.toISOString() ?? null,
      updatedAt: row.updatedAt.toISOString(),
    },
    createdAt: row.createdAt.toISOString(),
  }
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function parseTaskRuntime(value: string | null): DownloadTaskRuntime | null {
  if (!value) return null
  return downloadTaskRuntimeSchema.parse(JSON.parse(value))
}

function serializeTaskRuntime(runtime: DownloadTaskRuntime | null | undefined): string | null {
  return runtime && Object.keys(runtime).length > 0 ? JSON.stringify(runtime) : null
}
