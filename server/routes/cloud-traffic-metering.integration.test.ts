import { sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cloudTrafficReports } from '../db/schema'
import { createLicenseBinding } from '../licensing/license-state'
import type { Database } from '../platform/interface'
import { currentTrafficPeriod } from '../services/effective-quota'
import { S3Service } from '../services/s3'
import { authedHeaders, createTestApp } from '../test/setup'

const STORAGE_ID = 'st-cloud-traffic-test'

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(S3Service.prototype, 'presignDownload').mockResolvedValue('https://presigned-download.example.com')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function makeCloudResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

function acceptedUsageResponse(_url: string, init?: RequestInit): Response {
  const body = JSON.parse(init?.body as string) as { eventId: string }
  return makeCloudResponse({ data: { accepted: true, duplicate: false, eventId: body.eventId } })
}

async function seedTrafficBinding(db: Database) {
  await createLicenseBinding(db, {
    cloudBindingId: 'test-binding',
    cloudStoreId: 'store-test-binding',
    instanceId: 'test-instance',
    cloudAccountId: 'test-account',
    refreshToken: 'test-refresh-token',
    cachedCert: 'test-certificate',
    cachedExpiresAt: Math.floor(Date.now() / 1000) + 3600,
    lastRefreshAt: Math.floor(Date.now() / 1000),
  })
}

async function insertStorage(db: Database) {
  const now = Date.now()
  await db.run(sql`
    INSERT INTO storages (id, title, mode, bucket, endpoint, region, access_key, secret_key, file_path, custom_host, capacity, used, status, created_at, updated_at)
    VALUES (${STORAGE_ID}, 'Cloud Traffic S3', 'private', 'test-bucket', 'https://s3.amazonaws.com', 'us-east-1', 'AK', 'SK', '', '', 0, 0, 'active', ${now}, ${now})
  `)
}

async function getOrgId(db: Database): Promise<string> {
  const rows = await db.all<{ id: string }>(
    sql`SELECT id FROM organization WHERE metadata LIKE '%"type":"personal"%' LIMIT 1`,
  )
  return rows[0].id
}

async function insertFile(db: Database, orgId: string, id: string) {
  const now = Date.now()
  await db.run(sql`
    INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, created_at, updated_at)
    VALUES (${id}, ${orgId}, ${`${id}-alias`}, 'download.txt', 'text/plain', 100, 0, '', 'some/key.txt', ${STORAGE_ID}, 'active', ${now}, ${now})
  `)
}

async function setTrafficQuota(db: Database, orgId: string) {
  await db.run(sql`
    UPDATE org_quotas
    SET traffic_quota = 500, traffic_used = 25, traffic_period = ${currentTrafficPeriod()}
    WHERE org_id = ${orgId}
  `)
}

describe('object download cloud traffic reporting', () => {
  it('reports successful object downloads to Cloud after presigning', async () => {
    const { app, db } = await createTestApp({ ZPAN_CLOUD_URL: 'https://cloud.example' })
    await seedTrafficBinding(db)
    vi.stubGlobal('fetch', vi.fn().mockImplementation(acceptedUsageResponse))
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, 'm-cloud-report-ok')
    await setTrafficQuota(db, orgId)

    const res = await app.request('/api/objects/m-cloud-report-ok', { headers })

    expect(res.status).toBe(200)
    expect(fetch).toHaveBeenCalledTimes(1)
    const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toMatchObject({ resource: 'traffic_egress', bytes: 100, endUserId: orgId })
    await expect(db.select().from(cloudTrafficReports)).resolves.toMatchObject([
      { orgId, source: 'object_download', sourceId: 'm-cloud-report-ok', bytes: 100, status: 'reported' },
    ])
  })

  it('refunds local traffic and denies the download when Cloud blocks usage', async () => {
    const { app, db } = await createTestApp()
    await seedTrafficBinding(db)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(makeCloudResponse({ error: { code: 'overage_cap_exceeded' } }, 429)),
    )
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, 'm-cloud-report-blocked')
    await setTrafficQuota(db, orgId)

    const res = await app.request('/api/objects/m-cloud-report-blocked', { headers })

    expect(res.status).toBe(429)
    await expect(res.json()).resolves.toEqual({ error: 'Cloud traffic overage cap exceeded' })
    const rows = await db.all<{ trafficUsed: number }>(
      sql`SELECT traffic_used AS trafficUsed FROM org_quotas WHERE org_id = ${orgId}`,
    )
    expect(rows[0].trafficUsed).toBe(25)
    await expect(db.select().from(cloudTrafficReports)).resolves.toMatchObject([{ status: 'blocked' }])
  })

  it('does not report usage when presign fails and local traffic is refunded', async () => {
    const { app, db } = await createTestApp()
    await seedTrafficBinding(db)
    vi.stubGlobal('fetch', vi.fn().mockImplementation(acceptedUsageResponse))
    vi.mocked(S3Service.prototype.presignDownload).mockRejectedValueOnce(new Error('sign failed'))
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, 'm-cloud-report-presign-fail')
    await setTrafficQuota(db, orgId)

    const res = await app.request('/api/objects/m-cloud-report-presign-fail', { headers })

    expect(res.status).toBe(500)
    expect(fetch).not.toHaveBeenCalled()
    const rows = await db.all<{ trafficUsed: number }>(
      sql`SELECT traffic_used AS trafficUsed FROM org_quotas WHERE org_id = ${orgId}`,
    )
    expect(rows[0].trafficUsed).toBe(25)
    await expect(db.select().from(cloudTrafficReports)).resolves.toHaveLength(0)
  })
})
