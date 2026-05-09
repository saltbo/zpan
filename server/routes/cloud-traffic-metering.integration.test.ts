import { sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cloudTrafficReports } from '../db/schema'
import { createLicenseBinding } from '../licensing/license-state'
import type { Database } from '../platform/interface'
import { currentTrafficPeriod } from '../services/effective-quota'
import { S3Service } from '../services/s3'
import { createShare } from '../services/share'
import { authedHeaders, createTestApp } from '../test/setup'
import { encodeChildRef } from './share-utils'

const STORAGE_ID = 'st-cloud-traffic-test'

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(S3Service.prototype, 'presignDownload').mockResolvedValue('https://presigned-download.example.com')
  vi.spyOn(S3Service.prototype, 'presignInline').mockResolvedValue('https://presigned-inline.example.com')
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

async function getUserId(db: Database): Promise<string> {
  const rows = await db.all<{ id: string }>(sql`SELECT id FROM user LIMIT 1`)
  return rows[0].id
}

async function insertFile(db: Database, orgId: string, id: string) {
  const now = Date.now()
  await db.run(sql`
    INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, created_at, updated_at)
    VALUES (${id}, ${orgId}, ${`${id}-alias`}, 'download.txt', 'text/plain', 100, 0, '', 'some/key.txt', ${STORAGE_ID}, 'active', ${now}, ${now})
  `)
}

async function insertImage(db: Database, orgId: string, id: string, token: string, path = `blog/${id}.png`) {
  const now = Date.now()
  await db.run(sql`
    INSERT INTO image_hostings (id, org_id, token, path, storage_id, storage_key, size, mime, status, access_count, created_at)
    VALUES (${id}, ${orgId}, ${token}, ${path}, ${STORAGE_ID}, ${`ih/${orgId}/${id}.png`}, 100, 'image/png', 'active', 0, ${now})
  `)
}

async function insertImageConfig(db: Database, orgId: string, customDomain?: string) {
  const now = Date.now()
  const verifiedAt = customDomain ? now : null
  await db.run(sql`
    INSERT OR REPLACE INTO image_hosting_configs (org_id, custom_domain, domain_verified_at, referer_allowlist, created_at, updated_at)
    VALUES (${orgId}, ${customDomain ?? null}, ${verifiedAt}, null, ${now}, ${now})
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

  it('refunds local traffic when Cloud returns a mismatched event id', async () => {
    const { app, db } = await createTestApp()
    await seedTrafficBinding(db)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(makeCloudResponse({ data: { accepted: true, duplicate: false, eventId: 'wrong' } })),
    )
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, 'm-cloud-report-mismatch')
    await setTrafficQuota(db, orgId)

    const res = await app.request('/api/objects/m-cloud-report-mismatch', { headers })

    expect(res.status).toBe(500)
    const rows = await db.all<{ trafficUsed: number }>(
      sql`SELECT traffic_used AS trafficUsed FROM org_quotas WHERE org_id = ${orgId}`,
    )
    expect(rows[0].trafficUsed).toBe(25)
    await expect(db.select().from(cloudTrafficReports)).resolves.toMatchObject([{ status: 'failed' }])
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

describe('public redirect cloud traffic reporting', () => {
  it('reports direct share redirects to Cloud', async () => {
    const { app, db } = await createTestApp()
    await seedTrafficBinding(db)
    vi.stubGlobal('fetch', vi.fn().mockImplementation(acceptedUsageResponse))
    await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    const creatorId = await getUserId(db)
    await insertFile(db, orgId, 'm-cloud-direct-share')
    const share = await createShare(db, { matterId: 'm-cloud-direct-share', orgId, creatorId, kind: 'direct' })

    const res = await app.request(`/r/${share.token}`, { redirect: 'manual' })

    expect(res.status).toBe(302)
    await expect(db.select().from(cloudTrafficReports)).resolves.toMatchObject([
      { source: 'direct_share', sourceId: share.id, bytes: 100, status: 'reported' },
    ])
  })

  it('reports landing share downloads to Cloud', async () => {
    const { app, db } = await createTestApp()
    await seedTrafficBinding(db)
    vi.stubGlobal('fetch', vi.fn().mockImplementation(acceptedUsageResponse))
    await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    const creatorId = await getUserId(db)
    await insertFile(db, orgId, 'm-cloud-landing-share')
    const share = await createShare(db, { matterId: 'm-cloud-landing-share', orgId, creatorId, kind: 'landing' })
    const ref = encodeChildRef(share.token, 'm-cloud-landing-share')

    const res = await app.request(`/api/shares/${share.token}/objects/${ref}?downloadUrl=1`, { redirect: 'manual' })

    expect(res.status).toBe(200)
    await expect(db.select().from(cloudTrafficReports)).resolves.toMatchObject([
      { source: 'landing_share', sourceId: share.id, bytes: 100, status: 'reported' },
    ])
  })

  it('still returns landing share URLs when audit recording fails after Cloud report', async () => {
    const { app, db } = await createTestApp()
    await seedTrafficBinding(db)
    vi.stubGlobal('fetch', vi.fn().mockImplementation(acceptedUsageResponse))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    const creatorId = await getUserId(db)
    await insertFile(db, orgId, 'm-cloud-landing-audit-fail')
    const share = await createShare(db, { matterId: 'm-cloud-landing-audit-fail', orgId, creatorId, kind: 'landing' })
    const ref = encodeChildRef(share.token, 'm-cloud-landing-audit-fail')
    await db.run(sql`DROP TABLE activity_events`)

    const res = await app.request(`/api/shares/${share.token}/objects/${ref}?downloadUrl=1`, { redirect: 'manual' })

    expect(res.status).toBe(200)
    expect(consoleError).toHaveBeenCalled()
  })

  it('reports token image-hosting redirects to Cloud', async () => {
    const { app, db } = await createTestApp()
    await seedTrafficBinding(db)
    vi.stubGlobal('fetch', vi.fn().mockImplementation(acceptedUsageResponse))
    await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertImage(db, orgId, 'ih-cloud-token', 'ih_cloudtoken')
    await insertImageConfig(db, orgId)

    const res = await app.request('/r/ih_cloudtoken', { redirect: 'manual' })

    expect(res.status).toBe(302)
    await expect(db.select().from(cloudTrafficReports)).resolves.toMatchObject([
      { source: 'image_hosting', sourceId: 'ih-cloud-token', bytes: 100, status: 'reported' },
    ])
  })

  it('still redirects token images when access-count recording fails after Cloud report', async () => {
    const { app, db } = await createTestApp()
    await seedTrafficBinding(db)
    vi.stubGlobal('fetch', vi.fn().mockImplementation(acceptedUsageResponse))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertImage(db, orgId, 'ih-cloud-log-fail', 'ih_cloudlogfail')
    await insertImageConfig(db, orgId)
    vi.spyOn(db, 'run').mockRejectedValue(new Error('access failed'))

    const res = await app.request('/r/ih_cloudlogfail', { redirect: 'manual' })

    expect(res.status).toBe(302)
    expect(consoleError).toHaveBeenCalled()
  })

  it('reports custom-domain image-hosting redirects to Cloud', async () => {
    const { app, db } = await createTestApp({ PUBLIC_APP_HOST: 'zpan.example.com' })
    await seedTrafficBinding(db)
    vi.stubGlobal('fetch', vi.fn().mockImplementation(acceptedUsageResponse))
    await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertImage(db, orgId, 'ih-cloud-domain', 'ih_clouddomain', 'blog/domain.png')
    await insertImageConfig(db, orgId, 'img.example.com')

    const res = await app.request('https://img.example.com/blog/domain.png', {
      headers: { host: 'img.example.com' },
      redirect: 'manual',
    })

    expect(res.status).toBe(302)
    await expect(db.select().from(cloudTrafficReports)).resolves.toMatchObject([
      { source: 'custom_domain_image', sourceId: 'ih-cloud-domain', bytes: 100, status: 'reported' },
    ])
  })

  it('still redirects custom-domain images when access-count recording fails after Cloud report', async () => {
    const { app, db } = await createTestApp({ PUBLIC_APP_HOST: 'zpan.example.com' })
    await seedTrafficBinding(db)
    vi.stubGlobal('fetch', vi.fn().mockImplementation(acceptedUsageResponse))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertImage(db, orgId, 'ih-cloud-domain-log-fail', 'ih_clouddomainlogfail', 'blog/domain-log-fail.png')
    await insertImageConfig(db, orgId, 'img.example.com')
    vi.spyOn(db, 'run').mockRejectedValue(new Error('access failed'))

    const res = await app.request('https://img.example.com/blog/domain-log-fail.png', {
      headers: { host: 'img.example.com' },
      redirect: 'manual',
    })

    expect(res.status).toBe(302)
    expect(consoleError).toHaveBeenCalled()
  })
})
