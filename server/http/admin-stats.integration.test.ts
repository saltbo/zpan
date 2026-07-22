import type { AdminDashboardOverviewStats } from '@shared/types'
import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { createAdminStatsRepo, metricSpec } from '../adapters/repos/admin-stats'
import { ensureAdminStatsIntegrityOpening } from '../adapters/repos/admin-stats-integrity'
import { captureAdminStatsSnapshot, rebuildAdminStatsHour } from '../adapters/repos/admin-stats-rollup'
import { createCloudTrafficReportRepo } from '../adapters/repos/cloud-traffic-report'
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
    const rankingRes = await app.request('/api/site/stats/ranking', { headers })

    expect(coreRes.status).toBe(404)
    expect(detailsRes.status).toBe(404)
    expect(rankingRes.status).toBe(404)
  })

  it('rejects unsupported hourly activity metric definitions', () => {
    expect(() => metricSpec(['unknown_action'])).toThrow('Unsupported hourly activity metric: unknown_action')
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

  it('accepts exact UTC hourly boundaries', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)
    const from = encodeURIComponent('2026-07-01T10:00:00.000Z')
    const to = encodeURIComponent('2026-07-01T10:59:59.999Z')

    const res = await app.request(`/api/site/stats/overview?from=${from}&to=${to}&timeZone=UTC`, {
      headers,
    })
    const body = (await res.json()) as { from: string; to: string; trends: Array<{ date: string }> }

    expect(res.status).toBe(200)
    expect(body.from).toBe('2026-07-01T10:00:00.000Z')
    expect(body.to).toBe('2026-07-01T10:59:59.999Z')
    expect(body.trends.map((point) => point.date)).toEqual(['2026-07-01'])
  })

  it('rejects partial-hour ranges that cannot map to offline result buckets', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)
    const from = encodeURIComponent('2026-07-01T10:30:00.000Z')
    const to = encodeURIComponent('2026-07-01T10:59:59.999Z')

    const res = await app.request(`/api/site/stats/overview?from=${from}&to=${to}&timeZone=UTC`, { headers })

    expect(res.status).toBe(400)
  })

  it('rejects ranges with no closed offline result bucket', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)
    const nextHour = Math.floor(Date.now() / 3_600_000) * 3_600_000 + 3_600_000
    const from = encodeURIComponent(new Date(nextHour).toISOString())
    const to = encodeURIComponent(new Date(nextHour + 3_600_000 - 1).toISOString())

    const res = await app.request(`/api/site/stats/overview?from=${from}&to=${to}&timeZone=UTC`, { headers })

    expect(res.status).toBe(400)
  })

  it('rejects local reporting zones because offline result buckets are UTC-only', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)

    const res = await app.request('/api/site/stats/overview?from=2026-07-01&to=2026-07-01&timeZone=America%2FToronto', {
      headers,
    })

    expect(res.status).toBe(400)
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

  it('reads storage waterline trends from hourly rollups when present', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await seedProLicense(db)
    await seedStatsFixture(db)

    await db.run(sql`
      INSERT INTO stats_rollups_hourly (
        id, bucket_start, org_id, metric_key, dimension_key, dimension_value,
        count, bytes, unique_count, metadata, updated_at
      )
      VALUES (
        'storage-marker-2026-01-01', ${Date.UTC(2026, 0, 1)}, '', 'stats.rollup_run', '', '',
        1, 0, 0, '{"version":3,"scope":"full","quality":"exact"}', ${Date.UTC(2026, 0, 2)}
      ), (
        'storage-used-2026-01-01', ${Date.UTC(2026, 0, 1)}, '', 'storage.ledger_balance', '', '',
        0, 4096, 0, '{"version":3,"scope":"counters","quality":"exact"}', ${Date.UTC(2026, 0, 2)}
      )
    `)

    const res = await app.request('/api/site/stats/storage?from=2026-01-01&to=2026-01-01', { headers })
    const body = (await res.json()) as {
      storageTrend: Array<{ date: string; usedBytes: number; newBytes: number; newFiles: number }>
    }

    expect(res.status).toBe(200)
    expect(body.storageTrend).toEqual([{ date: '2026-01-01', usedBytes: 4096, newBytes: 0, newFiles: 0 }])
  })

  it('reads only hourly rollups and never falls back to raw events', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await seedProLicense(db)
    const [{ id: orgId }] = await db.all<{ id: string }>(sql`SELECT id FROM organization LIMIT 1`)
    const at = Date.UTC(2026, 6, 1, 10)
    await createCloudTrafficReportRepo(db).ensureLedgerOpening(new Date(at - 3_600_000))
    await db.run(sql`
      INSERT INTO audit_events (
        id, org_id, user_id, actor_type, action, target_type, target_id, target_name, metadata, created_at
      ) VALUES (
        'hourly-reader-raw', ${orgId}, NULL, 'system', 'upload_confirm', 'file', 'old-file', 'old.bin',
        '{"bytes":111,"source":"upload"}', ${Math.floor(at / 1000) + 60}
      )
    `)
    await db.run(sql`
      INSERT INTO stats_rollups_hourly (
        id, bucket_start, org_id, metric_key, dimension_key, dimension_value,
        count, bytes, unique_count, metadata, updated_at
      ) VALUES
        ('hourly-reader-marker', ${at}, '', 'stats.rollup_run', '', '', 1, 0, 0,
          '{"version":3,"scope":"full","quality":"exact"}', ${at + 3_600_000}),
        ('hourly-reader-upload', ${at}, ${orgId}, 'transfer.upload', 'status', 'success', 1, 999, 0,
          '{"version":3,"scope":"counters","quality":"exact"}', ${at + 3_600_000})
    `)

    const query =
      '/api/site/stats/traffic?from=2026-07-01T10%3A00%3A00.000Z&to=2026-07-01T10%3A59%3A59.999Z&timeZone=UTC'
    const rollupRes = await app.request(query, { headers })
    const rollupBody = (await rollupRes.json()) as {
      coverage: { status: string; completedBuckets: number; expectedBuckets: number }
      comparisonCoverage: { status: string; completedBuckets: number; expectedBuckets: number }
      summary: { totalBytes: { value: number } }
    }

    await db.run(sql`DELETE FROM stats_rollups_hourly WHERE id = 'hourly-reader-upload'`)
    const emptyRes = await app.request(query, { headers })
    const emptyBody = (await emptyRes.json()) as { summary: { totalBytes: { value: number } } }

    expect(rollupRes.status).toBe(200)
    expect(rollupBody.summary.totalBytes.value).toBe(999)
    expect(rollupBody.coverage).toMatchObject({ status: 'complete', completedBuckets: 1, expectedBuckets: 1 })
    expect(rollupBody.comparisonCoverage).toMatchObject({ status: 'empty', completedBuckets: 0, expectedBuckets: 1 })
    expect(emptyRes.status).toBe(200)
    expect(emptyBody.summary.totalBytes.value).toBe(0)
  })

  it('hydrates completed-hour dashboard dimensions from rollups', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await seedProLicense(db)
    const [{ id: orgId }] = await db.all<{ id: string }>(sql`SELECT id FROM organization LIMIT 1`)
    const at = Date.UTC(2026, 6, 1, 10)
    await createCloudTrafficReportRepo(db).ensureLedgerOpening(new Date(at - 3_600_000))
    await db.run(sql`
      INSERT INTO stats_rollups_hourly
        (id, bucket_start, org_id, metric_key, dimension_key, dimension_value,
          count, bytes, unique_count, metadata, updated_at)
      VALUES
        ('dimensions-marker', ${at}, '', 'stats.rollup_run', '', '', 1, 0, 0, '{"version":3,"scope":"full","quality":"exact"}', ${at}),
        ('dimensions-share-total', ${at}, ${orgId}, 'share.created', '', '', 1, 0, 0, '{"version":3,"scope":"counters","quality":"exact"}', ${at}),
        ('dimensions-share-kind', ${at}, ${orgId}, 'share.created', 'kind', 'landing', 1, 0, 0, '{"version":3,"scope":"counters","quality":"exact"}', ${at}),
        ('dimensions-job-total', ${at}, ${orgId}, 'background_job.finished', '', '', 1, 0, 0, '{"version":3,"scope":"counters","quality":"exact"}', ${at}),
        ('dimensions-job-outcome', ${at}, ${orgId}, 'background_job.finished', 'outcome', 'failed', 1, 0, 0, '{"version":3,"scope":"counters","quality":"exact"}', ${at}),
        ('dimensions-download-total', ${at}, ${orgId}, 'transfer.download_issued', '', '', 1, 10, 0, '{"version":3,"scope":"counters","quality":"exact"}', ${at}),
        ('dimensions-download-source', ${at}, ${orgId}, 'transfer.download_issued', 'source', 'object_download', 1, 10, 0, '{"version":3,"scope":"counters","quality":"exact"}', ${at}),
        ('dimensions-failure-total', ${at}, ${orgId}, 'transfer.download_failed', '', '', 1, 4, 0, '{"version":3,"scope":"counters","quality":"exact"}', ${at}),
        ('dimensions-failure-reason', ${at}, ${orgId}, 'transfer.download_failed', 'reason', 'network', 1, 4, 0, '{"version":3,"scope":"counters","quality":"exact"}', ${at}),
        ('dimensions-quality-total', ${at}, ${orgId}, 'stats.quality_missing_bytes', '', '', 5, 0, 0, '{"version":3,"scope":"counters","quality":"exact"}', ${at}),
        ('dimensions-quality-upload', ${at}, ${orgId}, 'stats.quality_missing_bytes', 'direction', 'upload', 2, 0, 0, '{"version":3,"scope":"counters","quality":"exact"}', ${at}),
        ('dimensions-quality-download', ${at}, ${orgId}, 'stats.quality_missing_bytes', 'direction', 'download', 3, 0, 0, '{"version":3,"scope":"counters","quality":"exact"}', ${at})
    `)
    const query = 'from=2026-07-01T10%3A00%3A00.000Z&to=2026-07-01T10%3A59%3A59.999Z&timeZone=UTC'

    const [overviewRes, operationsRes, sharingRes, trafficRes] = await Promise.all([
      app.request(`/api/site/stats/overview?${query}`, { headers }),
      app.request(`/api/site/stats/operations?${query}`, { headers }),
      app.request(`/api/site/stats/sharing?${query}`, { headers }),
      app.request(`/api/site/stats/traffic?${query}`, { headers }),
    ])
    const overview = (await overviewRes.json()) as { dataQuality: AdminDashboardOverviewStats['dataQuality'] }
    const operations = (await operationsRes.json()) as { backgroundJobOutcomes: Array<{ name: string; value: number }> }
    const sharing = (await sharingRes.json()) as {
      summary: { createdShares: { value: number } }
      typeBreakdown: Array<{ name: string; value: number }>
    }
    const traffic = (await trafficRes.json()) as {
      summary: { requestCount: { value: number } }
      sourceBreakdown: Array<{ name: string; requests: number; bytes: number }>
      failureReasons: Array<{ name: string; value: number }>
    }

    expect([overviewRes.status, operationsRes.status, sharingRes.status, trafficRes.status]).toEqual([
      200, 200, 200, 200,
    ])
    expect(overview.dataQuality).toMatchObject({ missingUploadBytesEvents: 2, missingDownloadBytesEvents: 3 })
    expect(operations.backgroundJobOutcomes).toContainEqual(expect.objectContaining({ name: 'failed', value: 1 }))
    expect(sharing.summary.createdShares.value).toBe(1)
    expect(sharing.typeBreakdown).toContainEqual(expect.objectContaining({ name: 'landing', value: 1 }))
    expect(traffic.summary.requestCount.value).toBe(2)
    expect(traffic.sourceBreakdown).toEqual([])
    expect(traffic.failureReasons).toContainEqual(expect.objectContaining({ name: 'network', value: 1 }))
  })

  it('refreshes exact hourly storage snapshots', async () => {
    const { app, db } = await createTestApp()
    await adminHeaders(app)
    await seedStatsFixture(db)
    const [{ expected }] = await db.all<{ expected: number }>(
      sql`SELECT COALESCE(SUM(used), 0) AS expected FROM org_quotas`,
    )
    const repo = createAdminStatsRepo(db)
    const firstNow = new Date('2026-07-10T04:05:00.000Z')
    const secondNow = new Date('2026-07-10T18:05:00.000Z')

    await repo.refreshHourlyRollups(firstNow)
    await repo.refreshHourlyRollups(secondNow)
    const rows = await db.all<{ bucketStart: number; bytes: number; metadata: string }>(sql`
      SELECT bucket_start AS bucketStart, bytes, metadata
      FROM stats_rollups_hourly
      WHERE metric_key = 'storage.used' AND org_id = '' AND dimension_key = ''
      ORDER BY bucket_start, org_id
    `)

    expect(rows.map((row) => Number(row.bucketStart))).toContain(Date.UTC(2026, 6, 10, 18))
    expect(
      rows
        .filter((row) => Number(row.bucketStart) === Date.UTC(2026, 6, 10, 18))
        .reduce((sum, row) => sum + row.bytes, 0),
    ).toBe(expected)
    expect(JSON.parse(rows.at(-1)?.metadata ?? '{}')).toMatchObject({ version: 3, quality: 'exact' })
  })

  it('does not write rollups while serving storage stats', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await seedProLicense(db)
    await seedStatsFixture(db)

    const before = await db.all<{ count: number }>(sql`SELECT COUNT(*) AS count FROM stats_rollups_hourly`)
    const res = await app.request('/api/site/stats/storage?from=2000-01-01&to=2000-01-02', { headers })
    const after = await db.all<{ count: number }>(sql`SELECT COUNT(*) AS count FROM stats_rollups_hourly`)
    const body = (await res.json()) as { storageTrend: Array<{ usedBytes: number | null }> }

    expect(res.status).toBe(200)
    expect(after[0].count).toBe(before[0].count)
    expect(body.storageTrend.every((point) => point.usedBytes === null)).toBe(true)
  })

  it('returns growth lifecycle metrics from the hourly-aware repository', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await seedProLicense(db)
    await seedStatsFixture(db)

    const res = await app.request('/api/site/stats/growth', { headers })
    const body = (await res.json()) as {
      summary: {
        totalUsers: number
        newUsers: { value: number }
        activeUsers: { value: number }
        verifiedUsers: number
        bannedUsers: number
        silentUsers: number
      }
      userScaleTrend: Array<{ date: string; newUsers: number; totalUsers: number }>
      activeUserTrend: Array<{ date: string; dau: number; wau: number; mau: number }>
      userStatus: Array<{ name: string; value: number; percent: number }>
      registrationSources: Array<{ name: string; value: number; percent: number }>
    }

    expect(res.status).toBe(200)
    expect(body.summary.totalUsers).toBeGreaterThanOrEqual(1)
    expect(body.summary.newUsers.value).toBeGreaterThanOrEqual(1)
    expect(body.summary.activeUsers.value).toBeGreaterThanOrEqual(1)
    expect(body.summary.verifiedUsers + body.summary.bannedUsers + body.summary.silentUsers).toBeGreaterThanOrEqual(0)
    expect(body.userScaleTrend.length).toBeGreaterThan(0)
    expect(body.activeUserTrend.length).toBeGreaterThan(0)
    expect(body.userStatus.map((row) => row.name)).toEqual(['normal', 'unverified', 'banned', 'silent'])
    expect(body.registrationSources.length).toBeGreaterThan(0)
  })

  it('reads historical signup totals, trends, and providers from completed hourly rollups', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await seedProLicense(db)
    const at = Date.UTC(2026, 0, 1, 10)
    await db.run(sql`
      INSERT INTO stats_rollups_hourly
        (id, bucket_start, org_id, metric_key, dimension_key, dimension_value,
          count, bytes, unique_count, metadata, updated_at)
      VALUES
        ('growth-rollup-marker', ${at}, '', 'stats.rollup_run', '', '', 1, 0, 0,
          '{"version":3,"scope":"full","quality":"exact"}', ${at + 3_600_000}),
        ('growth-rollup-total', ${at}, '', 'user.signup', '', '', 2, 0, 0,
          '{"version":3,"scope":"counters","quality":"exact"}', ${at + 3_600_000}),
        ('growth-inventory-total', ${at}, '', 'user.inventory', '', '', 2, 0, 0,
          '{"version":3,"scope":"snapshots","quality":"exact"}', ${at + 3_600_000}),
        ('growth-rollup-credential', ${at}, '', 'user.signup', 'provider', 'credential', 1, 0, 0,
          '{"version":3,"scope":"counters","quality":"exact"}', ${at + 3_600_000}),
        ('growth-rollup-github', ${at}, '', 'user.signup', 'provider', 'github', 1, 0, 0,
          '{"version":3,"scope":"counters","quality":"exact"}', ${at + 3_600_000})
    `)

    const res = await app.request('/api/site/stats/growth?from=2026-01-01&to=2026-01-01', { headers })
    const body = (await res.json()) as {
      summary: { newUsers: { value: number } }
      userScaleTrend: Array<{ newUsers: number; totalUsers: number }>
      registrationSources: Array<{ name: string; value: number; percent: number }>
    }

    expect(res.status).toBe(200)
    expect(body.summary.newUsers.value).toBe(2)
    expect(body.userScaleTrend).toEqual([{ date: '2026-01-01', newUsers: 2, totalUsers: 2 }])
    expect(body.registrationSources).toEqual(
      expect.arrayContaining([
        { name: 'credential', value: 1, percent: 50 },
        { name: 'github', value: 1, percent: 50 },
      ]),
    )
  })

  it('does not expose raw storage changes until a snapshot rollup completes', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await seedProLicense(db)
    const { orgId, bucketStart } = await seedStatsFixture(db)
    const nowSec = Math.floor(Date.now() / 1000)
    for (let index = 0; index < 9; index += 1) {
      await db.run(sql`
        INSERT INTO matters
          (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, created_at, updated_at)
        VALUES (${`file-type-${index}`}, ${orgId}, ${`file-type-alias-${index}`}, ${`file-${index}`},
          ${`custom/type-${index}`}, ${index + 1}, 0, '', ${`file-${index}`}, 'stats-storage', 'active', ${nowSec}, ${nowSec})
      `)
    }

    const beforeRes = await app.request('/api/site/stats/storage', { headers })
    const before = (await beforeRes.json()) as { typeBreakdown: Array<{ type: string; files: number; bytes: number }> }

    await captureAdminStatsSnapshot(db, bucketStart, new Date(bucketStart.getTime() + 45 * 60_000))
    await rebuildAdminStatsHour(db, bucketStart, new Date())
    const afterRes = await app.request('/api/site/stats/storage', { headers })
    const after = (await afterRes.json()) as { typeBreakdown: Array<{ type: string; files: number; bytes: number }> }

    expect(beforeRes.status).toBe(200)
    expect(before.typeBreakdown).not.toContainEqual(expect.objectContaining({ type: 'custom' }))
    expect(afterRes.status).toBe(200)
    expect(after.typeBreakdown).toContainEqual(expect.objectContaining({ type: 'custom', files: 9 }))
  })

  it('counts quota pressure across every space while bounding the ranking to eight', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await seedProLicense(db)
    const { bucketStart } = await seedStatsFixture(db)
    for (let index = 0; index < 12; index += 1) {
      await db.run(sql`
        INSERT INTO organization (id, name, slug, metadata, created_at, updated_at)
        VALUES (
          ${`quota-pressure-org-${index}`},
          ${`Quota Pressure ${index}`},
          ${`quota-pressure-${index}`},
          '{"type":"team"}',
          ${bucketStart.getTime()},
          ${bucketStart.getTime()}
        )
      `)
      await db.run(sql`
        INSERT INTO org_quotas (id, org_id, quota, used, traffic_quota, traffic_used, traffic_period)
        VALUES (
          ${`quota-pressure-${index}`},
          ${`quota-pressure-org-${index}`},
          100,
          ${index < 9 ? 90 : 110},
          0,
          0,
          '2026-07'
        )
      `)
      await db.run(sql`
        INSERT INTO org_quota_entitlements
          (id, org_id, resource_type, entitlement_type, source, source_id, bytes, starts_at, status, created_at, updated_at)
        VALUES (
          ${`quota-pressure-plan-${index}`},
          ${`quota-pressure-org-${index}`},
          'storage',
          'plan',
          'test',
          ${`quota-pressure-source-${index}`},
          100,
          ${bucketStart.getTime()},
          'active',
          ${bucketStart.getTime()},
          ${bucketStart.getTime()}
        )
      `)
      await db.run(sql`
        INSERT INTO matters
          (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, created_at, updated_at)
        VALUES (
          ${`quota-pressure-file-${index}`},
          ${`quota-pressure-org-${index}`},
          ${`quota-pressure-file-${index}`},
          ${`quota-pressure-file-${index}`},
          'application/octet-stream',
          ${index < 9 ? 90 : 110},
          0,
          '',
          ${`quota-pressure-file-${index}`},
          'stats-storage',
          'active',
          ${Math.floor(bucketStart.getTime() / 1000)},
          ${Math.floor(bucketStart.getTime() / 1000)}
        )
      `)
    }
    await db.run(sql`
      INSERT INTO organization (id, name, slug, metadata, created_at, updated_at)
      VALUES ('quota-invalid-org', 'Invalid Quota', 'quota-invalid', '{"type":"team"}', ${bucketStart.getTime()}, ${bucketStart.getTime()})
    `)
    await db.run(sql`
      INSERT INTO org_quotas (id, org_id, quota, used, traffic_quota, traffic_used, traffic_period)
      VALUES ('quota-invalid', 'quota-invalid-org', 0, 1000, 0, 0, '2026-07')
    `)
    await db.run(sql`
      INSERT INTO matters
        (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, created_at, updated_at)
      VALUES (
        'quota-invalid-file',
        'quota-invalid-org',
        'quota-invalid-file',
        'quota-invalid-file',
        'application/octet-stream',
        1000,
        0,
        '',
        'quota-invalid-file',
        'stats-storage',
        'active',
        ${Math.floor(bucketStart.getTime() / 1000)},
        ${Math.floor(bucketStart.getTime() / 1000)}
      )
    `)
    await captureAdminStatsSnapshot(db, bucketStart, new Date(bucketStart.getTime() + 45 * 60_000))
    await rebuildAdminStatsHour(db, bucketStart, new Date())

    const res = await app.request('/api/site/stats/storage', { headers })
    const body = (await res.json()) as {
      summary: {
        quotaBytes: number | null
        storageUtilization: number | null
        nearQuotaSpaces: number
        overQuotaSpaces: number
        invalidQuotaSpaces: number
      }
      topSpaces: Array<{ orgId: string; utilization: number | null }>
    }

    expect(res.status).toBe(200)
    expect(body.summary.nearQuotaSpaces).toBe(9)
    expect(body.summary.overQuotaSpaces).toBe(3)
    expect(body.summary.invalidQuotaSpaces).toBe(2)
    expect(body.summary.quotaBytes).toBeNull()
    expect(body.summary.storageUtilization).toBeNull()
    expect(body.topSpaces).toHaveLength(8)
    expect(body.topSpaces[0]).toMatchObject({ orgId: 'quota-invalid-org', utilization: null })
  })

  it('omits quota-derived storage values when the usage counter has drifted', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await seedProLicense(db)
    const { orgId, bucketStart } = await seedStatsFixture(db)
    await db.run(sql`UPDATE org_quotas SET used = used + 1 WHERE org_id = ${orgId}`)
    await captureAdminStatsSnapshot(db, bucketStart, new Date(bucketStart.getTime() + 45 * 60_000))
    await rebuildAdminStatsHour(db, bucketStart, new Date())

    const res = await app.request('/api/site/stats/storage', { headers })
    const body = (await res.json()) as {
      summary: {
        storageUsedBytes: number | null
        storageUtilization: number | null
        nearQuotaSpaces: number | null
      }
      topSpaces: unknown[]
      typeBreakdown: unknown[]
    }

    expect(res.status).toBe(200)
    expect(body.summary.storageUsedBytes).toBeNull()
    expect(body.summary.storageUtilization).toBeNull()
    expect(body.summary.nearQuotaSpaces).toBeNull()
    expect(body.topSpaces).toEqual([])
    expect(body.typeBreakdown.length).toBeGreaterThan(0)
  })

  it('reads historical active users from completed snapshots instead of raw activity', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    const [{ id: orgId }] = await db.all<{ id: string }>(sql`SELECT id FROM organization LIMIT 1`)
    const [{ id: userId }] = await db.all<{ id: string }>(sql`SELECT id FROM user LIMIT 1`)
    const created = Math.floor(Date.UTC(2026, 0, 2, 12) / 1000)
    await db.run(sql`
      INSERT INTO audit_events (id, org_id, user_id, actor_type, action, target_type, target_name, created_at)
      VALUES
        ('valid-historical-activity', ${orgId}, ${userId}, 'user', 'login', 'user', 'valid', ${created}),
        ('orphan-historical-activity', ${orgId}, 'deleted-user', 'user', 'login', 'user', 'orphan', ${created})
    `)
    const at = Date.UTC(2026, 0, 2, 12)
    await db.run(sql`
      INSERT INTO stats_rollups_hourly
        (id, bucket_start, org_id, metric_key, dimension_key, dimension_value,
          count, bytes, unique_count, metadata, updated_at)
      VALUES
        ('active-snapshot-marker', ${at}, '', 'stats.rollup_run', '', '', 1, 0, 0,
          '{"version":3,"scope":"full","quality":"exact"}', ${at + 3_600_000}),
        ('active-snapshot-total', ${at}, '', 'user.active_snapshot', '', '', 1, 0, 0,
          '{"version":3,"scope":"snapshots","quality":"exact"}', ${at + 3_600_000}),
        ('active-snapshot-mau', ${at}, '', 'user.active_snapshot', 'window', 'mau', 1, 0, 0,
          '{"version":3,"scope":"snapshots","quality":"exact"}', ${at + 3_600_000})
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
    const { orgId, userId, bucketStart, eventSec } = await seedStatsFixture(db)
    await db.run(sql`
      INSERT INTO object_upload_sessions
        (id, org_id, object_id, storage_id, storage_key, upload_id, part_size, on_conflict, status,
          created_by, expires_at, created_at, updated_at)
      VALUES
        ('upload-cancel-rate', ${orgId}, 'stats-file', 'stats-storage', 'files/cancel.bin', NULL, 5242880,
          'fail', 'aborted', ${userId}, ${eventSec * 1000 + 3600000}, ${eventSec * 1000}, ${eventSec * 1000})
    `)
    await rebuildAdminStatsHour(db, bucketStart, new Date())

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

  it('excludes invalid transfer facts instead of presenting partial values', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await seedProLicense(db)
    const { orgId, userId } = await seedStatsFixture(db)
    await db.run(sql`
      INSERT INTO audit_events
        (id, org_id, user_id, actor_type, action, target_type, target_name, metadata, created_at)
      VALUES
        ('missing-current-upload-bytes', ${orgId}, ${userId}, 'user', 'upload_confirm', 'file', 'current.bin', '{}',
          ${Math.floor(Date.parse('2026-07-01T12:00:00.000Z') / 1000)}),
        ('missing-previous-download-bytes', ${orgId}, ${userId}, 'user', 'share_download', 'share', 'previous.bin', '{}',
          ${Math.floor(Date.parse('2026-06-30T12:00:00.000Z') / 1000)})
    `)
    await rebuildAdminStatsHour(db, new Date('2026-07-01T12:00:00.000Z'), new Date())
    await rebuildAdminStatsHour(db, new Date('2026-06-30T12:00:00.000Z'), new Date())

    const [res, trafficRes, storageRes] = await Promise.all([
      app.request('/api/site/stats/overview?from=2026-07-01&to=2026-07-01', { headers }),
      app.request('/api/site/stats/traffic?from=2026-07-01&to=2026-07-01', { headers }),
      app.request('/api/site/stats/storage?from=2026-07-01&to=2026-07-01', { headers }),
    ])
    const body = (await res.json()) as {
      dataQuality: AdminDashboardOverviewStats['dataQuality']
      totals: { trafficBytes: { value: number | null }; uploadBytes: { value: number | null } }
      trends: Array<{ uploadBytes: number | null }>
    }
    const traffic = (await trafficRes.json()) as {
      summary: { totalBytes: { value: number | null }; requestCount: { value: number } }
      sourceBreakdown: unknown[]
    }
    const storage = (await storageRes.json()) as {
      summary: { newBytes: { value: number | null }; newFiles: { value: number } }
      storageTrend: Array<{ newBytes: number | null; newFiles: number }>
    }

    expect([res.status, trafficRes.status, storageRes.status]).toEqual([200, 200, 200])
    expect(body.dataQuality).toEqual({
      missingBytesEvents: 0,
      previousMissingBytesEvents: 0,
      missingUploadBytesEvents: 0,
      previousMissingUploadBytesEvents: 0,
      missingDownloadBytesEvents: 0,
      previousMissingDownloadBytesEvents: 0,
    })
    expect(body.totals.trafficBytes.value).toBe(0)
    expect(body.totals.uploadBytes.value).toBe(0)
    expect(body.trends).toContainEqual(expect.objectContaining({ uploadBytes: 0 }))
    expect(traffic.summary.totalBytes.value).toBe(0)
    expect(traffic.summary.requestCount.value).toBe(0)
    expect(traffic.sourceBreakdown).toEqual([])
    expect(storage.summary.newBytes.value).toBe(0)
    expect(storage.summary.newFiles.value).toBe(0)
    expect(storage.storageTrend).toContainEqual(expect.objectContaining({ newBytes: 0, newFiles: 0 }))
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

  it('returns traffic dashboard stats from the confirmed traffic ledger for Pro admins', async () => {
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

  it('separates operational health from transfer analytics', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await seedProLicense(db)
    const { orgId, bucketStart, eventMs } = await seedStatsFixture(db)
    const previousBucket = new Date(bucketStart.getTime() - 3_600_000)
    const reportAt = previousBucket.getTime() + 60_000
    await db.run(sql`UPDATE download_tasks SET finished_at = updated_at WHERE id IN ('task-1', 'task-2')`)
    await db.run(sql`
      INSERT INTO cloud_traffic_reports
        (id, org_id, period, source, source_id, event_id, bytes, status, created_at, updated_at)
      VALUES ('operations-cloud-report', ${orgId}, '2026-07', 'object_download', 'stats-file',
        'operations-cloud-report', 64, 'pending', ${reportAt}, ${reportAt})
    `)
    await rebuildAdminStatsHour(db, previousBucket, new Date(reportAt + 3_600_000))
    await db.run(sql`
      UPDATE cloud_traffic_reports
      SET status = 'reported', updated_at = ${eventMs}
      WHERE id = 'operations-cloud-report'
    `)
    await captureAdminStatsSnapshot(db, bucketStart, new Date(bucketStart.getTime() + 45 * 60_000))
    await rebuildAdminStatsHour(db, bucketStart, new Date())

    const res = await app.request('/api/site/stats/operations', { headers })
    const body = (await res.json()) as {
      summary: {
        onlineDownloaders: number
        backgroundJobFailureRate: number | null
        remoteDownloadSuccessRate: number | null
      }
      backgroundJobOutcomes: Array<{ name: string; value: number }>
      remoteDownloadOutcomes: Array<{ name: string; value: number }>
      cloudReportStatus: Array<{ name: string; value: number }>
    }

    expect(res.status).toBe(200)
    expect(body.summary.onlineDownloaders).toBe(1)
    expect(body.summary.backgroundJobFailureRate).toBe(100)
    expect(body.summary.remoteDownloadSuccessRate).toBe(50)
    expect(body.backgroundJobOutcomes).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'failed', value: 1 })]),
    )
    expect(body.remoteDownloadOutcomes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'completed', value: 1 }),
        expect.objectContaining({ name: 'failed', value: 1 }),
      ]),
    )
    expect(body.cloudReportStatus).toEqual([{ name: 'reported', value: 1, percent: 100 }])
    const [{ count: mutableCounters }] = await db.all<{ count: number }>(sql`
      SELECT COUNT(*) AS count FROM stats_rollups_hourly WHERE metric_key = 'traffic.report_sync'
    `)
    expect(mutableCounters).toBe(0)
  })

  it('keeps cumulative views exact while omitting incomplete download history', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await seedProLicense(db)
    await seedStatsFixture(db)

    const currentSharingRes = await app.request('/api/site/stats/sharing', { headers })
    const currentSharing = (await currentSharingRes.json()) as {
      dataQuality: { unlocatedDownloads: number }
      summary: {
        views: number | null
        downloads: { value: number | null; change: number | null }
      }
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
      summary: { views: number | null; downloads: { value: number | null } }
      topShares: unknown[]
    }
    expect(currentSharingRes.status).toBe(200)
    expect(currentSharing.summary.views).toBe(12)
    expect(currentSharing.summary.downloads.value).toBeNull()
    expect(currentSharing.dataQuality).toEqual({ unlocatedDownloads: 3 })
    expect(currentSharing.summary.downloads.change).toBeNull()
    expect(currentSharing.topShares[0]).toMatchObject({ token: 'share-token-1', views: 12, downloads: 4 })
    expect(oldSharing.summary.views).toBe(12)
    expect(oldSharing.summary.downloads.value).toBeNull()
    expect(oldSharing.topShares).toHaveLength(1)
  })

  it('excludes deleted shares from the live cumulative ranking', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await seedProLicense(db)
    const { bucketStart } = await seedStatsFixture(db)
    await makeSharingHistoryExact(db, bucketStart)
    await db.run(sql`DELETE FROM shares WHERE id = 'share-1'`)

    const res = await app.request('/api/site/stats/sharing', { headers })
    const body = (await res.json()) as {
      topShares: Array<{ id: string; token: string; name: string; status: string; views: number; downloads: number }>
    }

    expect(res.status).toBe(200)
    expect(body.topShares).toEqual([])
  })

  it('orders top share rankings by views before downloads', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await seedProLicense(db)
    const { orgId, userId, bucketStart, eventSec } = await seedStatsFixture(db)
    const futureSec = eventSec + 7 * 24 * 60 * 60

    await db.run(sql`
      INSERT INTO shares (id, token, kind, matter_id, org_id, creator_id, expires_at, download_limit, views, downloads, status, created_at)
      VALUES ('share-download-heavy', 'share-download-heavy', 'landing', 'stats-file', ${orgId}, ${userId}, ${futureSec}, 10, 0, 3, 'active', ${eventSec})
    `)
    await db.run(sql`
      INSERT INTO cloud_traffic_reports
        (id, org_id, period, source, source_id, event_id, bytes, status, issued_at, created_at, updated_at)
      VALUES
        ('ranking-download-1', ${orgId}, (SELECT period FROM cloud_traffic_reports LIMIT 1), 'landing_share',
          'share-download-heavy', 'ranking-download-1', 512, 'not_required', ${eventSec * 1000}, ${eventSec * 1000}, ${eventSec * 1000}),
        ('ranking-download-2', ${orgId}, (SELECT period FROM cloud_traffic_reports LIMIT 1), 'landing_share',
          'share-download-heavy', 'ranking-download-2', 512, 'not_required', ${eventSec * 1000}, ${eventSec * 1000}, ${eventSec * 1000}),
        ('ranking-download-3', ${orgId}, (SELECT period FROM cloud_traffic_reports LIMIT 1), 'landing_share',
          'share-download-heavy', 'ranking-download-3', 512, 'not_required', ${eventSec * 1000}, ${eventSec * 1000}, ${eventSec * 1000})
    `)
    await makeSharingHistoryExact(db, bucketStart)
    const res = await app.request('/api/site/stats/sharing', { headers })
    const body = (await res.json()) as { topShares: Array<{ token: string; views: number; downloads: number }> }

    expect(res.status).toBe(200)
    expect(body.topShares[0]).toMatchObject({ token: 'share-token-1', views: 1, downloads: 1 })
    expect(body.topShares[1]).toMatchObject({ token: 'share-download-heavy', views: 0, downloads: 3 })
  })

  it('calculates top-share percentages against all matching shares before the top-eight limit', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await seedProLicense(db)
    const { orgId, userId, bucketStart, eventSec } = await seedStatsFixture(db)
    for (let index = 2; index <= 9; index += 1) {
      const id = `share-percent-${index}`
      await db.run(sql`
        INSERT INTO shares (id, token, kind, matter_id, org_id, creator_id, expires_at, download_limit, views, downloads, status, created_at)
        VALUES (${id}, ${id}, 'landing', 'stats-file', ${orgId}, ${userId}, NULL, NULL, 1, 0, 'active', ${eventSec})
      `)
    }
    await makeSharingHistoryExact(db, bucketStart)

    const res = await app.request('/api/site/stats/sharing', { headers })
    const body = (await res.json()) as { topShares: Array<{ viewPercent: number }> }

    expect(res.status).toBe(200)
    expect(body.topShares).toHaveLength(8)
    expect(body.topShares.every((share) => share.viewPercent === 11.1)).toBe(true)
  })
})

async function makeSharingHistoryExact(
  db: Awaited<ReturnType<typeof createTestApp>>['db'],
  bucketStart: Date,
): Promise<void> {
  await db.run(sql`UPDATE shares SET views = 1, downloads = 1 WHERE id = 'share-1'`)
  await captureAdminStatsSnapshot(db, bucketStart, new Date(bucketStart.getTime() + 45 * 60_000))
  await rebuildAdminStatsHour(db, bucketStart, new Date())
}

async function seedStatsFixture(db: Awaited<ReturnType<typeof createTestApp>>['db']) {
  const generatedAt = Date.now()
  const bucketStart = new Date(Math.floor(generatedAt / 3_600_000) * 3_600_000 - 3_600_000)
  const now = bucketStart.getTime() + 30 * 60 * 1000
  const nowSec = Math.floor(now / 1000)
  const future = generatedAt + 7 * 24 * 60 * 60 * 1000
  const futureSec = Math.floor(future / 1000)
  const period = currentTrafficPeriod(new Date(generatedAt))
  const [{ id: orgId }] = await db.all<{ id: string }>(
    sql`SELECT id FROM organization WHERE metadata LIKE '%"type":"personal"%' LIMIT 1`,
  )
  const [{ id: userId }] = await db.all<{ id: string }>(sql`SELECT id FROM user LIMIT 1`)
  await ensureAdminStatsIntegrityOpening(db, new Date(generatedAt - 60 * 24 * 60 * 60 * 1000))
  await createCloudTrafficReportRepo(db).ensureLedgerOpening(new Date(generatedAt - 60 * 24 * 60 * 60 * 1000))

  await db.run(
    sql`UPDATE user SET created_at = ${now}, updated_at = ${now}, last_active_at = ${now} WHERE id = ${userId}`,
  )
  await db.run(sql`UPDATE account SET created_at = ${now}, updated_at = ${now} WHERE user_id = ${userId}`)
  await db.run(sql`UPDATE session SET created_at = ${now}, updated_at = ${now} WHERE user_id = ${userId}`)
  await db.run(sql`
    UPDATE audit_events
    SET created_at = ${nowSec}
    WHERE id = ${`event:user_register:${userId}`}
  `)

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
    INSERT INTO audit_events (id, org_id, user_id, action, target_type, target_id, target_name, metadata, created_at)
    VALUES ('activity-1', ${orgId}, ${userId}, 'upload', 'file', 'stats-file', 'report.pdf', NULL, ${nowSec})
  `)
  await db.run(sql`
    INSERT INTO audit_events (id, org_id, user_id, actor_type, action, target_type, target_id, target_name, metadata, created_at)
    VALUES
      ('activity-upload-confirm', ${orgId}, ${userId}, 'user', 'upload_confirm', 'file', 'stats-file', 'report.pdf', '{"bytes":128,"source":"upload"}', ${nowSec}),
      ('activity-share-download', ${orgId}, NULL, 'anonymous', 'share_download', 'share', 'share-1', 'report.pdf', '{"bytes":512,"shareId":"share-1","source":"landing_share","trafficEventId":"stats-traffic-share","anonymous":true}', ${nowSec}),
      ('activity-object-download', ${orgId}, ${userId}, 'user', 'object_download', 'file', 'stats-file', 'report.pdf', '{"bytes":256,"source":"object_download","trafficEventId":"stats-traffic-object"}', ${nowSec}),
      ('event:share_create:share-1', ${orgId}, ${userId}, 'user', 'share_create', 'share', 'share-1', 'share-1', '{"kind":"landing"}', ${nowSec}),
      ('event-fixture-job-failed', ${orgId}, NULL, 'system', 'background_job_failed', 'background_job', 'job-1', 'job-1', '{"jobType":"extract","outcome":"failed"}', ${nowSec})
  `)
  await db.run(sql`
    INSERT INTO cloud_traffic_reports (
      id, org_id, period, source, source_id, event_id, bytes, status, issued_at, created_at, updated_at
    ) VALUES
      ('stats-traffic-share', ${orgId}, ${period}, 'landing_share', 'share-1', 'stats-traffic-share', 512,
        'not_required', ${now}, ${now}, ${now}),
      ('stats-traffic-object', ${orgId}, ${period}, 'object_download', 'stats-file', 'stats-traffic-object', 256,
        'not_required', ${now}, ${now}, ${now})
  `)
  await db.run(sql`
    INSERT INTO downloaders (id, name, token_hash, token_jti, status, enabled, version, hostname, platform, arch, engine, capabilities, max_concurrent_tasks, current_tasks, download_bps, upload_bps, free_disk_bytes, created_by, last_heartbeat_at, created_at, updated_at)
    VALUES ('downloader-1', 'Downloader One', 'hash', 'jti', 'online', 1, '1.0.0', 'host', 'linux', 'x64', 'http', '[]', 2, 0, 0, 0, 1000, ${userId}, ${now}, ${now}, ${now})
  `)
  await db.run(sql`
    INSERT INTO download_tasks (id, org_id, created_by_user_id, source_type, source_uri, display_name, target_folder, category, tags, assigned_downloader_id, status, error_code, error_message, events, created_at, updated_at, finished_at)
    VALUES
      ('task-1', ${orgId}, ${userId}, 'http', 'https://example.com/ok.bin', 'ok.bin', '', 'direct', '[]', 'downloader-1', 'completed', NULL, NULL,
        ${JSON.stringify([
          {
            id: 'task-1-completed',
            type: 'status_changed',
            occurredAt: now,
            attempt: 1,
            from: 'uploading',
            to: 'completed',
            reason: null,
            category: 'direct',
            downloaderId: 'downloader-1',
            transferredBytes: null,
            billedBytes: 0,
            errorCode: null,
            errorMessage: null,
          },
        ])}, ${now}, ${now}, ${now}),
      ('task-2', ${orgId}, ${userId}, 'http', 'https://example.com/bad.bin', 'bad.bin', '', 'direct', '[]', 'downloader-1', 'failed', 'network', 'Network error',
        ${JSON.stringify([
          {
            id: 'task-2-failed',
            type: 'status_changed',
            occurredAt: now,
            attempt: 1,
            from: 'downloading',
            to: 'failed',
            reason: null,
            category: 'direct',
            downloaderId: 'downloader-1',
            transferredBytes: null,
            billedBytes: 0,
            errorCode: 'network',
            errorMessage: 'Network error',
          },
        ])}, ${now}, ${now}, ${now})
  `)
  await db.run(sql`
    INSERT INTO background_jobs (id, org_id, user_id, type, status, target_folder, target_path, metadata, input_bytes, output_bytes, processed_bytes, file_count, current_filename, error_message, result_metadata, retryable, cancelable, retried_from_job_id, created_at, updated_at, started_at, finished_at)
    VALUES ('job-1', ${orgId}, ${userId}, 'extract', 'failed', '', '', NULL, 0, 0, 0, 0, NULL, 'bad zip', NULL, 1, 0, NULL, ${now}, ${now}, ${now}, ${now})
  `)

  await captureAdminStatsSnapshot(db, bucketStart, new Date(now))
  await rebuildAdminStatsHour(db, bucketStart, new Date(generatedAt))
  return { orgId, userId, bucketStart, eventMs: now, eventSec: nowSec }
}
