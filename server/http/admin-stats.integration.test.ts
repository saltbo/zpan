import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { currentTrafficPeriod } from '../domain/quota'
import { adminHeaders, createTestApp, seedProLicense } from '../test/setup.js'

describe('admin stats routes', () => {
  it('returns core dashboard stats for admins without a Pro license', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    const { orgId, userId } = await seedStatsFixture(db)

    const res = await app.request('/api/admin/stats/core', { headers })
    const body = (await res.json()) as {
      users: { total: number; admins: number }
      storage: { usedBytes: number; backendCount: number }
      sharing: { views: number; downloads: number }
      operations: { pendingInvitations: number }
    }

    expect(res.status).toBe(200)
    expect(orgId).toBeTruthy()
    expect(userId).toBeTruthy()
    expect(body.users.total).toBeGreaterThanOrEqual(1)
    expect(body.users.admins).toBe(1)
    expect(body.storage.usedBytes).toBe(512)
    expect(body.storage.backendCount).toBe(1)
    expect(body.sharing.views).toBe(12)
    expect(body.sharing.downloads).toBe(4)
    expect(body.operations.pendingInvitations).toBe(1)
  })

  it('gates detailed dashboard stats behind the analytics feature', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await seedStatsFixture(db)

    const res = await app.request('/api/admin/stats/details', { headers })
    const body = (await res.json()) as { error: { details: Array<{ metadata: Record<string, string> }> } }

    expect(res.status).toBe(402)
    expect(body.error.details[0].metadata.feature).toBe('analytics')
  })

  it('returns detailed dashboard stats for Pro admins', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await seedProLicense(db)
    await seedStatsFixture(db)

    const res = await app.request('/api/admin/stats/details?periodDays=7', { headers })
    const body = (await res.json()) as {
      periodDays: number
      trends: Array<{ remoteTasks: number; failedJobs: number }>
      topShares: Array<{ token: string; views: number }>
      remoteDownloads: { total: number; completed: number; failed: number; successRate: number }
      reliability: {
        backgroundJobs: { failed: number }
        license: { active: boolean; edition: string; lastRefreshAt: string }
      }
    }

    expect(res.status).toBe(200)
    expect(body.periodDays).toBe(7)
    expect(body.topShares[0]).toMatchObject({ token: 'share-token-1', views: 12 })
    expect(body.remoteDownloads).toMatchObject({ total: 2, completed: 1, failed: 1, successRate: 50 })
    expect(body.reliability.backgroundJobs.failed).toBe(1)
    expect(body.reliability.license).toMatchObject({ active: true, edition: 'pro' })
    expect(body.reliability.license.lastRefreshAt).toMatch(/^20\d{2}-/)
    expect(body.trends.some((point) => point.remoteTasks > 0 || point.failedJobs > 0)).toBe(true)
  })

  it('returns traffic dashboard stats from audit-backed download events for Pro admins', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await seedProLicense(db)
    await seedStatsFixture(db)

    const res = await app.request(
      '/api/admin/stats/traffic?from=2020-01-01T00:00:00.000Z&to=2100-01-01T00:00:00.000Z',
      {
        headers,
      },
    )
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
