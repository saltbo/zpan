import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { BACKFILL_PLAN_SQL, buildBackfillSql, VALIDATION_SQL } from '../../scripts/backfill-admin-stats'

interface DashboardStats {
  requestCount: number
  downloadBytes: number
  sourceBreakdown: Record<string, { bytes: number; requests: number }>
  sharing: { downloads: number; sourceBreakdown: Record<string, number> }
}

function createBackfillDatabase(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE user (id TEXT PRIMARY KEY);
    CREATE TABLE matters (id TEXT PRIMARY KEY, size INTEGER, dirtype INTEGER);
    CREATE TABLE shares (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, matter_id TEXT NOT NULL,
      status TEXT NOT NULL, expires_at INTEGER, download_limit INTEGER, downloads INTEGER NOT NULL
    );
    CREATE TABLE activity_events (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL, user_id TEXT, actor_type TEXT, actor_ref TEXT,
      action TEXT NOT NULL, target_type TEXT NOT NULL, target_id TEXT, target_name TEXT NOT NULL,
      metadata TEXT, created_at INTEGER NOT NULL
    );
    CREATE TABLE cloud_traffic_reports (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL, source TEXT NOT NULL, source_id TEXT NOT NULL,
      event_id TEXT NOT NULL UNIQUE, bytes INTEGER NOT NULL, status TEXT NOT NULL, error TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE org_quotas (id TEXT PRIMARY KEY, used INTEGER NOT NULL);
    CREATE TABLE stats_rollups_daily (
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
  const sql = buildBackfillSql(new Date('2026-07-10T12:00:00.000Z'))
  db.transaction(() => db.exec(sql))()
  const after = db.prepare('SELECT total_changes() AS value').get() as { value: number }
  return after.value - before.value
}

function readPlan(db: Database.Database): Record<string, number> {
  const row = db.prepare(BACKFILL_PLAN_SQL).get() as { summary: string }
  return JSON.parse(row.summary) as Record<string, number>
}

function readDashboardEquivalentStats(db: Database.Database): DashboardStats {
  const activityRows = db
    .prepare(`
      SELECT action, metadata
      FROM activity_events
      WHERE action IN (
        'share_download', 'object_download', 'image_hosting_download', 'webdav_download', 'download_failed'
      )
    `)
    .all() as Array<{ action: string; metadata: string }>
  const cloudRows = db
    .prepare('SELECT source, event_id AS eventId, bytes, status FROM cloud_traffic_reports')
    .all() as Array<{ source: string; eventId: string; bytes: number; status: string }>
  const parsedActivity = activityRows.map((row) => ({
    action: row.action,
    metadata: JSON.parse(row.metadata) as Record<string, unknown>,
  }))
  const coveredTrafficIds = new Set(
    parsedActivity
      .map((row) => row.metadata.trafficEventId)
      .filter((trafficEventId): trafficEventId is string => typeof trafficEventId === 'string'),
  )
  const issuedActivity = parsedActivity.filter((row) => row.action !== 'download_failed')
  const failedActivity = parsedActivity.filter((row) => row.action === 'download_failed')
  const uncoveredCloud = cloudRows.filter((row) => !coveredTrafficIds.has(row.eventId))
  const issuedCloud = uncoveredCloud.filter((row) => row.status !== 'blocked')
  const sourceBreakdown: DashboardStats['sourceBreakdown'] = {}

  for (const row of issuedActivity) {
    const source = String(row.metadata.source)
    const item = sourceBreakdown[source] ?? { bytes: 0, requests: 0 }
    item.bytes += Number(row.metadata.bytes)
    item.requests += 1
    sourceBreakdown[source] = item
  }
  for (const row of issuedCloud) {
    const item = sourceBreakdown[row.source] ?? { bytes: 0, requests: 0 }
    item.bytes += row.bytes
    item.requests += 1
    sourceBreakdown[row.source] = item
  }

  const sharingRows = issuedActivity.filter((row) => row.action === 'share_download')
  const sharingSources: Record<string, number> = {}
  for (const row of sharingRows) {
    const source = String(row.metadata.source)
    sharingSources[source] = (sharingSources[source] ?? 0) + 1
  }

  return {
    requestCount: issuedActivity.length + failedActivity.length + uncoveredCloud.length,
    downloadBytes:
      issuedActivity.reduce((sum, row) => sum + Number(row.metadata.bytes), 0) +
      issuedCloud.reduce((sum, row) => sum + row.bytes, 0),
    sourceBreakdown,
    sharing: { downloads: sharingRows.length, sourceBreakdown: sharingSources },
  }
}

describe('admin stats backfill', () => {
  it('enriches a direct-share audit without double-counting its cloud report and is idempotent', () => {
    const db = createBackfillDatabase()
    db.exec(`
      INSERT INTO user VALUES ('u1');
      INSERT INTO matters VALUES ('f1', 512, 0);
      INSERT INTO shares VALUES ('s1', 'direct', 'f1', 'active', NULL, 10, 1);
      INSERT INTO activity_events VALUES
        ('upload-1', 'o1', 'u1', NULL, NULL, 'upload_confirm', 'file', 'f1', 'file.bin', NULL, 1),
        ('share-1', 'o1', NULL, NULL, NULL, 'share_download', 'share', 's1', 'file.bin',
          '{"anonymous":true}', 100);
      INSERT INTO cloud_traffic_reports VALUES
        ('r1', 'o1', 'direct_share', 's1', 'traffic-1', 512, 'reported', NULL, 100000);
      INSERT INTO org_quotas VALUES ('q1', 512);
    `)

    expect(readPlan(db).cloudEventsToRecover).toBe(0)
    const firstChanges = applyBackfill(db)
    const firstSummary = JSON.parse((db.prepare(VALIDATION_SQL).get() as { summary: string }).summary) as Record<
      string,
      number
    >
    const secondChanges = applyBackfill(db)

    expect(firstChanges).toBeGreaterThan(0)
    expect(secondChanges).toBe(0)
    expect(readPlan(db).cloudEventsToRecover).toBe(0)
    expect(firstSummary).toMatchObject({
      orphanUserEvents: 0,
      missingUploadBytes: 0,
      missingDownloadBytes: 0,
      trafficEvents: 1,
      storageRollups: 1,
      rawActiveShares: 1,
      validActiveShares: 1,
    })
    expect(
      db.prepare("SELECT json_extract(metadata, '$.bytes') AS bytes FROM activity_events WHERE id = 'upload-1'").get(),
    ).toEqual({ bytes: 512 })
    expect(
      db
        .prepare(`
          SELECT
            json_extract(metadata, '$.trafficEventId') AS trafficEventId,
            json_extract(metadata, '$.source') AS source,
            json_extract(metadata, '$.bytes') AS bytes
          FROM activity_events WHERE id = 'share-1'
        `)
        .get(),
    ).toEqual({ trafficEventId: 'traffic-1', source: 'direct_share', bytes: 512 })
    expect(readDashboardEquivalentStats(db)).toEqual({
      requestCount: 1,
      downloadBytes: 512,
      sourceBreakdown: { direct_share: { bytes: 512, requests: 1 } },
      sharing: { downloads: 1, sourceBreakdown: { direct_share: 1 } },
    })
    db.close()
  })

  it('removes an obsolete direct-share synthetic duplicate but preserves a synthetic-only event', () => {
    const db = createBackfillDatabase()
    db.exec(`
      INSERT INTO matters VALUES ('f1', 512, 0);
      INSERT INTO shares VALUES ('s1', 'direct', 'f1', 'active', NULL, NULL, 0);
      INSERT INTO activity_events VALUES
        ('share-1', 'o1', NULL, 'anonymous', NULL, 'share_download', 'share', 's1', 'file.bin',
          '{"source":"direct_share","status":"issued","bytes":512}', 100),
        ('backfill_traffic-duplicate', 'o1', NULL, 'system', 'stats-backfill', 'share_download', 'share', 's1', 's1',
          '{"direction":"download","status":"issued","source":"direct_share","bytes":512,"trafficEventId":"traffic-duplicate","quality":"recovered_from_cloud_traffic_report"}', 100),
        ('backfill_traffic-synthetic', 'o1', NULL, 'system', 'stats-backfill', 'share_download', 'share',
          'synthetic-share', 'synthetic-share',
          '{"direction":"download","status":"issued","source":"direct_share","bytes":256,"trafficEventId":"traffic-synthetic","quality":"recovered_from_cloud_traffic_report"}', 200);
      INSERT INTO cloud_traffic_reports VALUES
        ('r1', 'o1', 'direct_share', 's1', 'traffic-duplicate', 512, 'reported', NULL, 100000),
        ('r2', 'o1', 'direct_share', 'synthetic-share', 'traffic-synthetic', 256, 'reported', NULL, 200000);
    `)

    expect(readPlan(db).syntheticDirectShareDuplicatesToRemove).toBe(1)
    applyBackfill(db)

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
    expect(readDashboardEquivalentStats(db)).toMatchObject({
      requestCount: 2,
      downloadBytes: 768,
      sourceBreakdown: {
        direct_share: { bytes: 768, requests: 2 },
      },
      sharing: { downloads: 2, sourceBreakdown: { direct_share: 2 } },
    })
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
        ('r1', 'o1', 'landing_share', 'landing-share', 'traffic-landing', 100, 'reported', NULL, 100000),
        ('r2', 'o1', 'object_download', 'object-1', 'traffic-object', 200, 'reported', NULL, 200000),
        ('r3', 'o1', 'image_hosting', 'image-1', 'traffic-image', 300, 'reported', NULL, 300000),
        ('r4', 'o1', 'webdav_download', 'webdav-1', 'traffic-webdav', 400, 'reported', NULL, 400000),
        ('r5', 'o1', 'object_download', 'blocked-1', 'traffic-blocked', 500, 'blocked', 'quota_exceeded', 500000);
    `)

    expect(readPlan(db).cloudEventsToRecover).toBe(1)
    applyBackfill(db)

    expect(readPlan(db).cloudEventsToRecover).toBe(0)
    expect(
      db
        .prepare(`
          SELECT
            COUNT(*) AS events,
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
    expect(readDashboardEquivalentStats(db)).toEqual({
      requestCount: 5,
      downloadBytes: 1000,
      sourceBreakdown: {
        landing_share: { bytes: 100, requests: 1 },
        object_download: { bytes: 200, requests: 1 },
        image_hosting: { bytes: 300, requests: 1 },
        webdav_download: { bytes: 400, requests: 1 },
      },
      sharing: { downloads: 1, sourceBreakdown: { landing_share: 1 } },
    })
    db.close()
  })
})
