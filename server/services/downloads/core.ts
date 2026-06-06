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
import { and, asc, count, desc, eq, inArray, like, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { downloaders, downloadTasks } from '../../db/schema'
import type { Platform } from '../../platform/interface'
import { hashDownloadToken, signDownloadToken } from '../download-tokens'
import { RemoteDownloadBillingBlockedError, reportRemoteDownloadUnit } from '../remote-download-usage'
import { parseCapabilities, toDownloader, toDownloadTask } from './mappers'
import { DownloadError, type DownloaderRow, type DownloadTaskRow } from './types'

const DEFAULT_REMOTE_DOWNLOAD_UNIT_BYTES = 100 * 1024 * 1024
const UPLOAD_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60
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

export async function createDownloader(
  platform: Platform,
  input: CreateDownloaderInput,
  userId: string,
): Promise<{ downloader: Downloader; token: string }> {
  const now = new Date()
  const id = nanoid()
  const jti = nanoid()
  const token = await signDownloadToken(platform, {
    v: 1,
    typ: 'downloader',
    downloaderId: id,
    jti,
    iat: Math.floor(now.getTime() / 1000),
  })
  await platform.db.insert(downloaders).values({
    id,
    name: input.name,
    tokenHash: await hashDownloadToken(platform, token),
    tokenJti: jti,
    status: 'offline',
    enabled: true,
    version: input.heartbeat.version,
    hostname: input.heartbeat.hostname,
    platform: input.heartbeat.platform,
    arch: input.heartbeat.arch,
    engine: input.heartbeat.engine,
    capabilities: JSON.stringify(input.heartbeat.capabilities),
    maxConcurrentTasks: input.heartbeat.maxConcurrentTasks,
    currentTasks: input.heartbeat.currentTasks,
    downloadBps: input.heartbeat.downloadBps,
    uploadBps: input.heartbeat.uploadBps,
    freeDiskBytes: input.heartbeat.freeDiskBytes,
    remoteDownloadCreditBillingEnabled: false,
    remoteDownloadCreditUnitBytes: DEFAULT_REMOTE_DOWNLOAD_UNIT_BYTES,
    remoteDownloadCreditPerUnit: 1,
    lastHeartbeatAt: null,
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
  })
  return { downloader: await getDownloader(platform, id), token }
}

export async function listDownloaders(platform: Platform): Promise<Downloader[]> {
  const rows = await platform.db.select().from(downloaders).orderBy(desc(downloaders.createdAt))
  return rows.map(toDownloader)
}

export async function getDownloader(platform: Platform, id: string): Promise<Downloader> {
  const rows = await platform.db.select().from(downloaders).where(eq(downloaders.id, id)).limit(1)
  if (!rows[0]) throw new DownloadError('not_found')
  return toDownloader(rows[0])
}

export async function updateDownloader(
  platform: Platform,
  id: string,
  input: UpdateDownloaderInput,
): Promise<Downloader> {
  const rows = await platform.db.select({ id: downloaders.id }).from(downloaders).where(eq(downloaders.id, id)).limit(1)
  if (!rows[0]) throw new DownloadError('not_found')
  const now = new Date()
  await platform.db
    .update(downloaders)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.enabled !== undefined
        ? { enabled: input.enabled, status: input.enabled ? 'offline' : 'disabled' }
        : {}),
      ...(input.remoteDownloadCreditBillingEnabled !== undefined
        ? { remoteDownloadCreditBillingEnabled: input.remoteDownloadCreditBillingEnabled }
        : {}),
      ...(input.remoteDownloadCreditUnitBytes !== undefined
        ? { remoteDownloadCreditUnitBytes: input.remoteDownloadCreditUnitBytes }
        : {}),
      ...(input.remoteDownloadCreditPerUnit !== undefined
        ? { remoteDownloadCreditPerUnit: input.remoteDownloadCreditPerUnit }
        : {}),
      updatedAt: now,
    })
    .where(eq(downloaders.id, id))
  return getDownloader(platform, id)
}

export async function deleteDownloader(platform: Platform, id: string): Promise<{ id: string; deleted: true }> {
  const rows = await platform.db.select({ id: downloaders.id }).from(downloaders).where(eq(downloaders.id, id)).limit(1)
  if (!rows[0]) throw new DownloadError('not_found')
  const now = new Date()

  await platform.db
    .update(downloadTasks)
    .set({
      status: 'queued',
      assignedDownloaderId: null,
      runtime: null,
      assignedAt: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(downloadTasks.assignedDownloaderId, id),
        inArray(downloadTasks.status, [
          'queued',
          'assigned',
          'downloading',
          'suspended',
          'pausing',
          'paused',
          'interrupted',
          'uploading',
          'canceling',
        ]),
      ),
    )
  await platform.db.delete(downloaders).where(eq(downloaders.id, id))
  return { id, deleted: true }
}

export async function recordDownloaderHeartbeat(
  platform: Platform,
  downloaderId: string,
  heartbeat: DownloaderHeartbeatInput,
): Promise<Downloader> {
  const rows = await platform.db
    .select({ id: downloaders.id, enabled: downloaders.enabled })
    .from(downloaders)
    .where(eq(downloaders.id, downloaderId))
    .limit(1)
  if (!rows[0]) throw new DownloadError('not_found')
  const now = new Date()
  await platform.db
    .update(downloaders)
    .set({
      status: rows[0].enabled ? 'online' : 'disabled',
      version: heartbeat.version,
      hostname: heartbeat.hostname,
      platform: heartbeat.platform,
      arch: heartbeat.arch,
      engine: heartbeat.engine,
      capabilities: JSON.stringify(heartbeat.capabilities),
      maxConcurrentTasks: heartbeat.maxConcurrentTasks,
      currentTasks: heartbeat.currentTasks,
      downloadBps: heartbeat.downloadBps,
      uploadBps: heartbeat.uploadBps,
      freeDiskBytes: heartbeat.freeDiskBytes,
      lastHeartbeatAt: now,
      updatedAt: now,
    })
    .where(eq(downloaders.id, downloaderId))
  await assignQueuedTasks(platform)
  return getDownloader(platform, downloaderId)
}

export async function createDownloadTask(
  platform: Platform,
  orgId: string,
  userId: string,
  input: CreateDownloadTaskInput,
): Promise<DownloadTask> {
  const now = new Date()
  const id = nanoid()
  const assigned = await selectDownloader(platform, input.source.type)
  await platform.db.insert(downloadTasks).values({
    id,
    orgId,
    createdByUserId: userId,
    sourceType: input.source.type,
    sourceUri: input.source.uri,
    displayName: input.name ?? null,
    targetFolder: input.targetFolder,
    category: input.category ?? null,
    tags: JSON.stringify(input.tags ?? []),
    assignedDownloaderId: assigned?.id ?? null,
    status: assigned ? 'assigned' : 'queued',
    createdAt: now,
    updatedAt: now,
    assignedAt: assigned ? now : null,
  })
  return getDownloadTask(platform, orgId, id)
}

export async function listDownloadTasks(
  platform: Platform,
  opts: {
    orgId?: string
    downloaderId?: string
    status?: string
    category?: string
    tag?: string
    sortBy?: 'createdAt' | 'source' | 'category' | 'tags' | 'status' | 'progress' | 'eta'
    sortDir?: 'asc' | 'desc'
    page: number
    pageSize: number
    includeUploadToken?: boolean
  },
): Promise<{ items: DownloadTask[]; total: number }> {
  const offset = (opts.page - 1) * opts.pageSize
  const filters = []
  if (opts.orgId) filters.push(eq(downloadTasks.orgId, opts.orgId))
  if (opts.downloaderId) filters.push(eq(downloadTasks.assignedDownloaderId, opts.downloaderId))
  if (opts.status) filters.push(eq(downloadTasks.status, opts.status))
  if (opts.category) filters.push(eq(downloadTasks.category, opts.category))
  if (opts.tag) filters.push(like(downloadTasks.tags, `%${JSON.stringify(opts.tag)}%`))
  const where = filters.length ? and(...filters) : undefined
  const [rows, totalRows] = await Promise.all([
    platform.db
      .select()
      .from(downloadTasks)
      .where(where)
      .orderBy(downloadTaskOrderBy(opts.sortBy ?? 'createdAt', opts.sortDir ?? 'desc'))
      .limit(opts.pageSize)
      .offset(offset),
    platform.db.select({ count: count() }).from(downloadTasks).where(where),
  ])
  return {
    items: await Promise.all(
      rows.map((row) =>
        toDownloadTaskWithToken(
          platform,
          row,
          (opts.includeUploadToken ?? false) &&
            DOWNLOADER_TOKEN_TASK_STATUSES.includes(row.status as (typeof DOWNLOADER_TOKEN_TASK_STATUSES)[number]),
        ),
      ),
    ),
    total: totalRows[0]?.count ?? 0,
  }
}

function downloadTaskOrderBy(
  sortBy: 'createdAt' | 'source' | 'category' | 'tags' | 'status' | 'progress' | 'eta',
  sortDir: 'asc' | 'desc',
) {
  const direction = sortDir === 'asc' ? asc : desc
  if (sortBy === 'source') return direction(downloadTasks.sourceUri)
  if (sortBy === 'category') return direction(downloadTasks.category)
  if (sortBy === 'tags') return direction(downloadTasks.tags)
  if (sortBy === 'status') return direction(downloadTasks.status)
  if (sortBy === 'progress') {
    return direction(sql<number>`
      case
        when json_extract(${downloadTasks.runtime}, '$.progress.download.totalBytes') is null
          or json_extract(${downloadTasks.runtime}, '$.progress.download.totalBytes') = 0 then 0
        else (
          json_extract(${downloadTasks.runtime}, '$.progress.download.bytes') * 1000000 /
          json_extract(${downloadTasks.runtime}, '$.progress.download.totalBytes')
        )
      end
    `)
  }
  if (sortBy === 'eta') {
    return direction(sql<number>`coalesce(json_extract(${downloadTasks.runtime}, '$.etaSeconds'), 9223372036854775807)`)
  }
  return direction(downloadTasks.createdAt)
}

export async function getDownloadTask(platform: Platform, orgId: string, id: string): Promise<DownloadTask> {
  const rows = await platform.db
    .select()
    .from(downloadTasks)
    .where(and(eq(downloadTasks.id, id), eq(downloadTasks.orgId, orgId)))
    .limit(1)
  if (!rows[0]) throw new DownloadError('not_found')
  return toDownloadTask(rows[0])
}

export async function updateDownloadTask(
  platform: Platform,
  id: string,
  input: UpdateDownloadTaskInput,
  actor: { orgId?: string; downloaderId?: string },
): Promise<DownloadTask> {
  const rows = await platform.db.select().from(downloadTasks).where(eq(downloadTasks.id, id)).limit(1)
  const task = rows[0]
  if (!task) throw new DownloadError('not_found')
  if (actor.orgId && task.orgId !== actor.orgId) throw new DownloadError('not_found')
  if (actor.downloaderId && task.assignedDownloaderId !== actor.downloaderId) throw new DownloadError('forbidden')
  if (actor.downloaderId && task.status === 'pausing' && input.status === 'paused') {
    const now = new Date()
    await platform.db
      .update(downloadTasks)
      .set({ status: 'paused', runtime: serializeTaskRuntime(stoppedRuntime(task.runtime)), updatedAt: now })
      .where(eq(downloadTasks.id, id))
    return getDownloadTask(platform, task.orgId, id)
  }
  if (actor.downloaderId && task.status === 'canceling' && input.status === 'canceled') {
    const now = new Date()
    await platform.db
      .update(downloadTasks)
      .set({
        status: 'canceled',
        runtime: serializeTaskRuntime(stoppedRuntime(task.runtime)),
        finishedAt: task.finishedAt ?? now,
        updatedAt: now,
      })
      .where(eq(downloadTasks.id, id))
    return getDownloadTask(platform, task.orgId, id)
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

  const now = new Date()
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
    const downloader = await loadDownloaderRow(platform, actor.downloaderId)
    const targetUnits = Math.ceil(nextDownloadedBytes / downloader.remoteDownloadCreditUnitBytes)
    const currentUnits = Math.ceil(task.billingChargedBytes / downloader.remoteDownloadCreditUnitBytes)
    try {
      for (let unit = currentUnits + 1; unit <= targetUnits; unit += 1) {
        await reportRemoteDownloadUnit({
          platform,
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

  await platform.db
    .update(downloadTasks)
    .set({
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
    .where(eq(downloadTasks.id, id))

  return getDownloadTask(platform, task.orgId, id)
}

export async function performDownloadTaskAction(
  platform: Platform,
  orgId: string,
  id: string,
  action: DownloadTaskActionInput['action'],
): Promise<DownloadTask | { id: string; deleted: true }> {
  const rows = await platform.db
    .select()
    .from(downloadTasks)
    .where(and(eq(downloadTasks.id, id), eq(downloadTasks.orgId, orgId)))
    .limit(1)
  const task = rows[0]
  if (!task) throw new DownloadError('not_found')

  if (action === 'delete') {
    if (!TERMINAL_TASK_STATUSES.includes(task.status as (typeof TERMINAL_TASK_STATUSES)[number])) {
      throw new DownloadError('invalid_state', 'Only completed, failed, or canceled tasks can be deleted')
    }
    await platform.db.delete(downloadTasks).where(eq(downloadTasks.id, id))
    return { id, deleted: true }
  }

  const now = new Date()
  if (action === 'pause') {
    if (task.status === 'paused') return toDownloadTask(task)
    if (!PAUSABLE_TASK_STATUSES.includes(task.status as (typeof PAUSABLE_TASK_STATUSES)[number])) {
      throw new DownloadError('invalid_state', 'Only queued, assigned, or downloading tasks can be paused')
    }
    const status = task.status === 'downloading' ? 'pausing' : 'paused'
    await platform.db
      .update(downloadTasks)
      .set({ status, runtime: serializeTaskRuntime(stoppedRuntime(task.runtime)), updatedAt: now })
      .where(eq(downloadTasks.id, id))
    return getDownloadTask(platform, orgId, id)
  }

  if (action === 'resume') {
    if (!['paused', 'suspended'].includes(task.status)) {
      throw new DownloadError('invalid_state', 'Only paused or suspended tasks can be resumed')
    }
    await platform.db
      .update(downloadTasks)
      .set({
        status: 'queued',
        assignedDownloaderId: null,
        assignedAt: null,
        runtime: clearTaskRuntimeMessageJson(task.runtime),
        updatedAt: now,
      })
      .where(eq(downloadTasks.id, id))
    await assignQueuedTasks(platform)
    return getDownloadTask(platform, orgId, id)
  }

  if (action === 'cancel') {
    if (task.status === 'canceled') return toDownloadTask(task)
    if (!CANCELABLE_TASK_STATUSES.includes(task.status as (typeof CANCELABLE_TASK_STATUSES)[number])) {
      throw new DownloadError('invalid_state', 'Only active, interrupted, suspended, or paused tasks can be canceled')
    }
    const status =
      task.assignedDownloaderId &&
      ['assigned', 'downloading', 'uploading', 'pausing', 'interrupted'].includes(task.status)
        ? 'canceling'
        : 'canceled'
    await platform.db
      .update(downloadTasks)
      .set({
        status,
        runtime: serializeTaskRuntime(stoppedRuntime(task.runtime)),
        finishedAt: status === 'canceled' ? (task.finishedAt ?? now) : task.finishedAt,
        updatedAt: now,
      })
      .where(eq(downloadTasks.id, id))
    return getDownloadTask(platform, orgId, id)
  }

  if (action === 'retry') {
    if (task.status !== 'failed') {
      throw new DownloadError('invalid_state', 'Only failed tasks can be retried')
    }
    await platform.db
      .update(downloadTasks)
      .set({
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
      .where(eq(downloadTasks.id, id))
    await assignQueuedTasks(platform)
    return getDownloadTask(platform, orgId, id)
  }

  if (action === 'restart') {
    if (!RESTARTABLE_TASK_STATUSES.includes(task.status as (typeof RESTARTABLE_TASK_STATUSES)[number])) {
      throw new DownloadError('invalid_state', 'Only inactive tasks can be restarted')
    }
    await platform.db
      .update(downloadTasks)
      .set({
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
      .where(eq(downloadTasks.id, id))
    await assignQueuedTasks(platform)
    return getDownloadTask(platform, orgId, id)
  }

  throw new DownloadError('invalid_state')
}

function nextTaskRuntime(
  current: DownloadTaskRuntime | null,
  input: UpdateDownloadTaskInput['runtime'],
  progress: UpdateDownloadTaskInput['progress'],
  status: string,
  now: Date,
): DownloadTaskRuntime | null {
  const runtime = input === undefined ? current : input === null ? null : mergeTaskRuntimePatch(current, input)
  const merged = mergeTaskRuntime(runtime, progress, now)
  if (!EXECUTABLE_TASK_STATUSES.includes(status as (typeof EXECUTABLE_TASK_STATUSES)[number])) {
    return merged
  }
  return clearTaskRuntimeMessage(merged)
}

function mergeTaskRuntimePatch(current: DownloadTaskRuntime | null, patch: DownloadTaskRuntime): DownloadTaskRuntime {
  const merged: DownloadTaskRuntime = { ...(current ?? {}), ...patch }
  if (current?.progress || patch.progress) {
    merged.progress = mergeTaskProgress(current?.progress, patch.progress)
  }
  if (current?.torrent && patch.torrent) {
    merged.torrent = { ...current.torrent, ...patch.torrent }
  }
  if (current?.seeding && patch.seeding) {
    merged.seeding = { ...current.seeding, ...patch.seeding }
  }
  return merged
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

export async function assertTaskUploadAllowed(platform: Platform, params: { taskId: string; downloaderId: string }) {
  const rows = await platform.db.select().from(downloadTasks).where(eq(downloadTasks.id, params.taskId)).limit(1)
  const task = rows[0]
  if (!task || task.assignedDownloaderId !== params.downloaderId) throw new DownloadError('forbidden')
  if (!['assigned', 'downloading', 'uploading'].includes(task.status)) throw new DownloadError('invalid_state')
  return task
}

async function assignQueuedTasks(platform: Platform): Promise<void> {
  const tasks = await platform.db
    .select()
    .from(downloadTasks)
    .where(eq(downloadTasks.status, 'queued'))
    .orderBy(asc(downloadTasks.createdAt))
    .limit(20)
  for (const task of tasks) {
    const downloader = await selectDownloader(platform, task.sourceType)
    if (!downloader) continue
    const now = new Date()
    await platform.db
      .update(downloadTasks)
      .set({
        status: 'assigned',
        assignedDownloaderId: downloader.id,
        assignedAt: now,
        updatedAt: now,
      })
      .where(eq(downloadTasks.id, task.id))
  }
}

async function selectDownloader(platform: Platform, sourceType: string): Promise<DownloaderRow | null> {
  const needed = sourceType === 'http' ? ['http'] : ['magnet', 'torrent']
  const rows = await platform.db
    .select()
    .from(downloaders)
    .where(and(eq(downloaders.enabled, true), eq(downloaders.status, 'online')))
    .orderBy(asc(downloaders.currentTasks), asc(downloaders.downloadBps))
  return (
    rows.find((row) => {
      const capabilities = parseCapabilities(row.capabilities)
      return needed.some((capability) => capabilities.includes(capability))
    }) ?? null
  )
}

async function createTaskUploadToken(
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
  return signDownloadToken(platform, {
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

async function toDownloadTaskWithToken(platform: Platform, row: DownloadTaskRow, includeUploadToken: boolean) {
  const task = toDownloadTask(row)
  if (includeUploadToken && task.status.assignment && row.assignedAt) {
    task.status.assignment.uploadToken = await createTaskUploadToken(platform, {
      taskId: row.id,
      downloaderId: task.status.assignment.downloaderId,
      orgId: row.orgId,
      targetFolder: row.targetFolder,
      createdByUserId: row.createdByUserId,
      assignedAt: row.assignedAt,
    })
  }
  return task
}

async function loadDownloaderRow(platform: Platform, id: string): Promise<DownloaderRow> {
  const rows = await platform.db.select().from(downloaders).where(eq(downloaders.id, id)).limit(1)
  if (!rows[0]) throw new DownloadError('not_found')
  return rows[0]
}
