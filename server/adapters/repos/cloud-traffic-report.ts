import { asc, eq, inArray } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { cloudTrafficReports } from '../../db/schema'
import type { Database } from '../../platform/interface'
import type {
  CloudTrafficReportRecord,
  CloudTrafficReportRepo,
  CloudTrafficReportStatus,
  InsertCloudTrafficReportInput,
} from '../../usecases/ports'

function toRecord(row: typeof cloudTrafficReports.$inferSelect): CloudTrafficReportRecord {
  return {
    id: row.id,
    orgId: row.orgId,
    period: row.period,
    source: row.source,
    sourceId: row.sourceId,
    eventId: row.eventId,
    bytes: row.bytes,
    storageId: row.storageId,
    unitBytes: row.unitBytes,
    creditsPerUnit: row.creditsPerUnit,
    status: row.status as CloudTrafficReportStatus,
    error: row.error,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function createCloudTrafficReportRepo(db: Database): CloudTrafficReportRepo {
  return {
    async findByEventId(eventId) {
      const rows = await db.select().from(cloudTrafficReports).where(eq(cloudTrafficReports.eventId, eventId)).limit(1)
      return rows[0] ? toRecord(rows[0]) : undefined
    },

    async insert(input: InsertCloudTrafficReportInput) {
      await db.insert(cloudTrafficReports).values({
        id: nanoid(),
        orgId: input.orgId,
        period: input.period,
        source: input.source,
        sourceId: input.sourceId,
        eventId: input.eventId,
        bytes: input.bytes,
        storageId: input.storageId,
        unitBytes: input.unitBytes,
        creditsPerUnit: input.creditsPerUnit,
        status: input.status,
        error: null,
        createdAt: input.now,
        updatedAt: input.now,
      })
    },

    async updateStatus(eventId, status, error, now) {
      await db
        .update(cloudTrafficReports)
        .set({ status, error, updatedAt: now })
        .where(eq(cloudTrafficReports.eventId, eventId))
    },

    async listPending(limit) {
      const rows = await db
        .select()
        .from(cloudTrafficReports)
        .where(inArray(cloudTrafficReports.status, ['pending', 'failed']))
        .orderBy(asc(cloudTrafficReports.createdAt))
        .limit(limit)
      return rows.map(toRecord)
    },
  }
}
