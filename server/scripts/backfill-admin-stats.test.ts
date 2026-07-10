import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { buildBackfillSql, splitSqlStatements, VALIDATION_SQL } from '../../scripts/backfill-admin-stats'

describe('admin stats backfill', () => {
  it('recovers exact available facts and is idempotent', () => {
    const db = new Database(':memory:')
    db.exec(`
      CREATE TABLE user (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE account (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, provider_id TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE session (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE organization (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL);
      CREATE TABLE matters (id TEXT PRIMARY KEY, size INTEGER, dirtype INTEGER);
      CREATE TABLE shares (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, matter_id TEXT NOT NULL, org_id TEXT NOT NULL,
        status TEXT NOT NULL, expires_at INTEGER, download_limit INTEGER, downloads INTEGER NOT NULL,
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

      INSERT INTO user VALUES ('u1', 1);
      INSERT INTO matters VALUES ('f1', 512, 0);
      INSERT INTO shares VALUES ('s1', 'landing', 'f1', 'o1', 'active', NULL, 10, 1, 1);
      INSERT INTO activity_events VALUES
        ('upload-1', 'o1', 'u1', NULL, NULL, 'upload_confirm', 'file', 'f1', 'file.bin', NULL, 1),
        ('share-1', 'o1', NULL, NULL, NULL, 'share_download', 'share', 's1', 'file.bin', '{"anonymous":true}', 1),
        ('image-1', 'o1', NULL, NULL, NULL, 'image_hosting_download', 'image', 'img1', 'image.png', NULL, 1);
      INSERT INTO cloud_traffic_reports VALUES
        ('r1', 'o1', 'direct_share', 's1', 'traffic-1', 512, NULL, NULL, NULL, 'reported', NULL, 1000, 1000),
        ('r2', 'o1', 'image_hosting', 'img1', 'traffic-2', 128, NULL, NULL, NULL, 'reported', NULL, 1000, 1000);
      INSERT INTO org_quotas VALUES ('q1', 512);
    `)

    const sql = buildBackfillSql(new Date('2026-07-10T12:00:00.000Z'))
    const statements = splitSqlStatements(sql)
    expect(statements.length).toBeGreaterThan(1)
    db.transaction(() =>
      statements.forEach((statement) => {
        db.exec(statement)
      }),
    )()
    const firstChanges = db.prepare('SELECT total_changes() AS value').get() as { value: number }
    const firstSummary = JSON.parse((db.prepare(VALIDATION_SQL).get() as { summary: string }).summary) as Record<
      string,
      number
    >

    db.transaction(() =>
      statements.forEach((statement) => {
        db.exec(statement)
      }),
    )()
    const secondChanges = db.prepare('SELECT total_changes() AS value').get() as { value: number }

    expect(firstChanges.value).toBeGreaterThan(0)
    expect(secondChanges.value - firstChanges.value).toBe(0)
    expect(firstSummary).toMatchObject({
      orphanUserEvents: 0,
      missingUploadBytes: 0,
      missingDownloadBytes: 0,
      trafficEvents: 2,
      hourlyRollups: 2,
      rawActiveShares: 1,
      validActiveShares: 1,
    })
    expect(
      db.prepare("SELECT json_extract(metadata, '$.bytes') AS bytes FROM activity_events WHERE id = 'upload-1'").get(),
    ).toEqual({ bytes: 512 })
    expect(db.prepare("SELECT COUNT(*) AS value FROM activity_events WHERE target_id = 'img1'").get()).toEqual({
      value: 1,
    })
    db.close()
  })
})
