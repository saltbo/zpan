import { eq, sql } from 'drizzle-orm'
import { auditEvents, systemOptions } from '../../db/schema'
import { validDownloadTaskEventPredicate } from '../../domain/download-task-events'
import type { Database } from '../../platform/interface'
import { createCloudTrafficReportRepo, trafficLedgerExactFrom } from './cloud-traffic-report'

const OPENING_SOURCE_ID = 'v3-authoritative-sources'
const OPENING_EVENT_ID = `audit:statistics_source_initialized:${OPENING_SOURCE_ID}`
const OPENING_OPTION_KEY = 'stats_integrity_exact_from_v3'

export interface AdminStatsSourceIntegrity {
  exactFrom: Date
  missingDownloadTaskTerminalEvents: number
  invalidDownloadTaskEvents: number
  backgroundJobsMissingFinishedAt: number
  invalidIssuedTrafficReports: number
  invalidAuditEvents: number
  missingUserRegistrationEvents: number
  storageLedgerDriftSpaces: number
  storageLedgerDriftBytes: number
}

export async function ensureAdminStatsIntegrityOpening(db: Database, now = new Date()): Promise<Date> {
  const existing = await db
    .select({ value: systemOptions.value })
    .from(systemOptions)
    .where(eq(systemOptions.key, OPENING_OPTION_KEY))
    .limit(1)
  if (existing[0]) return parseOpening(existing[0].value)

  const legacy = await db
    .select({ createdAt: auditEvents.createdAt })
    .from(auditEvents)
    .where(eq(auditEvents.id, OPENING_EVENT_ID))
    .limit(1)
  const exactFrom = legacy[0]?.createdAt ?? new Date((Math.floor(now.getTime() / 1000) + 1) * 1000)
  await db
    .insert(systemOptions)
    .values({ key: OPENING_OPTION_KEY, value: exactFrom.toISOString() })
    .onConflictDoNothing({ target: systemOptions.key })
  await db.delete(auditEvents).where(eq(auditEvents.id, OPENING_EVENT_ID))

  const rows = await db
    .select({ value: systemOptions.value })
    .from(systemOptions)
    .where(eq(systemOptions.key, OPENING_OPTION_KEY))
    .limit(1)
  if (!rows[0]) throw new Error('admin_stats_integrity_opening_missing')
  return parseOpening(rows[0].value)
}

export async function inspectAdminStatsSourceIntegrity(
  db: Database,
  opening?: Date,
): Promise<AdminStatsSourceIntegrity> {
  const exactFrom = opening ?? (await getAdminStatsIntegrityOpening(db))
  if (!exactFrom) throw new Error('admin_stats_integrity_opening_missing')
  const exactFromMs = exactFrom.getTime()
  const exactFromSec = Math.floor(exactFromMs / 1000)
  const trafficOpening = await createCloudTrafficReportRepo(db).getLedgerOpening()
  const trafficExactFromMs = trafficOpening ? trafficLedgerExactFrom(trafficOpening).getTime() : exactFromMs
  const validTaskEvent = sql.raw(validDownloadTaskEventPredicate('task_event.value'))
  const rows = await db.all<Omit<AdminStatsSourceIntegrity, 'exactFrom'>>(sql`
    WITH billable_storage AS (
      SELECT org_id, SUM(bytes) AS bytes
      FROM (
        SELECT org_id, COALESCE(size, 0) AS bytes
        FROM matters
        WHERE status IN ('active', 'trashed') AND dirtype = 0 AND purged_at IS NULL
        UNION ALL
        SELECT org_id, COALESCE(size, 0) AS bytes
        FROM image_hostings
        WHERE status = 'active' AND purged_at IS NULL
      ) inventory
      GROUP BY org_id
    ),
    ledger_storage AS (
      SELECT org_id, SUM(delta_bytes) AS bytes
      FROM storage_usage_ledger
      WHERE org_id <> ''
      GROUP BY org_id
    ),
    ledger_drift AS (
      SELECT ABS(COALESCE(ledger_storage.bytes, 0) - COALESCE(billable_storage.bytes, 0)) AS bytes
      FROM organization o
      LEFT JOIN billable_storage ON billable_storage.org_id = o.id
      LEFT JOIN ledger_storage ON ledger_storage.org_id = o.id
      WHERE COALESCE(ledger_storage.bytes, 0) <> COALESCE(billable_storage.bytes, 0)
    ),
    invalid_events AS (
      SELECT COUNT(*) AS count
      FROM audit_events
      WHERE created_at >= ${exactFromSec}
        AND (
          (action = 'upload_confirm' AND (
              json_valid(metadata) = 0
              OR COALESCE(json_type(metadata, '$.bytes') IN ('integer', 'real'), 0) = 0
              OR json_extract(metadata, '$.bytes') < 0
              OR COALESCE(json_type(metadata, '$.source') = 'text', 0) = 0
              OR COALESCE(length(json_extract(metadata, '$.source')), 0) = 0
            ))
          OR (action IN ('upload_failed', 'download_failed') AND (
              json_valid(metadata) = 0
              OR COALESCE(json_type(metadata, '$.bytes') IN ('integer', 'real'), 0) = 0
              OR json_extract(metadata, '$.bytes') < 0
              OR COALESCE(json_type(metadata, '$.source') = 'text', 0) = 0
              OR COALESCE(length(json_extract(metadata, '$.source')), 0) = 0
            ))
          OR (action = 'save_from_share' AND (
              json_valid(metadata) = 0
              OR COALESCE(json_type(metadata, '$.shareId') = 'text', 0) = 0
              OR COALESCE(length(json_extract(metadata, '$.shareId')), 0) = 0
            ))
          OR (action = 'user_register' AND (
              json_valid(metadata) = 0
              OR target_id IS NULL
              OR user_id <> target_id
              OR id <> 'event:user_register:' || target_id
              OR COALESCE(json_type(metadata, '$.provider') = 'text', 0) = 0
              OR COALESCE(length(json_extract(metadata, '$.provider')), 0) = 0
            ))
        )
    ),
    invalid_task_events AS (
      SELECT COUNT(*) AS count
      FROM download_tasks dt
      JOIN json_each(dt.events) AS task_event
      WHERE NOT (${validTaskEvent})
    )
    SELECT
      (SELECT COUNT(*)
       FROM background_jobs bj
       WHERE bj.updated_at >= ${exactFromMs}
         AND bj.status IN ('completed', 'failed', 'canceled')
         AND bj.finished_at IS NULL) AS backgroundJobsMissingFinishedAt,
      (SELECT COUNT(*)
       FROM download_tasks dt
       WHERE dt.finished_at >= ${exactFromMs}
         AND dt.status IN ('completed', 'failed', 'canceled')
         AND NOT EXISTS (
           SELECT 1 FROM json_each(dt.events) task_event
           WHERE json_extract(task_event.value, '$.type') = 'status_changed'
             AND json_extract(task_event.value, '$.attempt') = dt.attempt
             AND json_extract(task_event.value, '$.to') = dt.status
             AND json_extract(task_event.value, '$.occurredAt') = dt.finished_at
         )) AS missingDownloadTaskTerminalEvents,
      (SELECT count FROM invalid_task_events) AS invalidDownloadTaskEvents,
      (SELECT COUNT(*)
       FROM cloud_traffic_reports ctr
       WHERE ctr.issued_at >= ${trafficExactFromMs}
         AND (
           ctr.status = 'reversed'
           OR ctr.bytes < 0
           OR length(ctr.org_id) = 0
           OR length(ctr.source_id) = 0
           OR ctr.source NOT IN (
             'object_download', 'direct_share', 'landing_share',
             'image_hosting', 'custom_domain_image', 'webdav_download'
           )
         )) AS invalidIssuedTrafficReports,
      (SELECT count FROM invalid_events) AS invalidAuditEvents,
      (SELECT COUNT(*)
       FROM user registered_user
       WHERE registered_user.created_at >= ${exactFromMs}
         AND NOT EXISTS (
           SELECT 1
           FROM audit_events registration_event
           WHERE registration_event.action = 'user_register'
             AND registration_event.id = 'event:user_register:' || registered_user.id
             AND registration_event.user_id = registered_user.id
             AND registration_event.target_id = registered_user.id
             AND registration_event.created_at = CAST(registered_user.created_at / 1000 AS INTEGER)
             AND json_valid(registration_event.metadata) = 1
             AND json_type(registration_event.metadata, '$.provider') = 'text'
             AND length(json_extract(registration_event.metadata, '$.provider')) > 0
         )) AS missingUserRegistrationEvents,
      (SELECT COUNT(*) FROM ledger_drift) AS storageLedgerDriftSpaces,
      (SELECT COALESCE(SUM(bytes), 0) FROM ledger_drift) AS storageLedgerDriftBytes
  `)

  const row = rows[0]
  return {
    exactFrom,
    missingDownloadTaskTerminalEvents: Number(row?.missingDownloadTaskTerminalEvents ?? 0),
    invalidDownloadTaskEvents: Number(row?.invalidDownloadTaskEvents ?? 0),
    backgroundJobsMissingFinishedAt: Number(row?.backgroundJobsMissingFinishedAt ?? 0),
    invalidIssuedTrafficReports: Number(row?.invalidIssuedTrafficReports ?? 0),
    invalidAuditEvents: Number(row?.invalidAuditEvents ?? 0),
    missingUserRegistrationEvents: Number(row?.missingUserRegistrationEvents ?? 0),
    storageLedgerDriftSpaces: Number(row?.storageLedgerDriftSpaces ?? 0),
    storageLedgerDriftBytes: Number(row?.storageLedgerDriftBytes ?? 0),
  }
}

export function assertAdminStatsSourceIntegrity(integrity: AdminStatsSourceIntegrity): void {
  const { exactFrom: _, ...counts } = integrity
  if (Object.values(counts).every((count) => count === 0)) return
  console.error(
    JSON.stringify({ event: 'admin_stats_source_integrity_failed', exactFrom: integrity.exactFrom, counts }),
  )
  throw new Error('admin_stats_source_integrity_failed')
}

async function getAdminStatsIntegrityOpening(db: Database): Promise<Date | null> {
  const rows = await db
    .select({ value: systemOptions.value })
    .from(systemOptions)
    .where(eq(systemOptions.key, OPENING_OPTION_KEY))
    .limit(1)
  return rows[0] ? parseOpening(rows[0].value) : null
}

function parseOpening(value: string): Date {
  const opening = new Date(value)
  if (Number.isNaN(opening.getTime())) throw new Error('admin_stats_integrity_opening_invalid')
  return opening
}
