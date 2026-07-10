import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { currentTrafficPeriod } from '../domain/quota'
import { adminHeaders, createTestApp, seedProLicense } from '../test/setup.js'

describe('admin stats routes', () => {
  it('does not expose legacy core or details stats endpoints', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)

    const coreRes = await app.request('/api/admin/stats/core', { headers })
    const detailsRes = await app.request('/api/admin/stats/details', { headers })

    expect(coreRes.status).toBe(404)
    expect(detailsRes.status).toBe(404)
  })

  it('gates advanced dashboard stats behind the analytics feature', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await seedStatsFixture(db)

    const res = await app.request('/api/admin/stats/storage', { headers })
    const body = (await res.json()) as { error: { details: Array<{ metadata: Record<string, string> }> } }

    expect(res.status).toBe(402)
    expect(body.error.details[0].metadata.feature).toBe('analytics')
  })

  it('normalizes date-only dashboard ranges to exact daily buckets', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)

    const res = await app.request('/api/admin/stats/overview?from=2026-01-01&to=2026-01-07', { headers })
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

  it('rejects dashboard ranges longer than one year', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)

    const res = await app.request('/api/admin/stats/overview?from=2025-01-01&to=2026-01-02', { headers })

    expect(res.status).toBe(400)
  })

  it('does not publish admin stats routes in the OpenAPI document', async () => {
    const { app } = await createTestApp()

    const res = await app.request('/api/openapi.json')
    const body = (await res.json()) as { paths: Record<string, unknown> }

    expect(res.status).toBe(200)
    expect(Object.keys(body.paths).some((path) => path.startsWith('/api/admin/stats'))).toBe(false)
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

    const res = await app.request('/api/admin/stats/storage?from=2026-01-01&to=2026-01-01', { headers })
    const body = (await res.json()) as {
      storageTrend: Array<{ date: string; usedBytes: number; newBytes: number; newFiles: number }>
    }

    expect(res.status).toBe(200)
    expect(body.storageTrend).toEqual([{ date: '2026-01-01', usedBytes: 4096, newBytes: 0, newFiles: 0 }])
  })

  it('does not write rollups while serving storage stats fallback data', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await seedProLicense(db)
    await seedStatsFixture(db)

    const before = await db.all<{ count: number }>(sql`SELECT COUNT(*) AS count FROM stats_rollups_daily`)
    const res = await app.request('/api/admin/stats/storage?from=2000-01-01&to=2000-01-02', { headers })
    const after = await db.all<{ count: number }>(sql`SELECT COUNT(*) AS count FROM stats_rollups_daily`)

    expect(res.status).toBe(200)
    expect(before[0].count).toBe(0)
    expect(after[0].count).toBe(0)
  })

  it('returns traffic dashboard stats from audit-backed download events for Pro admins', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await seedProLicense(db)
    await seedStatsFixture(db)

    const res = await app.request('/api/admin/stats/traffic', { headers })
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

    const currentSharingRes = await app.request('/api/admin/stats/sharing', { headers })
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
    const oldSharingRes = await app.request('/api/admin/stats/sharing?from=2000-01-01&to=2000-01-02', { headers })
    const oldSharing = (await oldSharingRes.json()) as {
      summary: { views: { value: number }; downloads: { value: number } }
      topShares: unknown[]
    }
    const currentRankingRes = await app.request('/api/admin/stats/ranking', { headers })
    const currentRanking = (await currentRankingRes.json()) as {
      topSpaces: unknown[]
      storageByType: unknown[]
      topShares: unknown[]
    }
    const oldRankingRes = await app.request('/api/admin/stats/ranking?from=2000-01-01&to=2000-01-02', { headers })
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

    const res = await app.request('/api/admin/stats/ranking', { headers })
    const body = (await res.json()) as { topShares: Array<{ token: string; views: number; downloads: number }> }

    expect(res.status).toBe(200)
    expect(body.topShares[0]).toMatchObject({ token: 'share-token-1', views: 1, downloads: 1 })
    expect(body.topShares[1]).toMatchObject({ token: 'share-download-heavy', views: 0, downloads: 3 })
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
