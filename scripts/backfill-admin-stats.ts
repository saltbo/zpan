#!/usr/bin/env tsx

import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import {
  downloadTaskEventTimestampSql,
  downloadTaskTerminalEventPredicate,
  validDownloadTaskEventPredicate,
} from '../server/domain/download-task-events'
import {
  ADMIN_STATS_FACT_COUNTER_METRICS,
  buildAdminStatsCounterRollupInsertSql,
} from '../server/adapters/repos/admin-stats-counter-query'
import { ADMIN_STATS_METRICS as M } from '../server/domain/admin-stats-metrics'

const MIN_VALID_TIMESTAMP_MS = Date.UTC(2000, 0, 1)
const MAX_BACKFILL_HOURS = 100_000
const STATISTICS_OPENING_SOURCE_ID = 'v3-authoritative-sources'
const STATISTICS_OPENING_EVENT_ID = `audit:statistics_source_initialized:${STATISTICS_OPENING_SOURCE_ID}`
const STATISTICS_OPENING_OPTION_KEY = 'stats_integrity_exact_from_v3'

const statisticsExactFromMsSql = `COALESCE(
  (SELECT unixepoch(value) * 1000 FROM system_options WHERE key = '${STATISTICS_OPENING_OPTION_KEY}'),
  (SELECT created_at * 1000 FROM audit_events WHERE id = '${STATISTICS_OPENING_EVENT_ID}'),
  (unixepoch() + 1) * 1000
)`
const statisticsFirstFullHourMsSql = `CAST((${statisticsExactFromMsSql} + 3599999) / 3600000 AS INTEGER) * 3600000`

type Target =
  | { kind: 'sqlite'; path: string }
  | { kind: 'd1'; database: string; remote: boolean; env?: string }

interface Options {
  target: Target
  apply: boolean
}

interface ValidationSummary {
  auditEvents: number
  missingUploadBytes: number
  missingDownloadBytes: number
  trafficEvents: number
  hourlyRollups: number
  rawActiveShares: number
  validActiveShares: number
  rawUploadEvents: number
  rollupUploadEvents: number
  rawUploadBytes: number
  rollupUploadBytes: number
  rawDownloadEvents: number
  rollupDownloadEvents: number
  rawDownloadBytes: number
  rollupDownloadBytes: number
  rawStorageWrittenBytes: number
  rollupStorageWrittenBytes: number
  rawStorageReleasedBytes: number
  rollupStorageReleasedBytes: number
  rawUploadAttempts: number
  rollupUploadAttempts: number
  rawUserSignups: number
  rollupUserSignups: number
  rawSharesCreated: number
  rollupSharesCreated: number
  rawShareDownloads: number
  rollupShareDownloads: number
  rawShareSaves: number
  rollupShareSaves: number
  rawFailedDownloads: number
  rollupFailedDownloads: number
  rawFinishedDownloadTasks: number
  rollupFinishedDownloadTasks: number
  rawFinishedBackgroundJobs: number
  rollupFinishedBackgroundJobs: number
  rawMissingByteEvents: number
  rollupMissingByteEvents: number
  invalidAuditEvents: number
  missingUserRegistrationEvents: number
  invalidDownloadTaskEvents: number
  orphanRollupBuckets: number
  requiredDimensionMismatchGroups: number
  lowerBoundRollups: number
  legacyRollupRows: number
  counterExpectedBuckets: number
  counterCompletedBuckets: number
  counterMissingBuckets: number
  openCounterMarkers: number
}

interface BackfillPlan {
  invalidAuditEvents: number
  issuedTrafficReportsToRecover: number
  userRegistrationEventsToRecover: number
}

export function buildBackfillSql(now = new Date()): string {
  const trafficPeriod = now.toISOString().slice(0, 7)
  const openingAt = new Date((Math.floor(now.getTime() / 1000) + 1) * 1000).toISOString()
  return `
INSERT OR IGNORE INTO system_options (key, value)
VALUES (
  '${STATISTICS_OPENING_OPTION_KEY}',
  COALESCE(
    (SELECT strftime('%Y-%m-%dT%H:%M:%fZ', created_at, 'unixepoch') FROM audit_events WHERE id = '${STATISTICS_OPENING_EVENT_ID}'),
    '${openingAt}'
  )
);

DELETE FROM audit_events WHERE id = '${STATISTICS_OPENING_EVENT_ID}';

INSERT OR IGNORE INTO cloud_traffic_reports (
  id, org_id, period, source, source_id, event_id, bytes, storage_id,
  unit_bytes, credits_per_unit, status, error, attempt_count, next_retry_at,
  issued_at, created_at, updated_at
) VALUES (
  'traffic_ledger_opening_v1', '', '${trafficPeriod}', 'object_download',
  'traffic_ledger_opening_v1', 'traffic_ledger_opening_v1', 0, NULL,
  NULL, NULL, 'ledger_opening', NULL, 0, NULL, NULL, ${now.getTime()}, ${now.getTime()}
);

UPDATE audit_events
SET actor_type = CASE WHEN user_id IS NULL THEN 'anonymous' ELSE 'user' END
WHERE actor_type IS NULL;

INSERT OR IGNORE INTO audit_events (
  id, org_id, user_id, actor_type, actor_ref, action, target_type,
  target_id, target_name, metadata, created_at
)
SELECT
  'event:user_register:' || registered_user.id,
  '',
  registered_user.id,
  'user',
  NULL,
  'user_register',
  'user',
  registered_user.id,
  registered_user.id,
  json_object(
    'provider',
    COALESCE(
      NULLIF((
        SELECT account.provider_id
        FROM account
        WHERE account.user_id = registered_user.id
        ORDER BY account.created_at, account.id
        LIMIT 1
      ), ''),
      'unknown'
    )
  ),
  CAST(registered_user.created_at / 1000 AS INTEGER)
FROM user registered_user;

UPDATE user
SET last_active_at = (
  SELECT MAX(ae.created_at * 1000)
  FROM audit_events ae
  WHERE ae.action = 'user_access' AND ae.user_id = user.id
)
WHERE EXISTS (
  SELECT 1 FROM audit_events ae
  WHERE ae.action = 'user_access' AND ae.user_id = user.id
)
AND (
  last_active_at IS NULL
  OR last_active_at < (
    SELECT MAX(ae.created_at * 1000)
    FROM audit_events ae
    WHERE ae.action = 'user_access' AND ae.user_id = user.id
  )
);

DELETE FROM audit_events WHERE action = 'user_access';

UPDATE download_tasks
SET events = json_insert(
  events,
  '$[#]',
  json_object(
    'id', 'backfill:status:' || id || ':' || attempt || ':' || finished_at || ':' || status,
    'type', 'status_changed',
    'occurredAt', finished_at,
    'attempt', attempt,
    'from', NULL,
    'to', status,
    'reason', NULL,
    'category', COALESCE(category, 'uncategorized'),
    'downloaderId', assigned_downloader_id,
    'transferredBytes', CASE
      WHEN json_valid(runtime) = 1 AND json_type(runtime, '$.progress.download.bytes') = 'integer'
        THEN json_extract(runtime, '$.progress.download.bytes')
      ELSE NULL
    END,
    'billedBytes', billing_charged_bytes,
    'errorCode', error_code,
    'errorMessage', error_message
  )
)
WHERE finished_at IS NOT NULL
  AND status IN ('completed', 'failed', 'canceled')
  AND NOT EXISTS (
    SELECT 1
    FROM json_each(download_tasks.events) task_event
    WHERE json_extract(task_event.value, '$.type') = 'status_changed'
      AND json_extract(task_event.value, '$.attempt') = download_tasks.attempt
      AND json_extract(task_event.value, '$.to') = download_tasks.status
      AND json_extract(task_event.value, '$.occurredAt') = download_tasks.finished_at
  );

DELETE FROM audit_events
WHERE action IN (
  'download_task_assigned', 'download_task_started', 'download_task_ingesting',
  'download_task_completed', 'download_task_failed', 'download_task_canceled',
  'download_task_suspended', 'download_task_paused', 'download_task_interrupted',
  'download_task_queued', 'download_task_error', 'download_task_billing_suspended',
  'download_resolve_started', 'download_resolve_completed', 'download_completed',
  'download_ingest_started', 'download_ingest_completed',
  'download_seeding_started', 'download_seeding_stopped',
  'download_stale_control_resolved', 'download_stale_requeued'
);

UPDATE cloud_traffic_reports AS ctr
SET issued_at = (
  SELECT ae.created_at * 1000
  FROM audit_events ae
  WHERE ae.action IN ('share_download', 'object_download', 'image_hosting_download', 'webdav_download')
    AND ae.id NOT LIKE 'backfill_%'
    AND json_valid(ae.metadata) = 1
    AND json_extract(ae.metadata, '$.trafficEventId') = ctr.event_id
  ORDER BY ae.created_at
  LIMIT 1
)
WHERE ctr.issued_at IS NULL
  AND ctr.status NOT IN ('blocked', 'reversed', 'ledger_opening')
  AND EXISTS (
    SELECT 1 FROM audit_events ae
    WHERE ae.action IN ('share_download', 'object_download', 'image_hosting_download', 'webdav_download')
      AND ae.id NOT LIKE 'backfill_%'
      AND json_valid(ae.metadata) = 1
      AND json_extract(ae.metadata, '$.trafficEventId') = ctr.event_id
  );

${purgeLegacyRollupsSql()}
${purgeOpenRollupsSql(now)}
${purgeCounterRollupsSql()}

${buildHourlyBackfillSql(now)}
`
}

function buildHourlyBackfillSql(now: Date): string {
  const currentHour = Math.floor(now.getTime() / 3_600_000) * 3_600_000
  const fromMs = `MAX(${MIN_VALID_TIMESTAMP_MS}, COALESCE(${statisticsFirstFullHourMsSql}, ${MIN_VALID_TIMESTAMP_MS}))`
  return [
    buildAdminStatsCounterRollupInsertSql({ fromMs, toMs: currentHour }),
    rollupMarkerBackfillSql(now),
  ].join(';\n\n')
}
function purgeLegacyRollupsSql(): string {
  return `DELETE FROM stats_rollups_hourly
WHERE CASE WHEN json_valid(metadata) = 1 THEN
    json_extract(metadata, '$.version') = 3
    AND json_extract(metadata, '$.scope') IN ('counters', 'snapshots', 'full')
    AND json_extract(metadata, '$.quality') = 'exact'
  ELSE 0 END = 0;`
}

function purgeOpenRollupsSql(now: Date): string {
  const currentHour = Math.floor(now.getTime() / 3_600_000) * 3_600_000
  return `DELETE FROM stats_rollups_hourly WHERE bucket_start >= ${currentHour};`
}

function purgeCounterRollupsSql(): string {
  const metricKeys = [
    ...ADMIN_STATS_FACT_COUNTER_METRICS,
    M.statsMissingBytes,
    'share.password_passed',
    'traffic.report_sync',
  ]
    .map((metric) => `'${metric}'`)
    .join(', ')
  return `DELETE FROM stats_rollups_hourly
WHERE metric_key IN (
    ${metricKeys}
  )
  OR (
    metric_key = 'stats.rollup_run'
    AND CASE WHEN json_valid(metadata) = 1 THEN json_extract(metadata, '$.scope') = 'counters' ELSE 0 END = 1
  );`
}

function rollupMarkerBackfillSql(now: Date): string {
  const currentHour = Math.floor(now.getTime() / 3_600_000) * 3_600_000
  const latestClosedHour = currentHour - 3_600_000
  return `WITH
digits(n) AS (VALUES (0),(1),(2),(3),(4),(5),(6),(7),(8),(9)),
numbers(n) AS (
  SELECT ones.n + tens.n * 10 + hundreds.n * 100 + thousands.n * 1000 + ten_thousands.n * 10000
  FROM digits ones
  CROSS JOIN digits tens
  CROSS JOIN digits hundreds
  CROSS JOIN digits thousands
  CROSS JOIN digits ten_thousands
),
bounds AS (
  SELECT ${statsHistoryStartSql()} AS start_at, ${latestClosedHour} AS end_at
),
buckets AS (
  SELECT start_at + numbers.n * 3600000 AS bucket_start
  FROM bounds
  JOIN numbers ON start_at + numbers.n * 3600000 <= end_at
  WHERE start_at IS NOT NULL AND start_at <= end_at
),
snapshot_markers AS MATERIALIZED (
  SELECT
    bucket_start,
    COALESCE(json_extract(metadata, '$.snapshotQuality'), json_extract(metadata, '$.quality'), 'exact') AS quality,
    COALESCE(json_extract(metadata, '$.snapshotObservedAt'), json_extract(metadata, '$.observedAt')) AS observed_at
  FROM stats_rollups_hourly
  WHERE metric_key = 'stats.rollup_run' AND org_id = '' AND dimension_key = '' AND dimension_value = ''
    AND json_valid(metadata) = 1
    AND json_extract(metadata, '$.version') = 3
    AND json_extract(metadata, '$.scope') IN ('snapshots', 'full')
    AND COALESCE(json_extract(metadata, '$.snapshotObservedAt'), json_extract(metadata, '$.observedAt')) IS NOT NULL
)
INSERT INTO stats_rollups_hourly (
  id, bucket_start, org_id, metric_key, dimension_key, dimension_value,
  count, bytes, unique_count, metadata, updated_at
)
SELECT
  CAST(buckets.bucket_start AS TEXT) || ':global:stats.rollup_run:all:all',
  buckets.bucket_start, '', 'stats.rollup_run', '', '', 1, 0, 0,
  CASE WHEN snapshot_markers.bucket_start IS NULL THEN
    json_object(
      'version', 3,
      'scope', 'counters',
      'quality', CASE WHEN EXISTS (
        SELECT 1 FROM stats_rollups_hourly result
        WHERE result.bucket_start = buckets.bucket_start
          AND result.metric_key <> 'stats.rollup_run'
          AND json_valid(result.metadata) = 1
          AND json_extract(result.metadata, '$.version') = 3
          AND json_extract(result.metadata, '$.scope') = 'counters'
          AND json_extract(result.metadata, '$.quality') = 'lower_bound'
      ) THEN 'lower_bound' ELSE 'exact' END,
      'counterQuality', CASE WHEN EXISTS (
        SELECT 1 FROM stats_rollups_hourly result
        WHERE result.bucket_start = buckets.bucket_start
          AND result.metric_key <> 'stats.rollup_run'
          AND json_valid(result.metadata) = 1
          AND json_extract(result.metadata, '$.version') = 3
          AND json_extract(result.metadata, '$.scope') = 'counters'
          AND json_extract(result.metadata, '$.quality') = 'lower_bound'
      ) THEN 'lower_bound' ELSE 'exact' END
    )
  ELSE
    json_object(
      'version', 3,
      'scope', 'full',
      'quality', CASE WHEN snapshot_markers.quality = 'lower_bound' OR EXISTS (
        SELECT 1 FROM stats_rollups_hourly result
        WHERE result.bucket_start = buckets.bucket_start
          AND result.metric_key <> 'stats.rollup_run'
          AND json_valid(result.metadata) = 1
          AND json_extract(result.metadata, '$.version') = 3
          AND json_extract(result.metadata, '$.scope') = 'counters'
          AND json_extract(result.metadata, '$.quality') = 'lower_bound'
      ) THEN 'lower_bound' ELSE 'exact' END,
      'counterQuality', CASE WHEN EXISTS (
        SELECT 1 FROM stats_rollups_hourly result
        WHERE result.bucket_start = buckets.bucket_start
          AND result.metric_key <> 'stats.rollup_run'
          AND json_valid(result.metadata) = 1
          AND json_extract(result.metadata, '$.version') = 3
          AND json_extract(result.metadata, '$.scope') = 'counters'
          AND json_extract(result.metadata, '$.quality') = 'lower_bound'
      ) THEN 'lower_bound' ELSE 'exact' END,
      'snapshotQuality', snapshot_markers.quality,
      'snapshotObservedAt', snapshot_markers.observed_at
    )
  END,
  buckets.bucket_start + 3600000
FROM buckets
LEFT JOIN snapshot_markers ON snapshot_markers.bucket_start = buckets.bucket_start
WHERE true
ON CONFLICT(bucket_start, org_id, metric_key, dimension_key, dimension_value)
DO UPDATE SET count = excluded.count, bytes = excluded.bytes, unique_count = excluded.unique_count,
  metadata = excluded.metadata, updated_at = excluded.updated_at
WHERE count <> excluded.count OR bytes <> excluded.bytes OR unique_count <> excluded.unique_count
  OR metadata <> excluded.metadata OR updated_at <> excluded.updated_at;`
}

function statsHistoryStartSql(): string {
  return `(SELECT ${statisticsFirstFullHourMsSql})`
}

export function buildValidationSql(now = new Date()): string {
  const currentHour = Math.floor(now.getTime() / 3_600_000) * 3_600_000
  const latestClosedHour = currentHour - 3_600_000
  const taskEventValue = 'task_event.value'
  const taskEventTimestamp = downloadTaskEventTimestampSql(taskEventValue)
  const terminalTaskEvent = downloadTaskTerminalEventPredicate(taskEventValue)
  const validTaskEvent = validDownloadTaskEventPredicate(taskEventValue)
  const storageLedgerExactFrom = `(SELECT CAST((MIN(occurred_at) + 3599999) / 3600000 AS INTEGER) * 3600000
    FROM storage_usage_ledger WHERE reason = 'opening_balance_complete')`
  const facts = `SELECT json_object(
  'auditEvents', (SELECT COUNT(*) FROM audit_events),
  'missingUploadBytes', (
    SELECT COUNT(*) FROM audit_events
    WHERE action IN ('upload_confirm', 'upload_failed')
      AND (metadata IS NULL OR json_valid(metadata) = 0 OR json_type(metadata, '$.bytes') IS NULL)
      AND created_at * 1000 >= COALESCE(${statisticsExactFromMsSql}, ${MIN_VALID_TIMESTAMP_MS})
  ),
  'missingDownloadBytes', (
    SELECT COUNT(*) FROM audit_events
    WHERE action = 'download_failed'
      AND (metadata IS NULL OR json_valid(metadata) = 0 OR json_type(metadata, '$.bytes') IS NULL)
      AND created_at * 1000 >= COALESCE(${statisticsExactFromMsSql}, ${MIN_VALID_TIMESTAMP_MS})
  ),
  'trafficEvents', (
    SELECT COUNT(*) FROM audit_events
    WHERE action IN ('share_download', 'object_download', 'image_hosting_download', 'webdav_download', 'download_failed')
  ),
  'rawActiveShares', (SELECT COUNT(*) FROM shares WHERE status = 'active'),
  'validActiveShares', (
    SELECT COUNT(*) FROM shares
    WHERE status = 'active'
      AND (expires_at IS NULL OR expires_at > unixepoch())
      AND (download_limit IS NULL OR downloads < download_limit)
  ),
  'rawUploadEvents', (
    SELECT COUNT(*) FROM audit_events
    WHERE action = 'upload_confirm'
      AND json_valid(metadata) = 1
      AND json_type(metadata, '$.bytes') IN ('integer', 'real')
      AND json_extract(metadata, '$.bytes') >= 0
      AND json_type(metadata, '$.source') = 'text'
      AND length(json_extract(metadata, '$.source')) > 0
      AND created_at * 1000 >= MAX(${MIN_VALID_TIMESTAMP_MS}, COALESCE(${statisticsFirstFullHourMsSql}, ${MIN_VALID_TIMESTAMP_MS})) AND created_at * 1000 < ${currentHour}
  ),
  'rawUploadBytes', (
    SELECT COALESCE(SUM(CASE WHEN json_valid(metadata) = 1 THEN COALESCE(json_extract(metadata, '$.bytes'), 0) ELSE 0 END), 0)
    FROM audit_events
    WHERE action = 'upload_confirm'
      AND json_valid(metadata) = 1
      AND json_type(metadata, '$.bytes') IN ('integer', 'real')
      AND json_extract(metadata, '$.bytes') >= 0
      AND json_type(metadata, '$.source') = 'text'
      AND length(json_extract(metadata, '$.source')) > 0
      AND created_at * 1000 >= MAX(${MIN_VALID_TIMESTAMP_MS}, COALESCE(${statisticsFirstFullHourMsSql}, ${MIN_VALID_TIMESTAMP_MS})) AND created_at * 1000 < ${currentHour}
  ),
  'rawDownloadEvents', (
    SELECT COUNT(*) FROM cloud_traffic_reports
    WHERE issued_at IS NOT NULL AND status <> 'reversed'
      AND issued_at >= MAX(${MIN_VALID_TIMESTAMP_MS}, COALESCE(${statisticsFirstFullHourMsSql}, ${MIN_VALID_TIMESTAMP_MS})) AND issued_at < ${currentHour}
  ),
  'rawDownloadBytes', (
    SELECT COALESCE(SUM(bytes), 0) FROM cloud_traffic_reports
    WHERE issued_at IS NOT NULL AND status <> 'reversed'
      AND issued_at >= MAX(${MIN_VALID_TIMESTAMP_MS}, COALESCE(${statisticsFirstFullHourMsSql}, ${MIN_VALID_TIMESTAMP_MS})) AND issued_at < ${currentHour}
  ),
  'statisticsExactFrom', ${statisticsExactFromMsSql}
) AS summary;`

  const additionalFacts = `SELECT json_object(
  'rawUploadAttempts', (
    SELECT
      (SELECT COUNT(*) FROM audit_events
       WHERE action IN ('upload_confirm', 'upload_failed')
         AND json_valid(metadata) = 1
         AND json_type(metadata, '$.bytes') IN ('integer', 'real')
         AND json_extract(metadata, '$.bytes') >= 0
         AND json_type(metadata, '$.source') = 'text'
         AND length(json_extract(metadata, '$.source')) > 0
         AND created_at * 1000 >= MAX(${MIN_VALID_TIMESTAMP_MS}, COALESCE(${statisticsFirstFullHourMsSql}, ${MIN_VALID_TIMESTAMP_MS}))
         AND created_at * 1000 < ${currentHour})
      +
      (SELECT COUNT(*) FROM object_upload_sessions
       WHERE status = 'aborted'
         AND updated_at >= MAX(${MIN_VALID_TIMESTAMP_MS}, COALESCE(${statisticsFirstFullHourMsSql}, ${MIN_VALID_TIMESTAMP_MS}))
         AND updated_at < ${currentHour})
  ),
  'rawUserSignups', (
    SELECT COUNT(*) FROM audit_events
    WHERE action = 'user_register'
      AND target_id IS NOT NULL
      AND user_id = target_id
      AND id = 'event:user_register:' || target_id
      AND json_valid(metadata) = 1
      AND json_type(metadata, '$.provider') = 'text'
      AND length(json_extract(metadata, '$.provider')) > 0
      AND created_at * 1000 >= MAX(${MIN_VALID_TIMESTAMP_MS}, COALESCE(${statisticsFirstFullHourMsSql}, ${MIN_VALID_TIMESTAMP_MS}))
      AND created_at * 1000 < ${currentHour}
  ),
  'rawSharesCreated', (
    SELECT COUNT(*) FROM shares
    WHERE created_at * 1000 >= MAX(${MIN_VALID_TIMESTAMP_MS}, COALESCE(${statisticsFirstFullHourMsSql}, ${MIN_VALID_TIMESTAMP_MS}))
      AND created_at * 1000 < ${currentHour}
  ),
  'rawShareDownloads', (
    SELECT COUNT(*) FROM cloud_traffic_reports
    WHERE source IN ('landing_share', 'direct_share')
      AND issued_at IS NOT NULL
      AND status <> 'reversed'
      AND issued_at >= MAX(${MIN_VALID_TIMESTAMP_MS}, COALESCE(${statisticsFirstFullHourMsSql}, ${MIN_VALID_TIMESTAMP_MS}))
      AND issued_at < ${currentHour}
  ),
  'rawShareSaves', (
    SELECT COUNT(*) FROM audit_events
    WHERE action = 'save_from_share'
      AND json_valid(metadata) = 1
      AND json_type(metadata, '$.shareId') = 'text'
      AND length(json_extract(metadata, '$.shareId')) > 0
      AND json_type(metadata, '$.bytes') IN ('integer', 'real')
      AND json_extract(metadata, '$.bytes') >= 0
      AND created_at * 1000 >= MAX(${MIN_VALID_TIMESTAMP_MS}, COALESCE(${statisticsFirstFullHourMsSql}, ${MIN_VALID_TIMESTAMP_MS})) AND created_at * 1000 < ${currentHour}
  ),
  'rawFailedDownloads', (
    SELECT COUNT(*) FROM audit_events
    WHERE action = 'download_failed'
      AND json_valid(metadata) = 1
      AND json_type(metadata, '$.bytes') IN ('integer', 'real')
      AND json_extract(metadata, '$.bytes') >= 0
      AND json_type(metadata, '$.source') = 'text'
      AND length(json_extract(metadata, '$.source')) > 0
      AND created_at * 1000 >= MAX(${MIN_VALID_TIMESTAMP_MS}, COALESCE(${statisticsFirstFullHourMsSql}, ${MIN_VALID_TIMESTAMP_MS})) AND created_at * 1000 < ${currentHour}
  ),
  'rawFinishedDownloadTasks', (
    SELECT COUNT(*)
    FROM download_tasks dt
    JOIN json_each(dt.events) AS task_event
    WHERE ${terminalTaskEvent}
      AND ${taskEventTimestamp} >= MAX(${MIN_VALID_TIMESTAMP_MS}, COALESCE(${statisticsFirstFullHourMsSql}, ${MIN_VALID_TIMESTAMP_MS}))
      AND ${taskEventTimestamp} < ${currentHour}
  ),
  'rawFinishedBackgroundJobs', (
    SELECT COUNT(*) FROM background_jobs
    WHERE status IN ('completed', 'failed', 'canceled')
      AND finished_at IS NOT NULL
      AND finished_at >= MAX(${MIN_VALID_TIMESTAMP_MS}, COALESCE(${statisticsFirstFullHourMsSql}, ${MIN_VALID_TIMESTAMP_MS}))
      AND finished_at < ${currentHour}
  ),
  'rawMissingByteEvents', (
    SELECT COUNT(*) FROM audit_events
    WHERE action IN ('upload_confirm', 'upload_failed', 'download_failed', 'save_from_share')
      AND (metadata IS NULL OR json_valid(metadata) = 0 OR json_type(metadata, '$.bytes') IS NULL)
      AND created_at * 1000 >= COALESCE(${statisticsExactFromMsSql}, ${MIN_VALID_TIMESTAMP_MS})
      AND created_at * 1000 < ${currentHour}
  ),
  'invalidAuditEvents', (
    SELECT COUNT(*) FROM audit_events
    WHERE created_at * 1000 >= COALESCE(${statisticsExactFromMsSql}, ${MIN_VALID_TIMESTAMP_MS})
      AND (
        (action IN ('upload_confirm', 'upload_failed') AND (
          json_valid(metadata) = 0
          OR COALESCE(json_type(metadata, '$.bytes') IN ('integer', 'real'), 0) = 0
          OR json_extract(metadata, '$.bytes') < 0
          OR COALESCE(json_type(metadata, '$.source') = 'text', 0) = 0
          OR COALESCE(length(json_extract(metadata, '$.source')), 0) = 0
        ))
        OR (action = 'download_failed' AND (
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
          OR COALESCE(json_type(metadata, '$.bytes') IN ('integer', 'real'), 0) = 0
          OR json_extract(metadata, '$.bytes') < 0
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
  'missingUserRegistrationEvents', (
    SELECT COUNT(*)
    FROM user registered_user
    WHERE registered_user.created_at >= COALESCE(${statisticsExactFromMsSql}, ${MIN_VALID_TIMESTAMP_MS})
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
      )
  ),
  'invalidDownloadTaskEvents', (
    SELECT COUNT(*)
    FROM download_tasks dt
    JOIN json_each(dt.events) AS task_event
    WHERE NOT (${validTaskEvent})
  ),
  'rawStorageWrittenBytes', (
    SELECT COALESCE(SUM(delta_bytes), 0) FROM storage_usage_ledger
    WHERE delta_bytes > 0
      AND reason NOT IN ('opening_balance', 'opening_balance_complete', 'integrity_opening_balance')
      AND occurred_at >= ${storageLedgerExactFrom} AND occurred_at < ${currentHour}
  ),
  'rawStorageReleasedBytes', (
    SELECT COALESCE(SUM(-delta_bytes), 0) FROM storage_usage_ledger
    WHERE delta_bytes < 0
      AND reason NOT IN ('opening_balance', 'opening_balance_complete', 'integrity_opening_balance')
      AND occurred_at >= ${storageLedgerExactFrom} AND occurred_at < ${currentHour}
  )
) AS summary;`

  const rollups = `WITH valid_rollups AS MATERIALIZED (
  SELECT *
  FROM stats_rollups_hourly
  WHERE CASE WHEN json_valid(metadata) = 1 THEN
      json_extract(metadata, '$.version') = 3
      AND json_extract(metadata, '$.scope') IN ('counters', 'snapshots', 'full')
      AND json_extract(metadata, '$.quality') = 'exact'
    ELSE 0 END = 1
),
completion_markers AS MATERIALIZED (
  SELECT bucket_start, json_extract(metadata, '$.scope') AS scope
  FROM valid_rollups
  WHERE metric_key = 'stats.rollup_run' AND org_id = '' AND dimension_key = '' AND dimension_value = ''
),
counter_markers AS MATERIALIZED (
  SELECT bucket_start
  FROM completion_markers
  WHERE scope IN ('counters', 'full')
),
counter_rows AS MATERIALIZED (
  SELECT result.*
  FROM valid_rollups result
  WHERE result.metric_key <> 'stats.rollup_run'
    AND EXISTS (SELECT 1 FROM counter_markers marker WHERE marker.bucket_start = result.bucket_start)
),
required_dimensions(metric_key, dimension_key, check_bytes) AS (
  VALUES
    ('transfer.upload', 'source', 1),
    ('transfer.upload', 'status', 1),
    ('transfer.download_issued', 'source', 1),
    ('storage.ledger_change', 'direction', 1),
    ('share.download_issued', 'source', 1),
    ('user.signup', 'provider', 0),
    ('share.created', 'kind', 0),
    ('remote_download.task_finished', 'category', 0),
    ('remote_download.task_finished', 'outcome', 0),
    ('background_job.finished', 'job_type', 0),
    ('background_job.finished', 'outcome', 0),
    ('storage.inventory', 'file_type_group', 1),
    ('storage.inventory', 'size_bucket', 1),
    ('storage.inventory', 'age_bucket', 1),
    ('storage.trash_snapshot', 'storage_id', 1),
    ('share.inventory', 'lifecycle', 0),
    ('traffic.report_snapshot', 'status', 1),
    ('webhook.snapshot', 'status', 0),
    ('downloader.snapshot', 'status', 0)
),
base_rows AS MATERIALIZED (
  SELECT bucket_start, org_id, metric_key, count, bytes
  FROM valid_rollups
  WHERE dimension_key = ''
),
dimension_rows AS MATERIALIZED (
  SELECT bucket_start, org_id, metric_key, dimension_key, SUM(count) AS count, SUM(bytes) AS bytes
  FROM valid_rollups
  WHERE dimension_key <> ''
  GROUP BY bucket_start, org_id, metric_key, dimension_key
),
required_dimension_keys AS MATERIALIZED (
  SELECT required.metric_key, required.dimension_key, required.check_bytes, base.bucket_start, base.org_id
  FROM required_dimensions required
  JOIN base_rows base ON base.metric_key = required.metric_key
  UNION
  SELECT required.metric_key, required.dimension_key, required.check_bytes, dimension.bucket_start, dimension.org_id
  FROM required_dimensions required
  JOIN dimension_rows dimension
    ON dimension.metric_key = required.metric_key AND dimension.dimension_key = required.dimension_key
)
SELECT json_object(
  'rollupUploadEvents', (
    SELECT COALESCE(SUM(count), 0) FROM counter_rows
    WHERE metric_key = 'transfer.upload' AND dimension_key = 'status' AND dimension_value = 'success'
  ),
  'rollupUploadBytes', (
    SELECT COALESCE(SUM(bytes), 0) FROM counter_rows
    WHERE metric_key = 'transfer.upload' AND dimension_key = 'status' AND dimension_value = 'success'
  ),
  'rollupDownloadEvents', (
    SELECT COALESCE(SUM(count), 0) FROM counter_rows
    WHERE metric_key = 'transfer.download_issued' AND dimension_key = ''
  ),
  'rollupDownloadBytes', (
    SELECT COALESCE(SUM(bytes), 0) FROM counter_rows
    WHERE metric_key = 'transfer.download_issued' AND dimension_key = ''
  ),
  'rollupStorageWrittenBytes', (
    SELECT COALESCE(SUM(bytes), 0) FROM counter_rows
    WHERE metric_key = 'storage.ledger_change' AND dimension_key = 'direction' AND dimension_value = 'written'
  ),
  'rollupStorageReleasedBytes', (
    SELECT COALESCE(SUM(bytes), 0) FROM counter_rows
    WHERE metric_key = 'storage.ledger_change' AND dimension_key = 'direction' AND dimension_value = 'released'
  ),
  'orphanRollupBuckets', (
    SELECT COUNT(DISTINCT r.bucket_start)
    FROM valid_rollups r
    WHERE r.metric_key <> 'stats.rollup_run'
      AND NOT EXISTS (
        SELECT 1
        FROM completion_markers marker
        WHERE marker.bucket_start = r.bucket_start
          AND (
            (json_extract(r.metadata, '$.scope') = 'counters' AND marker.scope IN ('counters', 'full'))
            OR (json_extract(r.metadata, '$.scope') = 'snapshots' AND marker.scope IN ('snapshots', 'full'))
            OR (json_extract(r.metadata, '$.scope') = 'full' AND marker.scope = 'full')
          )
      )
  ),
  'requiredDimensionMismatchGroups', (
    SELECT COUNT(*)
    FROM required_dimension_keys required
    LEFT JOIN base_rows base
      ON base.bucket_start = required.bucket_start
      AND base.org_id = required.org_id
      AND base.metric_key = required.metric_key
    LEFT JOIN dimension_rows dimension
      ON dimension.bucket_start = required.bucket_start
      AND dimension.org_id = required.org_id
      AND dimension.metric_key = required.metric_key
      AND dimension.dimension_key = required.dimension_key
    WHERE base.metric_key IS NULL
      OR (
        dimension.metric_key IS NULL
        AND (base.count <> 0 OR (required.check_bytes = 1 AND base.bytes <> 0))
      )
      OR (
        dimension.metric_key IS NOT NULL
        AND (base.count <> dimension.count OR (required.check_bytes = 1 AND base.bytes <> dimension.bytes))
      )
  ),
  'lowerBoundRollups', (
    SELECT COUNT(*) FROM valid_rollups WHERE json_extract(metadata, '$.quality') = 'lower_bound'
  ),
  'legacyRollupRows', (
    SELECT COUNT(*) FROM stats_rollups_hourly
    WHERE CASE WHEN json_valid(metadata) = 1 THEN
        json_extract(metadata, '$.version') = 3
        AND json_extract(metadata, '$.scope') IN ('counters', 'snapshots', 'full')
        AND json_extract(metadata, '$.quality') = 'exact'
      ELSE 0 END = 0
  )
) AS summary;`

  const additionalRollups = `WITH valid_rollups AS MATERIALIZED (
  SELECT *
  FROM stats_rollups_hourly
  WHERE CASE WHEN json_valid(metadata) = 1 THEN
      json_extract(metadata, '$.version') = 3
      AND json_extract(metadata, '$.scope') IN ('counters', 'snapshots', 'full')
      AND json_extract(metadata, '$.quality') = 'exact'
    ELSE 0 END = 1
),
counter_markers AS MATERIALIZED (
  SELECT bucket_start FROM valid_rollups
  WHERE metric_key = 'stats.rollup_run' AND org_id = '' AND dimension_key = '' AND dimension_value = ''
    AND json_extract(metadata, '$.scope') IN ('counters', 'full')
),
counter_rows AS MATERIALIZED (
  SELECT result.* FROM valid_rollups result
  WHERE result.metric_key <> 'stats.rollup_run'
    AND EXISTS (SELECT 1 FROM counter_markers marker WHERE marker.bucket_start = result.bucket_start)
)
SELECT json_object(
  'rollupUploadAttempts', (
    SELECT COALESCE(SUM(count), 0) FROM counter_rows
    WHERE metric_key = 'transfer.upload' AND dimension_key = ''
  ),
  'rollupUserSignups', (
    SELECT COALESCE(SUM(count), 0) FROM counter_rows
    WHERE metric_key = 'user.signup' AND dimension_key = ''
  ),
  'rollupSharesCreated', (
    SELECT COALESCE(SUM(count), 0) FROM counter_rows
    WHERE metric_key = 'share.created' AND dimension_key = ''
  ),
  'rollupShareDownloads', (
    SELECT COALESCE(SUM(count), 0) FROM counter_rows
    WHERE metric_key = 'share.download_issued' AND dimension_key = ''
  ),
  'rollupShareSaves', (
    SELECT COALESCE(SUM(count), 0) FROM counter_rows
    WHERE metric_key = 'share.saved' AND dimension_key = ''
  ),
  'rollupFailedDownloads', (
    SELECT COALESCE(SUM(count), 0) FROM counter_rows
    WHERE metric_key = 'transfer.download_failed' AND dimension_key = ''
  ),
  'rollupFinishedDownloadTasks', (
    SELECT COALESCE(SUM(count), 0) FROM counter_rows
    WHERE metric_key = 'remote_download.task_finished' AND dimension_key = ''
  ),
  'rollupFinishedBackgroundJobs', (
    SELECT COALESCE(SUM(count), 0) FROM counter_rows
    WHERE metric_key = 'background_job.finished' AND dimension_key = ''
  ),
  'rollupMissingByteEvents', (
    SELECT COALESCE(SUM(count), 0) FROM counter_rows
    WHERE metric_key = 'stats.quality_missing_bytes' AND dimension_key = ''
  )
) AS summary;`

  const coverage = `WITH counter_markers AS MATERIALIZED (
  SELECT bucket_start
  FROM stats_rollups_hourly
  WHERE metric_key = 'stats.rollup_run' AND org_id = '' AND dimension_key = '' AND dimension_value = ''
    AND CASE WHEN json_valid(metadata) = 1 THEN
      json_extract(metadata, '$.version') = 3
      AND json_extract(metadata, '$.scope') IN ('counters', 'snapshots', 'full')
      AND json_extract(metadata, '$.quality') = 'exact'
    ELSE 0 END = 1
    AND json_extract(metadata, '$.scope') IN ('counters', 'full')
),
coverage AS MATERIALIZED (
  SELECT ${statsHistoryStartSql()} AS start_at, ${latestClosedHour} AS end_at
),
coverage_counts AS MATERIALIZED (
  SELECT
    CASE WHEN start_at IS NULL OR start_at > end_at THEN 0
      ELSE CAST((end_at - start_at) / 3600000 AS INTEGER) + 1 END AS expected,
    CASE WHEN start_at IS NULL OR start_at > end_at THEN 0
      ELSE (SELECT COUNT(*) FROM counter_markers WHERE bucket_start BETWEEN start_at AND end_at) END AS completed
  FROM coverage
)
SELECT json_object(
  'hourlyRollups', (SELECT COUNT(*) FROM counter_markers),
  'counterExpectedBuckets', (SELECT expected FROM coverage_counts),
  'counterCompletedBuckets', (SELECT completed FROM coverage_counts),
  'counterMissingBuckets', (SELECT expected - completed FROM coverage_counts),
  'openCounterMarkers', (SELECT COUNT(*) FROM counter_markers WHERE bucket_start >= ${currentHour})
) AS summary;
`

  return [facts, additionalFacts, rollups, additionalRollups, coverage].join('\n\n')
}

export const BACKFILL_PLAN_SQL = `
SELECT json_object(
  'invalidAuditEvents', (
    SELECT COUNT(*) FROM audit_events ae
    WHERE ae.created_at * 1000 >= COALESCE(${statisticsExactFromMsSql}, ${MIN_VALID_TIMESTAMP_MS})
      AND (
        ae.metadata IS NULL
        OR json_valid(ae.metadata) = 0
        OR (ae.action IN ('upload_confirm', 'upload_failed', 'download_failed', 'save_from_share')
          AND COALESCE(json_type(ae.metadata, '$.bytes') IN ('integer', 'real'), 0) = 0)
        OR (ae.action = 'save_from_share'
          AND COALESCE(json_type(ae.metadata, '$.shareId') = 'text', 0) = 0)
        OR (ae.action = 'user_register'
          AND (
            ae.target_id IS NULL
            OR ae.user_id <> ae.target_id
            OR ae.id <> 'event:user_register:' || ae.target_id
            OR
            COALESCE(json_type(ae.metadata, '$.provider') = 'text', 0) = 0
            OR COALESCE(length(json_extract(ae.metadata, '$.provider')), 0) = 0
          ))
      )
  ),
  'userRegistrationEventsToRecover', (
    SELECT COUNT(*)
    FROM user registered_user
    WHERE NOT EXISTS (
      SELECT 1
      FROM audit_events registration_event
      WHERE registration_event.id = 'event:user_register:' || registered_user.id
    )
  ),
  'issuedTrafficReportsToRecover', (
    SELECT COUNT(*) FROM cloud_traffic_reports ctr
    WHERE ctr.issued_at IS NULL
      AND ctr.status NOT IN ('blocked', 'reversed', 'ledger_opening')
      AND EXISTS (
        SELECT 1 FROM audit_events ae
        WHERE ae.action IN ('share_download', 'object_download', 'image_hosting_download', 'webdav_download')
          AND ae.id NOT LIKE 'backfill_%'
          AND json_valid(ae.metadata) = 1
          AND json_extract(ae.metadata, '$.trafficEventId') = ctr.event_id
      )
  )
) AS summary;
`

function parseOptions(argv: string[]): Options {
  const apply = argv.includes('--apply')
  const sqliteIndex = argv.indexOf('--sqlite')
  const d1Index = argv.indexOf('--d1')
  if ((sqliteIndex >= 0) === (d1Index >= 0)) usage()
  if (sqliteIndex >= 0) {
    const path = argv[sqliteIndex + 1]
    if (!path) usage()
    return { apply, target: { kind: 'sqlite', path } }
  }
  const database = argv[d1Index + 1]
  if (!database) usage()
  const envIndex = argv.indexOf('--env')
  return {
    apply,
    target: {
      kind: 'd1',
      database,
      remote: argv.includes('--remote'),
      env: envIndex >= 0 ? argv[envIndex + 1] : undefined,
    },
  }
}

function usage(): never {
  throw new Error(
    'Usage: pnpm stats:backfill -- (--sqlite <path> | --d1 <database> [--remote] [--env <name>]) [--apply]',
  )
}

function d1Args(target: Extract<Target, { kind: 'd1' }>): string[] {
  return [
    'exec',
    'wrangler',
    'd1',
    'execute',
    target.database,
    target.remote ? '--remote' : '--local',
    ...(target.env ? ['--env', target.env] : []),
  ]
}

function queryD1(target: Extract<Target, { kind: 'd1' }>, sql: string): string {
  return execFileSync('pnpm', [...d1Args(target), '--command', sql, '--json'], { encoding: 'utf8' })
}

function applyD1(target: Extract<Target, { kind: 'd1' }>, sql: string): void {
  const dir = mkdtempSync(join(tmpdir(), 'zpan-stats-backfill-'))
  try {
    const statements = splitSqlStatements(sql)
    for (let index = 0; index < statements.length; index += 8) {
      const batch = statements.slice(index, index + 8)
      const file = join(dir, `backfill-${String(index / 8).padStart(3, '0')}.sql`)
      writeFileSync(file, `${batch.join(';\n\n')};\n`)
      execFileSync('pnpm', [...d1Args(target), '--file', file], { stdio: 'inherit' })
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = []
  let start = 0
  let quoted = false
  for (let index = 0; index < sql.length; index += 1) {
    if (sql[index] === "'") {
      if (quoted && sql[index + 1] === "'") {
        index += 1
        continue
      }
      quoted = !quoted
      continue
    }
    if (sql[index] !== ';' || quoted) continue
    const statement = sql.slice(start, index).trim()
    if (statement) statements.push(statement)
    start = index + 1
  }
  const trailing = sql.slice(start).trim()
  if (trailing) statements.push(trailing)
  if (quoted) throw new Error('admin_stats_backfill_unterminated_sql_string')
  return statements
}

function parseD1Summaries(output: string): string[] {
  const payload = JSON.parse(output) as Array<{ results?: Array<{ summary?: string }> }>
  return payload
    .flatMap((entry) => entry.results ?? [])
    .flatMap((row) => (row.summary ? [row.summary] : []))
}

function mergeSummaries<T>(summaries: string[]): T {
  if (summaries.length === 0) throw new Error('D1 validation query returned no summary')
  return Object.assign({}, ...summaries.map((summary) => JSON.parse(summary) as object)) as T
}

function querySummary<T>(target: Target, sql: string): T {
  if (target.kind === 'd1') {
    const summaries = splitSqlStatements(sql).flatMap((statement) => parseD1Summaries(queryD1(target, statement)))
    return mergeSummaries<T>(summaries)
  }
  const db = new Database(target.path, { readonly: true })
  try {
    const summaries = splitSqlStatements(sql).map((statement) => {
      const row = db.prepare(statement).get() as { summary: string }
      return row.summary
    })
    return mergeSummaries<T>(summaries)
  } finally {
    db.close()
  }
}

function apply(target: Target, sql: string): void {
  if (target.kind === 'd1') return applyD1(target, sql)
  const db = new Database(target.path)
  try {
    db.transaction(() => db.exec(sql))()
  } finally {
    db.close()
  }
}

export function assertBackfillValidation(summary: ValidationSummary): void {
  const mismatches = [
    ['upload events', summary.rawUploadEvents, summary.rollupUploadEvents],
    ['upload bytes', summary.rawUploadBytes, summary.rollupUploadBytes],
    ['download events', summary.rawDownloadEvents, summary.rollupDownloadEvents],
    ['download bytes', summary.rawDownloadBytes, summary.rollupDownloadBytes],
    ['storage written bytes', summary.rawStorageWrittenBytes, summary.rollupStorageWrittenBytes],
    ['storage released bytes', summary.rawStorageReleasedBytes, summary.rollupStorageReleasedBytes],
    ['upload attempts', summary.rawUploadAttempts, summary.rollupUploadAttempts],
    ['user signups', summary.rawUserSignups, summary.rollupUserSignups],
    ['shares created', summary.rawSharesCreated, summary.rollupSharesCreated],
    ['share downloads', summary.rawShareDownloads, summary.rollupShareDownloads],
    ['share saves', summary.rawShareSaves, summary.rollupShareSaves],
    ['failed downloads', summary.rawFailedDownloads, summary.rollupFailedDownloads],
    ['finished download tasks', summary.rawFinishedDownloadTasks, summary.rollupFinishedDownloadTasks],
    ['finished background jobs', summary.rawFinishedBackgroundJobs, summary.rollupFinishedBackgroundJobs],
    ['missing byte events', summary.rawMissingByteEvents, summary.rollupMissingByteEvents],
  ].filter(([, raw, rollup]) => raw !== rollup)
  if (
    mismatches.length > 0 ||
    summary.invalidAuditEvents > 0 ||
    summary.missingUserRegistrationEvents > 0 ||
    summary.invalidDownloadTaskEvents > 0 ||
    summary.orphanRollupBuckets > 0 ||
    summary.requiredDimensionMismatchGroups > 0 ||
    summary.legacyRollupRows > 0 ||
    summary.counterMissingBuckets > 0 ||
    summary.openCounterMarkers > 0
  ) {
    throw new Error(
      `admin_stats_validation_failed:${JSON.stringify({
        mismatches,
        invalidAuditEvents: summary.invalidAuditEvents,
        missingUserRegistrationEvents: summary.missingUserRegistrationEvents,
        invalidDownloadTaskEvents: summary.invalidDownloadTaskEvents,
        orphanRollupBuckets: summary.orphanRollupBuckets,
        requiredDimensionMismatchGroups: summary.requiredDimensionMismatchGroups,
        legacyRollupRows: summary.legacyRollupRows,
        counterMissingBuckets: summary.counterMissingBuckets,
        openCounterMarkers: summary.openCounterMarkers,
      })}`,
    )
  }
}

function main(): void {
  const options = parseOptions(process.argv.slice(2))
  const now = new Date()
  const validationSql = buildValidationSql(now)
  const before = querySummary<ValidationSummary>(options.target, validationSql)
  const plan = querySummary<BackfillPlan>(options.target, BACKFILL_PLAN_SQL)
  console.log(JSON.stringify({ mode: options.apply ? 'apply' : 'dry-run', before, plan }, null, 2))
  if (!options.apply) return
  if (before.counterExpectedBuckets > MAX_BACKFILL_HOURS) {
    throw new Error(`admin_stats_backfill_range_too_large:${before.counterExpectedBuckets}`)
  }
  apply(options.target, buildBackfillSql(now))
  const after = querySummary<ValidationSummary>(options.target, validationSql)
  assertBackfillValidation(after)
  console.log(
    JSON.stringify(
      {
        mode: 'complete',
        before,
        after,
        recovered: {
          auditEvents: after.auditEvents - before.auditEvents,
          hourlyRollups: after.hourlyRollups - before.hourlyRollups,
        },
      },
      null,
      2,
    ),
  )
}

if (import.meta.url === `file://${process.argv[1]}`) main()
