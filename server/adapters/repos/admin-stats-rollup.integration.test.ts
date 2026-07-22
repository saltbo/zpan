import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import {
  ADMIN_STATS_METRIC_REGISTRY,
  assertMetricDimension,
  ADMIN_STATS_METRICS as M,
  metricDefinition,
} from '../../domain/admin-stats-metrics'
import { adminHeaders, createTestApp } from '../../test/setup.js'
import { createAdminStatsRepo } from './admin-stats'
import { ADMIN_STATS_FACT_COUNTER_METRICS } from './admin-stats-counter-query'
import { AdminStatsHourlyReader } from './admin-stats-hourly'
import { ensureAdminStatsIntegrityOpening } from './admin-stats-integrity'
import {
  ADMIN_STATS_ROLLUP_WRITE_BATCH_SIZE,
  captureAdminStatsSnapshot,
  rebuildAdminStatsHour,
} from './admin-stats-rollup'
import { createCloudTrafficReportRepo } from './cloud-traffic-report'

type RollupRow = {
  orgId: string
  metric: string
  dimensionKey: string
  dimensionValue: string
  count: number
  bytes: number
  uniqueCount: number
  metadata: string
}

describe('admin hourly stats rollup', () => {
  it('routes every fact counter through the shared hourly and backfill calculator', () => {
    const internalMetrics = new Set<string>([M.statsMissingBytes, M.statsRollupRun])
    const expected = Object.entries(ADMIN_STATS_METRIC_REGISTRY)
      .filter(([metric, definition]) => definition.kind === 'counter' && !internalMetrics.has(metric))
      .map(([metric]) => metric)

    expect(new Set(ADMIN_STATS_FACT_COUNTER_METRICS)).toEqual(new Set(expected))
  })

  it('keeps each insert within the D1 bound-parameter limit', () => {
    expect(ADMIN_STATS_ROLLUP_WRITE_BATCH_SIZE).toBe(9)
    expect(ADMIN_STATS_ROLLUP_WRITE_BATCH_SIZE * 11).toBeLessThanOrEqual(100)
  })

  it('rebuilds event, user, operational, and snapshot metrics idempotently', async () => {
    const { app, db } = await createTestApp()
    await adminHeaders(app)
    const [{ id: orgId }] = await db.all<{ id: string }>(
      sql`SELECT id FROM organization WHERE metadata LIKE '%"type":"personal"%' LIMIT 1`,
    )
    const [{ id: userId }] = await db.all<{ id: string }>(sql`SELECT id FROM user LIMIT 1`)
    const bucketStart = new Date('2026-07-10T12:00:00.000Z')
    const generatedAt = new Date('2026-07-10T12:30:00.000Z')
    const atMs = bucketStart.getTime() + 60_000
    const atSec = Math.floor(atMs / 1000)

    await ensureAdminStatsIntegrityOpening(db, new Date(bucketStart.getTime() - 60_000))
    await createCloudTrafficReportRepo(db).ensureLedgerOpening(new Date(bucketStart.getTime() - 60_000))

    await db.run(
      sql`UPDATE user SET created_at = ${atMs}, updated_at = ${atMs}, last_active_at = ${atMs} WHERE id = ${userId}`,
    )
    await db.run(sql`UPDATE account SET created_at = ${atMs}, updated_at = ${atMs} WHERE user_id = ${userId}`)
    await db.run(sql`
      UPDATE audit_events
      SET created_at = ${atSec}, metadata = '{"provider":"credential"}'
      WHERE id = ${`event:user_register:${userId}`}
    `)
    await db.run(sql`UPDATE session SET created_at = ${atMs}, updated_at = ${atMs} WHERE user_id = ${userId}`)
    await db.run(sql`UPDATE organization SET created_at = ${atMs}, updated_at = ${atMs} WHERE id = ${orgId}`)
    await db.run(sql`
      INSERT INTO user (id, name, email, email_verified, last_active_at, created_at, updated_at)
      VALUES ('rollup-direct-user', 'Direct User', 'direct@example.com', 1, ${atMs}, ${atMs}, ${atMs})
    `)
    await db.run(sql`
      INSERT INTO session (id, expires_at, token, created_at, updated_at, user_id)
      VALUES ('rollup-direct-session', ${atMs + 86_400_000}, 'rollup-direct-session', ${atMs}, ${atMs}, 'rollup-direct-user')
    `)
    await db.run(sql`
      INSERT INTO organization (id, name, slug, metadata, created_at, updated_at)
      VALUES ('rollup-team', 'Rollup Team', 'rollup-team', '{"type":"team"}', ${atMs}, ${atMs})
    `)
    await db.run(sql`
      UPDATE org_quotas
      SET used = 1300, quota = 1000, traffic_used = 300, traffic_quota = 2000
      WHERE org_id = ${orgId}
    `)
    await db.run(sql`
      UPDATE org_quota_entitlements
      SET bytes = 1000, starts_at = ${atMs}
      WHERE org_id = ${orgId} AND resource_type = 'storage' AND source = 'free_plan' AND status = 'active'
    `)
    await db.run(sql`
      INSERT INTO org_quotas (id, org_id, quota, used, traffic_quota, traffic_used, traffic_period)
      VALUES ('rollup-orphan-quota', 'deleted-org', 999999, 999999, 0, 0, '2026-07')
    `)
    await db.run(sql`
      INSERT INTO storages
        (id, bucket, endpoint, region, access_key, secret_key, file_path, custom_host, capacity, used, status, created_at, updated_at)
      VALUES
        ('rollup-storage', 'bucket', 'https://s3.example', 'auto', 'AK', 'SK', '', '', 1000, 500, 'active', ${atSec}, ${atSec}),
        ('rollup-storage-disabled', 'bucket-2', 'https://s3.example', 'auto', 'AK', 'SK', '', '', 1000, 900, 'disabled', ${atSec}, ${atSec})
    `)
    await db.run(sql`
      INSERT INTO matters
        (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, trashed_at, created_at, updated_at)
      VALUES
        ('rollup-file', ${orgId}, 'rollup-file', 'video.mp4', 'video/mp4', 200, 0, '', 'video.mp4', 'rollup-storage', 'active', NULL, ${atSec}, ${atSec}),
        ('rollup-dir', ${orgId}, 'rollup-dir', 'folder', '', 0, 1, '', '', 'rollup-storage', 'active', NULL, ${atSec}, ${atSec}),
        ('rollup-trashed', ${orgId}, 'rollup-trashed', 'old.bin', 'application/octet-stream', 800, 0, '', 'old.bin', 'rollup-storage', 'active', ${atMs}, ${atSec}, ${atSec})
    `)
    await db.run(sql`
      INSERT INTO image_hostings
        (id, org_id, token, path, storage_id, storage_key, size, mime, status, access_count, created_at)
      VALUES ('rollup-image', ${orgId}, 'ih_rollup', 'image.png', 'rollup-storage', 'image.png', 300,
        'image/png', 'active', 0, ${atMs})
    `)
    await db.run(sql`
      INSERT INTO shares
        (id, token, kind, matter_id, org_id, creator_id, expires_at, download_limit, views, downloads, status, created_at)
      VALUES
        ('rollup-share-usable', 'rollup-share-usable', 'landing', 'rollup-file', ${orgId}, ${userId}, NULL, NULL, 0, 0, 'active', ${atSec}),
        ('rollup-share-revoked', 'rollup-share-revoked', 'direct', 'rollup-file', ${orgId}, ${userId}, NULL, NULL, 0, 0, 'revoked', ${atSec}),
        ('rollup-share-expired', 'rollup-share-expired', 'landing', 'rollup-file', ${orgId}, ${userId}, ${atSec - 1}, NULL, 0, 0, 'active', ${atSec}),
        ('rollup-share-limited', 'rollup-share-limited', 'direct', 'rollup-file', ${orgId}, ${userId}, NULL, 1, 0, 1, 'active', ${atSec})
    `)
    await db.run(sql`
      INSERT INTO audit_events
        (id, org_id, user_id, actor_type, action, target_type, target_id, target_name, metadata, created_at)
      VALUES
        ('rollup-upload-ok', ${orgId}, ${userId}, 'user', 'upload_confirm', 'file', 'rollup-file', 'ok.bin',
          '{"bytes":100,"source":"upload","storageId":"rollup-storage"}', ${atSec}),
        ('rollup-upload-missing', ${orgId}, ${userId}, NULL, 'upload_confirm', 'file', 'rollup-file', 'missing.bin',
          'not-json', ${atSec}),
        ('rollup-upload-cancel', ${orgId}, ${userId}, 'user', 'upload_cancel', 'file', 'rollup-file', 'cancel.bin',
          '{"source":"upload"}', ${atSec}),
        ('rollup-upload-failed', ${orgId}, ${userId}, 'user', 'upload_failed', 'file', 'rollup-file', 'failed.bin',
          '{"bytes":0,"source":"upload","reason":"network"}', ${atSec}),
        ('rollup-share-download', ${orgId}, NULL, NULL, 'share_download', 'share', 'rollup-share-usable', 'shared.bin',
          '{"bytes":20,"shareId":"rollup-share-usable","kind":"landing","source":"landing_share","trafficEventId":"traffic-share"}', ${atSec}),
        ('rollup-object-download', ${orgId}, ${userId}, NULL, 'object_download', 'file', 'rollup-file', 'object.bin',
          '{"bytes":30,"source":"object_download","trafficEventId":"traffic-object"}', ${atSec}),
        ('rollup-image-download', ${orgId}, NULL, 'anonymous', 'image_hosting_download', 'image', 'rollup-image', 'image.png',
          '[]', ${atSec}),
        ('rollup-webdav-download', ${orgId}, ${userId}, 'user', 'webdav_download', 'file', 'rollup-file', 'webdav.bin',
          '{"bytes":40,"source":"webdav_download","trafficEventId":"traffic-webdav"}', ${atSec}),
        ('rollup-download-failed', ${orgId}, ${userId}, 'user', 'download_failed', 'file', 'rollup-file', 'blocked.bin',
          '{"bytes":5,"source":"landing_share","reason":"quota_exceeded","trafficEventId":"traffic-blocked"}', ${atSec}),
        ('rollup-share-save', ${orgId}, ${userId}, 'user', 'save_from_share', 'share', 'rollup-share-usable', 'shared.bin',
          '{"bytes":6,"shareId":"rollup-share-usable"}', ${atSec}),
        ('rollup-restore', ${orgId}, ${userId}, 'user', 'restore', 'file', 'rollup-file', 'restored.bin', NULL, ${atSec}),
        ('rollup-purge', ${orgId}, ${userId}, 'user', 'object_purge', 'file', 'rollup-file', 'purged.bin', NULL, ${atSec}),
        ('rollup-team-join', ${orgId}, ${userId}, 'user', 'team_member_join', 'organization', 'rollup-team', 'team', NULL, ${atSec}),
        ('rollup-team-remove', ${orgId}, ${userId}, 'user', 'team_member_remove', 'organization', 'rollup-team', 'team', NULL, ${atSec}),
        ('rollup-license', ${orgId}, NULL, 'system', 'license_refresh', 'license', NULL, 'license',
          '{"status":"failed"}', ${atSec}),
        ('rollup-share-created-usable', ${orgId}, ${userId}, 'user', 'share_create', 'share', 'rollup-share-usable', 'rollup-share-usable',
          '{"kind":"landing"}', ${atSec}),
        ('rollup-share-created-revoked', ${orgId}, ${userId}, 'user', 'share_create', 'share', 'rollup-share-revoked', 'rollup-share-revoked',
          '{"kind":"direct"}', ${atSec}),
        ('rollup-share-created-expired', ${orgId}, ${userId}, 'user', 'share_create', 'share', 'rollup-share-expired', 'rollup-share-expired',
          '{"kind":"landing"}', ${atSec}),
        ('rollup-share-created-limited', ${orgId}, ${userId}, 'user', 'share_create', 'share', 'rollup-share-limited', 'rollup-share-limited',
          '{"kind":"direct"}', ${atSec}),
        ('rollup-job-finished-fact', ${orgId}, NULL, 'system', 'background_job_failed', 'background_job', 'rollup-job-finished', 'rollup-job-finished',
          '{"jobType":"archive","outcome":"failed"}', ${atSec}),
        ('event:user_register:rollup-direct-user', '', 'rollup-direct-user', 'user', 'user_register', 'user',
          'rollup-direct-user', 'rollup-direct-user', '{"provider":"unknown"}', ${atSec})
    `)
    await db.run(sql`
      INSERT INTO object_upload_sessions
        (id, org_id, object_id, storage_id, storage_key, upload_id, part_size, on_conflict,
          status, created_by, expires_at, created_at, updated_at)
      VALUES
        ('rollup-upload-aborted', ${orgId}, 'rollup-file', 'rollup-storage', 'upload/rollup-file', NULL,
          5242880, 'fail', 'aborted', ${userId}, ${atMs + 86400000}, ${atMs}, ${atMs})
    `)
    await db.run(sql`
      INSERT INTO cloud_traffic_reports
        (id, org_id, period, source, source_id, storage_id, event_id, bytes, unit_bytes, credits_per_unit, status, issued_at, created_at, updated_at)
      VALUES
        ('rollup-traffic-share', ${orgId}, '2026-07', 'landing_share', 'rollup-share-usable', 'rollup-storage', 'traffic-share', 20, 50, 2, 'reported', ${atMs}, ${atMs}, ${atMs}),
        ('rollup-traffic-object', ${orgId}, '2026-07', 'object_download', 'rollup-file', 'rollup-storage', 'traffic-object', 30, 50, 2, 'reported', ${atMs}, ${atMs}, ${atMs}),
        ('rollup-traffic-image', ${orgId}, '2026-07', 'image_hosting', 'rollup-image', 'rollup-storage', 'traffic-image', 0, 50, 2, 'reported', ${atMs}, ${atMs}, ${atMs}),
        ('rollup-traffic-webdav', ${orgId}, '2026-07', 'webdav_download', 'rollup-file', 'rollup-storage', 'traffic-webdav', 40, 50, 2, 'reported', ${atMs}, ${atMs}, ${atMs}),
        ('rollup-traffic-blocked', ${orgId}, '2026-07', 'landing_share', 'rollup-share-usable', NULL, 'traffic-blocked', 200, 50, 2, 'blocked', NULL, ${atMs}, ${atMs})
    `)
    await db.run(sql`
      INSERT INTO downloaders
        (id, name, token_hash, token_jti, status, enabled, version, hostname, platform, arch, engine, capabilities,
          max_concurrent_tasks, current_tasks, download_bps, upload_bps, free_disk_bytes, created_by, created_at, updated_at)
      VALUES
        ('rollup-downloader', 'Online', 'hash-1', 'jti-1', 'online', 1, '1', 'host', 'linux', 'x64', 'http', '[]', 2, 1, 0, 0, 1, ${userId}, ${atMs}, ${atMs}),
        ('rollup-downloader-offline', 'Offline', 'hash-2', 'jti-2', 'offline', 1, '1', 'host', 'linux', 'x64', 'http', '[]', 2, 0, 0, 0, 1, ${userId}, ${atMs}, ${atMs})
    `)
    await db.run(sql`
      INSERT INTO download_tasks
        (id, org_id, created_by_user_id, source_type, source_uri, display_name, target_folder, category, tags,
          assigned_downloader_id, status, billing_charged_bytes, events, created_at, updated_at, finished_at)
      VALUES
        ('rollup-task-finished', ${orgId}, ${userId}, 'http', 'https://example.com/a', 'a', '', NULL, '[]',
          'rollup-downloader', 'completed', 60,
          ${JSON.stringify([
            {
              id: 'rollup-task-finished-event',
              type: 'status_changed',
              occurredAt: atMs,
              attempt: 1,
              from: 'uploading',
              to: 'completed',
              reason: null,
              category: 'uncategorized',
              downloaderId: 'rollup-downloader',
              transferredBytes: 60,
              billedBytes: 60,
              errorCode: null,
              errorMessage: null,
            },
            {
              id: 'rollup-task-cleanup-requested-event',
              type: 'cleanup_requested',
              occurredAt: atMs + 1,
              attempt: 1,
              reason: null,
              category: 'uncategorized',
              downloaderId: 'rollup-downloader',
              transferredBytes: 60,
              billedBytes: 60,
              errorCode: null,
              errorMessage: null,
            },
          ])}, ${atMs}, ${atMs}, ${atMs}),
        ('rollup-task-queued', ${orgId}, ${userId}, 'torrent', 'magnet:?xt=1', 'b', '', 'media', '[]',
          'rollup-downloader', 'queued', 0, '[]', ${atMs}, ${atMs}, NULL)
    `)
    await db.run(sql`
      INSERT INTO background_jobs
        (id, org_id, user_id, type, status, target_folder, target_path, created_at, updated_at, finished_at)
      VALUES
        ('rollup-job-finished', ${orgId}, ${userId}, 'archive', 'failed', '', '', ${atMs}, ${atMs}, ${atMs}),
        ('rollup-job-queued', ${orgId}, ${userId}, 'extract', 'queued', '', '', ${atMs}, ${atMs}, NULL)
    `)
    await db.run(sql`
      INSERT INTO remote_download_usage_reports
        (id, org_id, downloader_id, task_id, event_id, unit_index, unit_bytes, credits_per_unit, status, created_at, updated_at)
      VALUES ('rollup-usage', ${orgId}, 'rollup-downloader', 'rollup-task-finished', 'usage-event', 0, 70, 3,
        'reported', ${atMs}, ${atMs})
    `)
    await db.run(sql`
      INSERT INTO webhook_events
        (id, source, event_id, event_type, payload_hash, raw_payload, status, created_at, processed_at)
      VALUES ('rollup-webhook', 'cloud', 'webhook-event', 'order.quota_changed', 'hash', '{}', 'processed', ${atMs}, ${atMs})
    `)

    await captureAdminStatsSnapshot(db, bucketStart, generatedAt)
    const first = await rebuildAdminStatsHour(db, bucketStart, generatedAt)
    const rows = await db.all<RollupRow>(sql`
      SELECT org_id AS orgId, metric_key AS metric, dimension_key AS dimensionKey,
        dimension_value AS dimensionValue, count, bytes, unique_count AS uniqueCount, metadata
      FROM stats_rollups_hourly
      WHERE bucket_start = ${bucketStart.getTime()}
    `)
    const row = (metric: string, dimensionKey = '', dimensionValue = '', rowOrgId = orgId) =>
      rows.find(
        (value) =>
          value.metric === metric &&
          value.orgId === rowOrgId &&
          value.dimensionKey === dimensionKey &&
          value.dimensionValue === dimensionValue,
      )

    expect(first).toMatchObject({
      bucketStart,
      bucketEnd: new Date('2026-07-10T13:00:00.000Z'),
      rows: expect.any(Number),
      lowerBoundRows: expect.any(Number),
    })
    expect(rows.length).toBeGreaterThan(first.rows)
    expect(first.lowerBoundRows).toBe(0)
    expect(row(M.transferUpload)).toMatchObject({ count: 3, bytes: 100 })
    expect(row(M.transferDownloadIssued)).toMatchObject({ count: 4, bytes: 90 })
    expect(row(M.shareDownloadIssued)).toMatchObject({ count: 1, bytes: 20 })
    expect(row(M.statsMissingBytes)).toBeUndefined()
    expect(row(M.userSignup, '', '', '')).toMatchObject({ count: 2 })
    expect(row(M.userSignup, 'provider', 'unknown', '')).toMatchObject({ count: 1 })
    expect(row(M.shareCreated)).toMatchObject({ count: 4 })
    expect(rows.some((value) => value.metric === 'traffic.report_sync')).toBe(false)
    expect(row(M.remoteDownloadTaskFinished)).toMatchObject({ count: 1, bytes: 0 })
    expect(row(M.backgroundJobFinished)).toMatchObject({ count: 1 })
    expect(row(M.storageInventory)).toMatchObject({ count: 2, bytes: 500 })
    expect(row(M.storageLedgerBalance, '', '', '')).toMatchObject({ bytes: 1300 })
    expect(row(M.storageUsed)).toMatchObject({ bytes: 1300 })
    expect(row(M.storageQuota)).toMatchObject({ bytes: 1000 })
    expect(row(M.storageQuota, 'status', 'over', '')).toMatchObject({ count: 1 })
    expect(row(M.storageQuota, 'status', 'invalid', '')).toMatchObject({ count: 1 })
    expect(row(M.storageTrashSnapshot)).toMatchObject({ count: 1, bytes: 800 })
    expect(row(M.statsDataQualitySnapshot, 'kind', 'storage_usage_drift', '')).toMatchObject({ count: 0, bytes: 0 })
    expect(row(M.shareInventory)).toMatchObject({ count: 4 })
    expect(row(M.shareInventory, '', '', '')).toMatchObject({ count: 4 })
    expect(row(M.shareInventory, 'lifecycle', 'usable')).toMatchObject({ count: 1 })
    expect(row(M.shareInventory, 'lifecycle', 'revoked')).toMatchObject({ count: 1 })
    expect(row(M.shareInventory, 'lifecycle', 'expired')).toMatchObject({ count: 1 })
    expect(row(M.shareInventory, 'lifecycle', 'download_limit_reached')).toMatchObject({ count: 1 })
    expect(row(M.statsDataQualitySnapshot, '', '', '')).toMatchObject({ count: 1 })
    expect(row(M.statsDataQualitySnapshot, 'kind', 'share_downloads', '')).toMatchObject({ count: 1 })
    expect(row(M.backgroundJobSnapshot)).toMatchObject({ count: 1 })
    expect(row(M.remoteDownloadTaskSnapshot)).toMatchObject({ count: 1 })
    expect(row(M.downloaderSnapshot, '', '', '')).toMatchObject({ count: 2 })
    expect(row(M.userInventory, '', '', '')).toMatchObject({ count: 2 })
    expect(row(M.userInventory, 'status', 'silent', '')).toMatchObject({ count: 0 })
    expect(row(M.userActiveSnapshot, 'window', 'mau', '')).toMatchObject({ count: 2 })
    expect(row(M.trafficReportSnapshot, '', '', '')).toMatchObject({ count: 5, bytes: 290 })
    expect(row(M.webhookSnapshot, 'status', 'processed', '')).toMatchObject({ count: 1 })
    expect(row(M.statsRollupRun, '', '', '')).toMatchObject({ count: 1 })
    expect(row(M.statsRollupRun, 'metric_key', M.userSignup, '')).toMatchObject({ count: 1 })
    expect(JSON.parse(row(M.transferUpload)?.metadata ?? '{}')).toMatchObject({ version: 3, quality: 'exact' })
    expect(JSON.parse(row(M.statsRollupRun, '', '', '')?.metadata ?? '{}')).toMatchObject({
      version: 3,
      scope: 'full',
      quality: 'exact',
      counterQuality: 'exact',
      snapshotQuality: 'exact',
      snapshotObservedAt: generatedAt.toISOString(),
    })
    expect(JSON.parse(row(M.statsRollupRun, 'metric_key', M.userSignup, '')?.metadata ?? '{}')).toMatchObject({
      version: 3,
      scope: 'counters',
      quality: 'exact',
    })

    const reader = new AdminStatsHourlyReader(
      db,
      { from: bucketStart, to: new Date(bucketStart.getTime() + 3_600_000 - 1), timeZone: 'UTC' },
      new Date(bucketStart.getTime() + 2 * 3_600_000),
    )
    await expect(reader.coverage('counters')).resolves.toMatchObject({ quality: 'exact' })
    await expect(reader.coverage('snapshots')).resolves.toMatchObject({
      quality: 'exact',
      dataThrough: generatedAt.toISOString(),
    })

    const overview = await createAdminStatsRepo(db).getOverviewStatistics(new Date('2026-07-10T13:30:00.000Z'), {
      from: bucketStart,
      to: new Date('2026-07-10T12:59:59.999Z'),
      timeZone: 'UTC',
    })
    expect(overview.users).toMatchObject({
      total: 2,
      active30Days: 2,
      new7Days: 2,
      activity: { total: 2, today: 2, last7Days: 0, last30Days: 0, inactive: 0 },
    })
    expect(overview.users.topUsage[0]).toMatchObject({ usedBytes: 1300, quotaBytes: 1000 })
    expect(overview.storageTrend).toContainEqual(expect.objectContaining({ date: '2026-07-10', usedBytes: 1300 }))
    expect(overview.storageTrend[0]).toMatchObject({ writtenBytes: 0, releasedBytes: 0 })

    const second = await rebuildAdminStatsHour(db, bucketStart, generatedAt)
    const [{ count: storedRows }] = await db.all<{ count: number }>(sql`
      SELECT COUNT(*) AS count FROM stats_rollups_hourly WHERE bucket_start = ${bucketStart.getTime()}
    `)
    expect(second.rows).toBe(first.rows)
    expect(storedRows).toBeGreaterThan(first.rows)

    await captureAdminStatsSnapshot(db, bucketStart, generatedAt)
    const [{ count: signupMarkers }] = await db.all<{ count: number }>(sql`
      SELECT COUNT(*) AS count
      FROM stats_rollups_hourly
      WHERE bucket_start = ${bucketStart.getTime()}
        AND metric_key = ${M.statsRollupRun}
        AND dimension_key = 'metric_key'
        AND dimension_value = ${M.userSignup}
    `)
    expect(signupMarkers).toBe(1)
  })

  it('rejects buckets that are not aligned to a UTC hour', async () => {
    const { db } = await createTestApp()

    await expect(
      rebuildAdminStatsHour(db, new Date('2026-07-10T12:00:00.001Z'), new Date('2026-07-10T12:30:00Z')),
    ).rejects.toThrow('stats_bucket_must_align_to_utc_hour')
  })

  it('reads current users and top usage live even when snapshots are unavailable', async () => {
    const { app, db } = await createTestApp()
    await adminHeaders(app)
    const now = new Date('2026-07-20T18:30:00.000Z')
    const recentCreatedAt = new Date('2026-07-15T09:00:00.000Z').getTime()
    const oldCreatedAt = new Date('2026-07-13T23:59:59.999Z').getTime()
    const [{ id: seededUserId }] = await db.all<{ id: string }>(sql`SELECT id FROM user LIMIT 1`)
    await db.run(sql`UPDATE user SET created_at = ${oldCreatedAt}`)
    await db.run(sql`UPDATE user SET created_at = ${recentCreatedAt} WHERE id = ${seededUserId}`)
    await db.run(sql`
      UPDATE audit_events
      SET created_at = CAST((SELECT created_at FROM user WHERE user.id = audit_events.target_id) / 1000 AS INTEGER)
      WHERE action = 'user_register'
    `)
    await db.run(sql`
      INSERT INTO user (id, name, email, email_verified, created_at, updated_at)
      VALUES ('old-overview-user', 'Old User', 'old-overview@example.com', 1, ${oldCreatedAt}, ${oldCreatedAt})
    `)
    await db.run(sql`UPDATE org_quotas SET used = 777`)
    const [{ count: expectedTotal }] = await db.all<{ count: number }>(sql`SELECT COUNT(*) AS count FROM user`)

    const overview = await createAdminStatsRepo(db).getOverviewStatistics(now, {
      from: new Date('2026-06-21T00:00:00.000Z'),
      to: new Date('2026-07-20T17:59:59.999Z'),
      timeZone: 'UTC',
    })

    expect(overview.users.total).toBe(expectedTotal)
    expect(overview.users.new7Days).toBe(1)
    expect(overview.users.activity.total).toBeNull()
    expect(overview.users.topUsage[0]?.usedBytes).toBe(777)
  })

  it('rolls exact storage writes and releases into the overview trend', async () => {
    const { app, db } = await createTestApp()
    await adminHeaders(app)
    const [{ id: orgId }] = await db.all<{ id: string }>(
      sql`SELECT id FROM organization WHERE metadata LIKE '%"type":"personal"%' LIMIT 1`,
    )
    const openingAt = Date.parse('2026-07-09T00:00:00.000Z')
    const bucketStart = new Date('2026-07-10T11:00:00.000Z')
    const writtenAt = bucketStart.getTime() + 5 * 60_000
    const releasedAt = bucketStart.getTime() + 10 * 60_000
    await db.run(sql`
      INSERT INTO storage_usage_ledger
        (id, event_key, org_id, storage_id, resource_type, resource_id, delta_bytes, reason, occurred_at, created_at)
      VALUES
        ('trend-opening', 'opening:complete', '', '', 'storage', 'global', 0, 'opening_balance_complete',
          ${openingAt}, ${openingAt}),
        ('trend-written', 'trend:written', ${orgId}, 'storage-1', 'matter', 'file-1', 500, 'matter_activated',
          ${writtenAt}, ${writtenAt}),
        ('trend-released', 'trend:released', ${orgId}, 'storage-1', 'matter', 'file-2', -120, 'matter_purged',
          ${releasedAt}, ${releasedAt})
    `)

    await rebuildAdminStatsHour(db, bucketStart, new Date('2026-07-10T12:05:00.000Z'))

    const rows = await db.all<RollupRow>(sql`
      SELECT org_id AS orgId, metric_key AS metric, dimension_key AS dimensionKey,
        dimension_value AS dimensionValue, count, bytes, unique_count AS uniqueCount, metadata
      FROM stats_rollups_hourly
      WHERE bucket_start = ${bucketStart.getTime()} AND metric_key = ${M.storageLedgerChange}
    `)
    expect(rows.find((row) => row.dimensionKey === '')).toMatchObject({ count: 2, bytes: 620 })
    expect(rows.find((row) => row.dimensionKey === 'direction' && row.dimensionValue === 'written')).toMatchObject({
      count: 1,
      bytes: 500,
    })
    expect(rows.find((row) => row.dimensionKey === 'direction' && row.dimensionValue === 'released')).toMatchObject({
      count: 1,
      bytes: 120,
    })

    const overview = await createAdminStatsRepo(db).getOverviewStatistics(new Date('2026-07-10T12:30:00.000Z'), {
      from: bucketStart,
      to: new Date('2026-07-10T11:59:59.999Z'),
      timeZone: 'UTC',
    })
    expect(overview.storageTrend).toEqual([
      expect.objectContaining({ date: '2026-07-10', writtenBytes: 500, releasedBytes: 120 }),
    ])
  })

  it('identifies the snapshot query stage that failed', async () => {
    const { db } = await createTestApp()
    await db.run(sql`DROP TABLE org_quotas`)

    await expect(
      captureAdminStatsSnapshot(db, new Date('2026-07-10T12:00:00Z'), new Date('2026-07-10T12:30:00Z')),
    ).rejects.toThrow(/stats_rollup_query_failed:(quota|data-quality)/)
  })

  it('reads only current-version result rows with a compatible completion scope', async () => {
    const { db } = await createTestApp()
    const bucketStart = Date.parse('2026-07-10T10:00:00.000Z')
    await db.run(sql`
      INSERT INTO stats_rollups_hourly
        (id, bucket_start, org_id, metric_key, dimension_key, dimension_value,
          count, bytes, unique_count, metadata, updated_at)
      VALUES
        ('quality-marker', ${bucketStart}, '', 'stats.rollup_run', '', '', 1, 0, 0,
          '{"version":3,"scope":"full","quality":"exact"}', ${bucketStart}),
        ('quality-null', ${bucketStart}, 'org-null', 'transfer.upload', '', '', 1, 1, 0, NULL, ${bucketStart}),
        ('quality-array', ${bucketStart}, 'org-array', 'transfer.upload', '', '', 1, 2, 0, '[]', ${bucketStart}),
        ('quality-v1', ${bucketStart}, 'org-v1', 'transfer.upload', '', '', 1, 3, 0,
          '{"version":1,"scope":"full","quality":"exact"}', ${bucketStart}),
        ('quality-exact', ${bucketStart}, 'org-exact', 'transfer.upload', '', '', 1, 4, 0,
          '{"version":3,"scope":"full","quality":"exact"}', ${bucketStart}),
        ('quality-lower', ${bucketStart}, 'org-lower', 'transfer.upload', '', '', 1, 5, 0,
          '{"version":3,"scope":"full","quality":"lower_bound"}', ${bucketStart})
    `)
    const reader = new AdminStatsHourlyReader(
      db,
      {
        from: new Date(bucketStart),
        to: new Date(bucketStart + 3_600_000 - 1),
        timeZone: 'UTC',
      },
      new Date(bucketStart + 7_200_000),
    )

    expect(reader.endExclusive()).toEqual(new Date(bucketStart + 3_600_000))
    expect(await reader.rows(M.transferUpload)).toEqual([
      expect.objectContaining({ orgId: 'org-exact', bytes: 4, lowerBound: false }),
    ])
    expect(metricDefinition(M.transferUpload)).toMatchObject({ kind: 'counter', bytesUnit: 'bytes' })
    expect(() => assertMetricDimension(M.transferUpload, 'not-a-dimension')).toThrow(
      'Unsupported stats dimension: transfer.upload/not-a-dimension',
    )
  })

  it('keeps counter-only repairs separate from full snapshot results', async () => {
    const { db } = await createTestApp()
    const bucketStart = Date.parse('2026-07-10T09:00:00.000Z')
    const metadata = '{"version":3,"scope":"counters","quality":"exact"}'
    await db.run(sql`
      INSERT INTO stats_rollups_hourly
        (id, bucket_start, org_id, metric_key, dimension_key, dimension_value,
          count, bytes, unique_count, metadata, updated_at)
      VALUES
        ('counter-marker', ${bucketStart}, '', 'stats.rollup_run', '', '', 1, 0, 0, ${metadata}, ${bucketStart}),
        ('counter-result', ${bucketStart}, '', 'transfer.upload', '', '', 1, 42, 0, ${metadata}, ${bucketStart}),
        ('orphan-gauge', ${bucketStart}, '', 'storage.used', '', '', 0, 99, 0,
          '{"version":3,"scope":"full","quality":"exact"}', ${bucketStart})
    `)
    const reader = new AdminStatsHourlyReader(
      db,
      {
        from: new Date(bucketStart),
        to: new Date(bucketStart + 3_600_000 - 1),
        timeZone: 'UTC',
      },
      new Date(bucketStart + 7_200_000),
    )

    expect(await reader.rows(M.transferUpload)).toEqual([expect.objectContaining({ bytes: 42 })])
    expect(await reader.rows(M.storageUsed)).toEqual([])
    expect(await reader.coverage('counters')).toMatchObject({ status: 'complete', completedBuckets: 1 })
    expect(await reader.coverage()).toMatchObject({ status: 'empty', completedBuckets: 0 })
  })

  it('uses metric completion markers without claiming unrelated counters are complete', async () => {
    const { db } = await createTestApp()
    const bucketStart = Date.parse('2026-06-10T09:00:00.000Z')
    const metadata = '{"version":3,"scope":"counters","quality":"exact"}'
    await db.run(sql`
      INSERT INTO stats_rollups_hourly
        (id, bucket_start, org_id, metric_key, dimension_key, dimension_value,
          count, bytes, unique_count, metadata, updated_at)
      VALUES
        ('signup-marker', ${bucketStart}, '', 'stats.rollup_run', 'metric_key', 'user.signup', 1, 0, 0,
          ${metadata}, ${bucketStart}),
        ('signup-result', ${bucketStart}, '', 'user.signup', '', '', 2, 0, 0, ${metadata}, ${bucketStart}),
        ('signup-provider', ${bucketStart}, '', 'user.signup', 'provider', 'github', 2, 0, 0,
          ${metadata}, ${bucketStart}),
        ('unmarked-upload', ${bucketStart}, '', 'transfer.upload', '', '', 1, 42, 0, ${metadata}, ${bucketStart})
    `)
    const reader = new AdminStatsHourlyReader(
      db,
      {
        from: new Date(bucketStart),
        to: new Date(bucketStart + 3_600_000 - 1),
        timeZone: 'UTC',
      },
      new Date(bucketStart + 7_200_000),
    )

    expect(await reader.rows(M.userSignup, ['', 'provider'])).toHaveLength(2)
    expect(await reader.rows(M.transferUpload)).toEqual([])
    expect(await reader.coverage('counters')).toMatchObject({ status: 'empty', completedBuckets: 0 })
    expect(await reader.coverage('counters', M.userSignup)).toMatchObject({
      status: 'complete',
      completedBuckets: 1,
    })
    expect(await reader.completeDayKeys('counters', M.userSignup)).toEqual(new Set(['2026-06-10']))
  })

  it('accepts exact boundary hours but rejects gaps inside the observed interval', async () => {
    const { db } = await createTestApp()
    const firstHour = Date.parse('2026-07-10T10:00:00.000Z')
    const secondHour = firstHour + 3_600_000
    const thirdHour = secondHour + 3_600_000
    const metadata = '{"version":3,"scope":"counters","quality":"exact"}'
    await db.run(sql`
      INSERT INTO stats_rollups_hourly
        (id, bucket_start, org_id, metric_key, dimension_key, dimension_value,
          count, bytes, unique_count, metadata, updated_at)
      VALUES
        ('complete-day-first', ${firstHour}, '', 'stats.rollup_run', '', '', 1, 0, 0, ${metadata}, ${firstHour})
    `)
    const range = {
      from: new Date(firstHour),
      to: new Date(thirdHour + 3_600_000 - 1),
      timeZone: 'UTC' as const,
    }

    const boundaryReader = new AdminStatsHourlyReader(db, range, new Date(thirdHour + 7_200_000))
    expect(await boundaryReader.completeDayKeys('counters')).toEqual(new Set(['2026-07-10']))

    await db.run(sql`
      INSERT INTO stats_rollups_hourly
        (id, bucket_start, org_id, metric_key, dimension_key, dimension_value,
          count, bytes, unique_count, metadata, updated_at)
      VALUES
        ('complete-day-third', ${thirdHour}, '', 'stats.rollup_run', '', '', 1, 0, 0, ${metadata}, ${thirdHour})
    `)
    const gapReader = new AdminStatsHourlyReader(db, range, new Date(thirdHour + 7_200_000))
    expect(await gapReader.completeDayKeys('counters')).toEqual(new Set())

    await db.run(sql`
      INSERT INTO stats_rollups_hourly
        (id, bucket_start, org_id, metric_key, dimension_key, dimension_value,
          count, bytes, unique_count, metadata, updated_at)
      VALUES
        ('complete-day-second', ${secondHour}, '', 'stats.rollup_run', '', '', 1, 0, 0, ${metadata}, ${secondHour})
    `)
    const completeReader = new AdminStatsHourlyReader(db, range, new Date(thirdHour + 7_200_000))
    expect(await completeReader.completeDayKeys('counters')).toEqual(new Set(['2026-07-10']))
  })

  it('reads exact current-hour snapshots without exposing current-hour counters', async () => {
    const { db } = await createTestApp()
    const bucketStart = Date.parse('2026-07-10T10:00:00.000Z')
    await db.run(sql`
      INSERT INTO stats_rollups_hourly
        (id, bucket_start, org_id, metric_key, dimension_key, dimension_value,
          count, bytes, unique_count, metadata, updated_at)
      VALUES
        ('current-hour-marker', ${bucketStart}, '', 'stats.rollup_run', '', '', 1, 0, 0,
          '{"version":3,"scope":"full","quality":"exact"}', ${bucketStart}),
        ('current-hour-rollup', ${bucketStart}, '', 'transfer.upload', '', '', 1, 42, 0,
          '{"version":3,"scope":"full","quality":"exact"}', ${bucketStart}),
        ('current-hour-snapshot', ${bucketStart}, '', 'storage.used', '', '', 0, 99, 0,
          '{"version":3,"scope":"full","quality":"exact"}', ${bucketStart})
    `)
    const reader = new AdminStatsHourlyReader(
      db,
      {
        from: new Date(bucketStart),
        to: new Date(bucketStart + 3_600_000 - 1),
        timeZone: 'UTC',
      },
      new Date(bucketStart + 30 * 60_000),
    )

    expect(await reader.rows(M.transferUpload)).toEqual([])
    expect(await reader.rows(M.storageUsed)).toEqual([expect.objectContaining({ bytes: 99 })])
    expect(await reader.coverage()).toMatchObject({ status: 'empty', expectedBuckets: 0, completedBuckets: 0 })
    expect(await reader.coverage('snapshots')).toMatchObject({
      status: 'complete',
      expectedBuckets: 1,
      completedBuckets: 1,
    })
  })
})
