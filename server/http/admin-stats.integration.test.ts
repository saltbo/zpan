import type { AdminDashboardOverviewStats } from '@shared/types'
import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { createAdminStatsRepo } from '../adapters/repos/admin-stats'
import { currentTrafficPeriod } from '../domain/quota'
import { adminHeaders, createTestApp, seedProLicense } from '../test/setup.js'

describe('site stats routes', () => {
  it('does not expose stats under the removed admin API group', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)

    const res = await app.request('/api/admin/stats/overview', { headers })

    expect(res.status).toBe(404)
  })

  it('does not expose legacy core or details stats endpoints', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)

    const coreRes = await app.request('/api/site/stats/core', { headers })
    const detailsRes = await app.request('/api/site/stats/details', { headers })

    expect(coreRes.status).toBe(404)
    expect(detailsRes.status).toBe(404)
  })

  it('gates advanced dashboard stats behind the analytics feature', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await seedStatsFixture(db)

    const res = await app.request('/api/site/stats/storage', { headers })
    const body = (await res.json()) as { error: { details: Array<{ metadata: Record<string, string> }> } }

    expect(res.status).toBe(402)
    expect(body.error.details[0].metadata.feature).toBe('analytics')
  })

  it('normalizes date-only dashboard ranges to exact daily buckets', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)

    const res = await app.request('/api/site/stats/overview?from=2026-01-01&to=2026-01-07', { headers })
    const body = (await res.json()) as { from: string; to: string; trends: Array<{ date: string }> }

    expect(res.status).toBe(200)
    expect(body.from).toBe('2026-01-01T00:00:00.000Z')
    expect(body.to).toBe('2026-01-07T23:59:59.999Z')
    expect(body.trends.map((point) => point.date)).toEqual([
      '2026-01-01',
      '2026-01-02',
      '2026-01-03',
      '2026-01-04',
      '2026-01-05',
      '2026-01-06',
      '2026-01-07',
    ])
  })

  it('preserves explicit ISO offsets instead of shifting the selected local-day boundary', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)
    const from = encodeURIComponent('2026-07-01T04:00:00.000Z')
    const to = encodeURIComponent('2026-07-02T03:59:59.999Z')

    const res = await app.request(`/api/site/stats/overview?from=${from}&to=${to}&timeZone=America%2FToronto`, {
      headers,
    })
    const body = (await res.json()) as { from: string; to: string; trends: Array<{ date: string }> }

    expect(res.status).toBe(200)
    expect(body.from).toBe('2026-07-01T04:00:00.000Z')
    expect(body.to).toBe('2026-07-02T03:59:59.999Z')
    expect(body.trends.map((point) => point.date)).toEqual(['2026-07-01'])
  })

  it('rejects dashboard ranges longer than one year', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)

    const res = await app.request('/api/site/stats/overview?from=2025-01-01&to=2026-01-02', { headers })

    expect(res.status).toBe(400)
  })

  it('rejects invalid calendar dates', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)

    const res = await app.request('/api/site/stats/overview?from=2026-99-99', { headers })

    expect(res.status).toBe(400)
  })

  it('rejects invalid IANA time zones', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)

    const res = await app.request('/api/site/stats/overview?timeZone=Not%2FAZone', { headers })

    expect(res.status).toBe(400)
  })

  it('does not publish site stats routes in the OpenAPI document', async () => {
    const { app } = await createTestApp()

    const res = await app.request('/api/openapi.json')
    const body = (await res.json()) as { paths: Record<string, unknown> }

    expect(res.status).toBe(200)
    expect(Object.keys(body.paths).some((path) => path.startsWith('/api/site/stats'))).toBe(false)
  })

  it('reads storage waterline trends from daily rollups when present', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await seedProLicense(db)
    await seedStatsFixture(db)

    await db.run(sql`
      INSERT INTO stats_rollups_daily (
        id, bucket_start, org_id, metric_key, dimension_key, dimension_value,
        count, bytes, unique_count, metadata, updated_at
      )
      VALUES (
        'storage-used-2026-01-01', ${Date.UTC(2026, 0, 1)}, '', 'storage.used.bytes', '', '',
        0, 4096, 0, NULL, ${Date.UTC(2026, 0, 2)}
      )
    `)

    const res = await app.request('/api/site/stats/storage?from=2026-01-01&to=2026-01-01', { headers })
    const body = (await res.json()) as {
      storageTrend: Array<{ date: string; usedBytes: number; newBytes: number; newFiles: number }>
    }

    expect(res.status).toBe(200)
    expect(body.storageTrend).toEqual([{ date: '2026-01-01', usedBytes: 4096, newBytes: 0, newFiles: 0 }])
  })

  it('upserts one exact storage rollup per UTC day', async () => {
    const { db } = await createTestApp()
    const [{ expected }] = await db.all<{ expected: number }>(
      sql`SELECT COALESCE(SUM(used), 0) AS expected FROM org_quotas`,
    )
    const repo = createAdminStatsRepo(db)
    const firstNow = new Date('2026-07-10T04:05:00.000Z')
    const secondNow = new Date('2026-07-10T18:05:00.000Z')

    await repo.writeStorageUsedRollup(firstNow)
    await repo.writeStorageUsedRollup(secondNow)
    const rows = await db.all<{ bucketStart: number; bytes: number; metadata: string }>(sql`
      SELECT bucket_start AS bucketStart, bytes, metadata
      FROM stats_rollups_daily
      WHERE metric_key = 'storage.used.bytes'
    `)

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ bucketStart: Date.UTC(2026, 6, 10), bytes: expected })
    expect(JSON.parse(rows[0].metadata)).toEqual({ source: 'org_quotas.used', quality: 'exact_snapshot' })
  })

  it('does not write rollups while serving storage stats fallback data', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await seedProLicense(db)
    await seedStatsFixture(db)

    const before = await db.all<{ count: number }>(sql`SELECT COUNT(*) AS count FROM stats_rollups_daily`)
    const res = await app.request('/api/site/stats/storage?from=2000-01-01&to=2000-01-02', { headers })
    const after = await db.all<{ count: number }>(sql`SELECT COUNT(*) AS count FROM stats_rollups_daily`)
    const body = (await res.json()) as { storageTrend: Array<{ usedBytes: number | null }> }

    expect(res.status).toBe(200)
    expect(before[0].count).toBe(0)
    expect(after[0].count).toBe(0)
    expect(body.storageTrend.every((point) => point.usedBytes === null)).toBe(true)
  })

  it('excludes orphan actors and uses immutable session creation time for historical active users', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    const [{ id: orgId }] = await db.all<{ id: string }>(sql`SELECT id FROM organization LIMIT 1`)
    const [{ id: userId }] = await db.all<{ id: string }>(sql`SELECT id FROM user LIMIT 1`)
    const created = Math.floor(Date.UTC(2026, 0, 2, 12) / 1000)
    await db.run(sql`
      INSERT INTO activity_events (id, org_id, user_id, actor_type, action, target_type, target_name, created_at)
      VALUES
        ('valid-historical-activity', ${orgId}, ${userId}, 'user', 'login', 'user', 'valid', ${created}),
        ('orphan-historical-activity', ${orgId}, 'deleted-user', 'user', 'login', 'user', 'orphan', ${created})
    `)

    const res = await app.request('/api/site/stats/overview?from=2026-01-02&to=2026-01-02', { headers })
    const body = (await res.json()) as { totals: { activeUsers: { value: number } } }

    expect(res.status).toBe(200)
    expect(body.totals.activeUsers.value).toBe(1)
  })

  it('returns null for empty success-rate samples and counts upload cancellations as failures', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await seedProLicense(db)
    const { orgId, userId } = await seedStatsFixture(db)
    const nowSec = Math.floor(Date.now() / 1000)
    await db.run(sql`
      INSERT INTO activity_events (id, org_id, user_id, actor_type, action, target_type, target_name, metadata, created_at)
      VALUES ('upload-cancel-rate', ${orgId}, ${userId}, 'user', 'upload_cancel', 'file', 'cancel.bin',
        '{"source":"upload","status":"canceled"}', ${nowSec})
    `)

    const current = await app.request('/api/site/stats/traffic', { headers })
    const currentBody = (await current.json()) as {
      summary: { requestCount: { changePercent: number | null } }
      successTrend: Array<{ uploadSuccessRate: number | null }>
    }
    const empty = await app.request('/api/site/stats/traffic?from=2000-01-01&to=2000-01-01', { headers })
    const emptyBody = (await empty.json()) as {
      successTrend: Array<{ uploadSuccessRate: number | null; downloadSuccessRate: number | null }>
    }

    expect(currentBody.successTrend.some((point) => point.uploadSuccessRate === 50)).toBe(true)
    expect(currentBody.summary.requestCount.changePercent).toBeNull()
    expect(emptyBody.successTrend).toEqual([{ date: '2000-01-01', uploadSuccessRate: null, downloadSuccessRate: null }])
  })

  it('reports incomplete transfer byte metadata for the selected and comparison ranges', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    const { orgId, userId } = await seedStatsFixture(db)
    await db.run(sql`
      INSERT INTO activity_events
        (id, org_id, user_id, actor_type, action, target_type, target_name, metadata, created_at)
      VALUES
        ('missing-current-upload-bytes', ${orgId}, ${userId}, 'user', 'upload_confirm', 'file', 'current.bin', '{}',
          ${Math.floor(Date.parse('2026-07-01T12:00:00.000Z') / 1000)}),
        ('missing-previous-download-bytes', ${orgId}, ${userId}, 'user', 'share_download', 'share', 'previous.bin', '{}',
          ${Math.floor(Date.parse('2026-06-30T12:00:00.000Z') / 1000)})
    `)

    const res = await app.request('/api/site/stats/overview?from=2026-07-01&to=2026-07-01', { headers })
    const body = (await res.json()) as { dataQuality: AdminDashboardOverviewStats['dataQuality'] }

    expect(res.status).toBe(200)
    expect(body.dataQuality).toEqual({
      missingUploadBytesEvents: 1,
      previousMissingUploadBytesEvents: 0,
      missingDownloadBytesEvents: 0,
      previousMissingDownloadBytesEvents: 1,
    })
  })

  it('excludes expired and exhausted shares from the active-share total', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await seedProLicense(db)
    const { orgId, userId } = await seedStatsFixture(db)
    const nowSec = Math.floor(Date.now() / 1000)
    await db.run(sql`
      INSERT INTO shares (id, token, kind, matter_id, org_id, creator_id, expires_at, download_limit, views, downloads, status, created_at)
      VALUES
        ('expired-share', 'expired-share', 'landing', 'stats-file', ${orgId}, ${userId}, ${nowSec - 60}, NULL, 0, 0, 'active', ${nowSec}),
        ('exhausted-share', 'exhausted-share', 'direct', 'stats-file', ${orgId}, ${userId}, NULL, 1, 0, 1, 'active', ${nowSec})
    `)

    const res = await app.request('/api/site/stats/sharing', { headers })
    const body = (await res.json()) as { summary: { activeShares: number } }

    expect(res.status).toBe(200)
    expect(body.summary.activeShares).toBe(1)
  })

  it('returns traffic dashboard stats from audit-backed download events for Pro admins', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await seedProLicense(db)
    await seedStatsFixture(db)

    const res = await app.request('/api/site/stats/traffic', { headers })
    const body = (await res.json()) as {
      summary: {
        totalBytes: { value: number }
        requestCount: { value: number }
        issuedDownloads: number
        blockedDownloads: number
      }
      sourceBreakdown: Array<{ name: string; bytes: number; requests: number }>
      successTrend: Array<{ uploadSuccessRate: number; downloadSuccessRate: number }>
      failureReasons: Array<{ name: string; value: number; percent: number }>
    }

    expect(res.status).toBe(200)
    expect(body.summary.totalBytes.value).toBe(896)
    expect(body.summary.requestCount.value).toBe(3)
    expect(body.summary.issuedDownloads).toBe(2)
    expect(body.summary.blockedDownloads).toBe(0)
    expect(body.sourceBreakdown).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'upload', bytes: 128, requests: 1 }),
        expect.objectContaining({ name: 'landing_share', bytes: 512, requests: 1 }),
        expect.objectContaining({ name: 'object_download', bytes: 256, requests: 1 }),
      ]),
    )
    expect(
      body.successTrend.some((point) => point.uploadSuccessRate === 100 && point.downloadSuccessRate === 100),
    ).toBe(true)
    expect(body.failureReasons).toEqual([])
  })

  it('applies dashboard ranges to sharing and ranking drill-down data', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await seedProLicense(db)
    await seedStatsFixture(db)

    const currentSharingRes = await app.request('/api/site/stats/sharing', { headers })
    const currentSharing = (await currentSharingRes.json()) as {
      summary: { views: { value: number }; downloads: { value: number } }
      topShares: Array<{
        token: string
        views: number
        downloads: number
        viewPercent: number
        downloadPercent: number
      }>
    }
    const oldSharingRes = await app.request('/api/site/stats/sharing?from=2000-01-01&to=2000-01-02', { headers })
    const oldSharing = (await oldSharingRes.json()) as {
      summary: { views: { value: number }; downloads: { value: number } }
      topShares: unknown[]
    }
    const currentRankingRes = await app.request('/api/site/stats/ranking', { headers })
    const currentRanking = (await currentRankingRes.json()) as {
      topSpaces: unknown[]
      storageByType: unknown[]
      topShares: unknown[]
    }
    const oldRankingRes = await app.request('/api/site/stats/ranking?from=2000-01-01&to=2000-01-02', { headers })
    const oldRanking = (await oldRankingRes.json()) as {
      topSpaces: unknown[]
      storageByType: unknown[]
      topShares: unknown[]
    }

    expect(currentSharingRes.status).toBe(200)
    expect(currentSharing.summary.views.value).toBe(1)
    expect(currentSharing.summary.downloads.value).toBe(1)
    expect(currentSharing.topShares[0]).toMatchObject({
      token: 'share-token-1',
      views: 1,
      downloads: 1,
      viewPercent: 100,
      downloadPercent: 100,
    })
    expect(oldSharing.summary.views.value).toBe(0)
    expect(oldSharing.summary.downloads.value).toBe(0)
    expect(oldSharing.topShares).toEqual([])
    expect(currentRanking.topSpaces.length).toBeGreaterThan(0)
    expect(currentRanking.storageByType.length).toBeGreaterThan(0)
    expect(currentRanking.topShares.length).toBeGreaterThan(0)
    expect(oldRanking.topSpaces).toEqual([])
    expect(oldRanking.storageByType).toEqual([])
    expect(oldRanking.topShares).toEqual([])
  })

  it('orders top share rankings by views before downloads', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await seedProLicense(db)
    const { orgId, userId } = await seedStatsFixture(db)
    const nowSec = Math.floor(Date.now() / 1000)
    const futureSec = nowSec + 7 * 24 * 60 * 60

    await db.run(sql`
      INSERT INTO shares (id, token, kind, matter_id, org_id, creator_id, expires_at, download_limit, views, downloads, status, created_at)
      VALUES ('share-download-heavy', 'share-download-heavy', 'landing', 'stats-file', ${orgId}, ${userId}, ${futureSec}, 10, 0, 3, 'active', ${nowSec})
    `)
    await db.run(sql`
      INSERT INTO activity_events (id, org_id, user_id, actor_type, action, target_type, target_id, target_name, metadata, created_at)
      VALUES
        ('activity-download-heavy-1', ${orgId}, NULL, 'anonymous', 'share_download', 'share', 'share-download-heavy', 'report.pdf', '{"bytes":512,"source":"landing_share","anonymous":true}', ${nowSec}),
        ('activity-download-heavy-2', ${orgId}, NULL, 'anonymous', 'share_download', 'share', 'share-download-heavy', 'report.pdf', '{"bytes":512,"source":"landing_share","anonymous":true}', ${nowSec}),
        ('activity-download-heavy-3', ${orgId}, NULL, 'anonymous', 'share_download', 'share', 'share-download-heavy', 'report.pdf', '{"bytes":512,"source":"landing_share","anonymous":true}', ${nowSec})
    `)

    const res = await app.request('/api/site/stats/ranking', { headers })
    const body = (await res.json()) as { topShares: Array<{ token: string; views: number; downloads: number }> }

    expect(res.status).toBe(200)
    expect(body.topShares[0]).toMatchObject({ token: 'share-token-1', views: 1, downloads: 1 })
    expect(body.topShares[1]).toMatchObject({ token: 'share-download-heavy', views: 0, downloads: 3 })
  })

  it('calculates top-share percentages against all matching shares before the top-eight limit', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await seedProLicense(db)
    const { orgId, userId } = await seedStatsFixture(db)
    const nowSec = Math.floor(Date.now() / 1000)
    for (let index = 2; index <= 9; index += 1) {
      const id = `share-percent-${index}`
      await db.run(sql`
        INSERT INTO shares (id, token, kind, matter_id, org_id, creator_id, expires_at, download_limit, views, downloads, status, created_at)
        VALUES (${id}, ${id}, 'landing', 'stats-file', ${orgId}, ${userId}, NULL, NULL, 1, 0, 'active', ${nowSec})
      `)
      await db.run(sql`
        INSERT INTO activity_events (id, org_id, user_id, actor_type, action, target_type, target_id, target_name, metadata, created_at)
        VALUES (${`view-percent-${index}`}, ${orgId}, NULL, 'anonymous', 'share_view', 'share', ${id}, 'report.pdf',
          '{"source":"landing_share"}', ${nowSec})
      `)
    }

    const res = await app.request('/api/site/stats/ranking', { headers })
    const body = (await res.json()) as { topShares: Array<{ viewPercent: number }> }

    expect(res.status).toBe(200)
    expect(body.topShares).toHaveLength(8)
    expect(body.topShares.every((share) => share.viewPercent === 11.1)).toBe(true)
  })
})

async function seedStatsFixture(db: Awaited<ReturnType<typeof createTestApp>>['db']) {
  const now = Date.now()
  const nowSec = Math.floor(now / 1000)
  const future = now + 7 * 24 * 60 * 60 * 1000
  const futureSec = Math.floor(future / 1000)
  const period = currentTrafficPeriod(new Date(now))
  const [{ id: orgId }] = await db.all<{ id: string }>(
    sql`SELECT id FROM organization WHERE metadata LIKE '%"type":"personal"%' LIMIT 1`,
  )
  const [{ id: userId }] = await db.all<{ id: string }>(sql`SELECT id FROM user LIMIT 1`)

  await db.run(sql`
    UPDATE org_quotas
    SET used = 512, traffic_used = 256, traffic_period = ${period}
    WHERE org_id = ${orgId}
  `)
  await db.run(sql`
    INSERT INTO storages (id, bucket, endpoint, region, access_key, secret_key, file_path, custom_host, capacity, used, status, created_at, updated_at)
    VALUES ('stats-storage', 'stats-bucket', 'https://s3.example', 'auto', 'AK', 'SK', '', '', 2048, 512, 'active', ${nowSec}, ${nowSec})
  `)
  await db.run(sql`
    INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, created_at, updated_at)
    VALUES ('stats-file', ${orgId}, 'stats-file-alias', 'report.pdf', 'application/pdf', 512, 0, '', 'files/report.pdf', 'stats-storage', 'active', ${nowSec}, ${nowSec})
  `)
  await db.run(sql`
    INSERT INTO shares (id, token, kind, matter_id, org_id, creator_id, expires_at, download_limit, views, downloads, status, created_at)
    VALUES ('share-1', 'share-token-1', 'landing', 'stats-file', ${orgId}, ${userId}, ${futureSec}, 10, 12, 4, 'active', ${nowSec})
  `)
  await db.run(sql`
    INSERT INTO site_invitations (id, email, token, invited_by, accepted_by, accepted_at, revoked_by, revoked_at, expires_at, created_at, updated_at)
    VALUES ('invite-1', 'new@example.com', 'invite-token', ${userId}, NULL, NULL, NULL, NULL, ${futureSec}, ${nowSec}, ${nowSec})
  `)
  await db.run(sql`
    INSERT INTO activity_events (id, org_id, user_id, action, target_type, target_id, target_name, metadata, created_at)
    VALUES ('activity-1', ${orgId}, ${userId}, 'upload', 'file', 'stats-file', 'report.pdf', NULL, ${nowSec})
  `)
  await db.run(sql`
    INSERT INTO activity_events (id, org_id, user_id, actor_type, action, target_type, target_id, target_name, metadata, created_at)
    VALUES
      ('activity-upload-confirm', ${orgId}, ${userId}, 'user', 'upload_confirm', 'file', 'stats-file', 'report.pdf', '{"bytes":128,"source":"upload"}', ${nowSec}),
      ('activity-share-view', ${orgId}, NULL, 'anonymous', 'share_view', 'share', 'share-1', 'report.pdf', '{"source":"landing_share","anonymous":true}', ${nowSec}),
      ('activity-share-password', ${orgId}, NULL, 'anonymous', 'share_password_passed', 'share', 'share-1', 'report.pdf', '{"source":"landing_share","anonymous":true}', ${nowSec}),
      ('activity-share-download', ${orgId}, NULL, 'anonymous', 'share_download', 'share', 'share-1', 'report.pdf', '{"bytes":512,"source":"landing_share","anonymous":true}', ${nowSec}),
      ('activity-object-download', ${orgId}, ${userId}, 'user', 'object_download', 'file', 'stats-file', 'report.pdf', '{"bytes":256,"source":"object_download"}', ${nowSec})
  `)
  await db.run(sql`
    INSERT INTO downloaders (id, name, token_hash, token_jti, status, enabled, version, hostname, platform, arch, engine, capabilities, max_concurrent_tasks, current_tasks, download_bps, upload_bps, free_disk_bytes, created_by, last_heartbeat_at, created_at, updated_at)
    VALUES ('downloader-1', 'Downloader One', 'hash', 'jti', 'online', 1, '1.0.0', 'host', 'linux', 'x64', 'http', '[]', 2, 0, 0, 0, 1000, ${userId}, ${now}, ${now}, ${now})
  `)
  await db.run(sql`
    INSERT INTO download_tasks (id, org_id, created_by_user_id, source_type, source_uri, display_name, target_folder, category, tags, assigned_downloader_id, status, error_code, error_message, created_at, updated_at)
    VALUES
      ('task-1', ${orgId}, ${userId}, 'http', 'https://example.com/ok.bin', 'ok.bin', '', 'direct', '[]', 'downloader-1', 'completed', NULL, NULL, ${now}, ${now}),
      ('task-2', ${orgId}, ${userId}, 'http', 'https://example.com/bad.bin', 'bad.bin', '', 'direct', '[]', 'downloader-1', 'failed', 'network', 'Network error', ${now}, ${now})
  `)
  await db.run(sql`
    INSERT INTO background_jobs (id, org_id, user_id, type, status, target_folder, target_path, metadata, input_bytes, output_bytes, processed_bytes, file_count, current_filename, error_message, result_metadata, retryable, cancelable, retried_from_job_id, created_at, updated_at, started_at, finished_at)
    VALUES ('job-1', ${orgId}, ${userId}, 'extract', 'failed', '', '', NULL, 0, 0, 0, 0, NULL, 'bad zip', NULL, 1, 0, NULL, ${now}, ${now}, ${now}, ${now})
  `)

  return { orgId, userId }
}
