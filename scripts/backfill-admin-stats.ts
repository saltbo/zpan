#!/usr/bin/env tsx

import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'

const MIN_VALID_TIMESTAMP_MS = Date.UTC(2000, 0, 1)
const MIN_VALID_TIMESTAMP_SECONDS = Math.floor(MIN_VALID_TIMESTAMP_MS / 1000)
const MAX_BACKFILL_HOURS = 100_000

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
  rawSharePasswordPasses: number
  rollupSharePasswordPasses: number
  rawFailedDownloads: number
  rollupFailedDownloads: number
  rawFinishedDownloadTasks: number
  rollupFinishedDownloadTasks: number
  rawFinishedBackgroundJobs: number
  rollupFinishedBackgroundJobs: number
  rawMissingByteEvents: number
  rollupMissingByteEvents: number
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
  recoverableUploadBytes: number
  skippedUploadBytesMissingMatter: number
  recoverableShareBytes: number
  skippedShareBytesMissingCurrentFile: number
  cloudEventsToRecover: number
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
    WHERE ctr.source_id = ae.target_id
      AND (
        (ae.action = 'share_download' AND ctr.source IN ('direct_share', 'landing_share'))
        OR ctr.source = CASE ae.action
          WHEN 'object_download' THEN 'object_download'
          WHEN 'image_hosting_download' THEN 'image_hosting'
          WHEN 'webdav_download' THEN 'webdav_download'
          ELSE ''
        END
      )
      AND ctr.status <> 'blocked'
      AND ABS(CAST(ctr.created_at / 1000 AS INTEGER) - ae.created_at) <= 5
    ORDER BY ctr.created_at, ctr.event_id
    LIMIT 1
  ),
  '$.source', (
    SELECT ctr.source FROM cloud_traffic_reports ctr
    WHERE ctr.source_id = ae.target_id
      AND (
        (ae.action = 'share_download' AND ctr.source IN ('direct_share', 'landing_share'))
        OR ctr.source = CASE ae.action
          WHEN 'object_download' THEN 'object_download'
          WHEN 'image_hosting_download' THEN 'image_hosting'
          WHEN 'webdav_download' THEN 'webdav_download'
          ELSE ''
        END
      )
      AND ctr.status <> 'blocked'
      AND ABS(CAST(ctr.created_at / 1000 AS INTEGER) - ae.created_at) <= 5
    ORDER BY ctr.created_at, ctr.event_id
    LIMIT 1
  ),
  '$.status', 'issued',
  '$.trafficEventId', (
    SELECT ctr.event_id FROM cloud_traffic_reports ctr
    WHERE ctr.source_id = ae.target_id
      AND (
        (ae.action = 'share_download' AND ctr.source IN ('direct_share', 'landing_share'))
        OR ctr.source = CASE ae.action
          WHEN 'object_download' THEN 'object_download'
          WHEN 'image_hosting_download' THEN 'image_hosting'
          WHEN 'webdav_download' THEN 'webdav_download'
          ELSE ''
        END
      )
      AND ctr.status <> 'blocked'
      AND ABS(CAST(ctr.created_at / 1000 AS INTEGER) - ae.created_at) <= 5
    ORDER BY ctr.created_at, ctr.event_id
    LIMIT 1
  ),
  '$.quality', 'recovered_from_matched_cloud_traffic_report'
)
WHERE action IN ('share_download', 'object_download', 'image_hosting_download', 'webdav_download')
  AND (metadata IS NULL OR json_valid(metadata) = 0 OR json_type(metadata, '$.trafficEventId') IS NULL)
  AND EXISTS (
    SELECT 1 FROM cloud_traffic_reports ctr
    WHERE ctr.source_id = ae.target_id
      AND (
        (ae.action = 'share_download' AND ctr.source IN ('direct_share', 'landing_share'))
        OR ctr.source = CASE ae.action
          WHEN 'object_download' THEN 'object_download'
          WHEN 'image_hosting_download' THEN 'image_hosting'
          WHEN 'webdav_download' THEN 'webdav_download'
          ELSE ''
        END
      )
      AND ctr.status <> 'blocked'
      AND ABS(CAST(ctr.created_at / 1000 AS INTEGER) - ae.created_at) <= 5
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
  AND NOT EXISTS (
    SELECT 1 FROM activity_events ae
    WHERE ae.id = 'backfill_' || ctr.event_id
      OR (
        ae.target_id = ctr.source_id
        AND ae.action = CASE
          WHEN ctr.status = 'blocked' THEN 'download_failed'
          WHEN ctr.source IN ('direct_share', 'landing_share') THEN 'share_download'
          WHEN ctr.source = 'image_hosting' THEN 'image_hosting_download'
          WHEN ctr.source = 'object_download' THEN 'object_download'
          ELSE 'webdav_download'
        END
        AND ABS(ae.created_at - CAST(ctr.created_at / 1000 AS INTEGER)) <= 5
      )
  );

${buildImmutableFactBackfillSql()}

${purgeLegacyRollupsSql()}
${purgeOpenRollupsSql(now)}
${purgeCounterRollupsSql()}

${buildHourlyBackfillSql(now)}
`
}

function buildImmutableFactBackfillSql(): string {
  return `INSERT OR IGNORE INTO activity_events (
  id, org_id, user_id, actor_type, actor_ref, action, target_type,
  target_id, target_name, metadata, created_at
)
SELECT
  'stats:stats_share_created:' || ae.target_id,
  ae.org_id, NULL, 'system', 'stats-backfill', 'stats_share_created', 'share',
  ae.target_id, ae.target_id,
  json_object(
    'kind', COALESCE(CASE WHEN json_valid(ae.metadata) = 1 THEN json_extract(ae.metadata, '$.kind') END, 'unknown'),
    'statsQuality', 'lower_bound'
  ),
  ae.created_at
FROM activity_events ae
WHERE ae.action = 'share_create' AND ae.target_id IS NOT NULL;

INSERT OR IGNORE INTO activity_events (
  id, org_id, user_id, actor_type, actor_ref, action, target_type,
  target_id, target_name, metadata, created_at
)
SELECT
  'stats:stats_share_created:' || s.id,
  s.org_id, NULL, 'system', 'stats-backfill', 'stats_share_created', 'share',
  s.id, s.id, json_object('kind', s.kind, 'statsQuality', 'lower_bound'), s.created_at
FROM shares s;

INSERT OR IGNORE INTO activity_events (
  id, org_id, user_id, actor_type, actor_ref, action, target_type,
  target_id, target_name, metadata, created_at
)
SELECT
  'stats:stats_user_signup:' || u.id,
  COALESCE((
    SELECT m.organization_id
    FROM member m
    JOIN organization o ON o.id = m.organization_id
    WHERE m.user_id = u.id AND o.metadata LIKE '%"type":"personal"%'
    ORDER BY m.created_at, m.id
    LIMIT 1
  ), ''),
  NULL, 'system', 'stats-backfill', 'stats_user_signup', 'user',
  u.id, u.id,
  json_object(
    'provider', COALESCE((
      SELECT a.provider_id FROM account a WHERE a.user_id = u.id ORDER BY a.created_at, a.id LIMIT 1
    ), 'direct'),
    'statsQuality', 'lower_bound'
  ),
  CAST(u.created_at / 1000 AS INTEGER)
FROM user u;

INSERT OR IGNORE INTO activity_events (
  id, org_id, user_id, actor_type, actor_ref, action, target_type,
  target_id, target_name, metadata, created_at
)
SELECT
  'stats:stats_background_job_finished:' || bj.id,
  bj.org_id, NULL, 'system', 'stats-backfill', 'stats_background_job_finished', 'background_job',
  bj.id, bj.id,
  json_object('jobType', bj.type, 'outcome', bj.status, 'statsQuality', 'lower_bound'),
  CAST(bj.finished_at / 1000 AS INTEGER)
FROM background_jobs bj
WHERE bj.finished_at IS NOT NULL;

INSERT OR IGNORE INTO activity_events (
  id, org_id, user_id, actor_type, actor_ref, action, target_type,
  target_id, target_name, metadata, created_at
)
SELECT
  'stats:stats_remote_download_finished:event:' || ae.id,
  ae.org_id, NULL, 'system', 'stats-backfill', 'stats_remote_download_finished', 'remote_download',
  ae.target_id, ae.target_id,
  json_object(
    'category', COALESCE(dt.category, 'uncategorized'),
    'downloaderId', dt.assigned_downloader_id,
    'outcome', CASE ae.action
      WHEN 'download_task_completed' THEN 'completed'
      WHEN 'download_task_failed' THEN 'failed'
      ELSE 'canceled'
    END,
    'bytes', CASE WHEN ae.action = 'download_task_completed' THEN COALESCE(dt.billing_charged_bytes, 0) ELSE 0 END,
    'statsQuality', 'lower_bound'
  ),
  ae.created_at
FROM activity_events ae
LEFT JOIN download_tasks dt ON dt.id = ae.target_id
WHERE ae.action IN ('download_task_completed', 'download_task_failed', 'download_task_canceled')
  AND ae.target_id IS NOT NULL;

INSERT OR IGNORE INTO activity_events (
  id, org_id, user_id, actor_type, actor_ref, action, target_type,
  target_id, target_name, metadata, created_at
)
SELECT
  'stats:stats_remote_download_finished:' || dt.id,
  dt.org_id, NULL, 'system', 'stats-backfill', 'stats_remote_download_finished', 'remote_download',
  dt.id, dt.id,
  json_object(
    'category', COALESCE(dt.category, 'uncategorized'),
    'downloaderId', dt.assigned_downloader_id,
    'outcome', dt.status,
    'bytes', dt.billing_charged_bytes,
    'statsQuality', 'lower_bound'
  ),
  CAST(dt.finished_at / 1000 AS INTEGER)
FROM download_tasks dt
WHERE dt.finished_at IS NOT NULL
  AND dt.status IN ('completed', 'failed', 'canceled')
  AND NOT EXISTS (
    SELECT 1 FROM activity_events ae
    WHERE ae.target_id = dt.id
      AND ae.action = CASE dt.status
        WHEN 'completed' THEN 'download_task_completed'
        WHEN 'failed' THEN 'download_task_failed'
        WHEN 'canceled' THEN 'download_task_canceled'
        ELSE ''
      END
  );`
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
  scope?: 'counters' | 'full'
  dimensions?: Record<string, string>
}

function buildHourlyBackfillSql(now: Date): string {
  const currentHour = Math.floor(now.getTime() / 3_600_000) * 3_600_000
  const missingShareViewsQuality = `CASE WHEN EXISTS (
    SELECT 1 FROM shares s
    WHERE s.views > (
      SELECT COUNT(*) FROM activity_events history
      WHERE history.action = 'share_view'
        AND COALESCE(CASE WHEN json_valid(history.metadata) = 1 THEN json_extract(history.metadata, '$.shareId') END, history.target_id) = s.id
    )
  ) THEN 'lower_bound' ELSE 'exact' END`
  const missingShareDownloadsQuality = `CASE WHEN EXISTS (
    SELECT 1 FROM shares s
    WHERE s.downloads > (
      SELECT COUNT(*) FROM activity_events history
      WHERE history.action = 'share_download'
        AND COALESCE(CASE WHEN json_valid(history.metadata) = 1 THEN json_extract(history.metadata, '$.shareId') END, history.target_id) = s.id
    )
  ) THEN 'lower_bound' ELSE 'exact' END`
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
      metric: 'transfer.download_issued',
      source: 'activity_events ae',
      timestampMs: 'ae.created_at * 1000',
      org: 'ae.org_id',
      where: "ae.action IN ('share_download','object_download','image_hosting_download','webdav_download')",
      bytes: "SUM(CASE WHEN json_valid(ae.metadata) = 1 THEN COALESCE(json_extract(ae.metadata, '$.bytes'), 0) ELSE 0 END)",
      quality: `CASE WHEN
        SUM(CASE WHEN ae.metadata IS NULL OR json_valid(ae.metadata) = 0 OR json_type(ae.metadata, '$.bytes') IS NULL THEN 1 ELSE 0 END) > 0
        OR (${missingShareDownloadsQuality}) = 'lower_bound'
        THEN 'lower_bound' ELSE 'exact' END`,
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
      source: 'activity_events ae',
      timestampMs: 'ae.created_at * 1000',
      org: 'ae.org_id',
      where: "ae.action = 'stats_share_created'",
      quality:
        "CASE WHEN SUM(CASE WHEN json_valid(ae.metadata) = 1 AND json_extract(ae.metadata, '$.statsQuality') = 'lower_bound' THEN 1 ELSE 0 END) > 0 THEN 'lower_bound' ELSE 'exact' END",
      dimensions: { kind: "COALESCE(CASE WHEN json_valid(ae.metadata) = 1 THEN json_extract(ae.metadata, '$.kind') END, 'unknown')" },
    },
    activitySource('share.view', "ae.action = 'share_view'", { share_id: 'ae.target_id', actor_type: "COALESCE(ae.actor_type, CASE WHEN ae.user_id IS NULL THEN 'anonymous' ELSE 'user' END)" }, false, missingShareViewsQuality),
    activitySource('share.download_issued', "ae.action = 'share_download'", { share_id: "COALESCE(CASE WHEN json_valid(ae.metadata) = 1 THEN json_extract(ae.metadata, '$.shareId') END, ae.target_id)", kind: "CASE WHEN json_valid(ae.metadata) = 1 THEN json_extract(ae.metadata, '$.kind') END", source: "COALESCE(CASE WHEN json_valid(ae.metadata) = 1 THEN json_extract(ae.metadata, '$.source') END, 'landing_share')", actor_type: "COALESCE(ae.actor_type, CASE WHEN ae.user_id IS NULL THEN 'anonymous' ELSE 'user' END)" }, true, missingShareDownloadsQuality),
    activitySource('share.saved', "ae.action = 'save_from_share'", { share_id: "COALESCE(CASE WHEN json_valid(ae.metadata) = 1 THEN json_extract(ae.metadata, '$.shareId') END, ae.target_id)", actor_type: "COALESCE(ae.actor_type, CASE WHEN ae.user_id IS NULL THEN 'anonymous' ELSE 'user' END)" }, true),
    activitySource('share.password_passed', "ae.action = 'share_password_passed'", { share_id: 'ae.target_id' }),
    {
      metric: 'remote_download.task_finished',
      source: 'activity_events ae',
      timestampMs: 'ae.created_at * 1000',
      org: 'ae.org_id',
      where: "ae.action = 'stats_remote_download_finished'",
      bytes: "SUM(CASE WHEN json_valid(ae.metadata) = 1 THEN COALESCE(json_extract(ae.metadata, '$.bytes'), 0) ELSE 0 END)",
      quality:
        "CASE WHEN SUM(CASE WHEN json_valid(ae.metadata) = 1 AND json_extract(ae.metadata, '$.statsQuality') = 'lower_bound' THEN 1 ELSE 0 END) > 0 THEN 'lower_bound' ELSE 'exact' END",
      dimensions: {
        category: "COALESCE(CASE WHEN json_valid(ae.metadata) = 1 THEN json_extract(ae.metadata, '$.category') END, 'uncategorized')",
        downloader_id: "CASE WHEN json_valid(ae.metadata) = 1 THEN json_extract(ae.metadata, '$.downloaderId') END",
        outcome: "COALESCE(CASE WHEN json_valid(ae.metadata) = 1 THEN json_extract(ae.metadata, '$.outcome') END, 'unknown')",
      },
    },
    {
      metric: 'background_job.finished',
      source: 'activity_events ae',
      timestampMs: 'ae.created_at * 1000',
      org: 'ae.org_id',
      where: "ae.action = 'stats_background_job_finished'",
      quality:
        "CASE WHEN SUM(CASE WHEN json_valid(ae.metadata) = 1 AND json_extract(ae.metadata, '$.statsQuality') = 'lower_bound' THEN 1 ELSE 0 END) > 0 THEN 'lower_bound' ELSE 'exact' END",
      dimensions: {
        job_type: "COALESCE(CASE WHEN json_valid(ae.metadata) = 1 THEN json_extract(ae.metadata, '$.jobType') END, 'unknown')",
        outcome: "COALESCE(CASE WHEN json_valid(ae.metadata) = 1 THEN json_extract(ae.metadata, '$.outcome') END, 'unknown')",
      },
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

  const statements = sources.flatMap((source) => hourlyStatements(source, currentHour))
  statements.push(userSignupBackfillSql(currentHour), rollupMarkerBackfillSql(now))
  return statements.join('\n\n')
}

function purgeLegacyRollupsSql(): string {
  return `DELETE FROM stats_rollups_hourly
WHERE CASE WHEN json_valid(metadata) = 1 THEN
    json_extract(metadata, '$.version') = 3
    AND json_extract(metadata, '$.scope') IN ('counters', 'snapshots', 'full')
    AND json_extract(metadata, '$.quality') IN ('exact', 'lower_bound')
  ELSE 0 END = 0;`
}

function purgeOpenRollupsSql(now: Date): string {
  const currentHour = Math.floor(now.getTime() / 3_600_000) * 3_600_000
  return `DELETE FROM stats_rollups_hourly WHERE bucket_start >= ${currentHour};`
}

function purgeCounterRollupsSql(): string {
  return `DELETE FROM stats_rollups_hourly
WHERE metric_key IN (
    'background_job.finished', 'remote_download.task_finished', 'share.created',
    'share.download_issued', 'share.password_passed', 'share.saved', 'share.view',
    'stats.quality_missing_bytes', 'traffic.report_sync', 'transfer.download_failed',
    'transfer.download_issued', 'transfer.upload', 'user.signup'
  )
  OR (
    metric_key = 'stats.rollup_run'
    AND CASE WHEN json_valid(metadata) = 1 THEN json_extract(metadata, '$.scope') = 'counters' ELSE 0 END = 1
  );`
}

function activitySource(
  metric: string,
  where: string,
  dimensions: Record<string, string>,
  bytes = false,
  quality?: string,
): HourlySource {
  return {
    metric,
    source: 'activity_events ae',
    timestampMs: 'ae.created_at * 1000',
    org: 'ae.org_id',
    where,
    bytes: bytes ? "SUM(CASE WHEN json_valid(ae.metadata) = 1 THEN COALESCE(json_extract(ae.metadata, '$.bytes'), 0) ELSE 0 END)" : undefined,
    quality,
    dimensions,
  }
}

function hourlyStatements(source: HourlySource, before: number): string[] {
  return [
    hourlyInsert(source, '', "''", before),
    ...Object.entries(source.dimensions ?? {}).map(([key, value]) => hourlyInsert(source, key, value, before)),
  ]
}

function hourlyInsert(source: HourlySource, dimensionKey = '', dimensionExpression = "''", before?: number): string {
  const bucket = `CAST((${source.timestampMs}) / 3600000 AS INTEGER) * 3600000`
  const where = [
    source.where,
    `(${source.timestampMs}) >= ${MIN_VALID_TIMESTAMP_MS}`,
    before === undefined ? null : `(${source.timestampMs}) < ${before}`,
    dimensionKey ? `(${dimensionExpression}) IS NOT NULL AND CAST((${dimensionExpression}) AS TEXT) <> ''` : null,
  ]
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
  json_object('version', 3, 'scope', '${source.scope ?? 'counters'}', 'quality', quality_value),
  bucket_start + 3600000
FROM (
  SELECT ${bucket} AS bucket_start, ${source.org} AS org_id, ${dimension} AS dimension_value,
    ${count} AS count_value, ${bytes} AS bytes_value, ${uniqueCount} AS unique_value, ${quality} AS quality_value
  FROM ${source.source}
  ${where ? `WHERE ${where}` : ''}
  GROUP BY 1, 2${dimensionKey ? ', 3' : ''}
) rollup
WHERE true
ON CONFLICT(bucket_start, org_id, metric_key, dimension_key, dimension_value)
DO UPDATE SET count = excluded.count, bytes = excluded.bytes, unique_count = excluded.unique_count,
  metadata = excluded.metadata, updated_at = excluded.updated_at
WHERE count <> excluded.count OR bytes <> excluded.bytes OR unique_count <> excluded.unique_count OR metadata <> excluded.metadata;`
}

function userSignupBackfillSql(before: number): string {
  return hourlyStatements({
    metric: 'user.signup',
    source: 'activity_events ae',
    timestampMs: 'ae.created_at * 1000',
    org: "''",
    where: "ae.action = 'stats_user_signup'",
    quality:
      "CASE WHEN SUM(CASE WHEN json_valid(ae.metadata) = 1 AND json_extract(ae.metadata, '$.statsQuality') = 'lower_bound' THEN 1 ELSE 0 END) > 0 THEN 'lower_bound' ELSE 'exact' END",
    dimensions: {
      provider: "COALESCE(CASE WHEN json_valid(ae.metadata) = 1 THEN json_extract(ae.metadata, '$.provider') END, 'unknown')",
    },
  }, before).join('\n\n')
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
  const missing = '9223372036854775807'
  return `NULLIF(COALESCE((
    SELECT CAST((MIN(ae.created_at) * 1000) / 3600000 AS INTEGER) * 3600000
    FROM activity_events ae
    WHERE ae.created_at >= ${MIN_VALID_TIMESTAMP_SECONDS}
      AND ae.action IN (
        'upload_confirm', 'upload_cancel', 'upload_failed',
        'share_download', 'object_download', 'image_hosting_download', 'webdav_download', 'download_failed',
        'share_view', 'save_from_share', 'share_password_passed',
        'stats_user_signup', 'stats_share_created',
        'stats_remote_download_finished', 'stats_background_job_finished'
      )
  ), ${missing}), ${missing})`
}

export function buildValidationSql(now = new Date()): string {
  const currentHour = Math.floor(now.getTime() / 3_600_000) * 3_600_000
  const latestClosedHour = currentHour - 3_600_000
  const facts = `SELECT json_object(
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
  'rawActiveShares', (SELECT COUNT(*) FROM shares WHERE status = 'active'),
  'validActiveShares', (
    SELECT COUNT(*) FROM shares
    WHERE status = 'active'
      AND (expires_at IS NULL OR expires_at > unixepoch())
      AND (download_limit IS NULL OR downloads < download_limit)
  ),
  'rawUploadEvents', (
    SELECT COUNT(*) FROM activity_events
    WHERE action = 'upload_confirm'
      AND created_at >= ${MIN_VALID_TIMESTAMP_SECONDS} AND created_at * 1000 < ${currentHour}
  ),
  'rawUploadBytes', (
    SELECT COALESCE(SUM(CASE WHEN json_valid(metadata) = 1 THEN COALESCE(json_extract(metadata, '$.bytes'), 0) ELSE 0 END), 0)
    FROM activity_events
    WHERE action = 'upload_confirm'
      AND created_at >= ${MIN_VALID_TIMESTAMP_SECONDS} AND created_at * 1000 < ${currentHour}
  ),
  'rawDownloadEvents', (
    SELECT COUNT(*) FROM activity_events
    WHERE action IN ('share_download', 'object_download', 'image_hosting_download', 'webdav_download')
      AND created_at >= ${MIN_VALID_TIMESTAMP_SECONDS} AND created_at * 1000 < ${currentHour}
  ),
  'rawDownloadBytes', (
    SELECT COALESCE(SUM(CASE WHEN json_valid(metadata) = 1 THEN COALESCE(json_extract(metadata, '$.bytes'), 0) ELSE 0 END), 0)
    FROM activity_events
    WHERE action IN ('share_download', 'object_download', 'image_hosting_download', 'webdav_download')
      AND created_at >= ${MIN_VALID_TIMESTAMP_SECONDS} AND created_at * 1000 < ${currentHour}
  ),
  'rawShareViews', (
    SELECT COUNT(*) FROM activity_events
    WHERE action = 'share_view'
      AND created_at >= ${MIN_VALID_TIMESTAMP_SECONDS} AND created_at * 1000 < ${currentHour}
  )
) AS summary;`

  const additionalFacts = `SELECT json_object(
  'rawUploadAttempts', (
    SELECT COUNT(*) FROM activity_events
    WHERE action IN ('upload_confirm', 'upload_cancel', 'upload_failed')
      AND created_at >= ${MIN_VALID_TIMESTAMP_SECONDS} AND created_at * 1000 < ${currentHour}
  ),
  'rawUserSignups', (
    SELECT COUNT(*) FROM activity_events
    WHERE action = 'stats_user_signup'
      AND created_at >= ${MIN_VALID_TIMESTAMP_SECONDS} AND created_at * 1000 < ${currentHour}
  ),
  'rawSharesCreated', (
    SELECT COUNT(*) FROM activity_events
    WHERE action = 'stats_share_created'
      AND created_at >= ${MIN_VALID_TIMESTAMP_SECONDS} AND created_at * 1000 < ${currentHour}
  ),
  'rawShareDownloads', (
    SELECT COUNT(*) FROM activity_events
    WHERE action = 'share_download'
      AND created_at >= ${MIN_VALID_TIMESTAMP_SECONDS} AND created_at * 1000 < ${currentHour}
  ),
  'rawShareSaves', (
    SELECT COUNT(*) FROM activity_events
    WHERE action = 'save_from_share'
      AND created_at >= ${MIN_VALID_TIMESTAMP_SECONDS} AND created_at * 1000 < ${currentHour}
  ),
  'rawSharePasswordPasses', (
    SELECT COUNT(*) FROM activity_events
    WHERE action = 'share_password_passed'
      AND created_at >= ${MIN_VALID_TIMESTAMP_SECONDS} AND created_at * 1000 < ${currentHour}
  ),
  'rawFailedDownloads', (
    SELECT COUNT(*) FROM activity_events
    WHERE action = 'download_failed'
      AND created_at >= ${MIN_VALID_TIMESTAMP_SECONDS} AND created_at * 1000 < ${currentHour}
  ),
  'rawFinishedDownloadTasks', (
    SELECT COUNT(*) FROM activity_events
    WHERE action = 'stats_remote_download_finished'
      AND created_at >= ${MIN_VALID_TIMESTAMP_SECONDS} AND created_at * 1000 < ${currentHour}
  ),
  'rawFinishedBackgroundJobs', (
    SELECT COUNT(*) FROM activity_events
    WHERE action = 'stats_background_job_finished'
      AND created_at >= ${MIN_VALID_TIMESTAMP_SECONDS} AND created_at * 1000 < ${currentHour}
  ),
  'rawMissingByteEvents', (
    SELECT COUNT(*) FROM activity_events
    WHERE action IN ('upload_confirm', 'share_download', 'object_download', 'image_hosting_download', 'webdav_download')
      AND (metadata IS NULL OR json_valid(metadata) = 0 OR json_type(metadata, '$.bytes') IS NULL)
      AND created_at >= ${MIN_VALID_TIMESTAMP_SECONDS} AND created_at * 1000 < ${currentHour}
  )
) AS summary;`

  const rollups = `WITH valid_rollups AS MATERIALIZED (
  SELECT *
  FROM stats_rollups_hourly
  WHERE CASE WHEN json_valid(metadata) = 1 THEN
      json_extract(metadata, '$.version') = 3
      AND json_extract(metadata, '$.scope') IN ('counters', 'snapshots', 'full')
      AND json_extract(metadata, '$.quality') IN ('exact', 'lower_bound')
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
    ('transfer.download_issued', 'actor_type', 1),
    ('transfer.download_issued', 'source', 1),
    ('share.download_issued', 'actor_type', 1),
    ('share.download_issued', 'source', 1),
    ('user.signup', 'provider', 0),
    ('share.created', 'kind', 0),
    ('remote_download.task_finished', 'category', 1),
    ('remote_download.task_finished', 'outcome', 1),
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
  'rollupShareViews', (
    SELECT COALESCE(SUM(count), 0) FROM counter_rows
    WHERE metric_key = 'share.view' AND dimension_key = ''
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
        AND json_extract(metadata, '$.quality') IN ('exact', 'lower_bound')
      ELSE 0 END = 0
  )
) AS summary;`

  const additionalRollups = `WITH valid_rollups AS MATERIALIZED (
  SELECT *
  FROM stats_rollups_hourly
  WHERE CASE WHEN json_valid(metadata) = 1 THEN
      json_extract(metadata, '$.version') = 3
      AND json_extract(metadata, '$.scope') IN ('counters', 'snapshots', 'full')
      AND json_extract(metadata, '$.quality') IN ('exact', 'lower_bound')
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
  'rollupSharePasswordPasses', (
    SELECT COALESCE(SUM(count), 0) FROM counter_rows
    WHERE metric_key = 'share.password_passed' AND dimension_key = ''
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
      AND json_extract(metadata, '$.quality') IN ('exact', 'lower_bound')
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
      AND NOT EXISTS (
        SELECT 1 FROM activity_events ae
        WHERE ae.id = 'backfill_' || ctr.event_id
          OR (
            ae.target_id = ctr.source_id
            AND ae.action = CASE
              WHEN ctr.status = 'blocked' THEN 'download_failed'
              WHEN ctr.source IN ('direct_share', 'landing_share') THEN 'share_download'
              WHEN ctr.source = 'image_hosting' THEN 'image_hosting_download'
              WHEN ctr.source = 'object_download' THEN 'object_download'
              ELSE 'webdav_download'
            END
            AND ABS(ae.created_at - CAST(ctr.created_at / 1000 AS INTEGER)) <= 5
          )
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
    ['share views', summary.rawShareViews, summary.rollupShareViews],
    ['upload attempts', summary.rawUploadAttempts, summary.rollupUploadAttempts],
    ['user signups', summary.rawUserSignups, summary.rollupUserSignups],
    ['shares created', summary.rawSharesCreated, summary.rollupSharesCreated],
    ['share downloads', summary.rawShareDownloads, summary.rollupShareDownloads],
    ['share saves', summary.rawShareSaves, summary.rollupShareSaves],
    ['share password passes', summary.rawSharePasswordPasses, summary.rollupSharePasswordPasses],
    ['failed downloads', summary.rawFailedDownloads, summary.rollupFailedDownloads],
    ['finished download tasks', summary.rawFinishedDownloadTasks, summary.rollupFinishedDownloadTasks],
    ['finished background jobs', summary.rawFinishedBackgroundJobs, summary.rollupFinishedBackgroundJobs],
    ['missing byte events', summary.rawMissingByteEvents, summary.rollupMissingByteEvents],
  ].filter(([, raw, rollup]) => raw !== rollup)
  if (
    mismatches.length > 0 ||
    summary.orphanRollupBuckets > 0 ||
    summary.requiredDimensionMismatchGroups > 0 ||
    summary.legacyRollupRows > 0 ||
    summary.counterMissingBuckets > 0 ||
    summary.openCounterMarkers > 0
  ) {
    throw new Error(
      `admin_stats_validation_failed:${JSON.stringify({
        mismatches,
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
