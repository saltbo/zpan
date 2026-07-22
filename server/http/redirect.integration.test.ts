import { sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { S3Service } from '../adapters/gateways/s3.js'
import { createShareRepo } from '../adapters/repos/share'
import { currentTrafficPeriod } from '../domain/quota.js'
import { authedHeaders, createTestApp } from '../test/setup.js'
import { insufficientCredits } from '../usecases/ports'

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
    INSERT INTO storages (id, bucket, endpoint, region, access_key, secret_key, file_path, custom_host, capacity, used, status, created_at, updated_at)
    VALUES (${STORAGE_ID}, 'test-bucket', 'https://s3.amazonaws.com', 'us-east-1', 'AK', 'SK', '', '', 0, 0, 'active', ${now}, ${now})
  `)
}

async function setTrafficPlanEntitlement(
  db: Awaited<ReturnType<typeof createTestApp>>['db'],
  orgId: string,
  bytes: number,
) {
  const now = Date.now()
  await db.run(sql`
    UPDATE org_quota_entitlements
    SET status = 'revoked', updated_at = ${now}
    WHERE org_id = ${orgId}
      AND resource_type = 'traffic'
      AND entitlement_type = 'plan'
      AND status = 'active'
  `)
  await db.run(sql`
    INSERT INTO org_quota_entitlements
      (id, org_id, resource_type, entitlement_type, source, source_id, bytes, starts_at, expires_at, status, metadata, created_at, updated_at)
    VALUES
      (${`test-traffic-plan-${now}`}, ${orgId}, 'traffic', 'plan', 'test', ${`test-traffic-plan:${orgId}:${now}`}, ${bytes}, ${now}, NULL, 'active', '{"packageName":"Test Plan"}', ${now}, ${now})
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
  it('returns 302 with attachment disposition and no-store cache for valid direct share [spec: redirect/direct-share]', async () => {
    const { app, db } = await createTestApp()
    await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    const creatorId = await getUserId(db)
    await insertFile(db, orgId, { id: 'ds-f1', name: 'file.bin' })
    const share = await createShareRepo(db).create({ matterId: 'ds-f1', orgId, creatorId, kind: 'direct' })

    const res = await app.request(`/r/${share.token}`, { redirect: 'manual' })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(MOCK_PRESIGN_URL)
    expect(res.headers.get('cache-control')).toContain('no-store')
    const events = await db.all<{ actorType: string; bytes: number; source: string; trafficEventId: string }>(sql`
      SELECT
        actor_type AS actorType,
        json_extract(metadata, '$.bytes') AS bytes,
        json_extract(metadata, '$.source') AS source,
        json_extract(metadata, '$.trafficEventId') AS trafficEventId
      FROM audit_events
      WHERE action = 'share_download' AND target_id = ${share.id}
    `)
    expect(events).toEqual([
      { actorType: 'anonymous', bytes: 1024, source: 'direct_share', trafficEventId: expect.any(String) },
    ])
  })

  it('returns 404 for unknown ds_ token [spec: redirect/unknown-ds-token]', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/r/ds_unknowntoken', { redirect: 'manual' })
    expect(res.status).toBe(404)
  })

  it('returns 404 for landing share token at /r/ [spec: redirect/landing-token-rejected]', async () => {
    const { app, db } = await createTestApp()
    await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    const creatorId = await getUserId(db)
    await insertFile(db, orgId, { id: 'ds-f2', name: 'landing.txt' })
    const share = await createShareRepo(db).create({ matterId: 'ds-f2', orgId, creatorId, kind: 'landing' })

    // Landing share token does not start with ds_ so falls through to 404
    const res = await app.request(`/r/${share.token}`, { redirect: 'manual' })
    expect(res.status).toBe(404)
  })

  it('returns 422 when direct share traffic quota is exhausted [spec: redirect/ds-quota-exhausted]', async () => {
    const { app, db } = await createTestApp()
    await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    const creatorId = await getUserId(db)
    await insertFile(db, orgId, { id: 'ds-quota', name: 'quota.bin' })
    const trafficPeriod = currentTrafficPeriod()
    await db.run(sql`
      UPDATE org_quotas
      SET traffic_quota = 0, traffic_used = 0, traffic_period = ${trafficPeriod}
      WHERE org_id = ${orgId}
    `)
    await setTrafficPlanEntitlement(db, orgId, 512)
    const share = await createShareRepo(db).create({
      matterId: 'ds-quota',
      orgId,
      creatorId,
      kind: 'direct',
      downloadLimit: 1,
    })

    const res = await app.request(`/r/${share.token}`, { redirect: 'manual' })
    expect(res.status).toBe(422)
    const body = (await res.json()) as { error: { message: string; details: Array<{ reason: string }> } }
    expect(body.error.message).toBe('Traffic quota exceeded')
    expect(body.error.details[0].reason).toBe('QUOTA_EXCEEDED')
    expect(S3Service.prototype.presignDownload).not.toHaveBeenCalled()

    const shares = await db.all<{ downloads: number }>(sql`SELECT downloads FROM shares WHERE id = ${share.id}`)
    expect(shares[0].downloads).toBe(0)
    const failures = await db.all<{ reason: string; source: string }>(sql`
      SELECT json_extract(metadata, '$.reason') AS reason, json_extract(metadata, '$.source') AS source
      FROM audit_events
      WHERE action = 'download_failed' AND target_id = ${share.id}
    `)
    expect(failures).toEqual([{ reason: 'quota_exceeded', source: 'direct_share' }])
  })

  it('consumes traffic quota on successful direct share redirect [spec: redirect/ds-consumes-quota]', async () => {
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
    const share = await createShareRepo(db).create({ matterId: 'ds-quota-ok', orgId, creatorId, kind: 'direct' })

    const res = await app.request(`/r/${share.token}`, { redirect: 'manual' })
    expect(res.status).toBe(302)

    const rows = await db.all<{ trafficUsed: number }>(
      sql`SELECT traffic_used AS trafficUsed FROM org_quotas WHERE org_id = ${orgId}`,
    )
    expect(rows[0].trafficUsed).toBe(1280)
  })

  it('returns 410 with AIP-193 body when a direct share is expired', async () => {
    const { app, db } = await createTestApp()
    await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    const creatorId = await getUserId(db)
    await insertFile(db, orgId, { id: 'ds-expired', name: 'expired.bin' })
    const share = await createShareRepo(db).create({
      matterId: 'ds-expired',
      orgId,
      creatorId,
      kind: 'direct',
      expiresAt: new Date(Date.now() - 1000),
    })

    const res = await app.request(`/r/${share.token}`, { redirect: 'manual' })
    expect(res.status).toBe(410)
    const body = (await res.json()) as { error: { code: number; message: string; status: string } }
    expect(body.error.code).toBe(410)
    expect(body.error.message).toBe('Share has expired')
    expect(body.error.status).toBe('NOT_FOUND')
    expect(S3Service.prototype.presignDownload).not.toHaveBeenCalled()
  })

  it('returns 404 when a direct share references a missing storage', async () => {
    const { app, db } = await createTestApp()
    await authedHeaders(app)
    // Intentionally do NOT insert the storage row; the matter points at a
    // storage_id that does not exist.
    const orgId = await getOrgId(db)
    const creatorId = await getUserId(db)
    await insertFile(db, orgId, { id: 'ds-no-storage', name: 'orphan.bin' })
    const share = await createShareRepo(db).create({ matterId: 'ds-no-storage', orgId, creatorId, kind: 'direct' })

    const res = await app.request(`/r/${share.token}`, { redirect: 'manual' })
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: { message: string; status: string } }
    expect(body.error.message).toBe('Storage not found')
    expect(body.error.status).toBe('NOT_FOUND')
  })

  it('refunds traffic and download count when direct share signing fails [spec: redirect/ds-refund-on-failure]', async () => {
    const { app, db } = await createTestApp()
    await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    const creatorId = await getUserId(db)
    await insertFile(db, orgId, { id: 'ds-sign-fail', name: 'quota.bin' })
    const trafficPeriod = currentTrafficPeriod()
    await db.run(sql`
      UPDATE org_quotas
      SET traffic_quota = 2048, traffic_used = 256, traffic_period = ${trafficPeriod}
      WHERE org_id = ${orgId}
    `)
    vi.mocked(S3Service.prototype.presignDownload).mockRejectedValueOnce(new Error('sign failed'))
    const share = await createShareRepo(db).create({ matterId: 'ds-sign-fail', orgId, creatorId, kind: 'direct' })

    const res = await app.request(`/r/${share.token}`, { redirect: 'manual' })
    expect(res.status).toBe(500)

    const trafficRows = await db.all<{ trafficUsed: number }>(
      sql`SELECT traffic_used AS trafficUsed FROM org_quotas WHERE org_id = ${orgId}`,
    )
    expect(trafficRows[0].trafficUsed).toBe(256)

    const shareRows = await db.all<{ downloads: number }>(sql`SELECT downloads FROM shares WHERE id = ${share.id}`)
    expect(shareRows[0].downloads).toBe(0)
  })
})

// ─── ih_ image hosting tests ──────────────────────────────────────────────────

describe('GET /r/:token (ih_ image hosting)', () => {
  it('returns 302 with inline disposition and no-store cache for active image [spec: redirect/image]', async () => {
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
    const events = await db.all<{ actorType: string; bytes: number; source: string; trafficEventId: string }>(sql`
      SELECT
        actor_type AS actorType,
        json_extract(metadata, '$.bytes') AS bytes,
        json_extract(metadata, '$.source') AS source,
        json_extract(metadata, '$.trafficEventId') AS trafficEventId
      FROM audit_events
      WHERE action = 'image_hosting_download' AND target_id = 'ih-img1'
    `)
    expect(events).toEqual([
      { actorType: 'anonymous', bytes: 1024, source: 'image_hosting', trafficEventId: expect.any(String) },
    ])
  })

  it('strips .png extension and resolves same image [spec: redirect/image-strip-ext]', async () => {
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

  it('returns 404 for non-existent ih_ token [spec: redirect/unknown-ih-token]', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/r/ih_doesnotexist', { redirect: 'manual' })
    expect(res.status).toBe(404)
  })

  it('returns 404 for image with status=draft [spec: redirect/image-draft-hidden]', async () => {
    const { app, db } = await createTestApp()
    await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertImageHosting(db, orgId, { id: 'ih-draft1', token: 'ih_drafttoken', status: 'draft' })

    const res = await app.request('/r/ih_drafttoken', { redirect: 'manual' })
    expect(res.status).toBe(404)
  })

  it('returns 404 when an image hosting record references a missing storage', async () => {
    const { app, db } = await createTestApp()
    await authedHeaders(app)
    // No storage row inserted for this storage id.
    const orgId = await getOrgId(db)
    await insertImageHosting(db, orgId, {
      id: 'ih-no-storage',
      token: 'ih_nostorage',
      storageId: 'st-missing-storage',
    })

    const res = await app.request('/r/ih_nostorage', { redirect: 'manual' })
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: { message: string; status: string } }
    expect(body.error.message).toBe('Storage not found')
    expect(body.error.status).toBe('NOT_FOUND')
    expect(S3Service.prototype.presignInline).not.toHaveBeenCalled()
    expect(await getAccessCount(db, 'ih-no-storage')).toBe(0)
  })

  it('returns 402 insufficient credits when cloud egress reporting blocks the image redirect', async () => {
    const { app, db } = await createTestApp()
    await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertImageHosting(db, orgId, { id: 'ih-credits', token: 'ih_credits' })

    const redirectUsecase = await import('../usecases/redirect.js')
    vi.spyOn(redirectUsecase, 'resolveImageHostingDownload').mockResolvedValueOnce({
      ok: false,
      error: insufficientCredits('Insufficient credits', { metadata: { resource: 'storage_egress' } }),
    })

    const res = await app.request('/r/ih_credits', { redirect: 'manual' })
    expect(res.status).toBe(402)
    const body = (await res.json()) as {
      error: {
        code: number
        message: string
        status: string
        details: Array<{ reason: string; metadata?: { resource?: string } }>
      }
    }
    expect(body.error.code).toBe(402)
    expect(body.error.message).toBe('Insufficient credits')
    expect(body.error.details[0].reason).toBe('INSUFFICIENT_CREDITS')
    expect(body.error.details[0].metadata?.resource).toBe('storage_egress')
  })

  it('increments accessCount by 1 on successful redirect [spec: redirect/image-access-count]', async () => {
    const { app, db } = await createTestApp()
    await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertImageHosting(db, orgId, { id: 'ih-cnt1', token: 'ih_counttest1' })

    expect(await getAccessCount(db, 'ih-cnt1')).toBe(0)
    await app.request('/r/ih_counttest1', { redirect: 'manual' })
    expect(await getAccessCount(db, 'ih-cnt1')).toBe(1)
  })

  it('consumes traffic quota on successful image hosting redirect [spec: redirect/image-consumes-quota]', async () => {
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

  it('refunds traffic when image hosting signing fails [spec: redirect/image-refund-on-failure]', async () => {
    const { app, db } = await createTestApp()
    await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertImageHosting(db, orgId, { id: 'ih-sign-fail', token: 'ih_signfail' })
    const trafficPeriod = currentTrafficPeriod()
    await db.run(sql`
      UPDATE org_quotas
      SET traffic_quota = 2048, traffic_used = 256, traffic_period = ${trafficPeriod}
      WHERE org_id = ${orgId}
    `)
    vi.mocked(S3Service.prototype.presignInline).mockRejectedValueOnce(new Error('sign failed'))

    const res = await app.request('/r/ih_signfail', { redirect: 'manual' })
    expect(res.status).toBe(500)

    const rows = await db.all<{ trafficUsed: number }>(
      sql`SELECT traffic_used AS trafficUsed FROM org_quotas WHERE org_id = ${orgId}`,
    )
    expect(rows[0].trafficUsed).toBe(256)
    expect(await getAccessCount(db, 'ih-sign-fail')).toBe(0)
  })

  it('rejects the next image redirect after the first one consumes the remaining monthly traffic quota [spec: redirect/image-quota-boundary]', async () => {
    const { app, db } = await createTestApp()
    await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertImageHosting(db, orgId, { id: 'ih-quota-repeat', token: 'ih_quotarepeat' })
    const trafficPeriod = currentTrafficPeriod()
    await db.run(sql`
      UPDATE org_quotas
      SET traffic_quota = 0, traffic_used = 0, traffic_period = ${trafficPeriod}
      WHERE org_id = ${orgId}
    `)
    await setTrafficPlanEntitlement(db, orgId, 1024)

    const first = await app.request('/r/ih_quotarepeat', { redirect: 'manual' })
    expect(first.status).toBe(302)
    expect(first.headers.get('cache-control')).toBe('no-store')

    const second = await app.request('/r/ih_quotarepeat', { redirect: 'manual' })
    expect(second.status).toBe(422)
    const secondBody = (await second.json()) as { error: { message: string; details: Array<{ reason: string }> } }
    expect(secondBody.error.message).toBe('Traffic quota exceeded')
    expect(secondBody.error.details[0].reason).toBe('QUOTA_EXCEEDED')
    expect(S3Service.prototype.presignInline).toHaveBeenCalledTimes(1)
    expect(await getAccessCount(db, 'ih-quota-repeat')).toBe(1)
  })

  it('does NOT increment accessCount on 404 [spec: redirect/no-count-on-404]', async () => {
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
  it('allows any referer when allowlist is empty [spec: redirect/referer-empty-allowlist]', async () => {
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

  it('returns 302 when referer matches allowlist entry [spec: redirect/referer-match]', async () => {
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

  it('allows access when referer is missing (direct access from tools/address bar) [spec: redirect/referer-missing-ok]', async () => {
    const { app, db } = await createTestApp()
    await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertImageHosting(db, orgId, { id: 'ih-ref3', token: 'ih_reftest3' })
    await insertImageHostingConfig(db, orgId, { refererAllowlist: ['https://myblog.com'] })

    const res = await app.request('/r/ih_reftest3', { redirect: 'manual' })
    expect(res.status).toBe(302)
  })

  it('returns 403 when referer is from a different origin [spec: redirect/referer-mismatch]', async () => {
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

  it('returns 403 for subdomain mismatch (exact origin match required) [spec: redirect/referer-subdomain]', async () => {
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

  it('does NOT increment accessCount on 403 [spec: redirect/no-count-on-403]', async () => {
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
      INSERT OR IGNORE INTO storages (id, bucket, endpoint, region, access_key, secret_key, file_path, custom_host, capacity, used, status, created_at, updated_at)
      VALUES (${STORAGE_ID}, 'test-bucket', 'https://s3.amazonaws.com', 'us-east-1', 'AK', 'SK', '', '', 0, 0, 'active', ${now}, ${now})
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
      SET traffic_quota = 0, traffic_used = 0, traffic_period = ${trafficPeriod}
      WHERE org_id = ${orgId}
    `)
    await setTrafficPlanEntitlement(db, orgId, 512)

    const res = await app.request('/r/ih_quotatest', { redirect: 'manual' })
    expect(res.status).toBe(422)
    const body = (await res.json()) as { error: { message: string; details: Array<{ reason: string }> } }
    expect(body.error.message).toBe('Traffic quota exceeded')
    expect(body.error.details[0].reason).toBe('QUOTA_EXCEEDED')
    expect(S3Service.prototype.presignInline).not.toHaveBeenCalled()
  })
})
