import { sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { currentTrafficPeriod } from '../services/effective-quota'
import { S3Service } from '../services/s3'
import { authedHeaders, createTestApp } from '../test/setup'

const MOCK_INLINE_URL = 'https://presigned-inline.example.com/image.png'
const STORAGE_ID = 'st-domain-test'

// ─── Helpers ──────────────────────────────────────────────────────────────────

type TestDb = Awaited<ReturnType<typeof createTestApp>>['db']

async function getOrgId(db: TestDb): Promise<string> {
  const rows = await db.all<{ id: string }>(
    sql`SELECT id FROM organization WHERE metadata LIKE '%"type":"personal"%' LIMIT 1`,
  )
  return rows[0].id
}

async function insertStorage(db: TestDb) {
  const now = Date.now()
  await db.run(sql`
    INSERT OR IGNORE INTO storages (id, title, mode, bucket, endpoint, region, access_key, secret_key, file_path, custom_host, capacity, used, status, created_at, updated_at)
    VALUES (${STORAGE_ID}, 'Test S3', 'private', 'test-bucket', 'https://s3.amazonaws.com', 'us-east-1', 'AK', 'SK', '', '', 0, 0, 'active', ${now}, ${now})
  `)
}

async function insertImageHosting(db: TestDb, orgId: string, opts: { id: string; path: string; status?: string }) {
  const now = Date.now()
  await db.run(sql`
    INSERT INTO image_hostings (id, org_id, token, path, storage_id, storage_key, size, mime, status, access_count, created_at)
    VALUES (${opts.id}, ${orgId}, ${`ih_${opts.id}`}, ${opts.path}, ${STORAGE_ID}, ${`ih/${orgId}/${opts.id}.png`}, 1024, 'image/png', ${opts.status ?? 'active'}, 0, ${now})
  `)
}

async function insertImageHostingConfig(
  db: TestDb,
  orgId: string,
  opts: {
    customDomain?: string
    domainVerifiedAt?: number | null
    refererAllowlist?: string[]
  } = {},
) {
  const now = Date.now()
  const allowlist = opts.refererAllowlist ? JSON.stringify(opts.refererAllowlist) : null
  const verifiedAt = opts.domainVerifiedAt !== undefined ? opts.domainVerifiedAt : now
  await db.run(sql`
    INSERT OR REPLACE INTO image_hosting_configs (org_id, custom_domain, domain_verified_at, referer_allowlist, created_at, updated_at)
    VALUES (${orgId}, ${opts.customDomain ?? null}, ${verifiedAt}, ${allowlist}, ${now}, ${now})
  `)
}

async function getAccessCount(db: TestDb, id: string): Promise<number> {
  const rows = await db.all<{ access_count: number }>(sql`SELECT access_count FROM image_hostings WHERE id = ${id}`)
  return rows[0]?.access_count ?? 0
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(S3Service.prototype, 'presignInline').mockResolvedValue(MOCK_INLINE_URL)
})

// ─── App-host passthrough tests ───────────────────────────────────────────────

describe('imageHostingDomain middleware — app-host passthrough', () => {
  it('default app host → next(), normal routing works', async () => {
    const { app } = await createTestApp({ PUBLIC_APP_HOST: 'zpan.example.com' })
    const res = await app.request('/api/health', {
      headers: { host: 'zpan.example.com' },
    })
    expect(res.status).toBe(200)
  })

  it('subdomain of app host → next()', async () => {
    const { app } = await createTestApp({ PUBLIC_APP_HOST: 'zpan.example.com' })
    const res = await app.request('/api/health', {
      headers: { host: 'sub.zpan.example.com' },
    })
    expect(res.status).toBe(200)
  })

  it('workers.dev preview host → next(), normal routing works', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/health', {
      headers: { host: 'myproject.workers.dev' },
    })
    expect(res.status).toBe(200)
  })

  it('unknown external host with no DB entry → next() → normal 404', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/nonexistent-endpoint', {
      headers: { host: 'unknown.external.com' },
    })
    expect(res.status).toBe(404)
  })

  it('/api/* requests NOT interfered with even when host is unknown', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/health', {
      headers: { host: 'unknown.external.com' },
    })
    // no DB entry → next() → /api/health returns 200
    expect(res.status).toBe(200)
  })
})

// ─── Unverified custom domain ─────────────────────────────────────────────────

describe('imageHostingDomain middleware — unverified domain', () => {
  it('host = registered custom domain but domainVerifiedAt is null → next()', async () => {
    const { app, db } = await createTestApp()
    await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertImageHostingConfig(db, orgId, {
      customDomain: 'unverified.custom.com',
      domainVerifiedAt: null,
    })

    const res = await app.request('/api/health', {
      headers: { host: 'unverified.custom.com' },
    })
    // Falls through to normal routing
    expect(res.status).toBe(200)
  })
})

// ─── Custom domain redirect ───────────────────────────────────────────────────

describe('imageHostingDomain middleware — custom domain redirect', () => {
  it('verified custom domain with valid path returns non-cacheable metered redirect', async () => {
    const { app, db } = await createTestApp()
    await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertImageHosting(db, orgId, { id: 'dm-img1', path: 'blog/image.png' })
    await insertImageHostingConfig(db, orgId, { customDomain: 'img.user.com' })

    const res = await app.request('/blog/image.png', {
      headers: { host: 'img.user.com' },
      redirect: 'manual',
    })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(MOCK_INLINE_URL)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('verified custom domain consumes traffic quota when inline URL is issued', async () => {
    const { app, db } = await createTestApp()
    await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertImageHosting(db, orgId, { id: 'dm-quota-ok', path: 'quota/image.png' })
    await insertImageHostingConfig(db, orgId, { customDomain: 'img.quota.com' })
    const trafficPeriod = currentTrafficPeriod()
    await db.run(sql`
      UPDATE org_quotas
      SET traffic_quota = 2048, traffic_used = 256, traffic_period = ${trafficPeriod}
      WHERE org_id = ${orgId}
    `)

    const res = await app.request('/quota/image.png', {
      headers: { host: 'img.quota.com' },
      redirect: 'manual',
    })
    expect(res.status).toBe(302)

    const rows = await db.all<{ trafficUsed: number }>(
      sql`SELECT traffic_used AS trafficUsed FROM org_quotas WHERE org_id = ${orgId}`,
    )
    expect(rows[0].trafficUsed).toBe(1280)
  })

  it('verified custom domain returns 422 when traffic quota is exhausted', async () => {
    const { app, db } = await createTestApp()
    await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertImageHosting(db, orgId, { id: 'dm-quota-over', path: 'quota/over.png' })
    await insertImageHostingConfig(db, orgId, { customDomain: 'img.quota-over.com' })
    const trafficPeriod = currentTrafficPeriod()
    await db.run(sql`
      UPDATE org_quotas
      SET traffic_quota = 512, traffic_used = 0, traffic_period = ${trafficPeriod}
      WHERE org_id = ${orgId}
    `)

    const res = await app.request('/quota/over.png', {
      headers: { host: 'img.quota-over.com' },
      redirect: 'manual',
    })
    expect(res.status).toBe(422)
    await expect(res.json()).resolves.toEqual({ error: 'Traffic quota exceeded' })
    expect(S3Service.prototype.presignInline).not.toHaveBeenCalled()
    expect(await getAccessCount(db, 'dm-quota-over')).toBe(0)
  })

  it('verified custom domain refunds traffic when inline URL signing fails', async () => {
    const { app, db } = await createTestApp()
    await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertImageHosting(db, orgId, { id: 'dm-sign-fail', path: 'quota/sign-fail.png' })
    await insertImageHostingConfig(db, orgId, { customDomain: 'img.sign-fail.com' })
    const trafficPeriod = currentTrafficPeriod()
    await db.run(sql`
      UPDATE org_quotas
      SET traffic_quota = 2048, traffic_used = 256, traffic_period = ${trafficPeriod}
      WHERE org_id = ${orgId}
    `)
    vi.mocked(S3Service.prototype.presignInline).mockRejectedValueOnce(new Error('sign failed'))

    const res = await app.request('/quota/sign-fail.png', {
      headers: { host: 'img.sign-fail.com' },
      redirect: 'manual',
    })
    expect(res.status).toBe(500)

    const rows = await db.all<{ trafficUsed: number }>(
      sql`SELECT traffic_used AS trafficUsed FROM org_quotas WHERE org_id = ${orgId}`,
    )
    expect(rows[0].trafficUsed).toBe(256)
    expect(await getAccessCount(db, 'dm-sign-fail')).toBe(0)
  })

  it('verified custom domain, path not found → 404', async () => {
    const { app, db } = await createTestApp()
    await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertImageHostingConfig(db, orgId, { customDomain: 'img.missing.com' })

    const res = await app.request('/blog/notexist.png', {
      headers: { host: 'img.missing.com' },
      redirect: 'manual',
    })
    expect(res.status).toBe(404)
  })

  it('host with port suffix still matches', async () => {
    const { app, db } = await createTestApp()
    await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertImageHosting(db, orgId, { id: 'dm-port1', path: 'test/img.png' })
    await insertImageHostingConfig(db, orgId, { customDomain: 'img.port.com' })

    const res = await app.request('/test/img.png', {
      headers: { host: 'img.port.com:8080' },
      redirect: 'manual',
    })
    expect(res.status).toBe(302)
  })

  it('host uppercase → normalized match', async () => {
    const { app, db } = await createTestApp()
    await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertImageHosting(db, orgId, { id: 'dm-upper1', path: 'test/upper.png' })
    await insertImageHostingConfig(db, orgId, { customDomain: 'img.upper.com' })

    const res = await app.request('/test/upper.png', {
      headers: { host: 'IMG.UPPER.COM' },
      redirect: 'manual',
    })
    expect(res.status).toBe(302)
  })

  it('empty path (root /) → 404 with path required error', async () => {
    const { app, db } = await createTestApp()
    await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertImageHostingConfig(db, orgId, { customDomain: 'img.empty.com' })

    const res = await app.request('/', {
      headers: { host: 'img.empty.com' },
    })
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('path required')
  })
})

// ─── Referer allowlist tests ──────────────────────────────────────────────────

describe('imageHostingDomain middleware — referer allowlist', () => {
  it('referer allowlist blocks → 403', async () => {
    const { app, db } = await createTestApp()
    await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertImageHosting(db, orgId, { id: 'dm-ref1', path: 'ref/blocked.png' })
    await insertImageHostingConfig(db, orgId, {
      customDomain: 'img.refblock.com',
      refererAllowlist: ['https://allowed.com'],
    })

    const res = await app.request('/ref/blocked.png', {
      headers: { host: 'img.refblock.com', Referer: 'https://notallowed.com/page' },
      redirect: 'manual',
    })
    expect(res.status).toBe(403)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('forbidden referer')
  })

  it('referer allowlist allows matching origin → 302', async () => {
    const { app, db } = await createTestApp()
    await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertImageHosting(db, orgId, { id: 'dm-ref2', path: 'ref/allowed.png' })
    await insertImageHostingConfig(db, orgId, {
      customDomain: 'img.refallow.com',
      refererAllowlist: ['https://allowed.com'],
    })

    const res = await app.request('/ref/allowed.png', {
      headers: { host: 'img.refallow.com', Referer: 'https://allowed.com/post' },
      redirect: 'manual',
    })
    expect(res.status).toBe(302)
  })
})

// ─── Cross-org isolation ──────────────────────────────────────────────────────

describe('imageHostingDomain middleware — cross-org isolation', () => {
  it('path from org-A does not resolve via org-B custom domain', async () => {
    const { app, db } = await createTestApp()

    // Set up org A
    await authedHeaders(app, 'orgA@example.com')
    await insertStorage(db)
    const orgARows = await db.all<{ id: string }>(
      sql`SELECT id FROM organization WHERE metadata LIKE '%"type":"personal"%' ORDER BY created_at ASC LIMIT 1`,
    )
    const orgAId = orgARows[0].id
    await insertImageHosting(db, orgAId, { id: 'dm-iso-a', path: 'shared/image.png' })
    await insertImageHostingConfig(db, orgAId, { customDomain: 'img.orga.com' })

    // Set up org B
    await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Org B User', email: 'orgB@example.com', password: 'password123456' }),
    })
    const orgBRows = await db.all<{ id: string }>(
      sql`SELECT id FROM organization WHERE metadata LIKE '%"type":"personal"%' ORDER BY created_at DESC LIMIT 1`,
    )
    const orgBId = orgBRows[0].id
    // org-B has its own custom domain but NOT 'shared/image.png'
    await insertImageHostingConfig(db, orgBId, { customDomain: 'img.orgb.com' })

    // Requesting org-A's path via org-B's domain → 404 (isolation)
    const res = await app.request('/shared/image.png', {
      headers: { host: 'img.orgb.com' },
      redirect: 'manual',
    })
    expect(res.status).toBe(404)
  })
})

// ─── accessCount atomicity ────────────────────────────────────────────────────

describe('imageHostingDomain middleware — accessCount', () => {
  it('accessCount increments on successful redirect', async () => {
    const { app, db } = await createTestApp()
    await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertImageHosting(db, orgId, { id: 'dm-cnt1', path: 'cnt/image.png' })
    await insertImageHostingConfig(db, orgId, { customDomain: 'img.count.com' })

    expect(await getAccessCount(db, 'dm-cnt1')).toBe(0)
    await app.request('/cnt/image.png', {
      headers: { host: 'img.count.com' },
      redirect: 'manual',
    })
    expect(await getAccessCount(db, 'dm-cnt1')).toBe(1)
  })

  it('accessCount does NOT increment on 403 (blocked referer)', async () => {
    const { app, db } = await createTestApp()
    await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertImageHosting(db, orgId, { id: 'dm-cnt2', path: 'cnt/blocked.png' })
    await insertImageHostingConfig(db, orgId, {
      customDomain: 'img.countblocked.com',
      refererAllowlist: ['https://allowed.com'],
    })

    await app.request('/cnt/blocked.png', {
      headers: { host: 'img.countblocked.com' },
      redirect: 'manual',
    })
    expect(await getAccessCount(db, 'dm-cnt2')).toBe(0)
  })
})
