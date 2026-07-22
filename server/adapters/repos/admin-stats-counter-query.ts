import { type AdminStatsMetric, ADMIN_STATS_METRICS as M, ROLLUP_VERSION } from '../../domain/admin-stats-metrics'
import { downloadTaskEventTimestampSql, downloadTaskTerminalEventPredicate } from '../../domain/download-task-events'

const HOUR_MS = 3_600_000

export interface AdminStatsCounterQueryRange {
  fromMs: number | string
  toMs: number | string
}

type HourlySource = {
  metric: AdminStatsMetric
  source: string
  timestampMs: string
  org: string
  where?: string
  count?: string
  bytes?: string
  uniqueCount?: string
  dimensions?: Record<string, string>
}

const taskEventValue = 'task_event.value'

const HOURLY_SOURCES: readonly HourlySource[] = [
  {
    metric: M.transferUpload,
    source: `(SELECT
        ae.org_id, ae.created_at * 1000 AS occurred_at, ae.action, ae.metadata
      FROM audit_events ae
      WHERE ae.action IN ('upload_confirm', 'upload_failed')
        AND json_valid(ae.metadata) = 1
        AND json_type(ae.metadata, '$.bytes') IN ('integer', 'real')
        AND json_extract(ae.metadata, '$.bytes') >= 0
        AND json_type(ae.metadata, '$.source') = 'text'
        AND length(json_extract(ae.metadata, '$.source')) > 0
      UNION ALL
      SELECT
        ous.org_id, ous.updated_at, 'upload_cancel',
        json_object(
          'source', 'upload',
          'storageId', ous.storage_id,
          'reason', 'upload_canceled'
        )
      FROM object_upload_sessions ous
      WHERE ous.status = 'aborted') upload_facts`,
    timestampMs: 'upload_facts.occurred_at',
    org: 'upload_facts.org_id',
    bytes:
      "SUM(CASE WHEN upload_facts.action = 'upload_confirm' THEN COALESCE(json_extract(upload_facts.metadata, '$.bytes'), 0) ELSE 0 END)",
    dimensions: {
      source: "COALESCE(json_extract(upload_facts.metadata, '$.source'), 'upload')",
      status:
        "CASE upload_facts.action WHEN 'upload_confirm' THEN 'success' WHEN 'upload_cancel' THEN 'canceled' ELSE 'failed' END",
      reason:
        "CASE WHEN upload_facts.action = 'upload_confirm' THEN NULL ELSE COALESCE(json_extract(upload_facts.metadata, '$.reason'), 'upload_failed') END",
      storage_id: "json_extract(upload_facts.metadata, '$.storageId')",
    },
  },
  {
    metric: M.transferDownloadIssued,
    source: 'cloud_traffic_reports traffic_report',
    timestampMs: 'traffic_report.issued_at',
    org: 'traffic_report.org_id',
    where: "traffic_report.issued_at IS NOT NULL AND traffic_report.status <> 'reversed'",
    bytes: 'SUM(traffic_report.bytes)',
    dimensions: {
      source: 'traffic_report.source',
      storage_id: 'traffic_report.storage_id',
    },
  },
  {
    metric: M.storageLedgerChange,
    source: 'storage_usage_ledger storage_change',
    timestampMs: 'storage_change.occurred_at',
    org: 'storage_change.org_id',
    where: `storage_change.delta_bytes <> 0
      AND storage_change.reason NOT IN ('opening_balance', 'opening_balance_complete', 'integrity_opening_balance')
      AND storage_change.occurred_at >= (
        SELECT CAST((MIN(opening.occurred_at) + ${HOUR_MS - 1}) / ${HOUR_MS} AS INTEGER) * ${HOUR_MS}
        FROM storage_usage_ledger opening
        WHERE opening.reason = 'opening_balance_complete'
      )`,
    bytes: 'SUM(ABS(storage_change.delta_bytes))',
    dimensions: {
      direction: "CASE WHEN storage_change.delta_bytes > 0 THEN 'written' ELSE 'released' END",
      reason: 'storage_change.reason',
      storage_id: 'storage_change.storage_id',
    },
  },
  {
    metric: M.transferDownloadFailed,
    source: 'audit_events download_failure',
    timestampMs: 'download_failure.created_at * 1000',
    org: 'download_failure.org_id',
    where: `download_failure.action = 'download_failed'
      AND json_valid(download_failure.metadata) = 1
      AND json_type(download_failure.metadata, '$.bytes') IN ('integer', 'real')
      AND json_extract(download_failure.metadata, '$.bytes') >= 0
      AND json_type(download_failure.metadata, '$.source') = 'text'
      AND length(json_extract(download_failure.metadata, '$.source')) > 0`,
    bytes: "SUM(COALESCE(json_extract(download_failure.metadata, '$.bytes'), 0))",
    dimensions: {
      source: "COALESCE(json_extract(download_failure.metadata, '$.source'), 'unknown')",
      reason: "COALESCE(json_extract(download_failure.metadata, '$.reason'), 'unknown')",
    },
  },
  {
    metric: M.shareCreated,
    source: 'shares created_share',
    timestampMs: 'created_share.created_at * 1000',
    org: 'created_share.org_id',
    dimensions: { kind: 'created_share.kind' },
  },
  {
    metric: M.shareDownloadIssued,
    source: 'cloud_traffic_reports share_download',
    timestampMs: 'share_download.issued_at',
    org: 'share_download.org_id',
    where:
      "share_download.issued_at IS NOT NULL AND share_download.status <> 'reversed' AND share_download.source IN ('landing_share', 'direct_share')",
    bytes: 'SUM(share_download.bytes)',
    dimensions: {
      share_id: 'share_download.source_id',
      kind: "CASE WHEN share_download.source = 'landing_share' THEN 'landing' ELSE 'direct' END",
      source: 'share_download.source',
    },
  },
  {
    metric: M.shareSaved,
    source: 'audit_events saved_share',
    timestampMs: 'saved_share.created_at * 1000',
    org: 'saved_share.org_id',
    where: `saved_share.action = 'save_from_share'
      AND json_valid(saved_share.metadata) = 1
      AND json_type(saved_share.metadata, '$.shareId') = 'text'
      AND length(json_extract(saved_share.metadata, '$.shareId')) > 0
      AND json_type(saved_share.metadata, '$.bytes') IN ('integer', 'real')
      AND json_extract(saved_share.metadata, '$.bytes') >= 0`,
    bytes: "SUM(COALESCE(json_extract(saved_share.metadata, '$.bytes'), 0))",
    dimensions: {
      share_id: "json_extract(saved_share.metadata, '$.shareId')",
      actor_type:
        "COALESCE(saved_share.actor_type, CASE WHEN saved_share.user_id IS NULL THEN 'anonymous' ELSE 'user' END)",
    },
  },
  {
    metric: M.remoteDownloadTaskFinished,
    source: 'download_tasks task JOIN json_each(task.events) AS task_event',
    timestampMs: downloadTaskEventTimestampSql(taskEventValue),
    org: 'task.org_id',
    where: downloadTaskTerminalEventPredicate(taskEventValue),
    dimensions: {
      category: "COALESCE(json_extract(task_event.value, '$.category'), 'uncategorized')",
      downloader_id: "json_extract(task_event.value, '$.downloaderId')",
      outcome: "COALESCE(json_extract(task_event.value, '$.to'), 'unknown')",
    },
  },
  {
    metric: M.backgroundJobFinished,
    source: 'background_jobs background_job',
    timestampMs: 'background_job.finished_at',
    org: 'background_job.org_id',
    where: "background_job.finished_at IS NOT NULL AND background_job.status IN ('completed', 'failed', 'canceled')",
    dimensions: {
      job_type: 'background_job.type',
      outcome: 'background_job.status',
    },
  },
  {
    metric: M.userSignup,
    source: 'audit_events registered_user',
    timestampMs: 'registered_user.created_at * 1000',
    org: "''",
    where: `registered_user.action = 'user_register'
      AND registered_user.target_id IS NOT NULL
      AND registered_user.user_id = registered_user.target_id
      AND registered_user.id = 'event:user_register:' || registered_user.target_id
      AND json_valid(registered_user.metadata) = 1
      AND json_type(registered_user.metadata, '$.provider') = 'text'
      AND length(json_extract(registered_user.metadata, '$.provider')) > 0`,
    dimensions: {
      provider: "json_extract(registered_user.metadata, '$.provider')",
    },
  },
]

export const ADMIN_STATS_FACT_COUNTER_METRICS: readonly AdminStatsMetric[] = [
  ...new Set([...HOURLY_SOURCES.map((source) => source.metric), M.storageLedgerBalance]),
]

export function buildAdminStatsCounterRowsSql(range: AdminStatsCounterQueryRange): string {
  return buildCounterSql(
    range,
    `SELECT
  bucket_start AS bucketStart,
  org_id AS orgId,
  metric_key AS metricKey,
  dimension_key AS dimensionKey,
  dimension_value AS dimensionValue,
  count,
  bytes,
  unique_count AS uniqueCount
FROM aggregated_rows
ORDER BY bucket_start, org_id, metric_key, dimension_key, dimension_value`,
  )
}

export function buildAdminStatsCounterRollupInsertSql(range: AdminStatsCounterQueryRange): string {
  return buildCounterSql(
    range,
    `INSERT INTO stats_rollups_hourly (
  id, bucket_start, org_id, metric_key, dimension_key, dimension_value,
  count, bytes, unique_count, metadata, updated_at
)
SELECT
  CAST(bucket_start AS TEXT) || ':' || COALESCE(NULLIF(org_id, ''), 'global') || ':' ||
    metric_key || ':' || COALESCE(NULLIF(dimension_key, ''), 'all') || ':' ||
    COALESCE(NULLIF(hex(dimension_value), ''), 'all'),
  bucket_start, org_id, metric_key, dimension_key, dimension_value,
  count, bytes, unique_count,
  json_object('version', ${ROLLUP_VERSION}, 'scope', 'counters', 'quality', 'exact'),
  bucket_start + ${HOUR_MS}
FROM aggregated_rows
WHERE true
ON CONFLICT(bucket_start, org_id, metric_key, dimension_key, dimension_value)
DO UPDATE SET
  count = excluded.count,
  bytes = excluded.bytes,
  unique_count = excluded.unique_count,
  metadata = excluded.metadata,
  updated_at = excluded.updated_at
WHERE count <> excluded.count
  OR bytes <> excluded.bytes
  OR unique_count <> excluded.unique_count
  OR metadata <> excluded.metadata
  OR updated_at <> excluded.updated_at`,
  )
}

function buildCounterSql(range: AdminStatsCounterQueryRange, statement: string): string {
  const sourceRows = HOURLY_SOURCES.flatMap(hourlySourceRows).join('\nUNION ALL\n')
  return `WITH
bounds AS (
  SELECT (${range.fromMs}) AS from_ms, (${range.toMs}) AS to_ms
),
digits(n) AS (VALUES (0),(1),(2),(3),(4),(5),(6),(7),(8),(9)),
numbers(n) AS (
  SELECT ones.n + tens.n * 10 + hundreds.n * 100 + thousands.n * 1000 + ten_thousands.n * 10000
  FROM digits ones
  CROSS JOIN digits tens
  CROSS JOIN digits hundreds
  CROSS JOIN digits thousands
  CROSS JOIN digits ten_thousands
),
buckets AS (
  SELECT bounds.from_ms + numbers.n * ${HOUR_MS} AS bucket_start
  FROM bounds
  JOIN numbers ON bounds.from_ms + numbers.n * ${HOUR_MS} < bounds.to_ms
),
source_rows AS (
${indent(sourceRows, 2)}
  UNION ALL
  SELECT
    bucket.bucket_start,
    '' AS org_id,
    '${M.storageLedgerBalance}' AS metric_key,
    '' AS dimension_key,
    '' AS dimension_value,
    0 AS count,
    (SELECT COALESCE(SUM(ledger.delta_bytes), 0)
      FROM storage_usage_ledger ledger
      WHERE ledger.occurred_at < bucket.bucket_start + ${HOUR_MS}) AS bytes,
    0 AS unique_count
  FROM buckets bucket
  WHERE EXISTS (
    SELECT 1
    FROM storage_usage_ledger opening
    WHERE opening.reason = 'opening_balance_complete'
      AND opening.occurred_at < bucket.bucket_start + ${HOUR_MS}
  )
),
aggregated_rows AS (
  SELECT
    bucket_start,
    org_id,
    metric_key,
    dimension_key,
    dimension_value,
    SUM(count) AS count,
    SUM(bytes) AS bytes,
    SUM(unique_count) AS unique_count
  FROM source_rows
  GROUP BY bucket_start, org_id, metric_key, dimension_key, dimension_value
)
${statement}`
}

function hourlySourceRows(source: HourlySource): string[] {
  return [
    hourlySourceRow(source),
    ...Object.entries(source.dimensions ?? {}).map(([key, value]) => hourlySourceRow(source, key, value)),
  ]
}

function hourlySourceRow(source: HourlySource, dimensionKey = '', dimensionExpression = "''"): string {
  const timestamp = `(${source.timestampMs})`
  const bucket = `CAST(${timestamp} / ${HOUR_MS} AS INTEGER) * ${HOUR_MS}`
  const dimension = dimensionKey ? `CAST((${dimensionExpression}) AS TEXT)` : "''"
  const filters = [
    source.where,
    `${timestamp} >= (SELECT from_ms FROM bounds)`,
    `${timestamp} < (SELECT to_ms FROM bounds)`,
    dimensionKey ? `(${dimensionExpression}) IS NOT NULL AND CAST((${dimensionExpression}) AS TEXT) <> ''` : null,
  ]
    .filter(Boolean)
    .join('\n    AND ')
  return `SELECT
  ${bucket} AS bucket_start,
  ${source.org} AS org_id,
  '${source.metric}' AS metric_key,
  '${dimensionKey}' AS dimension_key,
  ${dimension} AS dimension_value,
  ${source.count ?? 'COUNT(*)'} AS count,
  ${source.bytes ?? '0'} AS bytes,
  ${source.uniqueCount ?? '0'} AS unique_count
FROM ${source.source}
WHERE ${filters}
GROUP BY 1, 2${dimensionKey ? ', 5' : ''}`
}

function indent(value: string, spaces: number): string {
  const prefix = ' '.repeat(spaces)
  return value
    .split('\n')
    .map((line) => `${prefix}${line}`)
    .join('\n')
}
