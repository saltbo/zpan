import type { BackgroundJob, BackgroundJobProgress, BackgroundJobStatus, BackgroundJobType } from '@shared/types'
import { and, count, desc, eq, type SQL } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { backgroundJobs } from '../db/schema'
import type { Database } from '../platform/interface'

export type BackgroundJobMetadata = Record<string, unknown>

export type CreateBackgroundJobInput = {
  orgId: string
  userId: string
  type: BackgroundJobType
  targetFolder?: string | null
  targetPath?: string | null
  metadata?: BackgroundJobMetadata | null
  progress?: Partial<BackgroundJobProgress>
  retryable?: boolean
  cancelable?: boolean
}

export type ListBackgroundJobsOptions = {
  status?: BackgroundJobStatus
  type?: string
  page: number
  pageSize: number
}

export type UpdateBackgroundJobInput = {
  status?: BackgroundJobStatus
  progress?: Partial<BackgroundJobProgress>
  errorMessage?: string | null
  resultMetadata?: BackgroundJobMetadata | null
  retryable?: boolean
  cancelable?: boolean
  startedAt?: Date | null
  finishedAt?: Date | null
}

export class BackgroundJobError extends Error {
  constructor(
    readonly code: 'not_found' | 'not_cancelable' | 'not_retryable',
    message = code,
  ) {
    super(message)
    this.name = 'BackgroundJobError'
  }
}

type BackgroundJobRow = typeof backgroundJobs.$inferSelect

const ACTIVE_STATUSES: BackgroundJobStatus[] = ['queued', 'running']

export async function createBackgroundJob(db: Database, input: CreateBackgroundJobInput): Promise<BackgroundJob> {
  const now = new Date()
  const row: typeof backgroundJobs.$inferInsert = {
    id: nanoid(),
    orgId: input.orgId,
    userId: input.userId,
    type: input.type,
    status: 'queued',
    targetFolder: input.targetFolder ?? null,
    targetPath: input.targetPath ?? null,
    metadata: stringifyMetadata(input.metadata),
    inputBytes: input.progress?.inputBytes ?? 0,
    outputBytes: input.progress?.outputBytes ?? 0,
    processedBytes: input.progress?.processedBytes ?? 0,
    fileCount: input.progress?.fileCount ?? 0,
    currentFilename: input.progress?.currentFilename ?? null,
    errorMessage: null,
    resultMetadata: null,
    retryable: input.retryable ?? false,
    cancelable: input.cancelable ?? true,
    retriedFromJobId: null,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    finishedAt: null,
  }

  await db.insert(backgroundJobs).values(row)
  return toBackgroundJob(row as BackgroundJobRow)
}

export async function listBackgroundJobs(
  db: Database,
  orgId: string,
  opts: ListBackgroundJobsOptions,
): Promise<{ items: BackgroundJob[]; total: number }> {
  const offset = (opts.page - 1) * opts.pageSize
  const where = backgroundJobWhere(orgId, opts)

  const [rows, totalRows] = await Promise.all([
    db
      .select()
      .from(backgroundJobs)
      .where(where)
      .orderBy(desc(backgroundJobs.createdAt))
      .limit(opts.pageSize)
      .offset(offset),
    db.select({ count: count() }).from(backgroundJobs).where(where),
  ])

  return {
    items: rows.map(toBackgroundJob),
    total: totalRows[0]?.count ?? 0,
  }
}

export async function getBackgroundJob(db: Database, orgId: string, id: string): Promise<BackgroundJob> {
  const row = await getBackgroundJobRow(db, orgId, id)
  if (!row) throw new BackgroundJobError('not_found')
  return toBackgroundJob(row)
}

export async function updateBackgroundJob(
  db: Database,
  orgId: string,
  id: string,
  input: UpdateBackgroundJobInput,
): Promise<BackgroundJob> {
  const row = await getBackgroundJobRow(db, orgId, id)
  if (!row) throw new BackgroundJobError('not_found')

  const nextStatus = input.status ?? row.status
  const now = new Date()
  const values: Partial<typeof backgroundJobs.$inferInsert> = {
    status: nextStatus,
    inputBytes: input.progress?.inputBytes ?? row.inputBytes,
    outputBytes: input.progress?.outputBytes ?? row.outputBytes,
    processedBytes: input.progress?.processedBytes ?? row.processedBytes,
    fileCount: input.progress?.fileCount ?? row.fileCount,
    currentFilename:
      input.progress?.currentFilename === undefined ? row.currentFilename : input.progress.currentFilename,
    errorMessage: input.errorMessage === undefined ? row.errorMessage : input.errorMessage,
    resultMetadata: input.resultMetadata === undefined ? row.resultMetadata : stringifyMetadata(input.resultMetadata),
    retryable: input.retryable ?? row.retryable,
    cancelable: input.cancelable ?? row.cancelable,
    startedAt: input.startedAt === undefined ? row.startedAt : input.startedAt,
    finishedAt: input.finishedAt === undefined ? finishedAtFor(nextStatus, row.finishedAt, now) : input.finishedAt,
    updatedAt: now,
  }

  await db.update(backgroundJobs).set(values).where(eq(backgroundJobs.id, id))
  return getBackgroundJob(db, orgId, id)
}

export async function cancelBackgroundJob(db: Database, orgId: string, id: string): Promise<BackgroundJob> {
  const row = await getBackgroundJobRow(db, orgId, id)
  if (!row) throw new BackgroundJobError('not_found')
  if (!ACTIVE_STATUSES.includes(row.status as BackgroundJobStatus) || !row.cancelable) {
    throw new BackgroundJobError('not_cancelable')
  }

  const now = new Date()
  await db
    .update(backgroundJobs)
    .set({ status: 'canceled', updatedAt: now, finishedAt: now })
    .where(eq(backgroundJobs.id, id))

  return getBackgroundJob(db, orgId, id)
}

export async function retryBackgroundJob(db: Database, orgId: string, id: string): Promise<BackgroundJob> {
  const row = await getBackgroundJobRow(db, orgId, id)
  if (!row) throw new BackgroundJobError('not_found')
  if (row.status !== 'failed' || !row.retryable) throw new BackgroundJobError('not_retryable')

  const now = new Date()
  const retry: typeof backgroundJobs.$inferInsert = {
    id: nanoid(),
    orgId: row.orgId,
    userId: row.userId,
    type: row.type,
    status: 'queued',
    targetFolder: row.targetFolder,
    targetPath: row.targetPath,
    metadata: row.metadata,
    inputBytes: row.inputBytes,
    outputBytes: 0,
    processedBytes: 0,
    fileCount: row.fileCount,
    currentFilename: null,
    errorMessage: null,
    resultMetadata: null,
    retryable: row.retryable,
    cancelable: row.cancelable,
    retriedFromJobId: row.id,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    finishedAt: null,
  }

  await db.insert(backgroundJobs).values(retry)
  return toBackgroundJob(retry as BackgroundJobRow)
}

function backgroundJobWhere(orgId: string, opts: ListBackgroundJobsOptions): SQL | undefined {
  const filters = [eq(backgroundJobs.orgId, orgId)]
  if (opts.status) filters.push(eq(backgroundJobs.status, opts.status))
  if (opts.type) filters.push(eq(backgroundJobs.type, opts.type))
  return and(...filters)
}

async function getBackgroundJobRow(db: Database, orgId: string, id: string): Promise<BackgroundJobRow | null> {
  const rows = await db
    .select()
    .from(backgroundJobs)
    .where(and(eq(backgroundJobs.id, id), eq(backgroundJobs.orgId, orgId)))
    .limit(1)
  return rows[0] ?? null
}

function finishedAtFor(status: string, current: Date | null, now: Date): Date | null {
  if (current) return current
  return ['completed', 'failed', 'canceled'].includes(status) ? now : null
}

function stringifyMetadata(value: BackgroundJobMetadata | null | undefined): string | null {
  return value == null ? null : JSON.stringify(value)
}

function parseMetadata(value: string | null): BackgroundJobMetadata | null {
  return value == null ? null : (JSON.parse(value) as BackgroundJobMetadata)
}

function toIso(value: Date | null): string | null {
  return value?.toISOString() ?? null
}

function toBackgroundJob(row: BackgroundJobRow): BackgroundJob {
  return {
    id: row.id,
    orgId: row.orgId,
    userId: row.userId,
    type: row.type,
    status: row.status as BackgroundJobStatus,
    targetFolder: row.targetFolder,
    targetPath: row.targetPath,
    metadata: parseMetadata(row.metadata),
    progress: {
      inputBytes: row.inputBytes,
      outputBytes: row.outputBytes,
      processedBytes: row.processedBytes,
      fileCount: row.fileCount,
      currentFilename: row.currentFilename,
    },
    errorMessage: row.errorMessage,
    resultMetadata: parseMetadata(row.resultMetadata),
    retryable: row.retryable,
    cancelable: row.cancelable,
    retriedFromJobId: row.retriedFromJobId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    startedAt: toIso(row.startedAt),
    finishedAt: toIso(row.finishedAt),
  }
}
