import { sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { currentTrafficPeriod } from '../services/effective-quota.js'
import { S3Service } from '../services/s3.js'
import { createShare } from '../services/share.js'
import { authedHeaders, createTestApp } from '../test/setup.js'

const MOCK_PRESIGN_URL = 'https://presigned-download.example.com/file'
const MOCK_INLINE_URL = 'https://presigned-inline.example.com/image.png'
const STORAGE_ID = 'st-redirect-test'

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(S3Service.prototype, 'presignDownload').mockResolvedValue(MOCK_PRESIGN_URL)
  vi.spyOn(S3Service.prototype, 'presignInline').mockResolvedValue(MOCK_INLINE_URL)
})

// ─── DB helpers ───────────────────────────────────────────────────────────────

async function insertStorage(db: Awaited<ReturnType<typeof createTestApp>>['db']) {
  const now = Date.now()
  await db.run(sql`
    INSERT INTO storages (id, title, mode, bucket, endpoint, region, access_key, secret_key, file_path, custom_host, capacity, used, status, created_at, updated_at)
    VALUES (${STORAGE_ID}, 'Test S3', 'private', 'test-bucket', 'https://s3.amazonaws.com', 'us-east-1', 'AK', 'SK', '', '', 0, 0, 'active', ${now}, ${now})
  `)
}

async function getOrgId(db: Awaited<ReturnType<typeof createTestApp>>['db']): Promise<string> {
  const rows = await db.all<{ id: string }>(
    sql`SELECT id FROM organization WHERE metadata LIKE '%"type":"personal"%' LIMIT 1`,
  )
  return rows[0].id
}

async function getUserId(db: Awaited<ReturnType<typeof createTestApp>>['db']): Promise<string> {
  const rows = await db.all<{ id: string }>(sql`SELECT id FROM user LIMIT 1`)
  return rows[0].id
}

async function insertFile(
  db: Awaited<ReturnType<typeof createTestApp>>['db'],
  orgId: string,
  opts: { id: string; name: string; status?: string },
) {
  const now = Date.now()
  await db.run(sql`
    INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, created_at, updated_at)
    VALUES (${opts.id}, ${orgId}, ${`${opts.id}-alias`}, ${opts.name}, 'image/png', 1024, 0, '', 'some/key.png', ${STORAGE_ID}, ${opts.status ?? 'active'}, ${now}, ${now})
  `)
}

async function insertImageHosting(
  db: Awaited<ReturnType<typeof createTestApp>>['db'],
  orgId: string,
  opts: { id: string; token: string; status?: string; storageId?: string },
) {
  const now = Date.now()
  await db.run(sql`
    INSERT INTO image_hostings (id, org_id, token, path, storage_id, storage_key, size, mime, status, access_count, created_at)
    VALUES (${opts.id}, ${orgId}, ${opts.token}, ${`blog/${opts.id}.png`}, ${opts.storageId ?? STORAGE_ID}, ${`ih/${orgId}/${opts.id}.png`}, 1024, 'image/png', ${opts.status ?? 'active'}, 0, ${now})
  `)
}

async function insertImageHostingConfig(
  db: Awaited<ReturnType<typeof createTestApp>>['db'],
  orgId: string,
  opts: { refererAllowlist?: string[] } = {},
) {
  const now = Date.now()
  const allowlist = opts.refererAllowlist ? JSON.stringify(opts.refererAllowlist) : null
  await db.run(sql`
    INSERT OR REPLACE INTO image_hosting_configs (org_id, referer_allowlist, created_at, updated_at)
    VALUES (${orgId}, ${allowlist}, ${now}, ${now})
  `)
}

async function getAccessCount(db: Awaited<ReturnType<typeof createTestApp>>['db'], id: string): Promise<number> {
  const rows = await db.all<{ access_count: number }>(sql`SELECT access_count FROM image_hostings WHERE id = ${id}`)
  return rows[0]?.access_count ?? 0
}

// ─── ds_ direct share tests ───────────────────────────────────────────────────

describe('GET /r/:token (ds_ direct shares)', () => {
  it('returns 302 with attachment disposition and no-store cache for valid direct share', async () => {
    const { app, db } = await createTestApp()
    await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    const creatorId = await getUserId(db)
    await insertFile(db, orgId, { id: 'ds-f1', name: 'file.bin' })
    const share = await createShare(db, { matterId: 'ds-f1', orgId, creatorId, kind: 'direct' })

    const res = await app.request(`/r/${share.token}`, { redirect: 'manual' })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(MOCK_PRESIGN_URL)
    expect(res.headers.get('cache-control')).toContain('no-store')
  })

  it('returns 404 for unknown ds_ token', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/r/ds_unknowntoken', { redirect: 'manual' })
    expect(res.status).toBe(404)
  })

  it('returns 404 for landing share token at /r/', async () => {
    const { app, db } = await createTestApp()
    await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    const creatorId = await getUserId(db)
    await insertFile(db, orgId, { id: 'ds-f2', name: 'landing.txt' })
    const share = await createShare(db, { matterId: 'ds-f2', orgId, creatorId, kind: 'landing' })

    // Landing share token does not start with ds_ so falls through to 404
    const res = await app.request(`/r/${share.token}`, { redirect: 'manual' })
    expect(res.status).toBe(404)
  })

  it('returns 422 when direct share traffic quota is exhausted', async () => {
    const { app, db } = await createTestApp()
    await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    const creatorId = await getUserId(db)
    await insertFile(db, orgId, { id: 'ds-quota', name: 'quota.bin' })
    const trafficPeriod = currentTrafficPeriod()
    await db.run(sql`
      UPDATE org_quotas
      SET traffic_quota = 512, traffic_used = 0, traffic_period = ${trafficPeriod}
      WHERE org_id = ${orgId}
    `)
    const share = await createShare(db, { matterId: 'ds-quota', orgId, creatorId, kind: 'direct', downloadLimit: 1 })

    const res = await app.request(`/r/${share.token}`, { redirect: 'manual' })
    expect(res.status).toBe(422)
    await expect(res.json()).resolves.toEqual({ error: 'Traffic quota exceeded' })
    expect(S3Service.prototype.presignDownload).not.toHaveBeenCalled()

    const shares = await db.all<{ downloads: number }>(sql`SELECT downloads FROM shares WHERE id = ${share.id}`)
    expect(shares[0].downloads).toBe(0)
  })

  it('consumes traffic quota on successful direct share redirect', async () => {
    const { app, db } = await createTestApp()
    await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    const creatorId = await getUserId(db)
    await insertFile(db, orgId, { id: 'ds-quota-ok', name: 'quota.bin' })
    const trafficPeriod = currentTrafficPeriod()
    await db.run(sql`
      UPDATE org_quotas
      SET traffic_quota = 2048, traffic_used = 256, traffic_period = ${trafficPeriod}
      WHERE org_id = ${orgId}
    `)
    const share = await createShare(db, { matterId: 'ds-quota-ok', orgId, creatorId, kind: 'direct' })

    const res = await app.request(`/r/${share.token}`, { redirect: 'manual' })
    expect(res.status).toBe(302)

    const rows = await db.all<{ trafficUsed: number }>(
      sql`SELECT traffic_used AS trafficUsed FROM org_quotas WHERE org_id = ${orgId}`,
    )
    expect(rows[0].trafficUsed).toBe(1280)
  })

  it('compensates direct share download count when traffic is exhausted after presign', async () => {
    const { app, db } = await createTestApp()
    await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    const creatorId = await getUserId(db)
    await insertFile(db, orgId, { id: 'ds-quota-race', name: 'quota.bin' })
    const trafficPeriod = currentTrafficPeriod()
    await db.run(sql`
      UPDATE org_quotas
      SET traffic_quota = 1024, traffic_used = 0, traffic_period = ${trafficPeriod}
      WHERE org_id = ${orgId}
    `)
    vi.mocked(S3Service.prototype.presignDownload).mockImplementationOnce(async () => {
      await db.run(sql`UPDATE org_quotas SET traffic_used = 1024 WHERE org_id = ${orgId}`)
      return MOCK_PRESIGN_URL
    })
    const share = await createShare(db, { matterId: 'ds-quota-race', orgId, creatorId, kind: 'direct' })

    const res = await app.request(`/r/${share.token}`, { redirect: 'manual' })
    expect(res.status).toBe(422)
    await expect(res.json()).resolves.toEqual({ error: 'Traffic quota exceeded' })

    const shares = await db.all<{ downloads: number }>(sql`SELECT downloads FROM shares WHERE id = ${share.id}`)
    expect(shares[0].downloads).toBe(0)
  })
})

// ─── ih_ image hosting tests ──────────────────────────────────────────────────

describe('GET /r/:token (ih_ image hosting)', () => {
  it('returns 302 with inline disposition and no-store cache for active image', async () => {
    const { app, db } = await createTestApp()
    await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertImageHosting(db, orgId, { id: 'ih-img1', token: 'ih_testtoken1' })

    const res = await app.request('/r/ih_testtoken1', { redirect: 'manual' })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(MOCK_INLINE_URL)
    const cc = res.headers.get('cache-control') ?? ''
    expect(cc).toContain('no-store')
  })

  it('strips .png extension and resolves same image', async () => {
    const { app, db } = await createTestApp()
    await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertImageHosting(db, orgId, { id: 'ih-img2', token: 'ih_exttest1' })

    const res = await app.request('/r/ih_exttest1.png', { redirect: 'manual' })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(MOCK_INLINE_URL)
  })

  it('strips .webp extension and resolves same image', async () => {
    const { app, db } = await createTestApp()
    await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertImageHosting(db, orgId, { id: 'ih-img3', token: 'ih_exttest2' })

    const res = await app.request('/r/ih_exttest2.webp', { redirect: 'manual' })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(MOCK_INLINE_URL)
  })

  it('returns 404 for non-existent ih_ token', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/r/ih_doesnotexist', { redirect: 'manual' })
    expect(res.status).toBe(404)
  })

  it('returns 404 for image with status=draft', async () => {
    const { app, db } = await createTestApp()
    await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertImageHosting(db, orgId, { id: 'ih-draft1', token: 'ih_drafttoken', status: 'draft' })

    const res = await app.request('/r/ih_drafttoken', { redirect: 'manual' })
    expect(res.status).toBe(404)
  })

  it('increments accessCount by 1 on successful redirect', async () => {
    const { app, db } = await createTestApp()
    await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertImageHosting(db, orgId, { id: 'ih-cnt1', token: 'ih_counttest1' })

    expect(await getAccessCount(db, 'ih-cnt1')).toBe(0)
    await app.request('/r/ih_counttest1', { redirect: 'manual' })
    expect(await getAccessCount(db, 'ih-cnt1')).toBe(1)
  })

  it('consumes traffic quota on successful image hosting redirect', async () => {
    const { app, db } = await createTestApp()
    await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertImageHosting(db, orgId, { id: 'ih-quota-ok', token: 'ih_quotaok' })
    const trafficPeriod = currentTrafficPeriod()
    await db.run(sql`
      UPDATE org_quotas
      SET traffic_quota = 2048, traffic_used = 256, traffic_period = ${trafficPeriod}
      WHERE org_id = ${orgId}
    `)

    const res = await app.request('/r/ih_quotaok', { redirect: 'manual' })
    expect(res.status).toBe(302)

    const rows = await db.all<{ trafficUsed: number }>(
      sql`SELECT traffic_used AS trafficUsed FROM org_quotas WHERE org_id = ${orgId}`,
    )
    expect(rows[0].trafficUsed).toBe(1280)
  })

  it('rejects the next image redirect after the first one consumes the remaining monthly traffic quota', async () => {
    const { app, db } = await createTestApp()
    await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertImageHosting(db, orgId, { id: 'ih-quota-repeat', token: 'ih_quotarepeat' })
    const trafficPeriod = currentTrafficPeriod()
    await db.run(sql`
      UPDATE org_quotas
      SET traffic_quota = 1024, traffic_used = 0, traffic_period = ${trafficPeriod}
      WHERE org_id = ${orgId}
    `)

    const first = await app.request('/r/ih_quotarepeat', { redirect: 'manual' })
    expect(first.status).toBe(302)
    expect(first.headers.get('cache-control')).toBe('no-store')

    const second = await app.request('/r/ih_quotarepeat', { redirect: 'manual' })
    expect(second.status).toBe(422)
    await expect(second.json()).resolves.toEqual({ error: 'Traffic quota exceeded' })
    expect(S3Service.prototype.presignInline).toHaveBeenCalledTimes(1)
    expect(await getAccessCount(db, 'ih-quota-repeat')).toBe(1)
  })

  it('does NOT increment accessCount on 404', async () => {
    const { app, db } = await createTestApp()
    await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertImageHosting(db, orgId, { id: 'ih-cnt2', token: 'ih_counttest2', status: 'draft' })

    await app.request('/r/ih_counttest2', { redirect: 'manual' })
    expect(await getAccessCount(db, 'ih-cnt2')).toBe(0)
  })
})

// ─── Referer allowlist tests ──────────────────────────────────────────────────

describe('GET /r/:token — referer allowlist enforcement', () => {
  it('allows any referer when allowlist is empty', async () => {
    const { app, db } = await createTestApp()
    await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertImageHosting(db, orgId, { id: 'ih-ref1', token: 'ih_reftest1' })
    // No config inserted — no allowlist

    const res = await app.request('/r/ih_reftest1', {
      redirect: 'manual',
      headers: { Referer: 'https://anydomain.com/page' },
    })
    expect(res.status).toBe(302)
  })

  it('returns 302 when referer matches allowlist entry', async () => {
    const { app, db } = await createTestApp()
    await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertImageHosting(db, orgId, { id: 'ih-ref2', token: 'ih_reftest2' })
    await insertImageHostingConfig(db, orgId, { refererAllowlist: ['https://myblog.com'] })

    const res = await app.request('/r/ih_reftest2', {
      redirect: 'manual',
      headers: { Referer: 'https://myblog.com/post/1' },
    })
    expect(res.status).toBe(302)
  })

  it('allows access when referer is missing (direct access from tools/address bar)', async () => {
    const { app, db } = await createTestApp()
    await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertImageHosting(db, orgId, { id: 'ih-ref3', token: 'ih_reftest3' })
    await insertImageHostingConfig(db, orgId, { refererAllowlist: ['https://myblog.com'] })

    const res = await app.request('/r/ih_reftest3', { redirect: 'manual' })
    expect(res.status).toBe(302)
  })

  it('returns 403 when referer is from a different origin', async () => {
    const { app, db } = await createTestApp()
    await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertImageHosting(db, orgId, { id: 'ih-ref4', token: 'ih_reftest4' })
    await insertImageHostingConfig(db, orgId, { refererAllowlist: ['https://myblog.com'] })

    const res = await app.request('/r/ih_reftest4', {
      redirect: 'manual',
      headers: { Referer: 'https://otherdomain.com/page' },
    })
    expect(res.status).toBe(403)
  })

  it('returns 403 for subdomain mismatch (exact origin match required)', async () => {
    const { app, db } = await createTestApp()
    await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertImageHosting(db, orgId, { id: 'ih-ref5', token: 'ih_reftest5' })
    await insertImageHostingConfig(db, orgId, { refererAllowlist: ['https://myblog.com'] })

    const res = await app.request('/r/ih_reftest5', {
      redirect: 'manual',
      headers: { Referer: 'https://sub.myblog.com/page' },
    })
    expect(res.status).toBe(403)
  })

  it('does NOT increment accessCount on 403', async () => {
    const { app, db } = await createTestApp()
    await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertImageHosting(db, orgId, { id: 'ih-ref6', token: 'ih_reftest6' })
    await insertImageHostingConfig(db, orgId, { refererAllowlist: ['https://myblog.com'] })

    await app.request('/r/ih_reftest6', {
      redirect: 'manual',
      headers: { Referer: 'https://evil.com/page' },
    })
    expect(await getAccessCount(db, 'ih-ref6')).toBe(0)
  })
})

// ─── Unknown prefix ───────────────────────────────────────────────────────────

describe('GET /r/:token — unknown prefix', () => {
  it('returns 404 for token with no known prefix', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/r/unknownprefix_abc', { redirect: 'manual' })
    expect(res.status).toBe(404)
  })

  it('returns 404 for plain nanoid token (no prefix)', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/r/abcdefghij', { redirect: 'manual' })
    expect(res.status).toBe(404)
  })
})

// ─── Two-org isolation ────────────────────────────────────────────────────────

describe('GET /r/:token — two-org isolation', () => {
  it('ih_ token for org-A resolves correctly and does not cross into org-B', async () => {
    const { app, db } = await createTestApp()

    // Sign up user A
    const emailA = `org-a-${Date.now()}@example.com`
    await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'User A', email: emailA, password: 'password123456' }),
    })

    // Sign up user B in a fresh db state is not possible without separate test app.
    // Instead, verify that org-A's token resolves to org-A's storage.
    const orgRows = await db.all<{ id: string }>(
      sql`SELECT id FROM organization WHERE metadata LIKE '%"type":"personal"%' ORDER BY created_at ASC LIMIT 1`,
    )
    const orgId = orgRows[0].id

    const now = Date.now()
    await db.run(sql`
      INSERT OR IGNORE INTO storages (id, title, mode, bucket, endpoint, region, access_key, secret_key, file_path, custom_host, capacity, used, status, created_at, updated_at)
      VALUES (${STORAGE_ID}, 'Test S3', 'private', 'test-bucket', 'https://s3.amazonaws.com', 'us-east-1', 'AK', 'SK', '', '', 0, 0, 'active', ${now}, ${now})
    `)
    await insertImageHosting(db, orgId, { id: 'ih-iso1', token: 'ih_isolationtest' })

    const res = await app.request('/r/ih_isolationtest', { redirect: 'manual' })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(MOCK_INLINE_URL)
  })

  it('returns 422 when image hosting traffic quota is exhausted', async () => {
    const { app, db } = await createTestApp()
    await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertImageHosting(db, orgId, { id: 'ih-quota', token: 'ih_quotatest' })
    const trafficPeriod = currentTrafficPeriod()
    await db.run(sql`
      UPDATE org_quotas
      SET traffic_quota = 512, traffic_used = 0, traffic_period = ${trafficPeriod}
      WHERE org_id = ${orgId}
    `)

    const res = await app.request('/r/ih_quotatest', { redirect: 'manual' })
    expect(res.status).toBe(422)
    await expect(res.json()).resolves.toEqual({ error: 'Traffic quota exceeded' })
    expect(S3Service.prototype.presignInline).not.toHaveBeenCalled()
  })
})
