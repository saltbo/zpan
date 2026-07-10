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
  storageRollups: number
  rawActiveShares: number
  validActiveShares: number
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
      WHERE ae.id = 'backfill_' || ${trafficAlias}.event_id
        OR (
          json_valid(ae.metadata) = 1
          AND json_extract(ae.metadata, '$.trafficEventId') = ${trafficAlias}.event_id
        )
    )
    OR EXISTS (
      SELECT 1 FROM activity_events ae
      WHERE ${unambiguousLegacyCloudTrafficMatch('ae', trafficAlias)}
    )`
}

export function buildBackfillSql(now = new Date()): string {
  const nowSeconds = Math.floor(now.getTime() / 1000)
  const nowMillis = now.getTime()
  const bucket = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const bucketDate = now.toISOString().slice(0, 10)
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
WHERE action IN ('share_download', 'object_download')
  AND (metadata IS NULL OR json_valid(metadata) = 0 OR json_type(metadata, '$.trafficEventId') IS NULL)
  AND EXISTS (
    SELECT 1 FROM cloud_traffic_reports ctr
    WHERE ${unambiguousLegacyCloudTrafficMatch('ae', 'ctr')}
  );

DELETE FROM activity_events AS synthetic
WHERE synthetic.actor_ref = 'stats-backfill'
  AND synthetic.action = 'share_download'
  AND EXISTS (
    SELECT 1 FROM cloud_traffic_reports ctr
    WHERE ctr.source = 'direct_share'
      AND synthetic.id = 'backfill_' || ctr.event_id
      AND EXISTS (
        SELECT 1 FROM activity_events recovered
        WHERE recovered.id <> synthetic.id
          AND (recovered.actor_ref IS NULL OR recovered.actor_ref <> 'stats-backfill')
          AND recovered.org_id = ctr.org_id
          AND recovered.target_id = ctr.source_id
          AND recovered.action = 'share_download'
          AND json_valid(recovered.metadata) = 1
          AND json_extract(recovered.metadata, '$.trafficEventId') = ctr.event_id
      )
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

INSERT INTO stats_rollups_daily (
  id, bucket_start, org_id, metric_key, dimension_key, dimension_value,
  count, bytes, unique_count, metadata, updated_at
)
SELECT
  'storage-used-${bucketDate}',
  ${bucket},
  '',
  'storage.used.bytes',
  '',
  '',
  0,
  COALESCE(SUM(used), 0),
  0,
  json_object('source', 'org_quotas.used', 'quality', 'exact_snapshot', 'backfilledAt', ${nowSeconds}),
  ${nowMillis}
FROM org_quotas
WHERE true
ON CONFLICT(bucket_start, org_id, metric_key, dimension_key, dimension_value)
DO UPDATE SET
  bytes = excluded.bytes,
  metadata = excluded.metadata,
  updated_at = excluded.updated_at
WHERE stats_rollups_daily.bytes <> excluded.bytes;
`
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
  'storageRollups', (
    SELECT COUNT(*) FROM stats_rollups_daily WHERE metric_key = 'storage.used.bytes'
  ),
  'rawActiveShares', (SELECT COUNT(*) FROM shares WHERE status = 'active'),
  'validActiveShares', (
    SELECT COUNT(*) FROM shares
    WHERE status = 'active'
      AND (expires_at IS NULL OR expires_at > unixepoch())
      AND (download_limit IS NULL OR downloads < download_limit)
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
    SELECT COUNT(*) FROM activity_events synthetic
    JOIN cloud_traffic_reports ctr ON synthetic.id = 'backfill_' || ctr.event_id
    WHERE synthetic.actor_ref = 'stats-backfill'
      AND synthetic.action = 'share_download'
      AND ctr.source = 'direct_share'
      AND EXISTS (
        SELECT 1 FROM activity_events recovered
        WHERE recovered.id <> synthetic.id
          AND (recovered.actor_ref IS NULL OR recovered.actor_ref <> 'stats-backfill')
          AND recovered.org_id = ctr.org_id
          AND recovered.target_id = ctr.source_id
          AND recovered.action = 'share_download'
          AND (
            (
              json_valid(recovered.metadata) = 1
              AND json_extract(recovered.metadata, '$.trafficEventId') = ctr.event_id
            )
            OR (${unambiguousLegacyCloudTrafficMatch('recovered', 'ctr')})
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
  const file = join(dir, 'backfill.sql')
  try {
    writeFileSync(file, sql)
    execFileSync('pnpm', [...d1Args(target), '--file', file], { stdio: 'inherit' })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
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

function main(): void {
  const options = parseOptions(process.argv.slice(2))
  const before = querySummary<ValidationSummary>(options.target, VALIDATION_SQL)
  const plan = querySummary<BackfillPlan>(options.target, BACKFILL_PLAN_SQL)
  console.log(JSON.stringify({ mode: options.apply ? 'apply' : 'dry-run', before, plan }, null, 2))
  if (!options.apply) return
  apply(options.target, buildBackfillSql())
  const after = querySummary<ValidationSummary>(options.target, VALIDATION_SQL)
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
          storageRollups: after.storageRollups - before.storageRollups,
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
