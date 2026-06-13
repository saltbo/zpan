import { asc, eq, inArray } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { remoteDownloadUsageReports } from '../../db/schema'
import type { Database } from '../../platform/interface'
import type {
  InsertRemoteDownloadUsageReportInput,
  RemoteDownloadUsageRepo,
  RemoteDownloadUsageReportRecord,
  RemoteDownloadUsageStatus,
} from '../../usecases/ports'

function toRecord(row: typeof remoteDownloadUsageReports.$inferSelect): RemoteDownloadUsageReportRecord {
  return {
    id: row.id,
    orgId: row.orgId,
    downloaderId: row.downloaderId,
    taskId: row.taskId,
    eventId: row.eventId,
    unitIndex: row.unitIndex,
    unitBytes: row.unitBytes,
    creditsPerUnit: row.creditsPerUnit,
    status: row.status as RemoteDownloadUsageStatus,
    error: row.error,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function createRemoteDownloadUsageRepo(db: Database): RemoteDownloadUsageRepo {
  return {
    async findByEventId(eventId) {
      const rows = await db
        .select()
        .from(remoteDownloadUsageReports)
        .where(eq(remoteDownloadUsageReports.eventId, eventId))
        .limit(1)
      return rows[0] ? toRecord(rows[0]) : undefined
    },

    async insert(input: InsertRemoteDownloadUsageReportInput) {
      await db.insert(remoteDownloadUsageReports).values({
        id: nanoid(),
        orgId: input.orgId,
        downloaderId: input.downloaderId,
        taskId: input.taskId,
        eventId: input.eventId,
        unitIndex: input.unitIndex,
        unitBytes: input.unitBytes,
        creditsPerUnit: input.creditsPerUnit,
        status: 'pending',
        error: null,
        createdAt: input.now,
        updatedAt: input.now,
      })
    },

    async updateStatus(eventId, status, error, now) {
      await db
        .update(remoteDownloadUsageReports)
        .set({ status, error, updatedAt: now })
        .where(eq(remoteDownloadUsageReports.eventId, eventId))
    },

    async listPending(limit) {
      const rows = await db
        .select()
        .from(remoteDownloadUsageReports)
        .where(inArray(remoteDownloadUsageReports.status, ['pending', 'failed']))
        .orderBy(asc(remoteDownloadUsageReports.createdAt))
        .limit(limit)
      return rows.map(toRecord)
    },
  }
}
