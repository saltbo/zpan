import type {
  CreateDownloaderInput,
  CreateDownloadTaskInput,
  DownloaderHeartbeatInput,
  DownloadTaskActionInput,
  UpdateDownloaderInput,
  UpdateDownloadTaskInput,
} from '@shared/schemas'
import type { Downloader, DownloadTask } from '@shared/types'
import { and, asc, count, desc, eq, inArray, like } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { downloaders, downloadTasks } from '../db/schema'
import type { Platform } from '../platform/interface'
import { hashDownloadToken, signDownloadToken } from './download-tokens'
import { RemoteDownloadBillingBlockedError, reportRemoteDownloadUnit } from './remote-download-usage'

const DEFAULT_REMOTE_DOWNLOAD_UNIT_BYTES = 100 * 1024 * 1024
const UPLOAD_TOKEN_TTL_SECONDS = 24 * 60 * 60
const ACTIVE_TASK_STATUSES = ['queued', 'assigned', 'running', 'billing_paused', 'uploading'] as const
const TERMINAL_TASK_STATUSES = ['completed', 'failed', 'canceled'] as const

export class DownloadError extends Error {
  constructor(
    readonly code:
      | 'not_found'
      | 'forbidden'
      | 'no_downloader'
      | 'invalid_state'
      | 'billing_paused'
      | 'unsupported_source',
    message: string = code,
  ) {
    super(message)
    this.name = 'DownloadError'
  }
}

type DownloaderRow = typeof downloaders.$inferSelect
type DownloadTaskRow = typeof downloadTasks.$inferSelect

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
      uploadTokenHash: null,
      uploadTokenJti: null,
      uploadTokenExpiresAt: null,
      assignedAt: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(downloadTasks.assignedDownloaderId, id),
        inArray(downloadTasks.status, [...ACTIVE_TASK_STATUSES, 'paused']),
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
  const uploadToken = assigned
    ? await createTaskUploadToken(platform, {
        taskId: id,
        downloaderId: assigned.id,
        orgId,
        targetFolder: input.targetFolder,
        createdByUserId: userId,
      })
    : null
  await platform.db.insert(downloadTasks).values({
    id,
    orgId,
    createdByUserId: userId,
    sourceType: input.source.type,
    sourceUri: input.source.uri,
    name: input.name ?? null,
    targetFolder: input.targetFolder,
    category: input.category ?? null,
    tags: JSON.stringify(input.tags ?? []),
    assignedDownloaderId: assigned?.id ?? null,
    status: assigned ? 'assigned' : 'queued',
    uploadTokenHash: uploadToken?.hash ?? null,
    uploadTokenJti: uploadToken?.jti ?? null,
    uploadTokenExpiresAt: uploadToken?.expiresAt ?? null,
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
      .orderBy(desc(downloadTasks.createdAt))
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
          (opts.includeUploadToken ?? false) && (row.status === 'assigned' || row.status === 'billing_paused'),
        ),
      ),
    ),
    total: totalRows[0]?.count ?? 0,
  }
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
  if (actor.orgId && !actor.downloaderId) {
    const onlyCancel =
      input.status === 'canceled' &&
      input.downloadedBytes === undefined &&
      input.storageUploadedBytes === undefined &&
      input.totalBytes === undefined &&
      input.downloadBps === undefined &&
      input.storageUploadBps === undefined &&
      input.errorMessage === undefined &&
      input.resultObjectId === undefined &&
      input.detail === undefined
    if (!onlyCancel) throw new DownloadError('forbidden')
  }

  const now = new Date()
  let status = input.status ?? task.status
  let authorizedBytes = task.authorizedBytes
  let billedBytes = task.billedBytes
  let billedCredits = task.billedCredits
  let billingStatus = task.billingStatus
  const downloadedBytes =
    actor.downloaderId && input.downloadedBytes !== undefined
      ? Math.max(input.downloadedBytes, task.downloadedBytes)
      : (input.downloadedBytes ?? task.downloadedBytes)
  const storageUploadedBytes =
    actor.downloaderId && input.storageUploadedBytes !== undefined
      ? Math.max(input.storageUploadedBytes, task.uploadedBytes)
      : (input.storageUploadedBytes ?? task.uploadedBytes)

  if (actor.downloaderId && downloadedBytes > task.downloadedBytes) {
    const downloader = await loadDownloaderRow(platform, actor.downloaderId)
    const targetUnits = Math.ceil(downloadedBytes / downloader.remoteDownloadCreditUnitBytes)
    const currentUnits = Math.ceil(task.billedBytes / downloader.remoteDownloadCreditUnitBytes)
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
        billedCredits += downloader.remoteDownloadCreditBillingEnabled ? downloader.remoteDownloadCreditPerUnit : 0
      }
      if (targetUnits > currentUnits) {
        billedBytes = targetUnits * downloader.remoteDownloadCreditUnitBytes
        authorizedBytes = billedBytes
        billingStatus = 'ok'
      }
    } catch (error) {
      if (error instanceof RemoteDownloadBillingBlockedError) {
        status = 'billing_paused'
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
      downloadedBytes,
      uploadedBytes: storageUploadedBytes,
      totalBytes: input.totalBytes === undefined ? task.totalBytes : input.totalBytes,
      authorizedBytes,
      billedBytes,
      billedCredits,
      billingStatus,
      downloadBps: input.downloadBps ?? task.downloadBps,
      uploadBps: input.storageUploadBps ?? task.uploadBps,
      errorMessage: input.errorMessage === undefined ? task.errorMessage : input.errorMessage,
      resultObjectId: input.resultObjectId === undefined ? task.resultObjectId : input.resultObjectId,
      detail: input.detail === undefined ? task.detail : JSON.stringify(input.detail),
      startedAt: task.startedAt ?? (status === 'running' ? now : null),
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
    if (!ACTIVE_TASK_STATUSES.includes(task.status as (typeof ACTIVE_TASK_STATUSES)[number])) {
      throw new DownloadError('invalid_state', 'Only active tasks can be paused')
    }
    await platform.db
      .update(downloadTasks)
      .set({ status: 'paused', downloadBps: 0, uploadBps: 0, updatedAt: now })
      .where(eq(downloadTasks.id, id))
    return getDownloadTask(platform, orgId, id)
  }

  if (action === 'resume') {
    if (task.status !== 'paused') throw new DownloadError('invalid_state', 'Only paused tasks can be resumed')
    await platform.db
      .update(downloadTasks)
      .set({
        status: task.assignedDownloaderId ? 'assigned' : 'queued',
        downloadBps: 0,
        uploadBps: 0,
        updatedAt: now,
      })
      .where(eq(downloadTasks.id, id))
    if (!task.assignedDownloaderId) await assignQueuedTasks(platform)
    return getDownloadTask(platform, orgId, id)
  }

  if (action === 'cancel') {
    if (task.status === 'canceled') return toDownloadTask(task)
    if (task.status === 'completed') throw new DownloadError('invalid_state', 'Completed tasks cannot be canceled')
    await platform.db
      .update(downloadTasks)
      .set({
        status: 'canceled',
        downloadBps: 0,
        uploadBps: 0,
        finishedAt: task.finishedAt ?? now,
        updatedAt: now,
      })
      .where(eq(downloadTasks.id, id))
    return getDownloadTask(platform, orgId, id)
  }

  if (action === 'retry') {
    if (!['failed', 'canceled'].includes(task.status)) {
      throw new DownloadError('invalid_state', 'Only failed or canceled tasks can be retried')
    }
    await platform.db
      .update(downloadTasks)
      .set({
        status: 'queued',
        assignedDownloaderId: null,
        uploadTokenHash: null,
        uploadTokenJti: null,
        uploadTokenExpiresAt: null,
        downloadedBytes: 0,
        uploadedBytes: 0,
        totalBytes: null,
        downloadBps: 0,
        uploadBps: 0,
        errorMessage: null,
        resultObjectId: null,
        detail: null,
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

export async function assertTaskUploadAllowed(platform: Platform, params: { taskId: string; downloaderId: string }) {
  const rows = await platform.db.select().from(downloadTasks).where(eq(downloadTasks.id, params.taskId)).limit(1)
  const task = rows[0]
  if (!task || task.assignedDownloaderId !== params.downloaderId) throw new DownloadError('forbidden')
  if (!['assigned', 'running', 'uploading'].includes(task.status)) throw new DownloadError('invalid_state')
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
    const token = await createTaskUploadToken(platform, {
      taskId: task.id,
      downloaderId: downloader.id,
      orgId: task.orgId,
      targetFolder: task.targetFolder,
      createdByUserId: task.createdByUserId,
    })
    const now = new Date()
    await platform.db
      .update(downloadTasks)
      .set({
        status: 'assigned',
        assignedDownloaderId: downloader.id,
        uploadTokenHash: token.hash,
        uploadTokenJti: token.jti,
        uploadTokenExpiresAt: token.expiresAt,
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
  params: { taskId: string; downloaderId: string; orgId: string; targetFolder: string; createdByUserId: string },
) {
  const now = Math.floor(Date.now() / 1000)
  const jti = nanoid()
  const expiresAt = new Date((now + UPLOAD_TOKEN_TTL_SECONDS) * 1000)
  const token = await signDownloadToken(platform, {
    v: 1,
    typ: 'download-task-upload',
    taskId: params.taskId,
    downloaderId: params.downloaderId,
    orgId: params.orgId,
    targetFolder: params.targetFolder,
    createdByUserId: params.createdByUserId,
    scopes: ['objects:create', 'objects:upload', 'objects:confirm'],
    jti,
    iat: now,
    exp: now + UPLOAD_TOKEN_TTL_SECONDS,
  })
  return { token, hash: await hashDownloadToken(platform, token), jti, expiresAt }
}

async function toDownloadTaskWithToken(platform: Platform, row: DownloadTaskRow, includeUploadToken: boolean) {
  const task = toDownloadTask(row)
  if (includeUploadToken && row.assignedDownloaderId && row.uploadTokenJti) {
    const token = await createTaskUploadToken(platform, {
      taskId: row.id,
      downloaderId: row.assignedDownloaderId,
      orgId: row.orgId,
      targetFolder: row.targetFolder,
      createdByUserId: row.createdByUserId,
    })
    await platform.db
      .update(downloadTasks)
      .set({ uploadTokenHash: token.hash, uploadTokenJti: token.jti, uploadTokenExpiresAt: token.expiresAt })
      .where(eq(downloadTasks.id, row.id))
    task.uploadToken = token.token
  }
  return task
}

async function loadDownloaderRow(platform: Platform, id: string): Promise<DownloaderRow> {
  const rows = await platform.db.select().from(downloaders).where(eq(downloaders.id, id)).limit(1)
  if (!rows[0]) throw new DownloadError('not_found')
  return rows[0]
}

function toDownloader(row: DownloaderRow): Downloader {
  return {
    id: row.id,
    name: row.name,
    status: row.enabled ? (row.status as Downloader['status']) : 'disabled',
    enabled: row.enabled,
    version: row.version,
    hostname: row.hostname,
    platform: row.platform,
    arch: row.arch,
    engine: row.engine as Downloader['engine'],
    capabilities: parseCapabilities(row.capabilities),
    maxConcurrentTasks: row.maxConcurrentTasks,
    currentTasks: row.currentTasks,
    downloadBps: row.downloadBps,
    uploadBps: row.uploadBps,
    freeDiskBytes: row.freeDiskBytes,
    remoteDownloadCreditBillingEnabled: row.remoteDownloadCreditBillingEnabled,
    remoteDownloadCreditUnitBytes: row.remoteDownloadCreditUnitBytes,
    remoteDownloadCreditPerUnit: row.remoteDownloadCreditPerUnit,
    lastHeartbeatAt: row.lastHeartbeatAt?.toISOString() ?? null,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function toDownloadTask(row: DownloadTaskRow): DownloadTask {
  return {
    id: row.id,
    orgId: row.orgId,
    createdByUserId: row.createdByUserId,
    sourceType: row.sourceType as DownloadTask['sourceType'],
    sourceUri: row.sourceUri,
    name: row.name,
    targetFolder: row.targetFolder,
    category: row.category,
    tags: parseTaskTags(row.tags),
    assignedDownloaderId: row.assignedDownloaderId,
    status: row.status as DownloadTask['status'],
    downloadedBytes: row.downloadedBytes,
    storageUploadedBytes: row.uploadedBytes,
    totalBytes: row.totalBytes,
    authorizedBytes: row.authorizedBytes,
    billedBytes: row.billedBytes,
    billedCredits: row.billedCredits,
    billingStatus: row.billingStatus,
    downloadBps: row.downloadBps,
    storageUploadBps: row.uploadBps,
    errorMessage: row.errorMessage,
    resultObjectId: row.resultObjectId,
    detail: parseTaskDetail(row.detail),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    assignedAt: row.assignedAt?.toISOString() ?? null,
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
  }
}

function parseTaskDetail(value: string | null): DownloadTask['detail'] {
  if (!value) return null
  try {
    const detail = JSON.parse(value) as DownloadTask['detail'] & { uploadedBytes?: number }
    if (detail.peerUploadedBytes === undefined && detail.uploadedBytes !== undefined) {
      detail.peerUploadedBytes = detail.uploadedBytes
    }
    delete detail.uploadedBytes
    return detail
  } catch {
    return null
  }
}

function parseTaskTags(value: string): string[] {
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function parseCapabilities(value: string): string[] {
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}
