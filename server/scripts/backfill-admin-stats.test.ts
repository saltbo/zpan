import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import {
  BACKFILL_PLAN_SQL,
  buildBackfillSql,
  splitSqlStatements,
  VALIDATION_SQL,
} from '../../scripts/backfill-admin-stats'

function createBackfillDatabase(): Database.Database {
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
  `)
  return db
}

function applyBackfill(db: Database.Database): number {
  const before = db.prepare('SELECT total_changes() AS value').get() as { value: number }
  db.transaction(() => db.exec(buildBackfillSql(new Date('2026-07-10T12:00:00.000Z'))))()
  const after = db.prepare('SELECT total_changes() AS value').get() as { value: number }
  return after.value - before.value
}

function readPlan(db: Database.Database): Record<string, number> {
  const row = db.prepare(BACKFILL_PLAN_SQL).get() as { summary: string }
  return JSON.parse(row.summary) as Record<string, number>
}

function readRollup(
  db: Database.Database,
  metricKey: string,
  dimensionKey = '',
  dimensionValue = '',
): { count: number; bytes: number } {
  return db
    .prepare(
      `SELECT COALESCE(SUM(count), 0) AS count, COALESCE(SUM(bytes), 0) AS bytes
       FROM stats_rollups_hourly
       WHERE metric_key = ? AND dimension_key = ? AND dimension_value = ?`,
    )
    .get(metricKey, dimensionKey, dimensionValue) as { count: number; bytes: number }
}

describe('admin stats backfill', () => {
  it('splits SQL batches without breaking quoted semicolons', () => {
    expect(splitSqlStatements("SELECT 'a;b'; SELECT 'it''s'; SELECT 3")).toEqual([
      "SELECT 'a;b'",
      "SELECT 'it''s'",
      'SELECT 3',
    ])
    expect(() => splitSqlStatements("SELECT 'unterminated")).toThrow('admin_stats_backfill_unterminated_sql_string')
  })

  it('recovers exact available facts into hourly rollups and is idempotent', () => {
    const db = createBackfillDatabase()
    db.exec(`
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

    const statements = splitSqlStatements(buildBackfillSql(new Date('2026-07-10T12:00:00.000Z')))
    expect(statements.length).toBeGreaterThan(1)
    const firstChanges = applyBackfill(db)
    const firstSummary = JSON.parse((db.prepare(VALIDATION_SQL).get() as { summary: string }).summary) as Record<
      string,
      number
    >
    const secondChanges = applyBackfill(db)

    expect(firstChanges).toBeGreaterThan(0)
    expect(secondChanges).toBe(0)
    expect(firstSummary).toMatchObject({
      orphanUserEvents: 0,
      missingUploadBytes: 0,
      missingDownloadBytes: 0,
      trafficEvents: 2,
      hourlyRollups: 2,
      rawActiveShares: 1,
      validActiveShares: 1,
      rawDownloadEvents: 2,
      rollupDownloadEvents: 2,
      rawDownloadBytes: 640,
      rollupDownloadBytes: 640,
    })
    expect(
      db.prepare("SELECT json_extract(metadata, '$.bytes') AS bytes FROM activity_events WHERE id = 'upload-1'").get(),
    ).toEqual({ bytes: 512 })
    expect(db.prepare("SELECT COUNT(*) AS value FROM activity_events WHERE target_id = 'img1'").get()).toEqual({
      value: 1,
    })
    db.close()
  })

  it('correlates a direct-share audit with its cloud report without creating a second hourly event', () => {
    const db = createBackfillDatabase()
    db.exec(`
      INSERT INTO matters VALUES ('f1', 512, 0);
      INSERT INTO shares VALUES ('s1', 'direct', 'f1', 'o1', 'active', NULL, 10, 1, 100);
      INSERT INTO activity_events VALUES
        ('share-1', 'o1', NULL, 'anonymous', NULL, 'share_download', 'share', 's1', 'file.bin',
          '{"anonymous":true}', 100);
      INSERT INTO cloud_traffic_reports VALUES
        ('r1', 'o1', 'direct_share', 's1', 'traffic-1', 512, NULL, NULL, NULL, 'reported', NULL, 100000, 100000);
    `)

    expect(readPlan(db).cloudEventsToRecover).toBe(0)
    applyBackfill(db)

    expect(
      db
        .prepare(`
          SELECT id, json_extract(metadata, '$.trafficEventId') AS trafficEventId,
            json_extract(metadata, '$.source') AS source, json_extract(metadata, '$.bytes') AS bytes
          FROM activity_events WHERE action = 'share_download'
        `)
        .all(),
    ).toEqual([{ id: 'share-1', trafficEventId: 'traffic-1', source: 'direct_share', bytes: 512 }])
    expect(readRollup(db, 'transfer.download_issued')).toEqual({ count: 1, bytes: 512 })
    expect(readRollup(db, 'transfer.download_issued', 'source', 'direct_share')).toEqual({ count: 1, bytes: 512 })
    expect(readRollup(db, 'share.download_issued')).toEqual({ count: 1, bytes: 512 })
    expect(readRollup(db, 'share.download_issued', 'source', 'direct_share')).toEqual({ count: 1, bytes: 512 })
    db.close()
  })

  it('removes only an owned direct-share duplicate, preserves synthetic-only traffic, and is idempotent', () => {
    const db = createBackfillDatabase()
    db.exec(`
      INSERT INTO matters VALUES ('f1', 512, 0);
      INSERT INTO shares VALUES ('s1', 'direct', 'f1', 'o1', 'active', NULL, NULL, 0, 100);
      INSERT INTO activity_events VALUES
        ('share-1', 'o1', NULL, 'anonymous', NULL, 'share_download', 'share', 's1', 'file.bin',
          '{"source":"direct_share","status":"issued","bytes":512}', 100),
        ('backfill_traffic-duplicate', 'o1', NULL, 'system', 'stats-backfill', 'share_download', 'share', 's1', 's1',
          '{"direction":"download","status":"issued","source":"direct_share","bytes":512,"trafficEventId":"traffic-duplicate","quality":"recovered_from_cloud_traffic_report"}', 100),
        ('backfill_traffic-synthetic', 'o1', NULL, 'system', 'stats-backfill', 'share_download', 'share',
          'synthetic-share', 'synthetic-share',
          '{"direction":"download","status":"issued","source":"direct_share","bytes":256,"trafficEventId":"traffic-synthetic","quality":"recovered_from_cloud_traffic_report"}', 200);
      INSERT INTO cloud_traffic_reports VALUES
        ('r1', 'o1', 'direct_share', 's1', 'traffic-duplicate', 512, NULL, NULL, NULL, 'reported', NULL, 100000, 100000),
        ('r2', 'o1', 'direct_share', 'synthetic-share', 'traffic-synthetic', 256, NULL, NULL, NULL, 'reported', NULL, 200000, 200000);
    `)

    expect(readPlan(db).syntheticDirectShareDuplicatesToRemove).toBe(1)
    expect(applyBackfill(db)).toBeGreaterThan(0)

    expect(readPlan(db).syntheticDirectShareDuplicatesToRemove).toBe(0)
    expect(db.prepare('SELECT id FROM activity_events ORDER BY id').all()).toEqual([
      { id: 'backfill_traffic-synthetic' },
      { id: 'share-1' },
    ])
    expect(
      db
        .prepare(
          "SELECT json_extract(metadata, '$.trafficEventId') AS trafficEventId FROM activity_events WHERE id = 'share-1'",
        )
        .get(),
    ).toEqual({ trafficEventId: 'traffic-duplicate' })
    expect(readRollup(db, 'transfer.download_issued')).toEqual({ count: 2, bytes: 768 })
    expect(readRollup(db, 'transfer.download_issued', 'source', 'direct_share')).toEqual({ count: 2, bytes: 768 })
    expect(readRollup(db, 'share.download_issued')).toEqual({ count: 2, bytes: 768 })
    expect(readRollup(db, 'share.download_issued', 'source', 'direct_share')).toEqual({ count: 2, bytes: 768 })
    expect(applyBackfill(db)).toBe(0)
    db.close()
  })

  it('keeps one logical event per cloud report across issued and blocked download sources', () => {
    const db = createBackfillDatabase()
    db.exec(`
      INSERT INTO activity_events VALUES
        ('landing-1', 'o1', NULL, 'anonymous', NULL, 'share_download', 'share', 'landing-share', 'landing-share',
          '{"source":"landing_share","status":"issued","bytes":100}', 100),
        ('object-1', 'o1', NULL, 'user', NULL, 'object_download', 'file', 'object-1', 'object-1',
          '{"source":"object_download","status":"issued","bytes":200}', 200),
        ('image-1', 'o1', NULL, 'anonymous', NULL, 'image_hosting_download', 'image', 'image-1', 'image-1',
          '{"source":"image_hosting","status":"issued","bytes":300,"trafficEventId":"traffic-image"}', 300),
        ('webdav-1', 'o1', NULL, 'user', NULL, 'webdav_download', 'file', 'webdav-1', 'webdav-1',
          '{"source":"webdav_download","status":"issued","bytes":400,"trafficEventId":"traffic-webdav"}', 400);
      INSERT INTO cloud_traffic_reports VALUES
        ('r1', 'o1', 'landing_share', 'landing-share', 'traffic-landing', 100, NULL, NULL, NULL, 'reported', NULL, 100000, 100000),
        ('r2', 'o1', 'object_download', 'object-1', 'traffic-object', 200, NULL, NULL, NULL, 'reported', NULL, 200000, 200000),
        ('r3', 'o1', 'image_hosting', 'image-1', 'traffic-image', 300, NULL, NULL, NULL, 'reported', NULL, 300000, 300000),
        ('r4', 'o1', 'webdav_download', 'webdav-1', 'traffic-webdav', 400, NULL, NULL, NULL, 'reported', NULL, 400000, 400000),
        ('r5', 'o1', 'object_download', 'blocked-1', 'traffic-blocked', 500, NULL, NULL, NULL, 'blocked', 'quota_exceeded', 500000, 500000);
    `)

    expect(readPlan(db).cloudEventsToRecover).toBe(1)
    applyBackfill(db)

    expect(readPlan(db).cloudEventsToRecover).toBe(0)
    expect(
      db
        .prepare(`
          SELECT COUNT(*) AS events,
            COUNT(DISTINCT json_extract(metadata, '$.trafficEventId')) AS trafficEvents
          FROM activity_events
          WHERE action IN (
            'share_download', 'object_download', 'image_hosting_download', 'webdav_download', 'download_failed'
          )
        `)
        .get(),
    ).toEqual({ events: 5, trafficEvents: 5 })
    expect(
      db
        .prepare(`
          SELECT action, json_extract(metadata, '$.status') AS status,
            json_extract(metadata, '$.reason') AS reason
          FROM activity_events WHERE id = 'backfill_traffic-blocked'
        `)
        .get(),
    ).toEqual({ action: 'download_failed', status: 'failed', reason: 'quota_exceeded' })
    expect(readRollup(db, 'transfer.download_issued')).toEqual({ count: 4, bytes: 1000 })
    expect(readRollup(db, 'transfer.download_issued', 'source', 'landing_share')).toEqual({ count: 1, bytes: 100 })
    expect(readRollup(db, 'transfer.download_issued', 'source', 'object_download')).toEqual({ count: 1, bytes: 200 })
    expect(readRollup(db, 'transfer.download_issued', 'source', 'image_hosting')).toEqual({ count: 1, bytes: 300 })
    expect(readRollup(db, 'transfer.download_issued', 'source', 'webdav_download')).toEqual({ count: 1, bytes: 400 })
    expect(readRollup(db, 'transfer.download_failed')).toEqual({ count: 1, bytes: 500 })
    expect(readRollup(db, 'transfer.download_failed', 'source', 'object_download')).toEqual({ count: 1, bytes: 500 })
    expect(readRollup(db, 'share.download_issued')).toEqual({ count: 1, bytes: 100 })
    expect(readRollup(db, 'share.download_issued', 'source', 'landing_share')).toEqual({ count: 1, bytes: 100 })
    db.close()
  })
})
