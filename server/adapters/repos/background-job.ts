import type { BackgroundJob, BackgroundJobStatus } from '@shared/types'
import { and, count, desc, eq, inArray, lt, or, type SQL, sql } from 'drizzle-orm'
import { generateId } from '../../../shared/ids'
import { backgroundJobs } from '../../db/schema'
import { executeWriteTransaction } from '../../db/transaction'
import type { Database } from '../../platform/interface'
import {
  BackgroundJobError,
  type BackgroundJobMetadata,
  type BackgroundJobRepo,
  type ListBackgroundJobsOptions,
} from '../../usecases/ports'
import { resourceChangeQuery } from './resource-change'

type BackgroundJobRow = typeof backgroundJobs.$inferSelect

const ACTIVE_STATUSES: BackgroundJobStatus[] = ['queued', 'running']

function backgroundJobWhere(orgId: string, opts: ListBackgroundJobsOptions): SQL | undefined {
  const filters = [eq(backgroundJobs.orgId, orgId)]
  if (opts.status) filters.push(eq(backgroundJobs.status, opts.status))
  if (opts.type) filters.push(eq(backgroundJobs.type, opts.type))
  if (opts.after) {
    filters.push(
      or(
        lt(backgroundJobs.createdAt, opts.after.createdAt),
        and(eq(backgroundJobs.createdAt, opts.after.createdAt), lt(backgroundJobs.id, opts.after.id)),
      )!,
    )
  }
  return and(...filters)
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

export function createBackgroundJobRepo(db: Database): BackgroundJobRepo {
  async function getRow(orgId: string, id: string): Promise<BackgroundJobRow | null> {
    const rows = await db
      .select()
      .from(backgroundJobs)
      .where(and(eq(backgroundJobs.id, id), eq(backgroundJobs.orgId, orgId)))
      .limit(1)
    return rows[0] ?? null
  }

  const repo: BackgroundJobRepo = {
    async create(input) {
      const now = new Date()
      const row: typeof backgroundJobs.$inferInsert = {
        id: generateId(),
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
      await executeWriteTransaction(db, [
        db.insert(backgroundJobs).values(row),
        resourceChangeQuery(db, {
          scopeType: 'organization',
          scopeId: input.orgId,
          resourceType: 'background_job',
          resourceId: row.id,
          changeType: 'upsert',
          action: 'created',
          occurredAt: now,
        }),
      ])
      return toBackgroundJob(row as BackgroundJobRow)
    },

    async list(orgId, opts) {
      const where = backgroundJobWhere(orgId, opts)
      const rows = await db
        .select()
        .from(backgroundJobs)
        .where(where)
        .orderBy(desc(backgroundJobs.createdAt), desc(backgroundJobs.id))
        .limit(opts.pageSize + 1)
      const hasMore = rows.length > opts.pageSize
      const page = hasMore ? rows.slice(0, opts.pageSize) : rows
      const last = page.at(-1)
      return {
        items: page.map(toBackgroundJob),
        nextBoundary: hasMore && last ? { createdAt: last.createdAt, id: last.id } : null,
      }
    },

    async activeSummary(orgId) {
      const rows = await db
        .select({
          count: count(),
          lastUpdatedAt: sql<number | null>`MAX(${backgroundJobs.updatedAt})`,
          processedBytes: sql<number>`COALESCE(SUM(${backgroundJobs.processedBytes}), 0)`,
        })
        .from(backgroundJobs)
        .where(and(eq(backgroundJobs.orgId, orgId), inArray(backgroundJobs.status, ACTIVE_STATUSES)))
      const row = rows[0]
      const activeCount = row?.count ?? 0
      return {
        count: activeCount,
        fingerprint: activeCount === 0 ? '' : `${activeCount}:${row?.lastUpdatedAt ?? 0}:${row?.processedBytes ?? 0}`,
      }
    },

    async get(orgId, id) {
      const row = await getRow(orgId, id)
      if (!row) throw new BackgroundJobError('not_found')
      return toBackgroundJob(row)
    },

    async update(orgId, id, input) {
      const row = await getRow(orgId, id)
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
        resultMetadata:
          input.resultMetadata === undefined ? row.resultMetadata : stringifyMetadata(input.resultMetadata),
        retryable: input.retryable ?? row.retryable,
        cancelable: input.cancelable ?? row.cancelable,
        startedAt: input.startedAt === undefined ? row.startedAt : input.startedAt,
        finishedAt: input.finishedAt === undefined ? finishedAtFor(nextStatus, row.finishedAt, now) : input.finishedAt,
        updatedAt: now,
      }
      await executeWriteTransaction(db, [
        db.update(backgroundJobs).set(values).where(eq(backgroundJobs.id, id)),
        resourceChangeQuery(db, {
          scopeType: 'organization',
          scopeId: orgId,
          resourceType: 'background_job',
          resourceId: id,
          changeType: 'upsert',
          action: 'updated',
          occurredAt: now,
        }),
      ])
      return repo.get(orgId, id)
    },

    async cancel(orgId, id) {
      const row = await getRow(orgId, id)
      if (!row) throw new BackgroundJobError('not_found')
      if (!ACTIVE_STATUSES.includes(row.status as BackgroundJobStatus) || !row.cancelable) {
        throw new BackgroundJobError('not_cancelable')
      }
      const now = new Date()
      await executeWriteTransaction(db, [
        db
          .update(backgroundJobs)
          .set({ status: 'canceled', updatedAt: now, finishedAt: now })
          .where(eq(backgroundJobs.id, id)),
        resourceChangeQuery(db, {
          scopeType: 'organization',
          scopeId: orgId,
          resourceType: 'background_job',
          resourceId: id,
          changeType: 'upsert',
          action: 'canceled',
          occurredAt: now,
        }),
      ])
      return repo.get(orgId, id)
    },

    async retry(orgId, id) {
      const row = await getRow(orgId, id)
      if (!row) throw new BackgroundJobError('not_found')
      if (row.status !== 'failed' || !row.retryable) throw new BackgroundJobError('not_retryable')

      const now = new Date()
      const retry: typeof backgroundJobs.$inferInsert = {
        id: generateId(),
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
      await executeWriteTransaction(db, [
        db.insert(backgroundJobs).values(retry),
        resourceChangeQuery(db, {
          scopeType: 'organization',
          scopeId: orgId,
          resourceType: 'background_job',
          resourceId: retry.id,
          changeType: 'upsert',
          action: 'retried',
          occurredAt: now,
        }),
      ])
      return toBackgroundJob(retry as BackgroundJobRow)
    },
  }

  return repo
}
