import { downloadTaskRuntimeSchema } from '@shared/schemas'
import type { DownloadTask, DownloadTaskRuntime } from '@shared/types'
import { and, asc, count, desc, eq, inArray, like, type SQL, sql } from 'drizzle-orm'
import { downloadTasks } from '../../db/schema'
import type { Database } from '../../platform/interface'
import {
  type CreateDownloadTaskRecordInput,
  DownloadError,
  type DownloadTaskRecord,
  type DownloadTaskRepo,
  type ListDownloadTasksFilters,
  type UpdateDownloadTaskFields,
} from '../../usecases/ports'

type DownloadTaskRow = typeof downloadTasks.$inferSelect

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

function emptyTaskProgress(): DownloadTask['status']['progress'] {
  return {
    download: { bytes: 0, totalBytes: null, bytesPerSecond: 0 },
    upload: { bytes: 0, totalBytes: null, bytesPerSecond: 0 },
  }
}

function toRecord(row: DownloadTaskRow): DownloadTaskRecord {
  return {
    id: row.id,
    orgId: row.orgId,
    createdByUserId: row.createdByUserId,
    sourceType: row.sourceType,
    sourceUri: row.sourceUri,
    displayName: row.displayName,
    targetFolder: row.targetFolder,
    category: row.category,
    tags: row.tags,
    assignedDownloaderId: row.assignedDownloaderId,
    status: row.status,
    attempt: row.attempt,
    billingAuthorizedBytes: row.billingAuthorizedBytes,
    billingChargedBytes: row.billingChargedBytes,
    billingChargedCredits: row.billingChargedCredits,
    billingStatus: row.billingStatus,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    resultObjectId: row.resultObjectId,
    runtime: row.runtime,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    assignedAt: row.assignedAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  }
}

function toDownloadTask(row: DownloadTaskRow): DownloadTask {
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
      progress: runtime?.progress ?? emptyTaskProgress(),
      billing: {
        state: row.billingStatus as DownloadTask['status']['billing']['state'],
        authorizedBytes: row.billingAuthorizedBytes,
        chargedBytes: row.billingChargedBytes,
        chargedCredits: row.billingChargedCredits,
      },
      output: row.resultObjectId ? { objectId: row.resultObjectId } : null,
      runtime,
      error: row.errorMessage ? { code: row.errorCode, message: row.errorMessage } : null,
      startedAt: row.startedAt?.toISOString() ?? null,
      finishedAt: row.finishedAt?.toISOString() ?? null,
      updatedAt: row.updatedAt.toISOString(),
    },
    createdAt: row.createdAt.toISOString(),
  }
}

function orderBy(sortBy: NonNullable<ListDownloadTasksFilters['sortBy']>, sortDir: 'asc' | 'desc'): SQL {
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

export function createDownloadTaskRepo(db: Database): DownloadTaskRepo {
  async function findRow(id: string): Promise<DownloadTaskRow | null> {
    const rows = await db.select().from(downloadTasks).where(eq(downloadTasks.id, id)).limit(1)
    return rows[0] ?? null
  }

  return {
    async insert(input: CreateDownloadTaskRecordInput) {
      await db.insert(downloadTasks).values({
        id: input.id,
        orgId: input.orgId,
        createdByUserId: input.createdByUserId,
        sourceType: input.sourceType,
        sourceUri: input.sourceUri,
        displayName: input.displayName,
        targetFolder: input.targetFolder,
        category: input.category,
        tags: JSON.stringify(input.tags),
        assignedDownloaderId: input.assignedDownloaderId,
        status: input.status,
        createdAt: input.now,
        updatedAt: input.now,
        assignedAt: input.assignedAt,
      })
    },

    async list(filters: ListDownloadTasksFilters) {
      const offset = (filters.page - 1) * filters.pageSize
      const conditions: SQL[] = []
      if (filters.orgId) conditions.push(eq(downloadTasks.orgId, filters.orgId))
      if (filters.downloaderId) conditions.push(eq(downloadTasks.assignedDownloaderId, filters.downloaderId))
      if (filters.status) conditions.push(eq(downloadTasks.status, filters.status))
      if (filters.category) conditions.push(eq(downloadTasks.category, filters.category))
      if (filters.tag) conditions.push(like(downloadTasks.tags, `%${JSON.stringify(filters.tag)}%`))
      const where = conditions.length ? and(...conditions) : undefined
      const [rows, totalRows] = await Promise.all([
        db
          .select()
          .from(downloadTasks)
          .where(where)
          .orderBy(orderBy(filters.sortBy ?? 'createdAt', filters.sortDir ?? 'desc'))
          .limit(filters.pageSize)
          .offset(offset),
        db.select({ count: count() }).from(downloadTasks).where(where),
      ])
      return { items: rows.map(toDownloadTask), total: totalRows[0]?.count ?? 0, rows: rows.map(toRecord) }
    },

    async get(orgId, id) {
      const rows = await db
        .select()
        .from(downloadTasks)
        .where(and(eq(downloadTasks.id, id), eq(downloadTasks.orgId, orgId)))
        .limit(1)
      if (!rows[0]) throw new DownloadError('not_found')
      return toDownloadTask(rows[0])
    },

    async getRecord(orgId, id) {
      const rows = await db
        .select()
        .from(downloadTasks)
        .where(and(eq(downloadTasks.id, id), eq(downloadTasks.orgId, orgId)))
        .limit(1)
      if (!rows[0]) throw new DownloadError('not_found')
      return toRecord(rows[0])
    },

    async findRecord(id) {
      const row = await findRow(id)
      return row ? toRecord(row) : null
    },

    async setFields(id, fields: UpdateDownloadTaskFields) {
      await db.update(downloadTasks).set(fields).where(eq(downloadTasks.id, id))
    },

    async delete(id) {
      await db.delete(downloadTasks).where(eq(downloadTasks.id, id))
    },

    async listQueued(limit) {
      const rows = await db
        .select()
        .from(downloadTasks)
        .where(eq(downloadTasks.status, 'queued'))
        .orderBy(asc(downloadTasks.createdAt))
        .limit(limit)
      return rows.map(toRecord)
    },

    async requeueAssignedTo(downloaderId, statuses, now) {
      await db
        .update(downloadTasks)
        .set({ status: 'queued', assignedDownloaderId: null, runtime: null, assignedAt: null, updatedAt: now })
        .where(and(eq(downloadTasks.assignedDownloaderId, downloaderId), inArray(downloadTasks.status, statuses)))
    },

    async requeueAssignedToMany(downloaderIds, statuses, now) {
      if (downloaderIds.length === 0) return
      await db
        .update(downloadTasks)
        .set({ status: 'queued', assignedDownloaderId: null, assignedAt: null, runtime: null, updatedAt: now })
        .where(and(inArray(downloadTasks.assignedDownloaderId, downloaderIds), inArray(downloadTasks.status, statuses)))
    },
  }
}
