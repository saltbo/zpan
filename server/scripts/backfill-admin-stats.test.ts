import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import {
  assertBackfillValidation,
  buildBackfillSql,
  buildValidationSql,
  splitSqlStatements,
} from '../../scripts/backfill-admin-stats'
import {
  ADMIN_STATS_FACT_COUNTER_METRICS,
  buildAdminStatsCounterRowsSqlStatements,
} from '../adapters/repos/admin-stats-counter-query'

describe('admin stats backfill', () => {
  it('splits SQL batches without breaking quoted semicolons', () => {
    expect(splitSqlStatements("SELECT 'a;b'; SELECT 'it''s'; SELECT 3")).toEqual([
      "SELECT 'a;b'",
      "SELECT 'it''s'",
      'SELECT 3',
    ])
    expect(() => splitSqlStatements("SELECT 'unterminated")).toThrow('admin_stats_backfill_unterminated_sql_string')
  })

  it('rejects required dimension mismatches', () => {
    expect(() =>
      assertBackfillValidation({ requiredDimensionMismatchGroups: 1 } as Parameters<
        typeof assertBackfillValidation
      >[0]),
    ).toThrow('"requiredDimensionMismatchGroups":1')
    expect(() =>
      assertBackfillValidation({ lowerBoundRollups: 1 } as Parameters<typeof assertBackfillValidation>[0]),
    ).toThrow('"lowerBoundRollups":1')
  })

  it('builds one compound branch per authoritative counter source', () => {
    const statements = buildAdminStatsCounterRowsSqlStatements({ fromMs: 0, toMs: 3_600_000 })
    const sql = statements.join('\n')

    expect(statements).toHaveLength(3)
    expect(sql.match(/FROM audit_events ae/g)).toHaveLength(1)
    expect(sql.match(/FROM cloud_traffic_reports traffic_report/g)).toHaveLength(1)
    expect(sql.match(/FROM storage_usage_ledger storage_change/g)).toHaveLength(1)
    expect(sql).toContain('audit_events registered_user')
    expect(statements.every((statement) => (statement.match(/UNION ALL/g) ?? []).length <= 5)).toBe(true)

    const signupStatements = buildAdminStatsCounterRowsSqlStatements({
      fromMs: 0,
      toMs: 3_600_000,
      metrics: ['user.signup'],
    })
    expect(signupStatements).toHaveLength(1)
    expect(signupStatements[0]).toContain('audit_events registered_user')
    expect(signupStatements[0]).not.toContain('cloud_traffic_reports')
  })

  it('recovers exact available facts and is idempotent', () => {
    const db = new Database(':memory:')
    const now = new Date('2026-07-10T12:00:00.000Z')
    const historyStartMs = Date.parse('2026-04-01T00:10:00.000Z')
    const preExactSignupMs = Date.parse('2026-03-31T22:10:00.000Z')
    const eventMs = Date.parse('2026-07-10T09:10:00.000Z')
    const eventHourMs = Date.parse('2026-07-10T09:00:00.000Z')
    const sessionCreatedMs = Date.parse('2026-07-10T08:00:00.000Z')
    const sessionUpdatedMs = Date.parse('2026-07-10T10:20:00.000Z')
    const newerExistingActivityMs = Date.parse('2026-07-10T11:30:00.000Z')
    const snapshotObservedAt = '2026-07-10T09:50:00.000Z'
    const eventSec = Math.floor(eventMs / 1000)
    const currentHourMs = Date.parse('2026-07-10T12:00:00.000Z')
    const storageOpeningMs = Date.parse('2026-03-01T00:00:00.000Z')
    const currentEventSec = Math.floor(Date.parse('2026-07-10T12:10:00.000Z') / 1000)
    const latestClosedHour = Date.parse('2026-07-10T11:00:00.000Z')
    const firstExactHour = Math.ceil(historyStartMs / 3_600_000) * 3_600_000
    const expectedBuckets = (latestClosedHour - firstExactHour) / 3_600_000 + 1
    const signupFirstHour = Math.floor(preExactSignupMs / 3_600_000) * 3_600_000
    const expectedSignupBuckets = (latestClosedHour - signupFirstHour) / 3_600_000 + 1
    db.exec(`
      CREATE TABLE user (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL DEFAULT 0, last_active_at INTEGER);
      CREATE TABLE account (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, provider_id TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE session (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE organization (id TEXT PRIMARY KEY, metadata TEXT, created_at INTEGER NOT NULL);
      CREATE TABLE member (
        id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, user_id TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE TABLE matters (id TEXT PRIMARY KEY, size INTEGER, dirtype INTEGER);
      CREATE TABLE shares (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, matter_id TEXT NOT NULL, org_id TEXT NOT NULL,
        status TEXT NOT NULL, expires_at INTEGER, download_limit INTEGER, views INTEGER NOT NULL, downloads INTEGER NOT NULL,
        created_at INTEGER NOT NULL, creator_id TEXT
      );
      CREATE TABLE audit_events (
        id TEXT PRIMARY KEY, org_id TEXT NOT NULL, user_id TEXT, actor_type TEXT, actor_ref TEXT,
        action TEXT NOT NULL, target_type TEXT NOT NULL, target_id TEXT, target_name TEXT NOT NULL,
        metadata TEXT, created_at INTEGER NOT NULL
      );
      CREATE TABLE system_options (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '');
      CREATE TABLE cloud_traffic_reports (
        id TEXT PRIMARY KEY, org_id TEXT NOT NULL, period TEXT NOT NULL, source TEXT NOT NULL, source_id TEXT NOT NULL,
        event_id TEXT NOT NULL UNIQUE, bytes INTEGER NOT NULL, storage_id TEXT, unit_bytes INTEGER,
        credits_per_unit INTEGER, status TEXT NOT NULL, error TEXT, attempt_count INTEGER NOT NULL DEFAULT 0,
        next_retry_at INTEGER, issued_at INTEGER,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE object_upload_sessions (
        id TEXT PRIMARY KEY, org_id TEXT NOT NULL, storage_id TEXT NOT NULL,
        status TEXT NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE download_tasks (
        id TEXT PRIMARY KEY, org_id TEXT NOT NULL, category TEXT, source_type TEXT NOT NULL,
        assigned_downloader_id TEXT, status TEXT NOT NULL, billing_charged_bytes INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL, finished_at INTEGER, attempt INTEGER NOT NULL DEFAULT 1,
        created_by_user_id TEXT, runtime TEXT, events TEXT NOT NULL DEFAULT '[]',
        error_code TEXT, error_message TEXT, deleted_at INTEGER
      );
      CREATE TABLE background_jobs (
        id TEXT PRIMARY KEY, org_id TEXT NOT NULL, type TEXT NOT NULL, status TEXT NOT NULL,
        created_at INTEGER NOT NULL, finished_at INTEGER, user_id TEXT
      );
      CREATE TABLE remote_download_usage_reports (
        id TEXT PRIMARY KEY, org_id TEXT NOT NULL, downloader_id TEXT NOT NULL, status TEXT NOT NULL,
        unit_bytes INTEGER NOT NULL, credits_per_unit INTEGER NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE TABLE webhook_events (
        id TEXT PRIMARY KEY, status TEXT NOT NULL, created_at INTEGER NOT NULL, processed_at INTEGER
      );
      CREATE TABLE org_quotas (id TEXT PRIMARY KEY, used INTEGER NOT NULL);
      CREATE TABLE storage_usage_ledger (
        id TEXT PRIMARY KEY, event_key TEXT NOT NULL UNIQUE, org_id TEXT NOT NULL, storage_id TEXT NOT NULL,
        resource_type TEXT NOT NULL, resource_id TEXT NOT NULL, delta_bytes INTEGER NOT NULL, reason TEXT NOT NULL,
        occurred_at INTEGER NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE TABLE stats_rollups_hourly (
        id TEXT PRIMARY KEY, bucket_start INTEGER NOT NULL, org_id TEXT NOT NULL,
        metric_key TEXT NOT NULL, dimension_key TEXT NOT NULL, dimension_value TEXT NOT NULL,
        count INTEGER NOT NULL, bytes INTEGER NOT NULL, unique_count INTEGER NOT NULL,
        metadata TEXT, updated_at INTEGER NOT NULL,
        UNIQUE(bucket_start, org_id, metric_key, dimension_key, dimension_value)
      );

      INSERT INTO user VALUES
        ('u0', 0, ${newerExistingActivityMs}),
        ('u3', ${preExactSignupMs}, NULL),
        ('u1', ${firstExactHour + 600_000}, NULL),
        ('u2', ${firstExactHour + 601_000}, NULL);
      INSERT INTO account VALUES
        ('a3', 'u3', 'google', ${preExactSignupMs}),
        ('a1', 'u1', 'github', ${firstExactHour + 600_000}),
        ('a2', 'u2', 'github', ${firstExactHour + 601_000});
      INSERT INTO session VALUES
        ('session-u0', 'u0', ${sessionCreatedMs}, ${eventHourMs}),
        ('session-u1', 'u1', ${sessionCreatedMs}, ${sessionCreatedMs + 1_800_000}),
        ('session-u2', 'u2', ${sessionCreatedMs}, ${sessionUpdatedMs});
      INSERT INTO organization VALUES
        ('o1', '{"type":"personal"}', ${historyStartMs}),
        ('o2', '{"type":"personal"}', ${historyStartMs + 1000});
      INSERT INTO member VALUES
        ('m1', 'o1', 'u1', ${historyStartMs}),
        ('m2', 'o2', 'u2', ${historyStartMs + 1000});
      INSERT INTO matters VALUES ('f1', 512, 0);
      INSERT INTO shares VALUES ('s1', 'landing', 'f1', 'o1', 'active', NULL, 10, 0, 1, ${eventSec}, 'u1');
      INSERT INTO audit_events VALUES
        ('audit:statistics_source_initialized:v3-authoritative-sources', '', NULL, 'system', 'statistics-integrity', 'statistics_source_initialized', 'statistics', 'v3-authoritative-sources', 'statistics source', '{"schemaVersion":3}', ${Math.floor(historyStartMs / 1000)}),
        ('upload-1', 'o1', 'u1', NULL, NULL, 'upload_confirm', 'file', 'f1', 'file.bin',
          '{"bytes":512,"source":"upload","status":"success"}', ${eventSec}),
        ('legacy-incomplete-upload', 'o1', 'u1', NULL, NULL, 'upload_confirm', 'file', 'f1', 'file.bin',
          NULL, ${Math.floor(historyStartMs / 1000) - 60}),
        ('legacy-user-access', 'o1', 'u1', 'user', NULL, 'user_access', 'user', 'u1', 'u1',
          '{"bucketStart":${eventHourMs}}', ${eventSec}),
        ('open-upload', 'o1', 'u1', 'user', NULL, 'upload_confirm', 'file', 'f1', 'file.bin',
          '{"bytes":512,"source":"upload","status":"success"}', ${currentEventSec}),
        ('share-1', 'o1', NULL, NULL, NULL, 'share_download', 'share', 's1', 'file.bin',
          '{"bytes":512,"shareId":"s1","source":"direct_share","trafficEventId":"traffic-1","anonymous":true}', ${eventSec}),
        ('image-1', 'o1', NULL, NULL, NULL, 'image_hosting_download', 'image', 'img1', 'image.png', NULL, ${eventSec}),
        ('blocked-download', 'o1', 'u1', 'user', NULL, 'download_failed', 'file', 'f1', 'file.bin',
          '{"bytes":512,"source":"object_download","reason":"quota_exceeded","trafficEventId":"traffic-3"}', ${eventSec}),
        ('legacy-downloader', 'o1', 'downloader:d1', 'user', NULL, 'create', 'file', 'f1', 'file.bin', NULL, ${eventSec}),
        ('legacy-api-key', 'o1', 'api-key:k1', 'user', NULL, 'download_task_created', 'remote_download', 't1', 'task', NULL, ${eventSec}),
        ('legacy-task-completed', 'o1', NULL, 'system', 'legacy-download-task-worker', 'download_task_completed', 'remote_download', 't1', 'task',
          '{"category":"video","outcome":"completed","bytes":512}', ${eventSec}),
        ('legacy-cloud-customer', 'o1', 'cloud-customer-1', 'user', NULL, 'quota_order_increase', 'quota', 'o1', 'o1', NULL, ${eventSec});
      INSERT INTO cloud_traffic_reports (
        id, org_id, period, source, source_id, event_id, bytes, storage_id, unit_bytes, credits_per_unit,
        status, error, attempt_count, next_retry_at, issued_at, created_at, updated_at
      ) VALUES
        ('r1', 'o1', '2026-07', 'direct_share', 's1', 'traffic-1', 512, NULL, NULL, NULL, 'reported', NULL, 0, NULL, NULL, ${eventMs}, ${eventMs}),
        ('r2', 'o1', '2026-07', 'image_hosting', 'img1', 'traffic-2', 128, NULL, NULL, NULL, 'reported', NULL, 0, NULL, NULL, ${eventMs}, ${eventMs}),
        ('r3', 'o1', '2026-07', 'object_download', 'f1', 'traffic-3', 512, NULL, NULL, NULL, 'blocked', 'quota_exceeded', 0, NULL, NULL, ${eventMs}, ${eventMs});
      INSERT INTO download_tasks (id, org_id, category, source_type, assigned_downloader_id, status, billing_charged_bytes, created_at, finished_at) VALUES
        ('t1', 'o1', 'video', 'url', 'd1', 'completed', 512, ${eventMs}, ${eventMs}),
        ('t2', 'o1', NULL, 'url', NULL, 'canceled', 0, ${eventMs}, ${eventMs});
      INSERT INTO org_quotas VALUES ('q1', 512);
      INSERT INTO storage_usage_ledger VALUES
        ('ledger-opening', 'opening:complete', '', '', 'storage', 'global', 0, 'opening_balance_complete',
          ${storageOpeningMs}, ${storageOpeningMs}),
        ('ledger-before-stats', 'matter:before-stats', 'o1', 'storage-1', 'matter', 'before-stats', 700, 'matter_activated',
          ${historyStartMs + 600_000}, ${historyStartMs + 600_000}),
        ('ledger-written', 'matter:written', 'o1', 'storage-1', 'matter', 'written', 600, 'matter_activated',
          ${eventMs}, ${eventMs}),
        ('ledger-released', 'matter:released', 'o1', 'storage-1', 'matter', 'released', -100, 'matter_purged',
          ${eventMs + 1000}, ${eventMs + 1000});
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
          '{"version":3,"scope":"snapshots","quality":"exact","observedAt":"${snapshotObservedAt}"}', ${eventMs}),
        ('orphan-snapshot-gauge', ${eventHourMs - 3_600_000}, '', 'storage.used', '', '', 0, 256, 0,
          '{"version":3,"scope":"snapshots","quality":"exact","observedAt":"${snapshotObservedAt}"}', ${eventMs}),
        ('preopening-user-activity', ${historyStartMs - 3_600_000}, '', 'user.active_snapshot', 'window', 'mau', 57, 0, 0,
          '{"version":3,"scope":"snapshots","quality":"exact","observedAt":"${snapshotObservedAt}"}', ${eventMs});
    `)

    const sql = buildBackfillSql(now)
    const validationSql = buildValidationSql(now)
    const readValidationSummary = () =>
      Object.assign(
        {},
        ...splitSqlStatements(validationSql).map((statement) =>
          JSON.parse((db.prepare(statement).get() as { summary: string }).summary),
        ),
      ) as Record<string, number>
    const statements = splitSqlStatements(sql)
    expect(statements.length).toBeGreaterThan(1)
    db.transaction(() =>
      statements.forEach((statement) => {
        db.exec(statement)
      }),
    )()
    const firstSummary = readValidationSummary()
    const firstRows = db.prepare('SELECT * FROM stats_rollups_hourly ORDER BY id').all()
    const metricList = ADMIN_STATS_FACT_COUNTER_METRICS.map((metric) => `'${metric}'`).join(', ')
    const calculatedFactRows = [
      ...buildAdminStatsCounterRowsSqlStatements({
        fromMs: firstExactHour,
        toMs: currentHourMs,
        metrics: ADMIN_STATS_FACT_COUNTER_METRICS.filter((metric) => metric !== 'user.signup'),
      }).flatMap((statement) => db.prepare(statement).all()),
      ...buildAdminStatsCounterRowsSqlStatements({
        fromMs: signupFirstHour,
        toMs: currentHourMs,
        metrics: ['user.signup'],
      }).flatMap((statement) => db.prepare(statement).all()),
    ].sort(compareCounterRows)
    const backfilledFactRows = db
      .prepare(
        `SELECT
          bucket_start AS bucketStart,
          org_id AS orgId,
          metric_key AS metricKey,
          dimension_key AS dimensionKey,
          dimension_value AS dimensionValue,
          count,
          bytes,
          unique_count AS uniqueCount
        FROM stats_rollups_hourly
        WHERE metric_key IN (${metricList})
        ORDER BY bucket_start, org_id, metric_key, dimension_key, dimension_value`,
      )
      .all()

    expect(backfilledFactRows).toEqual(calculatedFactRows)

    db.transaction(() =>
      statements.forEach((statement) => {
        db.exec(statement)
      }),
    )()
    const secondRows = db.prepare('SELECT * FROM stats_rollups_hourly ORDER BY id').all()

    expect(firstRows.length).toBeGreaterThan(0)
    expect(secondRows).toEqual(firstRows)
    expect(firstSummary).toMatchObject({
      missingUploadBytes: 0,
      missingDownloadBytes: 0,
      invalidAuditEvents: 0,
      trafficEvents: 3,
      hourlyRollups: expectedBuckets,
      rawActiveShares: 1,
      validActiveShares: 1,
      legacyRollupRows: 0,
      incompatibleUserSnapshotRows: 0,
      counterExpectedBuckets: expectedBuckets,
      counterCompletedBuckets: expectedBuckets,
      counterMissingBuckets: 0,
      signupExpectedBuckets: expectedSignupBuckets,
      signupCompletedBuckets: expectedSignupBuckets,
      signupMissingBuckets: 0,
      openCounterMarkers: 0,
      requiredDimensionMismatchGroups: 0,
      userSignupProviderMismatchGroups: 0,
      orphanRollupBuckets: 0,
      lowerBoundRollups: 0,
      rawUploadAttempts: 1,
      rollupUploadAttempts: 1,
      rawUserSignups: 3,
      rollupUserSignups: 3,
      rawSharesCreated: 1,
      rollupSharesCreated: 1,
      rawFailedDownloads: 1,
      rollupFailedDownloads: 1,
      rawShareDownloads: 1,
      rollupShareDownloads: 1,
      rawFinishedDownloadTasks: 2,
      rollupFinishedDownloadTasks: 2,
      rawMissingByteEvents: 0,
      rollupMissingByteEvents: 0,
      rawStorageWrittenBytes: 600,
      rollupStorageWrittenBytes: 600,
      rawStorageReleasedBytes: 100,
      rollupStorageReleasedBytes: 100,
    })
    expect(db.prepare("SELECT metadata FROM audit_events WHERE id = 'legacy-incomplete-upload'").get()).toEqual({
      metadata: null,
    })
    expect(db.prepare("SELECT issued_at AS issuedAt FROM cloud_traffic_reports WHERE id = 'r1'").get()).toEqual({
      issuedAt: eventMs,
    })
    expect(db.prepare("SELECT issued_at AS issuedAt FROM cloud_traffic_reports WHERE id = 'r2'").get()).toEqual({
      issuedAt: null,
    })
    expect(db.prepare("SELECT COUNT(*) AS value FROM audit_events WHERE target_id = 'img1'").get()).toEqual({
      value: 1,
    })
    expect(db.prepare("SELECT COUNT(*) AS value FROM audit_events WHERE id = 'backfill_traffic-3'").get()).toEqual({
      value: 0,
    })
    expect(db.prepare("SELECT last_active_at AS lastActiveAt FROM user WHERE id = 'u1'").get()).toEqual({
      lastActiveAt: eventSec * 1000,
    })
    expect(db.prepare("SELECT last_active_at AS lastActiveAt FROM user WHERE id = 'u2'").get()).toEqual({
      lastActiveAt: sessionUpdatedMs,
    })
    expect(db.prepare("SELECT last_active_at AS lastActiveAt FROM user WHERE id = 'u0'").get()).toEqual({
      lastActiveAt: newerExistingActivityMs,
    })
    expect(db.prepare("SELECT COUNT(*) AS value FROM audit_events WHERE action = 'user_access'").get()).toEqual({
      value: 0,
    })
    expect(
      db.prepare("SELECT COUNT(*) AS value FROM audit_events WHERE action = 'download_task_completed'").get(),
    ).toEqual({ value: 0 })
    expect(
      db
        .prepare(
          "SELECT json_extract(task_event.value, '$.to') AS status FROM download_tasks task JOIN json_each(task.events) task_event WHERE task.id = 't1'",
        )
        .get(),
    ).toEqual({ status: 'completed' })
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
    ).toEqual({ counterQuality: 'exact', snapshotQuality: 'exact', snapshotObservedAt })
    expect(db.prepare('SELECT COUNT(*) AS value FROM stats_rollups_hourly WHERE bucket_start = 0').get()).toEqual({
      value: 0,
    })
    expect(
      db.prepare("SELECT COUNT(*) AS value FROM stats_rollups_hourly WHERE id = 'orphan-snapshot-gauge'").get(),
    ).toEqual({ value: 0 })
    expect(
      db.prepare("SELECT COUNT(*) AS value FROM stats_rollups_hourly WHERE id = 'preopening-user-activity'").get(),
    ).toEqual({ value: 0 })
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
      db
        .prepare(
          "SELECT count AS value FROM stats_rollups_hourly WHERE metric_key = 'user.signup' AND dimension_key = 'provider' AND dimension_value = 'google'",
        )
        .get(),
    ).toEqual({ value: 1 })
    expect(
      db.prepare("SELECT COUNT(*) AS value FROM stats_rollups_hourly WHERE metric_key = 'traffic.report_sync'").get(),
    ).toEqual({
      value: 0,
    })
    expect(
      db
        .prepare(
          "SELECT COUNT(*) AS value FROM audit_events WHERE actor_ref IN ('stats-backfill', 'statistics-backfill')",
        )
        .get(),
    ).toEqual({ value: 0 })

    db.exec(`
      INSERT INTO stats_rollups_hourly VALUES
        ('current-snapshot-marker', ${currentHourMs}, '', 'stats.rollup_run', '', '', 1, 0, 0,
          '{"version":3,"scope":"snapshots","quality":"exact"}', ${currentHourMs}),
        ('current-snapshot-gauge', ${currentHourMs}, '', 'storage.used', '', '', 0, 1024, 0,
          '{"version":3,"scope":"snapshots","quality":"exact"}', ${currentHourMs});
    `)
    const snapshotSummary = readValidationSummary()
    expect(snapshotSummary.orphanRollupBuckets).toBe(0)
    expect(snapshotSummary.requiredDimensionMismatchGroups).toBe(0)

    db.exec(`
      INSERT INTO stats_rollups_hourly VALUES
        ('current-share-lifecycle', ${currentHourMs}, 'o1', 'share.inventory', 'lifecycle', 'usable', 3, 0, 0,
          '{"version":3,"scope":"snapshots","quality":"exact"}', ${currentHourMs});
    `)
    expect(readValidationSummary().requiredDimensionMismatchGroups).toBe(1)

    db.exec(`
      INSERT INTO stats_rollups_hourly VALUES
        ('current-share-base', ${currentHourMs}, 'o1', 'share.inventory', '', '', 3, 0, 0,
          '{"version":3,"scope":"snapshots","quality":"exact"}', ${currentHourMs});
    `)
    expect(readValidationSummary().requiredDimensionMismatchGroups).toBe(0)

    db.prepare("DELETE FROM stats_rollups_hourly WHERE id = 'current-share-lifecycle'").run()
    expect(readValidationSummary().requiredDimensionMismatchGroups).toBe(1)
    db.prepare("UPDATE stats_rollups_hourly SET count = 2 WHERE id = 'current-share-base'").run()
    db.exec(`
      INSERT INTO stats_rollups_hourly VALUES
        ('current-share-lifecycle', ${currentHourMs}, 'o1', 'share.inventory', 'lifecycle', 'usable', 3, 0, 0,
          '{"version":3,"scope":"snapshots","quality":"exact"}', ${currentHourMs});
    `)
    expect(readValidationSummary().requiredDimensionMismatchGroups).toBe(1)
    db.prepare("UPDATE stats_rollups_hourly SET count = 3 WHERE id = 'current-share-base'").run()
    expect(readValidationSummary().requiredDimensionMismatchGroups).toBe(0)

    db.exec(`
      INSERT INTO stats_rollups_hourly VALUES
        ('current-traffic-base', ${currentHourMs}, '', 'traffic.report_snapshot', '', '', 1, 10, 0,
          '{"version":3,"scope":"snapshots","quality":"exact"}', ${currentHourMs}),
        ('current-traffic-status', ${currentHourMs}, '', 'traffic.report_snapshot', 'status', 'reported', 1, 9, 0,
          '{"version":3,"scope":"snapshots","quality":"exact"}', ${currentHourMs});
    `)
    expect(readValidationSummary().requiredDimensionMismatchGroups).toBe(1)
    db.prepare("UPDATE stats_rollups_hourly SET bytes = 10 WHERE id = 'current-traffic-status'").run()
    expect(readValidationSummary().requiredDimensionMismatchGroups).toBe(0)

    db.prepare("DELETE FROM stats_rollups_hourly WHERE id = 'current-snapshot-marker'").run()
    const missingMarkerSummary = readValidationSummary()
    expect(missingMarkerSummary.orphanRollupBuckets).toBe(1)

    db.close()
  })
})

function compareCounterRows(left: unknown, right: unknown): number {
  const keys = ['bucketStart', 'orgId', 'metricKey', 'dimensionKey', 'dimensionValue'] as const
  const leftRow = left as Record<(typeof keys)[number], string | number>
  const rightRow = right as Record<(typeof keys)[number], string | number>
  for (const key of keys) {
    const comparison = String(leftRow[key]).localeCompare(String(rightRow[key]))
    if (comparison !== 0) return comparison
  }
  return 0
}
