import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { buildBackfillSql, buildValidationSql, splitSqlStatements } from '../../scripts/backfill-admin-stats'

describe('admin stats backfill', () => {
  it('splits SQL batches without breaking quoted semicolons', () => {
    expect(splitSqlStatements("SELECT 'a;b'; SELECT 'it''s'; SELECT 3")).toEqual([
      "SELECT 'a;b'",
      "SELECT 'it''s'",
      'SELECT 3',
    ])
    expect(() => splitSqlStatements("SELECT 'unterminated")).toThrow('admin_stats_backfill_unterminated_sql_string')
  })

  it('recovers exact available facts and is idempotent', () => {
    const db = new Database(':memory:')
    const now = new Date('2026-07-10T12:00:00.000Z')
    const historyStartMs = Date.parse('2026-04-01T00:10:00.000Z')
    const eventMs = Date.parse('2026-07-10T09:10:00.000Z')
    const eventHourMs = Date.parse('2026-07-10T09:00:00.000Z')
    const snapshotObservedAt = '2026-07-10T09:50:00.000Z'
    const eventSec = Math.floor(eventMs / 1000)
    const currentHourMs = Date.parse('2026-07-10T12:00:00.000Z')
    const currentEventSec = Math.floor(Date.parse('2026-07-10T12:10:00.000Z') / 1000)
    const latestClosedHour = Date.parse('2026-07-10T11:00:00.000Z')
    const expectedBuckets = (latestClosedHour - Math.floor(historyStartMs / 3_600_000) * 3_600_000) / 3_600_000 + 1
    db.exec(`
      CREATE TABLE user (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE account (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, provider_id TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE session (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE organization (id TEXT PRIMARY KEY, metadata TEXT, created_at INTEGER NOT NULL);
      CREATE TABLE member (
        id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, user_id TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE TABLE matters (id TEXT PRIMARY KEY, size INTEGER, dirtype INTEGER);
      CREATE TABLE shares (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, matter_id TEXT NOT NULL, org_id TEXT NOT NULL,
        status TEXT NOT NULL, expires_at INTEGER, download_limit INTEGER, views INTEGER NOT NULL, downloads INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE activity_events (
        id TEXT PRIMARY KEY, org_id TEXT NOT NULL, user_id TEXT, actor_type TEXT, actor_ref TEXT,
        action TEXT NOT NULL, target_type TEXT NOT NULL, target_id TEXT, target_name TEXT NOT NULL,
        metadata TEXT, created_at INTEGER NOT NULL
      );
      CREATE TABLE cloud_traffic_reports (
        id TEXT PRIMARY KEY, org_id TEXT NOT NULL, source TEXT NOT NULL, source_id TEXT NOT NULL,
        event_id TEXT NOT NULL UNIQUE, bytes INTEGER NOT NULL, storage_id TEXT, unit_bytes INTEGER,
        credits_per_unit INTEGER, status TEXT NOT NULL, error TEXT,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE download_tasks (
        id TEXT PRIMARY KEY, org_id TEXT NOT NULL, category TEXT, source_type TEXT NOT NULL,
        assigned_downloader_id TEXT, status TEXT NOT NULL, billing_charged_bytes INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL, finished_at INTEGER
      );
      CREATE TABLE background_jobs (
        id TEXT PRIMARY KEY, org_id TEXT NOT NULL, type TEXT NOT NULL, status TEXT NOT NULL,
        created_at INTEGER NOT NULL, finished_at INTEGER
      );
      CREATE TABLE remote_download_usage_reports (
        id TEXT PRIMARY KEY, org_id TEXT NOT NULL, downloader_id TEXT NOT NULL, status TEXT NOT NULL,
        unit_bytes INTEGER NOT NULL, credits_per_unit INTEGER NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE TABLE webhook_events (
        id TEXT PRIMARY KEY, status TEXT NOT NULL, created_at INTEGER NOT NULL, processed_at INTEGER
      );
      CREATE TABLE org_quotas (id TEXT PRIMARY KEY, used INTEGER NOT NULL);
      CREATE TABLE stats_rollups_hourly (
        id TEXT PRIMARY KEY, bucket_start INTEGER NOT NULL, org_id TEXT NOT NULL,
        metric_key TEXT NOT NULL, dimension_key TEXT NOT NULL, dimension_value TEXT NOT NULL,
        count INTEGER NOT NULL, bytes INTEGER NOT NULL, unique_count INTEGER NOT NULL,
        metadata TEXT, updated_at INTEGER NOT NULL,
        UNIQUE(bucket_start, org_id, metric_key, dimension_key, dimension_value)
      );

      INSERT INTO user VALUES ('u0', 0), ('u1', ${historyStartMs}), ('u2', ${historyStartMs + 1000});
      INSERT INTO account VALUES
        ('a1', 'u1', 'github', ${historyStartMs}),
        ('a2', 'u2', 'github', ${historyStartMs + 1000});
      INSERT INTO organization VALUES
        ('o1', '{"type":"personal"}', ${historyStartMs}),
        ('o2', '{"type":"personal"}', ${historyStartMs + 1000});
      INSERT INTO member VALUES
        ('m1', 'o1', 'u1', ${historyStartMs}),
        ('m2', 'o2', 'u2', ${historyStartMs + 1000});
      INSERT INTO matters VALUES ('f1', 512, 0);
      INSERT INTO shares VALUES ('s1', 'landing', 'f1', 'o1', 'active', NULL, 10, 0, 1, ${eventSec});
      INSERT INTO activity_events VALUES
        ('upload-1', 'o1', 'u1', NULL, NULL, 'upload_confirm', 'file', 'f1', 'file.bin', NULL, ${eventSec}),
        ('open-upload', 'o1', 'u1', 'user', NULL, 'upload_confirm', 'file', 'f1', 'file.bin',
          '{"bytes":512,"source":"upload","status":"success"}', ${currentEventSec}),
        ('share-1', 'o1', NULL, NULL, NULL, 'share_download', 'share', 's1', 'file.bin', '{"anonymous":true}', ${eventSec}),
        ('image-1', 'o1', NULL, NULL, NULL, 'image_hosting_download', 'image', 'img1', 'image.png', NULL, ${eventSec}),
        ('task-failed', 'o1', 'u1', 'user', NULL, 'download_task_failed', 'remote_download', 't1', 'task', NULL, ${eventSec + 1}),
        ('task-completed', 'o1', 'u1', 'user', NULL, 'download_task_completed', 'remote_download', 't1', 'task', NULL, ${eventSec + 2}),
        ('blocked-download', 'o1', 'u1', 'user', NULL, 'download_failed', 'file', 'f1', 'file.bin',
          '{"bytes":512,"source":"object_download","reason":"quota_exceeded","trafficEventId":"traffic-3"}', ${eventSec});
      INSERT INTO cloud_traffic_reports VALUES
        ('r1', 'o1', 'direct_share', 's1', 'traffic-1', 512, NULL, NULL, NULL, 'reported', NULL, ${eventMs}, ${eventMs}),
        ('r2', 'o1', 'image_hosting', 'img1', 'traffic-2', 128, NULL, NULL, NULL, 'reported', NULL, ${eventMs}, ${eventMs}),
        ('r3', 'o1', 'object_download', 'f1', 'traffic-3', 512, NULL, NULL, NULL, 'blocked', 'quota_exceeded', ${eventMs}, ${eventMs});
      INSERT INTO download_tasks VALUES
        ('t1', 'o1', 'video', 'url', 'd1', 'completed', 512, ${eventMs}, ${eventMs}),
        ('t2', 'o1', NULL, 'url', NULL, 'canceled', 0, ${eventMs}, ${eventMs});
      INSERT INTO org_quotas VALUES ('q1', 512);
      INSERT INTO stats_rollups_hourly VALUES
        ('legacy-epoch', 0, '', 'stats.rollup_run', '', '', 1, 0, 0,
          '{"version":1,"scope":"counters","quality":"exact"}', 0),
        ('latest-full', ${latestClosedHour}, '', 'stats.rollup_run', '', '', 1, 0, 0,
          '{"version":2,"scope":"full","quality":"exact"}', ${latestClosedHour + 3_600_000}),
        ('open-marker', ${currentHourMs}, '', 'stats.rollup_run', '', '', 1, 0, 0,
          '{"version":2,"scope":"full","quality":"exact"}', ${currentHourMs}),
        ('stale-task', ${eventMs - 3_600_000}, 'o1', 'remote_download.task_finished', '', '', 1, 512, 0,
          '{"version":2,"scope":"counters","quality":"exact"}', ${eventMs}),
        ('stale-traffic', ${eventMs - 3_600_000}, 'o1', 'traffic.report_sync', '', '', 2, 640, 0,
          '{"version":2,"scope":"counters","quality":"exact"}', ${eventMs}),
        ('snapshot-marker', ${eventHourMs}, '', 'stats.rollup_run', '', '', 1, 0, 0,
          '{"version":3,"scope":"snapshots","quality":"exact","snapshotQuality":"exact","snapshotObservedAt":"${snapshotObservedAt}"}', ${eventMs}),
        ('snapshot-gauge', ${eventHourMs}, '', 'storage.used', '', '', 0, 512, 0,
          '{"version":3,"scope":"snapshots","quality":"exact","observedAt":"${snapshotObservedAt}"}', ${eventMs});
    `)

    const sql = buildBackfillSql(now)
    const validationSql = buildValidationSql(now)
    const statements = splitSqlStatements(sql)
    expect(statements.length).toBeGreaterThan(1)
    db.transaction(() =>
      statements.forEach((statement) => {
        db.exec(statement)
      }),
    )()
    const firstSummary = Object.assign(
      {},
      ...splitSqlStatements(validationSql).map((statement) =>
        JSON.parse((db.prepare(statement).get() as { summary: string }).summary),
      ),
    ) as Record<string, number>
    const firstRows = db.prepare('SELECT * FROM stats_rollups_hourly ORDER BY id').all()

    db.transaction(() =>
      statements.forEach((statement) => {
        db.exec(statement)
      }),
    )()
    const secondRows = db.prepare('SELECT * FROM stats_rollups_hourly ORDER BY id').all()

    expect(firstRows.length).toBeGreaterThan(0)
    expect(secondRows).toEqual(firstRows)
    expect(firstSummary).toMatchObject({
      orphanUserEvents: 0,
      missingUploadBytes: 0,
      missingDownloadBytes: 0,
      trafficEvents: 3,
      hourlyRollups: expectedBuckets,
      rawActiveShares: 1,
      validActiveShares: 1,
      legacyRollupRows: 0,
      counterExpectedBuckets: expectedBuckets,
      counterCompletedBuckets: expectedBuckets,
      counterMissingBuckets: 0,
      openCounterMarkers: 0,
      rawUploadAttempts: 1,
      rollupUploadAttempts: 1,
      rawUserSignups: 2,
      rollupUserSignups: 2,
      rawSharesCreated: 1,
      rollupSharesCreated: 1,
      rawFailedDownloads: 1,
      rollupFailedDownloads: 1,
      rawShareDownloads: 1,
      rollupShareDownloads: 1,
      rawFinishedDownloadTasks: 3,
      rollupFinishedDownloadTasks: 3,
      rawMissingByteEvents: 0,
      rollupMissingByteEvents: 0,
    })
    expect(
      db.prepare("SELECT json_extract(metadata, '$.bytes') AS bytes FROM activity_events WHERE id = 'upload-1'").get(),
    ).toEqual({ bytes: 512 })
    expect(db.prepare("SELECT COUNT(*) AS value FROM activity_events WHERE target_id = 'img1'").get()).toEqual({
      value: 1,
    })
    expect(db.prepare("SELECT COUNT(*) AS value FROM activity_events WHERE id = 'backfill_traffic-3'").get()).toEqual({
      value: 0,
    })
    expect(
      db
        .prepare("SELECT COUNT(*) AS value FROM stats_rollups_hourly WHERE json_extract(metadata, '$.scope') = 'full'")
        .get(),
    ).toEqual({ value: 1 })
    expect(
      db
        .prepare(
          "SELECT json_extract(metadata, '$.counterQuality') AS counterQuality, json_extract(metadata, '$.snapshotQuality') AS snapshotQuality, json_extract(metadata, '$.snapshotObservedAt') AS snapshotObservedAt FROM stats_rollups_hourly WHERE id = 'snapshot-marker'",
        )
        .get(),
    ).toEqual({ counterQuality: 'lower_bound', snapshotQuality: 'exact', snapshotObservedAt })
    expect(db.prepare('SELECT COUNT(*) AS value FROM stats_rollups_hourly WHERE bucket_start = 0').get()).toEqual({
      value: 0,
    })
    expect(
      db.prepare('SELECT COUNT(*) AS value FROM stats_rollups_hourly WHERE bucket_start >= ?').get(currentHourMs),
    ).toEqual({ value: 0 })
    expect(
      db
        .prepare(
          "SELECT count AS value FROM stats_rollups_hourly WHERE metric_key = 'user.signup' AND dimension_key = 'provider' AND dimension_value = 'github'",
        )
        .get(),
    ).toEqual({ value: 2 })
    expect(
      db.prepare("SELECT COUNT(*) AS value FROM stats_rollups_hourly WHERE metric_key = 'traffic.report_sync'").get(),
    ).toEqual({
      value: 0,
    })
    expect(
      db
        .prepare(
          "SELECT json_extract(metadata, '$.outcome') AS outcome, json_extract(metadata, '$.bytes') AS bytes, COUNT(*) AS value FROM activity_events WHERE action = 'stats_remote_download_finished' GROUP BY outcome, bytes ORDER BY outcome",
        )
        .all(),
    ).toEqual([
      { outcome: 'canceled', bytes: 0, value: 1 },
      { outcome: 'completed', bytes: 512, value: 1 },
      { outcome: 'failed', bytes: 0, value: 1 },
    ])
    db.close()
  })
})
