#!/usr/bin/env tsx

import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'

type Target =
  | { kind: 'sqlite'; path: string }
  | { kind: 'd1'; database: string; remote: boolean; env?: string }

interface Options {
  target: Target
  apply: boolean
}

interface ValidationSummary {
  activityEvents: number
  orphanUserEvents: number
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
  rawShareViews: number
  rollupShareViews: number
  orphanRollupBuckets: number
  lowerBoundRollups: number
}

interface BackfillPlan {
  recoverableUploadBytes: number
  skippedUploadBytesMissingMatter: number
  recoverableShareBytes: number
  skippedShareBytesMissingCurrentFile: number
  cloudEventsToRecover: number
  syntheticDirectShareDuplicatesToRemove: number
}

function legacyCloudTrafficMatch(activityAlias: string, trafficAlias: string): string {
  return `
    (${activityAlias}.actor_ref IS NULL OR ${activityAlias}.actor_ref <> 'stats-backfill')
    AND ${activityAlias}.org_id = ${trafficAlias}.org_id
    AND ${activityAlias}.target_id = ${trafficAlias}.source_id
    AND ${trafficAlias}.status <> 'blocked'
    AND (
      (${activityAlias}.action = 'share_download' AND ${trafficAlias}.source IN ('direct_share', 'landing_share'))
      OR (${activityAlias}.action = 'object_download' AND ${trafficAlias}.source = 'object_download')
      OR (${activityAlias}.action = 'image_hosting_download' AND ${trafficAlias}.source = 'image_hosting')
      OR (${activityAlias}.action = 'webdav_download' AND ${trafficAlias}.source = 'webdav_download')
    )
    AND ABS(${activityAlias}.created_at - CAST(${trafficAlias}.created_at / 1000 AS INTEGER)) <= 5
    AND (
      ${activityAlias}.metadata IS NULL
      OR json_valid(${activityAlias}.metadata) = 0
      OR json_type(${activityAlias}.metadata, '$.trafficEventId') IS NULL
    )`
}

function unambiguousLegacyCloudTrafficMatch(activityAlias: string, trafficAlias: string): string {
  return `
    ${legacyCloudTrafficMatch(activityAlias, trafficAlias)}
    AND (
      SELECT COUNT(*) FROM cloud_traffic_reports candidate_traffic
      WHERE ${legacyCloudTrafficMatch(activityAlias, 'candidate_traffic')}
    ) = 1
    AND (
      SELECT COUNT(*) FROM activity_events candidate_activity
      WHERE ${legacyCloudTrafficMatch('candidate_activity', trafficAlias)}
    ) = 1`
}

function cloudTrafficCovered(trafficAlias: string): string {
  return `
    EXISTS (
      SELECT 1 FROM activity_events ae
      WHERE ae.org_id = ${trafficAlias}.org_id
        AND (
          ae.id = 'backfill_' || ${trafficAlias}.event_id
          OR (
            json_valid(ae.metadata) = 1
            AND json_extract(ae.metadata, '$.trafficEventId') = ${trafficAlias}.event_id
          )
        )
    )
    OR EXISTS (
      SELECT 1 FROM activity_events ae
      WHERE ${unambiguousLegacyCloudTrafficMatch('ae', trafficAlias)}
    )`
}

function syntheticDirectShareDuplicate(syntheticAlias: string, trafficAlias: string): string {
  return `
    ${syntheticAlias}.actor_ref = 'stats-backfill'
    AND ${syntheticAlias}.action = 'share_download'
    AND ${syntheticAlias}.org_id = ${trafficAlias}.org_id
    AND ${syntheticAlias}.id = 'backfill_' || ${trafficAlias}.event_id
    AND ${trafficAlias}.source = 'direct_share'
    AND EXISTS (
      SELECT 1 FROM activity_events recovered
      WHERE recovered.id <> ${syntheticAlias}.id
        AND (recovered.actor_ref IS NULL OR recovered.actor_ref <> 'stats-backfill')
        AND recovered.org_id = ${trafficAlias}.org_id
        AND recovered.target_id = ${trafficAlias}.source_id
        AND recovered.action = 'share_download'
        AND (
          (
            json_valid(recovered.metadata) = 1
            AND json_extract(recovered.metadata, '$.trafficEventId') = ${trafficAlias}.event_id
          )
          OR (${unambiguousLegacyCloudTrafficMatch('recovered', trafficAlias)})
        )
    )`
}

export function buildBackfillSql(now = new Date()): string {
  return `
UPDATE activity_events
SET actor_type = CASE WHEN user_id IS NULL THEN 'anonymous' ELSE 'user' END
WHERE actor_type IS NULL;

UPDATE activity_events AS ae
SET metadata = json_set(
  CASE WHEN metadata IS NULL OR metadata = '' OR json_valid(metadata) = 0 THEN '{}' ELSE metadata END,
  '$.bytes', (SELECT COALESCE(m.size, 0) FROM matters m WHERE m.id = ae.target_id),
  '$.source', 'upload',
  '$.status', 'success',
  '$.matterId', target_id,
  '$.quality', 'recovered_from_current_matter'
)
WHERE action = 'upload_confirm'
  AND (metadata IS NULL OR json_valid(metadata) = 0 OR json_type(metadata, '$.bytes') IS NULL)
  AND EXISTS (SELECT 1 FROM matters m WHERE m.id = ae.target_id);

UPDATE activity_events AS ae
SET metadata = json_set(
  CASE WHEN metadata IS NULL OR metadata = '' OR json_valid(metadata) = 0 THEN '{}' ELSE metadata END,
  '$.source', 'upload',
  '$.status', 'canceled',
  '$.quality', 'historical_bytes_unrecoverable'
)
WHERE action = 'upload_cancel'
  AND (metadata IS NULL OR json_valid(metadata) = 0 OR json_type(metadata, '$.status') IS NULL);

UPDATE activity_events AS ae
SET metadata = json_set(
  CASE WHEN metadata IS NULL OR metadata = '' OR json_valid(metadata) = 0 THEN '{}' ELSE metadata END,
  '$.bytes', (
    SELECT COALESCE(m.size, 0)
    FROM shares s
    JOIN matters m ON m.id = s.matter_id
    WHERE s.id = ae.target_id AND m.dirtype = 0
  ),
  '$.source', (
    SELECT CASE WHEN s.kind = 'direct' THEN 'direct_share' ELSE 'landing_share' END
    FROM shares s WHERE s.id = ae.target_id
  ),
  '$.status', 'issued',
  '$.shareId', target_id,
  '$.quality', 'recovered_from_current_share_root'
)
WHERE action = 'share_download'
  AND (metadata IS NULL OR json_valid(metadata) = 0 OR json_type(metadata, '$.bytes') IS NULL)
  AND EXISTS (
    SELECT 1 FROM shares s JOIN matters m ON m.id = s.matter_id
    WHERE s.id = ae.target_id AND m.dirtype = 0
  );

UPDATE activity_events AS ae
SET metadata = json_set(
  CASE WHEN metadata IS NULL OR metadata = '' OR json_valid(metadata) = 0 THEN '{}' ELSE metadata END,
  '$.bytes', (
    SELECT ctr.bytes FROM cloud_traffic_reports ctr
    WHERE ${unambiguousLegacyCloudTrafficMatch('ae', 'ctr')}
    LIMIT 1
  ),
  '$.source', (
    SELECT ctr.source FROM cloud_traffic_reports ctr
    WHERE ${unambiguousLegacyCloudTrafficMatch('ae', 'ctr')}
    LIMIT 1
  ),
  '$.status', 'issued',
  '$.trafficEventId', (
    SELECT ctr.event_id FROM cloud_traffic_reports ctr
    WHERE ${unambiguousLegacyCloudTrafficMatch('ae', 'ctr')}
    LIMIT 1
  ),
  '$.quality', 'recovered_from_matched_cloud_traffic_report'
)
WHERE action IN ('share_download', 'object_download', 'image_hosting_download', 'webdav_download')
  AND (metadata IS NULL OR json_valid(metadata) = 0 OR json_type(metadata, '$.trafficEventId') IS NULL)
  AND EXISTS (
    SELECT 1 FROM cloud_traffic_reports ctr
    WHERE ${unambiguousLegacyCloudTrafficMatch('ae', 'ctr')}
  );

DELETE FROM activity_events AS synthetic
WHERE EXISTS (
  SELECT 1 FROM cloud_traffic_reports ctr
  WHERE ${syntheticDirectShareDuplicate('synthetic', 'ctr')}
  );

INSERT OR IGNORE INTO activity_events (
  id, org_id, user_id, actor_type, actor_ref, action, target_type,
  target_id, target_name, metadata, created_at
)
SELECT
  'backfill_' || ctr.event_id,
  ctr.org_id,
  NULL,
  'system',
  'stats-backfill',
  CASE
    WHEN ctr.status = 'blocked' THEN 'download_failed'
    WHEN ctr.source IN ('direct_share', 'landing_share') THEN 'share_download'
    WHEN ctr.source = 'image_hosting' THEN 'image_hosting_download'
    WHEN ctr.source = 'object_download' THEN 'object_download'
    ELSE 'webdav_download'
  END,
  CASE WHEN ctr.source IN ('direct_share', 'landing_share') THEN 'share' WHEN ctr.source = 'image_hosting' THEN 'image' ELSE 'file' END,
  ctr.source_id,
  ctr.source_id,
  json_object(
    'direction', 'download',
    'status', CASE WHEN ctr.status = 'blocked' THEN 'failed' ELSE 'issued' END,
    'reason', CASE WHEN ctr.status = 'blocked' THEN COALESCE(ctr.error, 'blocked') ELSE NULL END,
    'source', ctr.source,
    'bytes', ctr.bytes,
    'trafficEventId', ctr.event_id,
    'quality', 'recovered_from_cloud_traffic_report'
  ),
  CAST(ctr.created_at / 1000 AS INTEGER)
FROM cloud_traffic_reports ctr
WHERE ctr.source IN ('direct_share', 'landing_share', 'image_hosting', 'object_download', 'webdav_download')
  AND NOT (${cloudTrafficCovered('ctr')});

DELETE FROM stats_rollups_hourly WHERE metric_key = 'storage.used.bytes';

${buildHourlyBackfillSql(now)}
`
}

type HourlySource = {
  metric: string
  source: string
  timestampMs: string
  org: string
  where?: string
  count?: string
  bytes?: string
  uniqueCount?: string
  quality?: string
  dimensions?: Record<string, string>
}

function buildHourlyBackfillSql(now: Date): string {
  const sources: HourlySource[] = [
    {
      metric: 'transfer.upload',
      source: 'activity_events ae',
      timestampMs: 'ae.created_at * 1000',
      org: 'ae.org_id',
      where: "ae.action IN ('upload_confirm','upload_cancel','upload_failed')",
      bytes: "SUM(CASE WHEN ae.action = 'upload_confirm' AND json_valid(ae.metadata) = 1 THEN COALESCE(json_extract(ae.metadata, '$.bytes'), 0) ELSE 0 END)",
      quality: "CASE WHEN SUM(CASE WHEN ae.action = 'upload_confirm' AND (ae.metadata IS NULL OR json_valid(ae.metadata) = 0 OR json_type(ae.metadata, '$.bytes') IS NULL) THEN 1 ELSE 0 END) > 0 THEN 'lower_bound' ELSE 'exact' END",
      dimensions: {
        source: "COALESCE(CASE WHEN json_valid(ae.metadata) = 1 THEN json_extract(ae.metadata, '$.source') END, 'upload')",
        status: "CASE ae.action WHEN 'upload_confirm' THEN 'success' WHEN 'upload_cancel' THEN 'canceled' ELSE 'failed' END",
        reason: "CASE WHEN ae.action = 'upload_confirm' THEN NULL WHEN json_valid(ae.metadata) = 1 AND json_type(ae.metadata, '$.reason') IS NOT NULL THEN json_extract(ae.metadata, '$.reason') WHEN ae.action = 'upload_cancel' THEN 'upload_canceled' ELSE 'upload_failed' END",
        storage_id: "CASE WHEN json_valid(ae.metadata) = 1 THEN json_extract(ae.metadata, '$.storageId') END",
      },
    },
    {
      metric: 'storage.ingress',
      source: 'activity_events ae',
      timestampMs: 'ae.created_at * 1000',
      org: 'ae.org_id',
      where: "ae.action = 'upload_confirm'",
      bytes: "SUM(CASE WHEN json_valid(ae.metadata) = 1 THEN COALESCE(json_extract(ae.metadata, '$.bytes'), 0) ELSE 0 END)",
      quality: "CASE WHEN SUM(CASE WHEN ae.metadata IS NULL OR json_valid(ae.metadata) = 0 OR json_type(ae.metadata, '$.bytes') IS NULL THEN 1 ELSE 0 END) > 0 THEN 'lower_bound' ELSE 'exact' END",
      dimensions: {
        source: "COALESCE(CASE WHEN json_valid(ae.metadata) = 1 THEN json_extract(ae.metadata, '$.source') END, 'web_upload')",
        status: "'success'",
        storage_id: "CASE WHEN json_valid(ae.metadata) = 1 THEN json_extract(ae.metadata, '$.storageId') END",
      },
    },
    {
      metric: 'transfer.download_issued',
      source: 'activity_events ae',
      timestampMs: 'ae.created_at * 1000',
      org: 'ae.org_id',
      where: "ae.action IN ('share_download','object_download','image_hosting_download','webdav_download')",
      bytes: "SUM(CASE WHEN json_valid(ae.metadata) = 1 THEN COALESCE(json_extract(ae.metadata, '$.bytes'), 0) ELSE 0 END)",
      quality: "CASE WHEN SUM(CASE WHEN ae.metadata IS NULL OR json_valid(ae.metadata) = 0 OR json_type(ae.metadata, '$.bytes') IS NULL THEN 1 ELSE 0 END) > 0 THEN 'lower_bound' ELSE 'exact' END",
      dimensions: {
        source: "COALESCE(CASE WHEN json_valid(ae.metadata) = 1 THEN json_extract(ae.metadata, '$.source') END, CASE ae.action WHEN 'object_download' THEN 'object_download' WHEN 'image_hosting_download' THEN 'image_hosting' WHEN 'webdav_download' THEN 'webdav_download' ELSE 'landing_share' END)",
        actor_type: "COALESCE(ae.actor_type, CASE WHEN ae.user_id IS NULL THEN 'anonymous' ELSE 'user' END)",
        storage_id: "CASE WHEN json_valid(ae.metadata) = 1 THEN json_extract(ae.metadata, '$.storageId') END",
      },
    },
    {
      metric: 'transfer.download_failed',
      source: 'activity_events ae',
      timestampMs: 'ae.created_at * 1000',
      org: 'ae.org_id',
      where: "ae.action = 'download_failed'",
      bytes: "SUM(CASE WHEN json_valid(ae.metadata) = 1 THEN COALESCE(json_extract(ae.metadata, '$.bytes'), 0) ELSE 0 END)",
      dimensions: {
        source: "COALESCE(CASE WHEN json_valid(ae.metadata) = 1 THEN json_extract(ae.metadata, '$.source') END, 'unknown')",
        reason: "COALESCE(CASE WHEN json_valid(ae.metadata) = 1 THEN json_extract(ae.metadata, '$.reason') END, 'unknown')",
      },
    },
    {
      metric: 'share.created',
      source: 'shares s',
      timestampMs: 's.created_at * 1000',
      org: 's.org_id',
      dimensions: { kind: 's.kind' },
    },
    activitySource('share.view', "ae.action = 'share_view'", { share_id: 'ae.target_id', actor_type: "COALESCE(ae.actor_type, CASE WHEN ae.user_id IS NULL THEN 'anonymous' ELSE 'user' END)" }),
    activitySource('share.download_issued', "ae.action = 'share_download'", { share_id: "COALESCE(CASE WHEN json_valid(ae.metadata) = 1 THEN json_extract(ae.metadata, '$.shareId') END, ae.target_id)", kind: "CASE WHEN json_valid(ae.metadata) = 1 THEN json_extract(ae.metadata, '$.kind') END", source: "COALESCE(CASE WHEN json_valid(ae.metadata) = 1 THEN json_extract(ae.metadata, '$.source') END, 'landing_share')", actor_type: "COALESCE(ae.actor_type, CASE WHEN ae.user_id IS NULL THEN 'anonymous' ELSE 'user' END)" }, true),
    activitySource('share.saved', "ae.action = 'save_from_share'", { share_id: "COALESCE(CASE WHEN json_valid(ae.metadata) = 1 THEN json_extract(ae.metadata, '$.shareId') END, ae.target_id)", actor_type: "COALESCE(ae.actor_type, CASE WHEN ae.user_id IS NULL THEN 'anonymous' ELSE 'user' END)" }, true),
    activitySource('share.password_passed', "ae.action = 'share_password_passed'", { share_id: 'ae.target_id' }),
    {
      metric: 'traffic.report_sync',
      source: 'cloud_traffic_reports ctr',
      timestampMs: 'ctr.updated_at',
      org: 'ctr.org_id',
      bytes: 'SUM(ctr.bytes)',
      dimensions: { source: 'ctr.source', status: 'ctr.status' },
    },
    {
      metric: 'remote_download.task_created',
      source: 'download_tasks dt',
      timestampMs: 'dt.created_at',
      org: 'dt.org_id',
      dimensions: { category: "COALESCE(dt.category, 'uncategorized')", source: 'dt.source_type' },
    },
    {
      metric: 'remote_download.task_finished',
      source: 'download_tasks dt',
      timestampMs: 'dt.finished_at',
      org: 'dt.org_id',
      where: 'dt.finished_at IS NOT NULL',
      bytes: 'SUM(dt.billing_charged_bytes)',
      dimensions: { category: "COALESCE(dt.category, 'uncategorized')", downloader_id: 'dt.assigned_downloader_id', outcome: 'dt.status' },
    },
    {
      metric: 'background_job.finished',
      source: 'background_jobs bj',
      timestampMs: 'bj.finished_at',
      org: 'bj.org_id',
      where: 'bj.finished_at IS NOT NULL',
      dimensions: { job_type: 'bj.type', outcome: 'bj.status' },
    },
    {
      metric: 'remote_download.usage',
      source: 'remote_download_usage_reports ru',
      timestampMs: 'ru.created_at',
      org: 'ru.org_id',
      count: 'SUM(ru.credits_per_unit)',
      bytes: 'SUM(ru.unit_bytes)',
      dimensions: { downloader_id: 'ru.downloader_id', status: 'ru.status' },
    },
    {
      metric: 'webhook.processed',
      source: 'webhook_events we',
      timestampMs: 'we.processed_at',
      org: "''",
      where: 'we.processed_at IS NOT NULL',
      dimensions: { outcome: 'we.status' },
    },
    {
      metric: 'stats.quality_missing_bytes',
      source: 'activity_events ae',
      timestampMs: 'ae.created_at * 1000',
      org: 'ae.org_id',
      where: "ae.action IN ('upload_confirm','share_download','object_download','image_hosting_download','webdav_download') AND (ae.metadata IS NULL OR json_valid(ae.metadata) = 0 OR json_type(ae.metadata, '$.bytes') IS NULL)",
      dimensions: {
        direction: "CASE WHEN ae.action = 'upload_confirm' THEN 'upload' ELSE 'download' END",
        source: "COALESCE(CASE WHEN json_valid(ae.metadata) = 1 THEN json_extract(ae.metadata, '$.source') END, ae.action)",
      },
    },
  ]

  const statements = sources.flatMap((source) => hourlyStatements(source))
  statements.push(userSignupBackfillSql(), activeUserBackfillSql(), rollupMarkerBackfillSql(now))
  return statements.join('\n\n')
}

function activitySource(metric: string, where: string, dimensions: Record<string, string>, bytes = false): HourlySource {
  return {
    metric,
    source: 'activity_events ae',
    timestampMs: 'ae.created_at * 1000',
    org: 'ae.org_id',
    where,
    bytes: bytes ? "SUM(CASE WHEN json_valid(ae.metadata) = 1 THEN COALESCE(json_extract(ae.metadata, '$.bytes'), 0) ELSE 0 END)" : undefined,
    dimensions,
  }
}

function hourlyStatements(source: HourlySource): string[] {
  return [hourlyInsert(source), ...Object.entries(source.dimensions ?? {}).map(([key, value]) => hourlyInsert(source, key, value))]
}

function hourlyInsert(source: HourlySource, dimensionKey = '', dimensionExpression = "''"): string {
  const bucket = `CAST((${source.timestampMs}) / 3600000 AS INTEGER) * 3600000`
  const where = [source.where, dimensionKey ? `(${dimensionExpression}) IS NOT NULL AND CAST((${dimensionExpression}) AS TEXT) <> ''` : null]
    .filter(Boolean)
    .join(' AND ')
  const dimension = dimensionKey ? `CAST((${dimensionExpression}) AS TEXT)` : "''"
  const count = source.count ?? 'COUNT(*)'
  const bytes = source.bytes ?? '0'
  const uniqueCount = source.uniqueCount ?? '0'
  const quality = source.quality ?? "'exact'"
  return `INSERT INTO stats_rollups_hourly (
  id, bucket_start, org_id, metric_key, dimension_key, dimension_value,
  count, bytes, unique_count, metadata, updated_at
)
SELECT
  CAST(bucket_start AS TEXT) || ':' || COALESCE(NULLIF(org_id, ''), 'global') || ':${source.metric}:${dimensionKey || 'all'}:' || hex(dimension_value),
  bucket_start, org_id, '${source.metric}', '${dimensionKey}', dimension_value,
  count_value, bytes_value, unique_value,
  json_object('version', 1, 'quality', quality_value),
  bucket_start + 3600000
FROM (
  SELECT ${bucket} AS bucket_start, ${source.org} AS org_id, ${dimension} AS dimension_value,
    ${count} AS count_value, ${bytes} AS bytes_value, ${uniqueCount} AS unique_value, ${quality} AS quality_value
  FROM ${source.source}
  ${where ? `WHERE ${where}` : ''}
  GROUP BY bucket_start, org_id${dimensionKey ? ', dimension_value' : ''}
) rollup
WHERE true
ON CONFLICT(bucket_start, org_id, metric_key, dimension_key, dimension_value)
DO UPDATE SET count = excluded.count, bytes = excluded.bytes, unique_count = excluded.unique_count,
  metadata = excluded.metadata, updated_at = excluded.updated_at
WHERE count <> excluded.count OR bytes <> excluded.bytes OR unique_count <> excluded.unique_count OR metadata <> excluded.metadata;`
}

function userSignupBackfillSql(): string {
  return hourlyInsert({
    metric: 'user.signup',
    source: `user u LEFT JOIN account a ON a.id = (
      SELECT a2.id FROM account a2 WHERE a2.user_id = u.id ORDER BY a2.created_at, a2.id LIMIT 1
    )`,
    timestampMs: 'u.created_at',
    org: "''",
    dimensions: { provider: "COALESCE(a.provider_id, 'direct')" },
  }) + '\n' + hourlyInsert({
    metric: 'user.signup',
    source: `user u LEFT JOIN account a ON a.id = (
      SELECT a2.id FROM account a2 WHERE a2.user_id = u.id ORDER BY a2.created_at, a2.id LIMIT 1
    )`,
    timestampMs: 'u.created_at',
    org: "''",
  })
}

function activeUserBackfillSql(): string {
  return hourlyInsert({
    metric: 'user.active_hour',
    source: `(SELECT created_at AS at, user_id FROM session
      UNION ALL
      SELECT ae.created_at * 1000 AS at, ae.user_id FROM activity_events ae JOIN user u ON u.id = ae.user_id) active`,
    timestampMs: 'active.at',
    org: "''",
    count: '0',
    uniqueCount: 'COUNT(DISTINCT active.user_id)',
  })
}

function rollupMarkerBackfillSql(now: Date): string {
  const currentHour = Math.floor(now.getTime() / 3_600_000) * 3_600_000
  return hourlyInsert({
    metric: 'stats.rollup_run',
    source: `(SELECT DISTINCT bucket_start AS at
      FROM stats_rollups_hourly WHERE metric_key <> 'stats.rollup_run'
      UNION SELECT ${currentHour} AS at) buckets`,
    timestampMs: 'buckets.at',
    org: "''",
    count: '1',
  })
}

export const VALIDATION_SQL = `
SELECT json_object(
  'activityEvents', (SELECT COUNT(*) FROM activity_events),
  'orphanUserEvents', (
    SELECT COUNT(*) FROM activity_events ae
    WHERE ae.user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM user u WHERE u.id = ae.user_id)
  ),
  'missingUploadBytes', (
    SELECT COUNT(*) FROM activity_events
    WHERE action = 'upload_confirm'
      AND (metadata IS NULL OR json_valid(metadata) = 0 OR json_type(metadata, '$.bytes') IS NULL)
  ),
  'missingDownloadBytes', (
    SELECT COUNT(*) FROM activity_events
    WHERE action IN ('share_download', 'object_download', 'image_hosting_download', 'webdav_download')
      AND (metadata IS NULL OR json_valid(metadata) = 0 OR json_type(metadata, '$.bytes') IS NULL)
  ),
  'trafficEvents', (
    SELECT COUNT(*) FROM activity_events
    WHERE action IN ('share_download', 'object_download', 'image_hosting_download', 'webdav_download', 'download_failed')
  ),
  'hourlyRollups', (
    SELECT COUNT(*) FROM stats_rollups_hourly WHERE metric_key = 'stats.rollup_run' AND dimension_key = ''
  ),
  'rawActiveShares', (SELECT COUNT(*) FROM shares WHERE status = 'active'),
  'validActiveShares', (
    SELECT COUNT(*) FROM shares
    WHERE status = 'active'
      AND (expires_at IS NULL OR expires_at > unixepoch())
      AND (download_limit IS NULL OR downloads < download_limit)
  ),
  'rawUploadEvents', (SELECT COUNT(*) FROM activity_events WHERE action = 'upload_confirm'),
  'rollupUploadEvents', (
    SELECT COALESCE(SUM(count), 0) FROM stats_rollups_hourly
    WHERE metric_key = 'transfer.upload' AND dimension_key = 'status' AND dimension_value = 'success'
  ),
  'rawUploadBytes', (
    SELECT COALESCE(SUM(CASE WHEN json_valid(metadata) = 1 THEN COALESCE(json_extract(metadata, '$.bytes'), 0) ELSE 0 END), 0)
    FROM activity_events WHERE action = 'upload_confirm'
  ),
  'rollupUploadBytes', (
    SELECT COALESCE(SUM(bytes), 0) FROM stats_rollups_hourly
    WHERE metric_key = 'transfer.upload' AND dimension_key = 'status' AND dimension_value = 'success'
  ),
  'rawDownloadEvents', (
    SELECT COUNT(*) FROM activity_events
    WHERE action IN ('share_download', 'object_download', 'image_hosting_download', 'webdav_download')
  ),
  'rollupDownloadEvents', (
    SELECT COALESCE(SUM(count), 0) FROM stats_rollups_hourly
    WHERE metric_key = 'transfer.download_issued' AND dimension_key = ''
  ),
  'rawDownloadBytes', (
    SELECT COALESCE(SUM(CASE WHEN json_valid(metadata) = 1 THEN COALESCE(json_extract(metadata, '$.bytes'), 0) ELSE 0 END), 0)
    FROM activity_events
    WHERE action IN ('share_download', 'object_download', 'image_hosting_download', 'webdav_download')
  ),
  'rollupDownloadBytes', (
    SELECT COALESCE(SUM(bytes), 0) FROM stats_rollups_hourly
    WHERE metric_key = 'transfer.download_issued' AND dimension_key = ''
  ),
  'rawShareViews', (SELECT COUNT(*) FROM activity_events WHERE action = 'share_view'),
  'rollupShareViews', (
    SELECT COALESCE(SUM(count), 0) FROM stats_rollups_hourly
    WHERE metric_key = 'share.view' AND dimension_key = ''
  ),
  'orphanRollupBuckets', (
    SELECT COUNT(DISTINCT r.bucket_start)
    FROM stats_rollups_hourly r
    WHERE r.metric_key <> 'stats.rollup_run'
      AND NOT EXISTS (
        SELECT 1 FROM stats_rollups_hourly marker
        WHERE marker.bucket_start = r.bucket_start
          AND marker.metric_key = 'stats.rollup_run'
          AND marker.dimension_key = ''
      )
  ),
  'lowerBoundRollups', (
    SELECT COUNT(*) FROM stats_rollups_hourly
    WHERE json_valid(metadata) = 1 AND json_extract(metadata, '$.quality') = 'lower_bound'
  )
) AS summary;
`

export const BACKFILL_PLAN_SQL = `
SELECT json_object(
  'recoverableUploadBytes', (
    SELECT COUNT(*) FROM activity_events ae
    WHERE ae.action = 'upload_confirm'
      AND (ae.metadata IS NULL OR json_valid(ae.metadata) = 0 OR json_type(ae.metadata, '$.bytes') IS NULL)
      AND EXISTS (SELECT 1 FROM matters m WHERE m.id = ae.target_id)
  ),
  'skippedUploadBytesMissingMatter', (
    SELECT COUNT(*) FROM activity_events ae
    WHERE ae.action = 'upload_confirm'
      AND (ae.metadata IS NULL OR json_valid(ae.metadata) = 0 OR json_type(ae.metadata, '$.bytes') IS NULL)
      AND NOT EXISTS (SELECT 1 FROM matters m WHERE m.id = ae.target_id)
  ),
  'recoverableShareBytes', (
    SELECT COUNT(*) FROM activity_events ae
    WHERE ae.action = 'share_download'
      AND (ae.metadata IS NULL OR json_valid(ae.metadata) = 0 OR json_type(ae.metadata, '$.bytes') IS NULL)
      AND EXISTS (
        SELECT 1 FROM shares s JOIN matters m ON m.id = s.matter_id
        WHERE s.id = ae.target_id AND m.dirtype = 0
      )
  ),
  'skippedShareBytesMissingCurrentFile', (
    SELECT COUNT(*) FROM activity_events ae
    WHERE ae.action = 'share_download'
      AND (ae.metadata IS NULL OR json_valid(ae.metadata) = 0 OR json_type(ae.metadata, '$.bytes') IS NULL)
      AND NOT EXISTS (
        SELECT 1 FROM shares s JOIN matters m ON m.id = s.matter_id
        WHERE s.id = ae.target_id AND m.dirtype = 0
      )
  ),
  'cloudEventsToRecover', (
    SELECT COUNT(*) FROM cloud_traffic_reports ctr
    WHERE ctr.source IN ('direct_share', 'landing_share', 'image_hosting', 'object_download', 'webdav_download')
      AND NOT (${cloudTrafficCovered('ctr')})
  ),
  'syntheticDirectShareDuplicatesToRemove', (
    SELECT COUNT(*)
    FROM activity_events synthetic, cloud_traffic_reports ctr
    WHERE ${syntheticDirectShareDuplicate('synthetic', 'ctr')}
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

function parseD1Summary<T>(output: string): T {
  const payload = JSON.parse(output) as Array<{ results?: Array<{ summary?: string }> }>
  const summary = payload.flatMap((entry) => entry.results ?? []).find((row) => row.summary)?.summary
  if (!summary) throw new Error('D1 validation query returned no summary')
  return JSON.parse(summary) as T
}

function querySummary<T>(target: Target, sql: string): T {
  if (target.kind === 'd1') return parseD1Summary<T>(queryD1(target, sql))
  const db = new Database(target.path, { readonly: true })
  try {
    const row = db.prepare(sql).get() as { summary: string }
    return JSON.parse(row.summary) as T
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

function assertBackfillValidation(summary: ValidationSummary): void {
  const mismatches = [
    ['upload events', summary.rawUploadEvents, summary.rollupUploadEvents],
    ['upload bytes', summary.rawUploadBytes, summary.rollupUploadBytes],
    ['download events', summary.rawDownloadEvents, summary.rollupDownloadEvents],
    ['download bytes', summary.rawDownloadBytes, summary.rollupDownloadBytes],
    ['share views', summary.rawShareViews, summary.rollupShareViews],
  ].filter(([, raw, rollup]) => raw !== rollup)
  if (mismatches.length > 0 || summary.orphanRollupBuckets > 0) {
    throw new Error(
      `admin_stats_validation_failed:${JSON.stringify({ mismatches, orphanRollupBuckets: summary.orphanRollupBuckets })}`,
    )
  }
}

function main(): void {
  const options = parseOptions(process.argv.slice(2))
  const before = querySummary<ValidationSummary>(options.target, VALIDATION_SQL)
  const plan = querySummary<BackfillPlan>(options.target, BACKFILL_PLAN_SQL)
  console.log(JSON.stringify({ mode: options.apply ? 'apply' : 'dry-run', before, plan }, null, 2))
  if (!options.apply) return
  apply(options.target, buildBackfillSql())
  const after = querySummary<ValidationSummary>(options.target, VALIDATION_SQL)
  assertBackfillValidation(after)
  console.log(
    JSON.stringify(
      {
        mode: 'complete',
        before,
        after,
        recovered: {
          activityEvents: after.activityEvents - before.activityEvents,
          uploadMetadata: before.missingUploadBytes - after.missingUploadBytes,
          downloadMetadata: before.missingDownloadBytes - after.missingDownloadBytes,
          hourlyRollups: after.hourlyRollups - before.hourlyRollups,
        },
        skipped: {
          uploadBytes: { count: after.missingUploadBytes, reason: 'historical matter no longer exists' },
          downloadBytes: { count: after.missingDownloadBytes, reason: 'historical target size is unavailable' },
        },
      },
      null,
      2,
    ),
  )
}

if (import.meta.url === `file://${process.argv[1]}`) main()
