import { and, asc, eq, isNull, lte, ne, or, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { cloudTrafficReports } from '../../db/schema'
import { currentTrafficPeriod } from '../../domain/quota'
import type { Database } from '../../platform/interface'
import type {
  CloudTrafficReportRecord,
  CloudTrafficReportRepo,
  CloudTrafficReportStatus,
  InsertCloudTrafficReportInput,
} from '../../usecases/ports'

export const TRAFFIC_LEDGER_OPENING_EVENT_ID = 'traffic_ledger_opening_v1'
const HOUR_MS = 3_600_000

export function trafficLedgerExactFrom(opening: Date): Date {
  return new Date(Math.ceil(opening.getTime() / HOUR_MS) * HOUR_MS)
}

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
    attemptCount: row.attemptCount,
    nextRetryAt: row.nextRetryAt,
    issuedAt: row.issuedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function createCloudTrafficReportRepo(db: Database): CloudTrafficReportRepo {
  return {
    async ensureLedgerOpening(now) {
      await db
        .insert(cloudTrafficReports)
        .values({
          id: TRAFFIC_LEDGER_OPENING_EVENT_ID,
          orgId: '',
          period: currentTrafficPeriod(now),
          source: 'object_download',
          sourceId: TRAFFIC_LEDGER_OPENING_EVENT_ID,
          eventId: TRAFFIC_LEDGER_OPENING_EVENT_ID,
          bytes: 0,
          storageId: null,
          unitBytes: null,
          creditsPerUnit: null,
          status: 'ledger_opening',
          error: null,
          attemptCount: 0,
          nextRetryAt: null,
          issuedAt: null,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing({ target: cloudTrafficReports.eventId })
    },

    async getLedgerOpening() {
      const rows = await db
        .select({ createdAt: cloudTrafficReports.createdAt })
        .from(cloudTrafficReports)
        .where(eq(cloudTrafficReports.eventId, TRAFFIC_LEDGER_OPENING_EVENT_ID))
        .limit(1)
      return rows[0]?.createdAt ?? null
    },

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
        attemptCount: 0,
        nextRetryAt: null,
        issuedAt: null,
        createdAt: input.now,
        updatedAt: input.now,
      })
    },

    async markIssued(eventId, now) {
      const rows = await db
        .update(cloudTrafficReports)
        .set({ issuedAt: sql`COALESCE(${cloudTrafficReports.issuedAt}, ${now.getTime()})`, updatedAt: now })
        .where(and(eq(cloudTrafficReports.eventId, eventId), ne(cloudTrafficReports.status, 'reversed')))
        .returning({ eventId: cloudTrafficReports.eventId })
      if (rows.length !== 1) throw new Error(`traffic_report_not_found:${eventId}`)
    },

    async reverse(eventId, now) {
      const rows = await db
        .update(cloudTrafficReports)
        .set({ status: 'reversed', error: null, nextRetryAt: null, issuedAt: null, updatedAt: now })
        .where(eq(cloudTrafficReports.eventId, eventId))
        .returning({ eventId: cloudTrafficReports.eventId })
      if (rows.length !== 1) throw new Error(`traffic_report_not_found:${eventId}`)
    },

    async updateStatus(eventId, status, error, now, retry) {
      await db
        .update(cloudTrafficReports)
        .set({
          status,
          error,
          updatedAt: now,
          ...(retry ? { attemptCount: retry.attemptCount, nextRetryAt: retry.nextRetryAt } : {}),
        })
        .where(eq(cloudTrafficReports.eventId, eventId))
    },

    async listPending(limit, now) {
      const rows = await db
        .select()
        .from(cloudTrafficReports)
        .where(
          or(
            eq(cloudTrafficReports.status, 'pending'),
            and(
              eq(cloudTrafficReports.status, 'failed'),
              or(isNull(cloudTrafficReports.nextRetryAt), lte(cloudTrafficReports.nextRetryAt, now)),
            ),
          ),
        )
        .orderBy(
          asc(sql`CASE WHEN ${cloudTrafficReports.status} = 'pending' THEN 0 ELSE 1 END`),
          asc(cloudTrafficReports.nextRetryAt),
          asc(cloudTrafficReports.createdAt),
        )
        .limit(limit)
      return rows.map(toRecord)
    },
  }
}
