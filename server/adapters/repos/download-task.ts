import { downloadTaskRuntimeSchema } from '@shared/schemas'
import type { DownloadTask, DownloadTaskRuntime } from '@shared/types'
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  like,
  ne,
  notInArray,
  or,
  type SQL,
  sql,
} from 'drizzle-orm'
import { downloaders, downloadTasks } from '../../db/schema'
import { parseDownloadTaskEvents } from '../../domain/download-task-events'
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

function nextValue<T>(value: T | undefined, column: SQL): SQL {
  return value === undefined ? column : sql`${value}`
}

function appendStatusEvent(
  events: SQL,
  input: {
    to: string
    now: Date
    reason: string | null
    attempt: SQL
    category: SQL
    downloaderId: SQL
    runtime: SQL
    billedBytes: SQL
    errorCode: SQL
    errorMessage: SQL
  },
): SQL {
  const appended = sql`json_insert(${events}, '$[#]', json_object(
    'id', lower(hex(randomblob(16))),
    'type', 'status_changed',
    'occurredAt', CAST(${input.now.getTime()} AS INTEGER),
    'attempt', CAST(${input.attempt} AS INTEGER),
    'from', ${downloadTasks.status},
    'to', ${input.to},
    'reason', ${input.reason},
    'category', COALESCE(${input.category}, 'uncategorized'),
    'downloaderId', ${input.downloaderId},
    'transferredBytes', CASE
      WHEN json_type(${input.runtime}, '$.progress.download.bytes') = 'integer'
        THEN CAST(json_extract(${input.runtime}, '$.progress.download.bytes') AS INTEGER)
      ELSE NULL
    END,
    'billedBytes', CAST(${input.billedBytes} AS INTEGER),
    'errorCode', ${input.errorCode},
    'errorMessage', ${input.errorMessage}
  ))`
  return sql`CASE WHEN ${downloadTasks.status} <> ${input.to} THEN ${appended} ELSE ${events} END`
}

function appendErrorEvent(
  events: SQL,
  input: {
    now: Date
    attempt: SQL
    category: SQL
    downloaderId: SQL
    runtime: SQL
    billedBytes: SQL
    errorCode: SQL
    errorMessage: string
  },
): SQL {
  const appended = sql`json_insert(${events}, '$[#]', json_object(
    'id', lower(hex(randomblob(16))),
    'type', 'error_reported',
    'occurredAt', CAST(${input.now.getTime()} AS INTEGER),
    'attempt', CAST(${input.attempt} AS INTEGER),
    'reason', NULL,
    'category', COALESCE(${input.category}, 'uncategorized'),
    'downloaderId', ${input.downloaderId},
    'transferredBytes', CASE
      WHEN json_type(${input.runtime}, '$.progress.download.bytes') = 'integer'
        THEN CAST(json_extract(${input.runtime}, '$.progress.download.bytes') AS INTEGER)
      ELSE NULL
    END,
    'billedBytes', CAST(${input.billedBytes} AS INTEGER),
    'errorCode', ${input.errorCode},
    'errorMessage', ${input.errorMessage}
  ))`
  return sql`CASE WHEN ${downloadTasks.errorMessage} IS NOT ${input.errorMessage} THEN ${appended} ELSE ${events} END`
}

function appendCleanupEvent(events: SQL, type: 'cleanup_requested' | 'cleanup_completed', now: Date): SQL {
  return sql`json_insert(${events}, '$[#]', json_object(
    'id', lower(hex(randomblob(16))),
    'type', ${type},
    'occurredAt', CAST(${now.getTime()} AS INTEGER),
    'attempt', CAST(${downloadTasks.attempt} AS INTEGER),
    'reason', NULL,
    'category', COALESCE(${downloadTasks.category}, 'uncategorized'),
    'downloaderId', ${downloadTasks.assignedDownloaderId},
    'transferredBytes', CASE
      WHEN json_type(${downloadTasks.runtime}, '$.progress.download.bytes') = 'integer'
        THEN CAST(json_extract(${downloadTasks.runtime}, '$.progress.download.bytes') AS INTEGER)
      ELSE NULL
    END,
    'billedBytes', CAST(${downloadTasks.billingChargedBytes} AS INTEGER),
    'errorCode', ${downloadTasks.errorCode},
    'errorMessage', ${downloadTasks.errorMessage}
  ))`
}

function statusEventExpression(
  events: SQL,
  to: string,
  now: Date,
  reason: string | null,
  overrides: {
    attempt?: SQL
    category?: SQL
    downloaderId?: SQL
    runtime?: SQL
    billedBytes?: SQL
    errorCode?: SQL
    errorMessage?: SQL
  } = {},
): SQL {
  return appendStatusEvent(events, {
    to,
    now,
    reason,
    attempt: overrides.attempt ?? sql`${downloadTasks.attempt}`,
    category: overrides.category ?? sql`${downloadTasks.category}`,
    downloaderId: overrides.downloaderId ?? sql`${downloadTasks.assignedDownloaderId}`,
    runtime: overrides.runtime ?? sql`${downloadTasks.runtime}`,
    billedBytes: overrides.billedBytes ?? sql`${downloadTasks.billingChargedBytes}`,
    errorCode: overrides.errorCode ?? sql`${downloadTasks.errorCode}`,
    errorMessage: overrides.errorMessage ?? sql`${downloadTasks.errorMessage}`,
  })
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
    events: row.events,
    resolveStartedAt: row.resolveStartedAt,
    resolveCompletedAt: row.resolveCompletedAt,
    downloadCompletedAt: row.downloadCompletedAt,
    ingestStartedAt: row.ingestStartedAt,
    ingestCompletedAt: row.ingestCompletedAt,
    seedingStartedAt: row.seedingStartedAt,
    seedingStoppedAt: row.seedingStoppedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    assignedAt: row.assignedAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    deletedAt: row.deletedAt,
  }
}

function toDownloadTask(row: DownloadTaskRow, control?: { action: 'delete'; requestedAt: string }): DownloadTask {
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
    control,
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
    const rows = await db
      .select()
      .from(downloadTasks)
      .where(and(eq(downloadTasks.id, id), isNull(downloadTasks.deletedAt)))
      .limit(1)
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
        events: JSON.stringify([
          {
            id: `initial:${input.id}`,
            type: 'status_changed',
            occurredAt: input.now.getTime(),
            attempt: 1,
            from: null,
            to: input.status,
            reason: null,
            category: input.category ?? 'uncategorized',
            downloaderId: input.assignedDownloaderId,
            transferredBytes: null,
            billedBytes: 0,
            errorCode: null,
            errorMessage: null,
          },
        ]),
        createdAt: input.now,
        updatedAt: input.now,
        assignedAt: input.assignedAt,
      })
    },

    async list(filters: ListDownloadTasksFilters) {
      const offset = (filters.page - 1) * filters.pageSize
      const conditions: SQL[] = []
      conditions.push(isNull(downloadTasks.deletedAt))
      if (filters.orgId) conditions.push(eq(downloadTasks.orgId, filters.orgId))
      if (filters.downloaderId) conditions.push(eq(downloadTasks.assignedDownloaderId, filters.downloaderId))
      if (filters.statuses?.length) conditions.push(inArray(downloadTasks.status, filters.statuses))
      else if (filters.status) conditions.push(eq(downloadTasks.status, filters.status))
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
      return {
        items: rows.map((row) => toDownloadTask(row)),
        total: totalRows[0]?.count ?? 0,
        rows: rows.map((row) => toRecord(row)),
      }
    },

    async get(orgId, id) {
      const rows = await db
        .select()
        .from(downloadTasks)
        .where(and(eq(downloadTasks.id, id), eq(downloadTasks.orgId, orgId), isNull(downloadTasks.deletedAt)))
        .limit(1)
      if (!rows[0]) throw new DownloadError('not_found')
      return toDownloadTask(rows[0])
    },

    async getRecord(orgId, id) {
      const rows = await db
        .select()
        .from(downloadTasks)
        .where(and(eq(downloadTasks.id, id), eq(downloadTasks.orgId, orgId), isNull(downloadTasks.deletedAt)))
        .limit(1)
      if (!rows[0]) throw new DownloadError('not_found')
      return toRecord(rows[0])
    },

    async findRecord(id) {
      const row = await findRow(id)
      return row ? toRecord(row) : null
    },

    async listPendingCleanup(downloaderId, limit) {
      const rows = await db
        .select()
        .from(downloadTasks)
        .where(
          and(
            eq(downloadTasks.assignedDownloaderId, downloaderId),
            isNotNull(downloadTasks.deletedAt),
            sql`EXISTS (
              SELECT 1 FROM json_each(${downloadTasks.events}) task_event
              WHERE json_extract(task_event.value, '$.type') = 'cleanup_requested'
            )`,
            sql`NOT EXISTS (
              SELECT 1 FROM json_each(${downloadTasks.events}) task_event
              WHERE json_extract(task_event.value, '$.type') = 'cleanup_completed'
            )`,
          ),
        )
        .orderBy(asc(downloadTasks.deletedAt))
        .limit(limit)
      return rows.map((row) =>
        toDownloadTask(row, {
          action: 'delete',
          requestedAt: row.deletedAt?.toISOString() ?? row.updatedAt.toISOString(),
        }),
      )
    },

    async completeCleanup(id, downloaderId, now) {
      const rows = await db
        .select()
        .from(downloadTasks)
        .where(
          and(
            eq(downloadTasks.id, id),
            eq(downloadTasks.assignedDownloaderId, downloaderId),
            isNotNull(downloadTasks.deletedAt),
          ),
        )
        .limit(1)
      const row = rows[0]
      if (!row) throw new DownloadError('not_found')
      const events = parseDownloadTaskEvents(row.events)
      if (!events.some((event) => event.type === 'cleanup_requested')) throw new DownloadError('invalid_state')
      if (events.some((event) => event.type === 'cleanup_completed')) return toRecord(row)
      const updated = await db
        .update(downloadTasks)
        .set({
          events: appendCleanupEvent(sql`${downloadTasks.events}`, 'cleanup_completed', now),
          updatedAt: now,
        })
        .where(
          and(
            eq(downloadTasks.id, id),
            eq(downloadTasks.assignedDownloaderId, downloaderId),
            isNotNull(downloadTasks.deletedAt),
            sql`NOT EXISTS (
              SELECT 1 FROM json_each(${downloadTasks.events}) task_event
              WHERE json_extract(task_event.value, '$.type') = 'cleanup_completed'
            )`,
          ),
        )
        .returning()
      if (updated[0]) return toRecord(updated[0])
      const concurrent = await db.select().from(downloadTasks).where(eq(downloadTasks.id, id)).limit(1)
      if (!concurrent[0]) throw new DownloadError('not_found')
      return toRecord(concurrent[0])
    },

    async findActiveTargetWithin(orgId, folderPath) {
      if (!folderPath) return null
      const prefix = `${folderPath}/`
      const rows = await db
        .select()
        .from(downloadTasks)
        .where(
          and(
            eq(downloadTasks.orgId, orgId),
            isNull(downloadTasks.deletedAt),
            notInArray(downloadTasks.status, ['completed', 'failed', 'canceled']),
            ne(downloadTasks.targetFolder, ''),
            or(
              sql`lower(${downloadTasks.targetFolder}) = lower(${folderPath})`,
              sql`lower(substr(${downloadTasks.targetFolder}, 1, length(${prefix}))) = lower(${prefix})`,
            ),
          ),
        )
        .orderBy(asc(downloadTasks.createdAt))
        .limit(1)
      return rows[0] ? toRecord(rows[0]) : null
    },

    async setFields(id, fields: UpdateDownloadTaskFields) {
      const row = await findRow(id)
      if (!row) throw new DownloadError('not_found')
      const now = fields.updatedAt
      const attempt = nextValue(fields.attempt, sql`${downloadTasks.attempt}`)
      const category = sql`${downloadTasks.category}`
      const downloaderId = nextValue(fields.assignedDownloaderId, sql`${downloadTasks.assignedDownloaderId}`)
      const runtime = nextValue(fields.runtime, sql`${downloadTasks.runtime}`)
      const billedBytes = nextValue(fields.billingChargedBytes, sql`${downloadTasks.billingChargedBytes}`)
      const errorCode = nextValue(fields.errorCode, sql`${downloadTasks.errorCode}`)
      const errorMessage = nextValue(fields.errorMessage, sql`${downloadTasks.errorMessage}`)
      let events: SQL = sql`${downloadTasks.events}`
      if (fields.status !== undefined) {
        const reason =
          fields.status === 'suspended' && fields.billingStatus === 'insufficient_credits'
            ? 'insufficient_credits'
            : null
        events = statusEventExpression(events, fields.status, now, reason, {
          attempt,
          category,
          downloaderId,
          runtime,
          billedBytes,
          errorCode,
          errorMessage,
        })
      }
      if (fields.errorMessage && (fields.status === undefined || fields.status === row.status)) {
        events = appendErrorEvent(events, {
          now,
          attempt,
          category,
          downloaderId,
          runtime,
          billedBytes,
          errorCode,
          errorMessage: fields.errorMessage,
        })
      }
      await db
        .update(downloadTasks)
        .set({ ...fields, events })
        .where(and(eq(downloadTasks.id, id), isNull(downloadTasks.deletedAt)))
    },

    async claimQueued(id, downloaderId, now) {
      const rows = await db
        .update(downloadTasks)
        .set({
          status: 'assigned',
          assignedDownloaderId: downloaderId,
          assignedAt: now,
          updatedAt: now,
          events: statusEventExpression(sql`${downloadTasks.events}`, 'assigned', now, null, {
            downloaderId: sql`${downloaderId}`,
          }),
        })
        .where(
          and(
            eq(downloadTasks.id, id),
            eq(downloadTasks.status, 'queued'),
            isNull(downloadTasks.assignedDownloaderId),
            isNull(downloadTasks.deletedAt),
          ),
        )
        .returning({ id: downloadTasks.id })
      return rows.length > 0
    },

    async delete(id, now) {
      const rows = await db
        .update(downloadTasks)
        .set({
          deletedAt: now,
          updatedAt: now,
          events: sql`CASE
            WHEN ${downloadTasks.assignedDownloaderId} IS NOT NULL
              AND EXISTS (
                SELECT 1 FROM ${downloaders}
                WHERE ${downloaders.id} = ${downloadTasks.assignedDownloaderId}
              )
              THEN ${appendCleanupEvent(sql`${downloadTasks.events}`, 'cleanup_requested', now)}
            ELSE ${downloadTasks.events}
          END`,
        })
        .where(and(eq(downloadTasks.id, id), isNull(downloadTasks.deletedAt)))
        .returning({ id: downloadTasks.id })
      if (rows.length === 0) throw new DownloadError('not_found')
    },

    async listQueued(limit) {
      const rows = await db
        .select()
        .from(downloadTasks)
        .where(and(eq(downloadTasks.status, 'queued'), isNull(downloadTasks.deletedAt)))
        .orderBy(asc(downloadTasks.createdAt))
        .limit(limit)
      return rows.map(toRecord)
    },

    async requeueAssignedTo(downloaderId, statuses, now) {
      await db
        .update(downloadTasks)
        .set({
          status: 'queued',
          assignedDownloaderId: null,
          runtime: null,
          assignedAt: null,
          updatedAt: now,
          events: statusEventExpression(sql`${downloadTasks.events}`, 'queued', now, 'downloader_deleted'),
        })
        .where(
          and(
            eq(downloadTasks.assignedDownloaderId, downloaderId),
            inArray(downloadTasks.status, statuses),
            isNull(downloadTasks.deletedAt),
          ),
        )
    },

    async requeueAssignedToMany(downloaderIds, statuses, now) {
      if (downloaderIds.length === 0) return
      await db
        .update(downloadTasks)
        .set({
          status: 'queued',
          assignedDownloaderId: null,
          assignedAt: null,
          runtime: null,
          updatedAt: now,
          events: statusEventExpression(sql`${downloadTasks.events}`, 'queued', now, 'downloader_unreachable'),
        })
        .where(
          and(
            inArray(downloadTasks.assignedDownloaderId, downloaderIds),
            inArray(downloadTasks.status, statuses),
            isNull(downloadTasks.deletedAt),
          ),
        )
    },

    async resolveControlAssignedToMany(downloaderIds, now) {
      if (downloaderIds.length === 0) return
      // A canceling task whose downloader vanished is effectively canceled.
      await db
        .update(downloadTasks)
        .set({
          status: 'canceled',
          assignedDownloaderId: null,
          assignedAt: null,
          runtime: null,
          finishedAt: now,
          updatedAt: now,
          events: statusEventExpression(sql`${downloadTasks.events}`, 'canceled', now, 'downloader_unreachable'),
        })
        .where(
          and(
            inArray(downloadTasks.assignedDownloaderId, downloaderIds),
            eq(downloadTasks.status, 'canceling'),
            isNull(downloadTasks.deletedAt),
          ),
        )
      // A pausing task whose downloader vanished settles to paused (resumable).
      await db
        .update(downloadTasks)
        .set({
          status: 'paused',
          assignedDownloaderId: null,
          assignedAt: null,
          runtime: null,
          updatedAt: now,
          events: statusEventExpression(sql`${downloadTasks.events}`, 'paused', now, 'downloader_unreachable'),
        })
        .where(
          and(
            inArray(downloadTasks.assignedDownloaderId, downloaderIds),
            eq(downloadTasks.status, 'pausing'),
            isNull(downloadTasks.deletedAt),
          ),
        )
    },

    async clearStaleSeedingRuntime(leaseCutoff, now) {
      // A completed task only keeps 'seeding' while a live downloader reports it.
      // Flip the stale runtime out of the seeding phase on any completed+seeding
      // task NOT owned by a recently-heartbeating downloader — covers offline,
      // deleted, and orphaned (null) owners. Surgically edit the JSON (phase ->
      // completed, drop the seeding object) so the download/upload progress and
      // file list are preserved; nulling it would erase the transfer record.
      // The LIKE only matches the seeding flag, so it's a one-shot.
      const liveDownloaders = db
        .select({ id: downloaders.id })
        .from(downloaders)
        .where(gte(downloaders.lastHeartbeatAt, leaseCutoff))
      await db
        .update(downloadTasks)
        .set({
          runtime: sql`json_remove(json_set(${downloadTasks.runtime}, '$.phase', 'completed'), '$.seeding')`,
          updatedAt: now,
        })
        .where(
          and(
            eq(downloadTasks.status, 'completed'),
            isNull(downloadTasks.deletedAt),
            like(downloadTasks.runtime, '%"phase":"seeding"%'),
            or(
              isNull(downloadTasks.assignedDownloaderId),
              notInArray(downloadTasks.assignedDownloaderId, liveDownloaders),
            ),
          ),
        )
    },
  }
}
