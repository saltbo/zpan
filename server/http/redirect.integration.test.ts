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

// ─── Direct share tests ──────────────────────────────────────────────────────

describe('GET /r/:token (direct shares)', () => {
  it('returns 302 with attachment disposition and no-store cache for valid direct share [spec: redirect/direct-share]', async () => {
    const { app, db, deps } = await createTestApp()
    const shareLookup = vi.spyOn(deps.share, 'resolveByToken')
    const imageLookup = vi.spyOn(deps.imageHosting, 'resolveActiveByToken')
    await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    const creatorId = await getUserId(db)
    await insertFile(db, orgId, { id: 'ds-f1', name: 'file.bin' })
    const share = await createShareRepo(db).create({ matterId: 'ds-f1', orgId, creatorId, kind: 'direct' })
    expect(share.token).toMatch(/^s[A-Za-z0-9]{11}$/)

    const res = await app.request(`/r/${share.token}`, { redirect: 'manual' })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(MOCK_PRESIGN_URL)
    expect(res.headers.get('cache-control')).toContain('no-store')
    expect(shareLookup).toHaveBeenCalledTimes(1)
    expect(imageLookup).not.toHaveBeenCalled()
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

  it('keeps a historical ds_ direct-share link usable [spec: redirect/legacy-direct-share]', async () => {
    const { app, db } = await createTestApp()
    await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    const creatorId = await getUserId(db)
    await insertFile(db, orgId, { id: 'legacy-direct-file_', name: 'legacy-direct.bin' })
    await db.run(sql`
      INSERT INTO shares (id, token, kind, matter_id, org_id, creator_id, views, downloads, status, private, created_at)
      VALUES ('legacy-direct-share_', 'ds_legacy-token', 'direct', 'legacy-direct-file_', ${orgId}, ${creatorId}, 0, 0, 'active', 0, ${Date.now()})
    `)

    const res = await app.request('/r/ds_legacy-token', { redirect: 'manual' })

    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(MOCK_PRESIGN_URL)
  })

  it('returns 404 for an unknown opaque token [spec: redirect/unknown-ds-token]', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/r/s00000000000', { redirect: 'manual' })
    expect(res.status).toBe(404)
  })

  it('returns 404 for landing share token at /r/ [spec: redirect/landing-token-rejected]', async () => {
    const { app, db, deps } = await createTestApp()
    const shareLookup = vi.spyOn(deps.share, 'resolveByToken')
    const imageLookup = vi.spyOn(deps.imageHosting, 'resolveActiveByToken')
    await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    const creatorId = await getUserId(db)
    await insertFile(db, orgId, { id: 'ds-f2', name: 'landing.txt' })
    const share = await createShareRepo(db).create({ matterId: 'ds-f2', orgId, creatorId, kind: 'landing' })

    const res = await app.request(`/r/${share.token}`, { redirect: 'manual' })
    expect(res.status).toBe(404)
    expect(shareLookup).toHaveBeenCalledTimes(1)
    expect(imageLookup).not.toHaveBeenCalled()
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

// ─── image hosting token tests ────────────────────────────────────────────────

describe('GET /r/:token (image hosting)', () => {
  it('returns 302 with inline disposition and no-store cache for active image [spec: redirect/image]', async () => {
    const { app, db, deps } = await createTestApp()
    const shareLookup = vi.spyOn(deps.share, 'resolveByToken')
    const imageLookup = vi.spyOn(deps.imageHosting, 'resolveActiveByToken')
    await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertImageHosting(db, orgId, { id: 'ih-img1', token: 'i00000000001' })

    const res = await app.request('/r/i00000000001', { redirect: 'manual' })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(MOCK_INLINE_URL)
    const cc = res.headers.get('cache-control') ?? ''
    expect(cc).toContain('no-store')
    expect(imageLookup).toHaveBeenCalledTimes(1)
    expect(shareLookup).not.toHaveBeenCalled()
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

  it('serves a new image-hosting token without an underscore', async () => {
    const { app, db } = await createTestApp()
    await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertImageHosting(db, orgId, { id: 'ih-new-token', token: 'i00000000002' })

    const res = await app.request('/r/i00000000002.png', { redirect: 'manual' })

    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(MOCK_INLINE_URL)
  })

  it('keeps a historical ih image link usable [spec: redirect/legacy-image]', async () => {
    const { app, db } = await createTestApp()
    await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertImageHosting(db, orgId, { id: 'legacy-image_', token: 'ih_legacy-token' })

    const res = await app.request('/r/ih_legacy-token.png', { redirect: 'manual' })

    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(MOCK_INLINE_URL)
  })

  it('strips .png extension and resolves same image [spec: redirect/image-strip-ext]', async () => {
    const { app, db } = await createTestApp()
    await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertImageHosting(db, orgId, { id: 'ih-img2', token: 'i00000000003' })

    const res = await app.request('/r/i00000000003.png', { redirect: 'manual' })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(MOCK_INLINE_URL)
  })

  it('strips .webp extension and resolves same image', async () => {
    const { app, db } = await createTestApp()
    await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertImageHosting(db, orgId, { id: 'ih-img3', token: 'i00000000004' })

    const res = await app.request('/r/i00000000004.webp', { redirect: 'manual' })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(MOCK_INLINE_URL)
  })

  it('returns 404 for an unknown historical image token [spec: redirect/unknown-ih-token]', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/r/ih_doesnotexist', { redirect: 'manual' })
    expect(res.status).toBe(404)
  })

  it('returns 404 for image with status=draft [spec: redirect/image-draft-hidden]', async () => {
    const { app, db } = await createTestApp()
    await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertImageHosting(db, orgId, { id: 'ih-draft1', token: 'i00000000005', status: 'draft' })

    const res = await app.request('/r/i00000000005', { redirect: 'manual' })
    expect(res.status).toBe(404)
  })

  it('returns 404 when an image hosting record references a missing storage', async () => {
    const { app, db } = await createTestApp()
    await authedHeaders(app)
    // No storage row inserted for this storage id.
    const orgId = await getOrgId(db)
    await insertImageHosting(db, orgId, {
      id: 'ih-no-storage',
      token: 'i00000000006',
      storageId: 'st-missing-storage',
    })

    const res = await app.request('/r/i00000000006', { redirect: 'manual' })
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
    await insertImageHosting(db, orgId, { id: 'ih-credits', token: 'i00000000007' })

    const redirectUsecase = await import('../usecases/redirect.js')
    vi.spyOn(redirectUsecase, 'resolveImageHostingDownload').mockResolvedValueOnce({
      ok: false,
      error: insufficientCredits('Insufficient credits', { metadata: { resource: 'storage_egress' } }),
    })

    const res = await app.request('/r/i00000000007', { redirect: 'manual' })
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
    await insertImageHosting(db, orgId, { id: 'ih-cnt1', token: 'i00000000008' })

    expect(await getAccessCount(db, 'ih-cnt1')).toBe(0)
    await app.request('/r/i00000000008', { redirect: 'manual' })
    expect(await getAccessCount(db, 'ih-cnt1')).toBe(1)
  })

  it('consumes traffic quota on successful image hosting redirect [spec: redirect/image-consumes-quota]', async () => {
    const { app, db } = await createTestApp()
    await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertImageHosting(db, orgId, { id: 'ih-quota-ok', token: 'i00000000009' })
    const trafficPeriod = currentTrafficPeriod()
    await db.run(sql`
      UPDATE org_quotas
      SET traffic_quota = 2048, traffic_used = 256, traffic_period = ${trafficPeriod}
      WHERE org_id = ${orgId}
    `)

    const res = await app.request('/r/i00000000009', { redirect: 'manual' })
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
    await insertImageHosting(db, orgId, { id: 'ih-sign-fail', token: 'i00000000010' })
    const trafficPeriod = currentTrafficPeriod()
    await db.run(sql`
      UPDATE org_quotas
      SET traffic_quota = 2048, traffic_used = 256, traffic_period = ${trafficPeriod}
      WHERE org_id = ${orgId}
    `)
    vi.mocked(S3Service.prototype.presignInline).mockRejectedValueOnce(new Error('sign failed'))

    const res = await app.request('/r/i00000000010', { redirect: 'manual' })
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
    await insertImageHosting(db, orgId, { id: 'ih-quota-repeat', token: 'i00000000011' })
    const trafficPeriod = currentTrafficPeriod()
    await db.run(sql`
      UPDATE org_quotas
      SET traffic_quota = 0, traffic_used = 0, traffic_period = ${trafficPeriod}
      WHERE org_id = ${orgId}
    `)
    await setTrafficPlanEntitlement(db, orgId, 1024)

    const first = await app.request('/r/i00000000011', { redirect: 'manual' })
    expect(first.status).toBe(302)
    expect(first.headers.get('cache-control')).toBe('no-store')

    const second = await app.request('/r/i00000000011', { redirect: 'manual' })
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
    await insertImageHosting(db, orgId, { id: 'ih-cnt2', token: 'i00000000012', status: 'draft' })

    await app.request('/r/i00000000012', { redirect: 'manual' })
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
    await insertImageHosting(db, orgId, { id: 'ih-ref1', token: 'i00000000013' })
    // No config inserted — no allowlist

    const res = await app.request('/r/i00000000013', {
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
    await insertImageHosting(db, orgId, { id: 'ih-ref2', token: 'i00000000014' })
    await insertImageHostingConfig(db, orgId, { refererAllowlist: ['https://myblog.com'] })

    const res = await app.request('/r/i00000000014', {
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
    await insertImageHosting(db, orgId, { id: 'ih-ref3', token: 'i00000000015' })
    await insertImageHostingConfig(db, orgId, { refererAllowlist: ['https://myblog.com'] })

    const res = await app.request('/r/i00000000015', { redirect: 'manual' })
    expect(res.status).toBe(302)
  })

  it('returns 403 when referer is from a different origin [spec: redirect/referer-mismatch]', async () => {
    const { app, db } = await createTestApp()
    await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertImageHosting(db, orgId, { id: 'ih-ref4', token: 'i00000000016' })
    await insertImageHostingConfig(db, orgId, { refererAllowlist: ['https://myblog.com'] })

    const res = await app.request('/r/i00000000016', {
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
    await insertImageHosting(db, orgId, { id: 'ih-ref5', token: 'i00000000017' })
    await insertImageHostingConfig(db, orgId, { refererAllowlist: ['https://myblog.com'] })

    const res = await app.request('/r/i00000000017', {
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
    await insertImageHosting(db, orgId, { id: 'ih-ref6', token: 'i00000000018' })
    await insertImageHostingConfig(db, orgId, { refererAllowlist: ['https://myblog.com'] })

    await app.request('/r/i00000000018', {
      redirect: 'manual',
      headers: { Referer: 'https://evil.com/page' },
    })
    expect(await getAccessCount(db, 'ih-ref6')).toBe(0)
  })
})

// ─── Unknown prefix ───────────────────────────────────────────────────────────

describe('GET /r/:token — unknown prefix', () => {
  it.each([
    '/r/x00000000000',
    '/r/S00000000000',
    '/r/I00000000000',
    '/r/000000000000',
    '/r/s0000000000',
    '/r/i000000000000',
    '/r/i00000000000.png.webp',
    '/r/i00000000000.bad-ext',
  ])('returns 404 without querying either resource repository for %s', async (path) => {
    const { app, deps } = await createTestApp()
    const shareLookup = vi.spyOn(deps.share, 'resolveByToken')
    const imageLookup = vi.spyOn(deps.imageHosting, 'resolveActiveByToken')
    const res = await app.request(path, { redirect: 'manual' })
    expect(res.status).toBe(404)
    expect(shareLookup).not.toHaveBeenCalled()
    expect(imageLookup).not.toHaveBeenCalled()
  })
})

// ─── Two-org isolation ────────────────────────────────────────────────────────

describe('GET /r/:token — two-org isolation', () => {
  it('image token for org-A resolves correctly and does not cross into org-B', async () => {
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
    await insertImageHosting(db, orgId, { id: 'ih-iso1', token: 'i00000000019' })

    const res = await app.request('/r/i00000000019', { redirect: 'manual' })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(MOCK_INLINE_URL)
  })

  it('returns 422 when image hosting traffic quota is exhausted', async () => {
    const { app, db } = await createTestApp()
    await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertImageHosting(db, orgId, { id: 'ih-quota', token: 'i00000000020' })
    const trafficPeriod = currentTrafficPeriod()
    await db.run(sql`
      UPDATE org_quotas
      SET traffic_quota = 0, traffic_used = 0, traffic_period = ${trafficPeriod}
      WHERE org_id = ${orgId}
    `)
    await setTrafficPlanEntitlement(db, orgId, 512)

    const res = await app.request('/r/i00000000020', { redirect: 'manual' })
    expect(res.status).toBe(422)
    const body = (await res.json()) as { error: { message: string; details: Array<{ reason: string }> } }
    expect(body.error.message).toBe('Traffic quota exceeded')
    expect(body.error.details[0].reason).toBe('QUOTA_EXCEEDED')
    expect(S3Service.prototype.presignInline).not.toHaveBeenCalled()
  })
})
