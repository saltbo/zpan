import { eq, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { S3Service } from '../adapters/gateways/s3.js'
import { createShareRepo } from '../adapters/repos/share'
import { shareRecipients, shares } from '../db/schema.js'
import { currentTrafficPeriod } from '../domain/quota.js'
import { authedHeaders, createTestApp, seedProLicense } from '../test/setup.js'

type TestApp = Awaited<ReturnType<typeof createTestApp>>['app']
type TestDb = Awaited<ReturnType<typeof createTestApp>>['db']

// ─── Helpers ──────────────────────────────────────────────────────────────────

const validStorage = {
  id: 'st-share-test',
  title: 'Test S3',
  mode: 'private',
  bucket: 'test-bucket',
  endpoint: 'https://s3.amazonaws.com',
  region: 'us-east-1',
  accessKey: 'AKIAIOSFODNN7EXAMPLE',
  secretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
}

async function insertStorage(db: TestDb) {
  const now = Date.now()
  await db.run(sql`
    INSERT OR IGNORE INTO storages (id, title, mode, bucket, endpoint, region, access_key, secret_key, file_path, custom_host, capacity, used, status, created_at, updated_at)
    VALUES (${validStorage.id}, ${validStorage.title}, ${validStorage.mode}, ${validStorage.bucket}, ${validStorage.endpoint}, ${validStorage.region}, ${validStorage.accessKey}, ${validStorage.secretKey}, '', '', 0, 0, 'active', ${now}, ${now})
  `)
}

async function setStoragePlanEntitlement(db: TestDb, orgId: string, bytes: number) {
  const now = Date.now()
  await db.run(sql`
    UPDATE org_quota_entitlements
    SET status = 'revoked', updated_at = ${now}
    WHERE org_id = ${orgId}
      AND resource_type = 'storage'
      AND entitlement_type = 'plan'
      AND status = 'active'
  `)
  await db.run(sql`
    INSERT INTO org_quota_entitlements
      (id, org_id, resource_type, entitlement_type, source, source_id, bytes, starts_at, expires_at, status, metadata, created_at, updated_at)
    VALUES
      (${nanoid()}, ${orgId}, 'storage', 'plan', 'test', ${`test-storage-plan:${orgId}:${nanoid()}`}, ${bytes}, ${now}, NULL, 'active', '{"packageName":"Test Plan"}', ${now}, ${now})
  `)
}

async function insertFile(
  db: TestDb,
  orgId: string,
  opts: { id: string; name: string; parent?: string; status?: string },
) {
  const now = Date.now()
  const status = opts.status ?? 'active'
  await db.run(sql`
    INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, created_at, updated_at)
    VALUES (${opts.id}, ${orgId}, ${`${opts.id}-alias`}, ${opts.name}, 'text/plain', 100, 0, ${opts.parent ?? ''}, 'some/key.txt', ${validStorage.id}, ${status}, ${now}, ${now})
  `)
}

async function insertFolder(db: TestDb, orgId: string, opts: { id: string; name: string; parent?: string }) {
  const now = Date.now()
  await db.run(sql`
    INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, created_at, updated_at)
    VALUES (${opts.id}, ${orgId}, ${`${opts.id}-alias`}, ${opts.name}, 'folder', 0, 1, ${opts.parent ?? ''}, '', ${validStorage.id}, 'active', ${now}, ${now})
  `)
}

async function getOrgId(db: TestDb): Promise<string> {
  const rows = await db.all<{ id: string }>(sql`
    SELECT id FROM organization WHERE metadata LIKE '%"type":"personal"%' LIMIT 1
  `)
  return rows[0].id
}

async function createShare(app: TestApp, headers: Record<string, string>, body: Record<string, unknown>) {
  return app.request('/api/shares', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function getShareIdByToken(db: TestDb, token: string): Promise<string> {
  const rows = await db.select({ id: shares.id }).from(shares).where(eq(shares.token, token))
  return rows[0]?.id ?? ''
}

// ─── POST /api/shares auth guard ─────────────────────────────────────────────

describe('POST /api/shares (auth guard)', () => {
  it('returns 401 without auth [spec: shares/auth-required]', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/shares', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matterId: 'x', kind: 'landing' }),
    })
    expect(res.status).toBe(401)
  })
})

// ─── POST /api/shares ─────────────────────────────────────────────────────────

describe('POST /api/shares', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('creates a landing share without password and returns 201 with correct shape [spec: shares/create-landing]', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'f1', name: 'doc.txt' })

    const res = await createShare(app, headers, { matterId: 'f1', kind: 'landing' })
    expect(res.status).toBe(201)

    const body = (await res.json()) as Record<string, unknown>
    expect(typeof body.token).toBe('string')
    expect(body.kind).toBe('landing')
    expect((body.urls as Record<string, string>).landing).toMatch(/^\/s\//)
    expect((body.urls as Record<string, string>).direct).toBeUndefined()
    // Internal primary key is not exposed in the creation response.
    expect(body.id).toBeUndefined()
  })

  it('creates a landing share with password and stores passwordHash in DB [spec: shares/create-password]', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'f2', name: 'secret.txt' })

    const res = await createShare(app, headers, { matterId: 'f2', kind: 'landing', password: 'hunter2' })
    expect(res.status).toBe(201)

    const body = (await res.json()) as Record<string, unknown>
    const token = body.token as string

    const rows = await db.select({ passwordHash: shares.passwordHash }).from(shares).where(eq(shares.token, token))
    expect(rows[0]?.passwordHash).not.toBeNull()
    expect(rows[0]?.passwordHash).not.toBe('')
  })

  it('creates a landing share with recipients and inserts share_recipients rows [spec: shares/create-recipients]', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'f3', name: 'report.txt' })

    const recipients = [{ recipientEmail: 'alice@example.com' }, { recipientEmail: 'bob@example.com' }]

    const res = await createShare(app, headers, { matterId: 'f3', kind: 'landing', recipients })
    expect(res.status).toBe(201)

    const body = (await res.json()) as Record<string, unknown>
    const shareId = await getShareIdByToken(db, body.token as string)

    const rows = await db.select().from(shareRecipients).where(eq(shareRecipients.shareId, shareId))
    expect(rows).toHaveLength(2)
  })

  it('creates a direct share for a file and returns direct url [spec: shares/create-direct]', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'f4', name: 'photo.jpg' })

    const res = await createShare(app, headers, { matterId: 'f4', kind: 'direct' })
    expect(res.status).toBe(201)

    const body = (await res.json()) as Record<string, unknown>
    expect(body.kind).toBe('direct')
    expect((body.urls as Record<string, string>).direct).toMatch(/^\/r\/ds_/)
    expect((body.urls as Record<string, string>).landing).toBeUndefined()
  })

  it('returns 400 with DIRECT_NO_FOLDER when creating direct share for a folder [spec: shares/direct-no-folder]', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFolder(db, orgId, { id: 'fo1', name: 'My Folder' })

    const res = await createShare(app, headers, { matterId: 'fo1', kind: 'direct' })
    expect(res.status).toBe(400)

    const body = (await res.json()) as { error: { details: Array<{ reason: string }> } }
    expect(body.error.details[0].reason).toBe('DIRECT_NO_FOLDER')
  })

  it('returns 400 with DIRECT_NO_PASSWORD when creating direct share with password [spec: shares/direct-no-password]', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'f5', name: 'file.txt' })

    const res = await createShare(app, headers, { matterId: 'f5', kind: 'direct', password: 'secret' })
    expect(res.status).toBe(400)

    const body = (await res.json()) as { error: { details: Array<{ reason: string }> } }
    expect(body.error.details[0].reason).toBe('DIRECT_NO_PASSWORD')
  })

  it('returns 404 when matterId does not belong to current org [spec: shares/create-cross-org]', async () => {
    const { app } = await createTestApp()
    const headers = await authedHeaders(app)

    const res = await createShare(app, headers, { matterId: 'nonexistent-matter', kind: 'landing' })
    expect(res.status).toBe(404)

    const body = (await res.json()) as { error: { details: Array<{ reason: string }> } }
    expect(body.error.details[0].reason).toBe('MATTER_NOT_FOUND')
  })

  it('sets expiresAt when provided in request [spec: shares/create-expiry]', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'f6', name: 'expire.txt' })

    const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    const res = await createShare(app, headers, {
      matterId: 'f6',
      kind: 'landing',
      expiresAt: futureDate,
    })
    expect(res.status).toBe(201)

    const body = (await res.json()) as Record<string, unknown>
    expect(body.expiresAt).not.toBeNull()
  })

  it('sets downloadLimit when provided in request [spec: shares/create-download-limit]', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'f7', name: 'limited.txt' })

    const res = await createShare(app, headers, {
      matterId: 'f7',
      kind: 'landing',
      downloadLimit: 5,
    })
    expect(res.status).toBe(201)

    const body = (await res.json()) as Record<string, unknown>
    expect(body.downloadLimit).toBe(5)
  })

  it('returns 400 with DIRECT_NO_RECIPIENTS when creating direct share with recipients [spec: shares/direct-no-recipients]', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    const orgId = await getOrgId(db)
    const matterId = nanoid()
    await insertFile(db, orgId, { id: matterId, name: 'file.txt' })

    const res = await createShare(app, headers, {
      matterId,
      kind: 'direct',
      recipients: [{ recipientEmail: 'someone@example.com' }],
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { details: Array<{ reason: string }> } }
    expect(body.error.details[0].reason).toBe('DIRECT_NO_RECIPIENTS')
  })

  it('returns 500 when createShare throws an unexpected error', async () => {
    const { app, db, deps } = await createTestApp()
    const headers = await authedHeaders(app)
    const orgId = await getOrgId(db)
    const matterId = nanoid()
    await insertFile(db, orgId, { id: matterId, name: 'file.txt' })

    vi.spyOn(deps.share, 'create').mockRejectedValueOnce(new Error('unexpected db error'))

    const res = await createShare(app, headers, { matterId, kind: 'landing' })
    expect(res.status).toBe(500)
  })

  it('returns 201 even when dispatchShareCreated rejects [spec: shares/create-notify-best-effort]', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    const orgId = await getOrgId(db)
    const matterId = nanoid()
    await insertFile(db, orgId, { id: matterId, name: 'file.txt' })

    const notifService = await import('../usecases/share.js')
    vi.spyOn(notifService, 'dispatchShareCreated').mockRejectedValueOnce(new Error('dispatch failed'))

    const res = await createShare(app, headers, {
      matterId,
      kind: 'landing',
      recipients: [{ recipientEmail: 'someone@example.com' }],
    })
    expect(res.status).toBe(201)
  })
})

// ─── GET /api/shares auth guard ───────────────────────────────────────────────

describe('GET /api/shares (auth guard)', () => {
  it('returns 401 without auth', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/shares')
    expect(res.status).toBe(401)
  })
})

// ─── GET /api/shares ──────────────────────────────────────────────────────────

describe('GET /api/shares', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns empty list for a new user with no shares [spec: shares/list-empty]', async () => {
    const { app } = await createTestApp()
    const headers = await authedHeaders(app)

    const res = await app.request('/api/shares', { headers })
    expect(res.status).toBe(200)

    const body = (await res.json()) as { items: unknown[]; total: number; page: number; pageSize: number }
    expect(body.items).toHaveLength(0)
    expect(body.total).toBe(0)
  })

  it('returns shares with pagination fields in response [spec: shares/list-pagination]', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'pg1', name: 'a.txt' })
    await insertFile(db, orgId, { id: 'pg2', name: 'b.txt' })

    await createShare(app, headers, { matterId: 'pg1', kind: 'landing' })
    await createShare(app, headers, { matterId: 'pg2', kind: 'landing' })

    const res = await app.request('/api/shares?page=1&pageSize=1', { headers })
    expect(res.status).toBe(200)

    const body = (await res.json()) as { items: unknown[]; total: number; page: number; pageSize: number }
    expect(body.page).toBe(1)
    expect(body.pageSize).toBe(1)
    expect(body.items).toHaveLength(1)
    expect(body.total).toBe(2)
  })

  it('does not return shares belonging to another user [spec: shares/list-isolation]', async () => {
    const { app, db } = await createTestApp()
    await insertStorage(db)

    // User A creates a share
    const headersA = await authedHeaders(app, `a-${nanoid()}@example.com`)
    const orgIdA = await getOrgId(db)
    await insertFile(db, orgIdA, { id: 'oa1', name: 'only-a.txt' })
    await createShare(app, headersA, { matterId: 'oa1', kind: 'landing' })

    // User B lists their shares
    const headersB = await authedHeaders(app, `b-${nanoid()}@example.com`)
    const res = await app.request('/api/shares', { headers: headersB })
    expect(res.status).toBe(200)

    const body = (await res.json()) as { items: unknown[]; total: number }
    expect(body.total).toBe(0)
    expect(body.items).toHaveLength(0)
  })

  it('each list item has matter and recipientCount fields', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'rm1', name: 'has-recipients.txt' })

    await createShare(app, headers, {
      matterId: 'rm1',
      kind: 'landing',
      recipients: [{ recipientEmail: 'x@example.com' }],
    })

    const res = await app.request('/api/shares', { headers })
    expect(res.status).toBe(200)

    const body = (await res.json()) as { items: Array<Record<string, unknown>> }
    const item = body.items[0]
    expect(item).toHaveProperty('matter')
    const matter = item.matter as Record<string, unknown>
    expect(typeof matter.name).toBe('string')
    expect(typeof matter.type).toBe('string')
    expect(typeof matter.dirtype).toBe('number')
    expect(typeof item.recipientCount).toBe('number')
    expect(item.recipientCount).toBe(1)
  })

  it('filters shares by status=active [spec: shares/list-filter-status]', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'st1', name: 'active.txt' })
    await insertFile(db, orgId, { id: 'st2', name: 'revoked.txt' })

    await createShare(app, headers, { matterId: 'st1', kind: 'landing' })
    const res2 = await createShare(app, headers, { matterId: 'st2', kind: 'landing' })
    const body2 = (await res2.json()) as Record<string, unknown>

    // Revoke the second share
    await app.request(`/api/shares/${body2.token}`, { method: 'DELETE', headers })

    const resActive = await app.request('/api/shares?status=active', { headers })
    const activeBody = (await resActive.json()) as { items: unknown[]; total: number }
    expect(activeBody.total).toBe(1)

    const resRevoked = await app.request('/api/shares?status=revoked', { headers })
    const revokedBody = (await resRevoked.json()) as { items: unknown[]; total: number }
    expect(revokedBody.total).toBe(1)
  })
})

// ─── GET /api/shares/:token (creator vs visitor views) ───────────────────────

describe('GET /api/shares/:token', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns full detail including recipients when viewer is the creator [spec: shares/detail-creator]', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'gd1', name: 'get-detail.txt' })

    const createRes = await createShare(app, headers, {
      matterId: 'gd1',
      kind: 'landing',
      recipients: [{ recipientEmail: 'r@example.com' }],
    })
    const token = ((await createRes.json()) as Record<string, unknown>).token as string

    const res = await app.request(`/api/shares/${token}`, { headers })
    expect(res.status).toBe(200)

    const body = (await res.json()) as Record<string, unknown>
    expect(body.token).toBe(token)
    expect(Array.isArray(body.recipients)).toBe(true)
    expect((body.recipients as unknown[]).length).toBe(1)
    const matter = body.matter as Record<string, unknown>
    expect(matter.name).toBe('get-detail.txt')
    expect(typeof body.id).toBe('string')
    expect(typeof body.orgId).toBe('string')
    expect(typeof body.rootRef).toBe('string')
  })

  it('returns landing view without recipients or internal ids for non-creator [spec: shares/detail-non-creator]', async () => {
    const { app, db } = await createTestApp()
    await insertStorage(db)

    const headersA = await authedHeaders(app, `ownerA-${nanoid()}@example.com`)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'ga1', name: 'owned-by-a.txt' })

    const createRes = await createShare(app, headersA, { matterId: 'ga1', kind: 'landing' })
    const token = ((await createRes.json()) as Record<string, unknown>).token as string

    const headersB = await authedHeaders(app, `otherB-${nanoid()}@example.com`)
    const res = await app.request(`/api/shares/${token}`, { headers: headersB })
    expect(res.status).toBe(200)

    const body = (await res.json()) as Record<string, unknown>
    expect(body.token).toBe(token)
    expect(body.recipients).toBeUndefined()
    expect(body.id).toBeUndefined()
    expect(body.orgId).toBeUndefined()
    expect(body.matterId).toBeUndefined()
    expect(body.creatorId).toBeUndefined()
  })

  it('returns 404 for a non-existent token [spec: shares/detail-not-found]', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/shares/does-not-exist')
    expect(res.status).toBe(404)
  })

  it('returns 404 for direct share when viewer is not the creator', async () => {
    const { app, db } = await createTestApp()
    await insertStorage(db)

    const headersA = await authedHeaders(app, `downer-${nanoid()}@example.com`)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'dgd1', name: 'direct.bin' })

    const createRes = await createShare(app, headersA, { matterId: 'dgd1', kind: 'direct' })
    const token = ((await createRes.json()) as Record<string, unknown>).token as string

    const res = await app.request(`/api/shares/${token}`)
    expect(res.status).toBe(404)
  })

  it('returns direct share detail with creator-only fields when viewer is the creator', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'dgd2', name: 'direct2.bin' })

    const createRes = await createShare(app, headers, { matterId: 'dgd2', kind: 'direct' })
    const token = ((await createRes.json()) as Record<string, unknown>).token as string

    const res = await app.request(`/api/shares/${token}`, { headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.kind).toBe('direct')
    expect(typeof body.id).toBe('string')
    expect(typeof body.orgId).toBe('string')
    expect(typeof body.creatorId).toBe('string')
    expect(typeof body.createdAt).toBe('string')
    expect(Array.isArray(body.recipients)).toBe(true)
  })

  it('does not increment views when viewer is the creator [spec: shares/no-self-view-count]', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'nv1', name: 'no-view-count.txt' })

    const createRes = await createShare(app, headers, { matterId: 'nv1', kind: 'landing' })
    const token = ((await createRes.json()) as Record<string, unknown>).token as string

    await app.request(`/api/shares/${token}`, { headers })
    await app.request(`/api/shares/${token}`, { headers })

    const rows = await db.select({ views: shares.views }).from(shares).where(eq(shares.token, token))
    expect(rows[0]?.views).toBe(0)
  })
})

// ─── POST /api/shares/:token/objects (save-to-drive) ─────────────────────────

describe('POST /api/shares/:token/objects', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(S3Service.prototype, 'copyObject').mockResolvedValue(undefined)
    vi.spyOn(S3Service.prototype, 'streamCopy').mockResolvedValue(undefined)
  })

  it('returns 404 when share token does not exist', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    const orgId = await getOrgId(db)

    const res = await app.request('/api/shares/nonexistent-token/objects', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetOrgId: orgId, targetParent: '' }),
    })
    expect(res.status).toBe(404)
  })

  it('returns 400 with DIRECT_SAVE_FORBIDDEN for direct shares [spec: shares/save-direct-forbidden]', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'sv-direct', name: 'direct-file.txt' })

    const createRes = await createShare(app, headers, { matterId: 'sv-direct', kind: 'direct' })
    const token = ((await createRes.json()) as Record<string, unknown>).token as string

    const res = await app.request(`/api/shares/${token}/objects`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetOrgId: orgId, targetParent: '' }),
    })
    expect(res.status).toBe(400)

    const body = (await res.json()) as { error: { details: Array<{ reason: string }> } }
    expect(body.error.details[0].reason).toBe('DIRECT_SAVE_FORBIDDEN')
  })

  it('returns 410 when the shared matter has been trashed [spec: shares/save-trashed-gone]', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'sv-trashed', name: 'will-trash.txt' })

    const createRes = await createShare(app, headers, { matterId: 'sv-trashed', kind: 'landing' })
    const token = ((await createRes.json()) as Record<string, unknown>).token as string

    await db.run(sql`UPDATE matters SET status = 'trashed' WHERE id = 'sv-trashed'`)

    const res = await app.request(`/api/shares/${token}/objects`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetOrgId: orgId, targetParent: '' }),
    })
    expect(res.status).toBe(410)
  })

  it('saves a landing share file to personal drive and returns 201 [spec: shares/save-to-drive]', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'sv-ok', name: 'shareable.txt' })

    const createRes = await createShare(app, headers, { matterId: 'sv-ok', kind: 'landing' })
    const token = ((await createRes.json()) as Record<string, unknown>).token as string

    const res = await app.request(`/api/shares/${token}/objects`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetOrgId: orgId, targetParent: '' }),
    })
    expect(res.status).toBe(201)
  })

  it('returns 401 without auth', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/shares/sometoken/objects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetOrgId: 'org1', targetParent: '' }),
    })
    expect(res.status).toBe(401)
  })

  it('returns 422 QUOTA_EXCEEDED when target org quota is exhausted [spec: shares/save-quota-exceeded]', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'sv-quota', name: 'big-file.txt' })

    await db.run(sql`UPDATE org_quotas SET used = 1 WHERE org_id = ${orgId}`)
    await setStoragePlanEntitlement(db, orgId, 1)

    const createRes = await createShare(app, headers, { matterId: 'sv-quota', kind: 'landing' })
    const token = ((await createRes.json()) as Record<string, unknown>).token as string

    const res = await app.request(`/api/shares/${token}/objects`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetOrgId: orgId, targetParent: '' }),
    })
    expect(res.status).toBe(422)

    const body = (await res.json()) as { error: { details: Array<{ reason: string }> } }
    expect(body.error.details[0].reason).toBe('QUOTA_EXCEEDED')
  })

  it('returns 403 when targetOrgId is not a personal org and user has no member role [spec: shares/save-target-permission]', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'sv-forbidden', name: 'forbidden.txt' })

    const createRes = await createShare(app, headers, { matterId: 'sv-forbidden', kind: 'landing' })
    const token = ((await createRes.json()) as Record<string, unknown>).token as string

    const fakeTeamOrgId = `team-org-${nanoid()}`
    await db.run(sql`
      INSERT INTO organization (id, name, slug, metadata, created_at)
      VALUES (${fakeTeamOrgId}, 'Team Org', ${fakeTeamOrgId}, '{"type":"team"}', ${Date.now()})
    `)

    const res = await app.request(`/api/shares/${token}/objects`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetOrgId: fakeTeamOrgId, targetParent: '' }),
    })
    expect(res.status).toBe(403)
  })

  it("returns 403 when targetOrgId is another user's personal org", async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await authedHeaders(app, 'victim@example.com')
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'sv-victim', name: 'victim.txt' })

    const victims = await db.all<{ id: string }>(sql`SELECT id FROM user WHERE email = 'victim@example.com'`)
    const victimOrgs = await db.all<{ id: string }>(
      sql`SELECT id FROM organization WHERE slug = ${`personal-${victims[0].id}`}`,
    )

    const createRes = await createShare(app, headers, { matterId: 'sv-victim', kind: 'landing' })
    const token = ((await createRes.json()) as Record<string, unknown>).token as string

    const res = await app.request(`/api/shares/${token}/objects`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetOrgId: victimOrgs[0].id, targetParent: '' }),
    })
    expect(res.status).toBe(403)
  })

  it('allows password-protected share save when the user is a listed recipient [spec: shares/save-recipient-bypass]', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'sv-recip', name: 'recipient-file.txt' })

    const emailB = `recip-user-b-${nanoid()}@example.com`
    const signupRes = await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'User B', email: emailB, password: 'password123456' }),
    })
    const signupBody = (await signupRes.json()) as { user?: { id: string } }
    const userBId = signupBody.user?.id ?? ''
    const cookiesB = signupRes.headers.getSetCookie().join('; ')
    const headersB = { Cookie: cookiesB }

    const orgIdB = await getOrgId(db)

    const createRes = await createShare(app, headers, {
      matterId: 'sv-recip',
      kind: 'landing',
      password: 'secretPass123',
      recipients: [{ recipientUserId: userBId }],
    })
    const token = ((await createRes.json()) as Record<string, unknown>).token as string

    const res = await app.request(`/api/shares/${token}/objects`, {
      method: 'POST',
      headers: { ...headersB, 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetOrgId: orgIdB, targetParent: '' }),
    })
    expect(res.status).not.toBe(401)
  })

  it('returns 401 for password-protected share when user is not a recipient and no cookie', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'sv-pw', name: 'protected.txt' })

    const createRes = await createShare(app, headers, {
      matterId: 'sv-pw',
      kind: 'landing',
      password: 'topSecret123',
    })
    const token = ((await createRes.json()) as Record<string, unknown>).token as string

    const headersB = await authedHeaders(app, `pw-user-b-${nanoid()}@example.com`)
    const res = await app.request(`/api/shares/${token}/objects`, {
      method: 'POST',
      headers: { ...headersB, 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetOrgId: orgId, targetParent: '' }),
    })
    expect(res.status).toBe(401)
  })

  it('bypasses 401 for password-protected share when non-recipient has valid sharetk cookie [spec: shares/save-cookie-bypass]', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'sv-cookie-auth', name: 'cookie-auth.txt' })

    const createRes = await createShare(app, headers, {
      matterId: 'sv-cookie-auth',
      kind: 'landing',
      password: 'cookiePass123',
    })
    const token = ((await createRes.json()) as Record<string, unknown>).token as string

    const headersB = await authedHeaders(app, `cookie-norecip-${nanoid()}@example.com`)
    const cookieHeader = `${headersB.Cookie}; sharetk_${token}=ok`
    const res = await app.request(`/api/shares/${token}/objects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
      body: JSON.stringify({ targetOrgId: orgId, targetParent: '' }),
    })
    expect(res.status).not.toBe(401)
  })

  it('still rejects password-protected save when cookie has wrong value', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'sv-bad-cookie', name: 'bad-cookie.txt' })

    const createRes = await createShare(app, headers, {
      matterId: 'sv-bad-cookie',
      kind: 'landing',
      password: 'cookiePass123',
    })
    const token = ((await createRes.json()) as Record<string, unknown>).token as string

    const headersB = await authedHeaders(app, `cookie-bad-${nanoid()}@example.com`)
    const cookieHeader = `${headersB.Cookie}; sharetk_${token}=anything-but-ok`
    const res = await app.request(`/api/shares/${token}/objects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
      body: JSON.stringify({ targetOrgId: orgId, targetParent: '' }),
    })
    expect(res.status).toBe(401)
  })

  it('returns 403 when user has a viewer role in the target org [spec: shares/save-viewer-forbidden]', async () => {
    const { app, db } = await createTestApp()
    const ownerHeaders = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'sv-viewer-role', name: 'viewer-role.txt' })

    const createRes = await createShare(app, ownerHeaders, { matterId: 'sv-viewer-role', kind: 'landing' })
    const token = ((await createRes.json()) as Record<string, unknown>).token as string

    const viewerEmail = `viewer-user-${nanoid()}@example.com`
    const signupRes = await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Viewer User', email: viewerEmail, password: 'password123456' }),
    })
    const signupBody = (await signupRes.json()) as { user?: { id: string } }
    const viewerId = signupBody.user?.id ?? ''
    const viewerHeaders = { Cookie: signupRes.headers.getSetCookie().join('; ') }

    const teamOrgId = `viewer-team-${nanoid()}`
    await db.run(sql`
      INSERT INTO organization (id, name, slug, metadata, created_at)
      VALUES (${teamOrgId}, 'Viewer Team', ${teamOrgId}, '{"type":"team"}', ${Date.now()})
    `)
    await db.run(sql`
      INSERT INTO member (id, organization_id, user_id, role, created_at)
      VALUES (${nanoid()}, ${teamOrgId}, ${viewerId}, 'viewer', ${Date.now()})
    `)

    const res = await app.request(`/api/shares/${token}/objects`, {
      method: 'POST',
      headers: { ...viewerHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetOrgId: teamOrgId, targetParent: '' }),
    })
    expect(res.status).toBe(403)
  })
})

// ─── DELETE /api/shares/:token ────────────────────────────────────────────────

describe('DELETE /api/shares/:token (auth guard)', () => {
  it('returns 401 without auth', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/shares/some-token', { method: 'DELETE' })
    expect(res.status).toBe(401)
  })
})

describe('DELETE /api/shares/:token', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('creator can delete their share and share status becomes revoked in DB [spec: shares/delete]', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'del1', name: 'delete-me.txt' })

    const createRes = await createShare(app, headers, { matterId: 'del1', kind: 'landing' })
    const token = ((await createRes.json()) as Record<string, unknown>).token as string

    const res = await app.request(`/api/shares/${token}`, { method: 'DELETE', headers })
    expect(res.status).toBe(204)

    const rows = await db.select({ status: shares.status }).from(shares).where(eq(shares.token, token))
    expect(rows[0]?.status).toBe('revoked')
  })

  it('returns 403 when non-creator tries to delete a share [spec: shares/delete-non-creator]', async () => {
    const { app, db } = await createTestApp()
    await insertStorage(db)

    const headersA = await authedHeaders(app, `del-owner-${nanoid()}@example.com`)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'del2', name: 'other-share.txt' })

    const createRes = await createShare(app, headersA, { matterId: 'del2', kind: 'landing' })
    const token = ((await createRes.json()) as Record<string, unknown>).token as string

    const headersB = await authedHeaders(app, `del-other-${nanoid()}@example.com`)
    const res = await app.request(`/api/shares/${token}`, { method: 'DELETE', headers: headersB })
    expect(res.status).toBe(403)
  })

  it('returns 404 for non-existent share token', async () => {
    const { app } = await createTestApp()
    const headers = await authedHeaders(app)

    const res = await app.request('/api/shares/does-not-exist', { method: 'DELETE', headers })
    expect(res.status).toBe(404)
  })
})

describe('GET /api/shares?box=received', () => {
  async function getUserId(db: TestDb, email: string): Promise<string> {
    const rows = await db.all<{ id: string }>(sql`SELECT id FROM user WHERE email = ${email}`)
    return rows[0].id
  }

  it('lists shares addressed to the user by id and by email, hiding unrelated shares [spec: shares/received-list]', async () => {
    const { app, db } = await createTestApp()
    const creatorHeaders = await authedHeaders(app)
    const recipientHeaders = await authedHeaders(app, 'recipient@example.com')
    const bystanderHeaders = await authedHeaders(app, 'bystander@example.com')
    await insertStorage(db)
    const orgId = await getOrgId(db)
    const recipientId = await getUserId(db, 'recipient@example.com')

    await insertFile(db, orgId, { id: 'rcv-1', name: 'for-user.txt' })
    await insertFile(db, orgId, { id: 'rcv-2', name: 'for-email.txt' })
    await insertFile(db, orgId, { id: 'rcv-3', name: 'for-nobody.txt' })

    const byUser = await createShare(app, creatorHeaders, {
      matterId: 'rcv-1',
      kind: 'landing',
      recipients: [{ recipientUserId: recipientId }],
    })
    expect(byUser.status).toBe(201)
    const byEmail = await createShare(app, creatorHeaders, {
      matterId: 'rcv-2',
      kind: 'landing',
      recipients: [{ recipientEmail: 'recipient@example.com' }],
    })
    expect(byEmail.status).toBe(201)
    const unrelated = await createShare(app, creatorHeaders, { matterId: 'rcv-3', kind: 'landing' })
    expect(unrelated.status).toBe(201)

    const res = await app.request('/api/shares?box=received', { headers: recipientHeaders })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      items: Array<{ matter: { name: string }; creatorName?: string }>
      total: number
    }
    expect(body.total).toBe(2)
    expect(body.items.map((item) => item.matter.name).sort()).toEqual(['for-email.txt', 'for-user.txt'])
    expect(body.items[0].creatorName).toBeTruthy()

    const bystander = await app.request('/api/shares?box=received', { headers: bystanderHeaders })
    const bystanderBody = (await bystander.json()) as { total: number }
    expect(bystanderBody.total).toBe(0)
  })

  it('excludes revoked shares from the received list [spec: shares/received-excludes-revoked]', async () => {
    const { app, db } = await createTestApp()
    const creatorHeaders = await authedHeaders(app)
    const recipientHeaders = await authedHeaders(app, 'revoked-recipient@example.com')
    await insertStorage(db)
    const orgId = await getOrgId(db)
    const recipientId = await getUserId(db, 'revoked-recipient@example.com')
    await insertFile(db, orgId, { id: 'rcv-revoked', name: 'gone.txt' })

    const created = await createShare(app, creatorHeaders, {
      matterId: 'rcv-revoked',
      kind: 'landing',
      recipients: [{ recipientUserId: recipientId }],
    })
    const token = ((await created.json()) as Record<string, unknown>).token as string
    const revoke = await app.request(`/api/shares/${token}`, { method: 'DELETE', headers: creatorHeaders })
    expect(revoke.status).toBe(204)

    const res = await app.request('/api/shares?box=received', { headers: recipientHeaders })
    const body = (await res.json()) as { total: number }
    expect(body.total).toBe(0)
  })
})

// ─── Public (visitor-facing) share routes ────────────────────────────────────
// Wrapped so the visitor-focused fixtures (own STORAGE_ID, presignDownload mock,
// single-arg getUserId, larger insertFile/insertFolder) stay isolated from the
// creator-facing helpers above.

describe('Public share routes', () => {
  const MOCK_PRESIGN_URL = 'https://presigned-download.example.com/file'
  const STORAGE_ID = 'st-public-test'

  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(S3Service.prototype, 'presignDownload').mockResolvedValue(MOCK_PRESIGN_URL)
  })

  // ─── DB helpers ───────────────────────────────────────────────────────────────

  async function insertStorage(db: Awaited<ReturnType<typeof createTestApp>>['db']) {
    const now = Date.now()
    await db.run(sql`
      INSERT INTO storages (id, title, mode, bucket, endpoint, region, access_key, secret_key, file_path, custom_host, capacity, used, status, created_at, updated_at)
      VALUES (${STORAGE_ID}, 'Test S3', 'private', 'test-bucket', 'https://s3.amazonaws.com', 'us-east-1', 'AK', 'SK', '', '', 0, 0, 'active', ${now}, ${now})
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
    opts: { id: string; name: string; parent?: string; status?: string },
  ) {
    const now = Date.now()
    await db.run(sql`
      INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, created_at, updated_at)
      VALUES (${opts.id}, ${orgId}, ${`${opts.id}-alias`}, ${opts.name}, 'text/plain', 1024, 0, ${opts.parent ?? ''}, 'some/key.txt', ${STORAGE_ID}, ${opts.status ?? 'active'}, ${now}, ${now})
    `)
  }

  async function insertFolder(
    db: Awaited<ReturnType<typeof createTestApp>>['db'],
    orgId: string,
    opts: { id: string; name: string; parent?: string; status?: string },
  ) {
    const now = Date.now()
    await db.run(sql`
      INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, created_at, updated_at)
      VALUES (${opts.id}, ${orgId}, ${`${opts.id}-alias`}, ${opts.name}, 'folder', 0, 1, ${opts.parent ?? ''}, '', ${STORAGE_ID}, ${opts.status ?? 'active'}, ${now}, ${now})
    `)
  }

  async function fetchRootRef(app: Awaited<ReturnType<typeof createTestApp>>['app'], token: string): Promise<string> {
    const res = await app.request(`/api/shares/${token}`)
    const body = (await res.json()) as { rootRef: string }
    return body.rootRef
  }

  // ─── GET /api/shares/:token ───────────────────────────────────────────────────

  describe('GET /api/shares/:token', () => {
    it('returns 404 for unknown token', async () => {
      const { app } = await createTestApp()
      const res = await app.request('/api/shares/unknown-token')
      expect(res.status).toBe(404)
    })

    it('returns share metadata for visitor and strips internal ids', async () => {
      const { app, db } = await createTestApp()
      const headers = await authedHeaders(app)
      await insertStorage(db)
      const orgId = await getOrgId(db)
      const creatorId = await getUserId(db)
      await insertFile(db, orgId, { id: 'f1', name: 'photo.jpg' })
      const share = await createShareRepo(db).create({ matterId: 'f1', orgId, creatorId, kind: 'landing' })

      // Call without auth headers to simulate a public visitor
      void headers
      const res = await app.request(`/api/shares/${share.token}`)
      expect(res.status).toBe(200)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.kind).toBe('landing')
      const matter = body.matter as Record<string, unknown>
      expect(matter.name).toBe('photo.jpg')
      expect(matter.type).toBe('text/plain')
      expect(matter.isFolder).toBe(false)
      expect(body.requiresPassword).toBe(false)
      expect(body.expired).toBe(false)
      expect(body.exhausted).toBe(false)
      expect(body.accessibleByUser).toBe(false)
      expect(typeof body.rootRef).toBe('string')
      // Non-creator must not see internal ids
      expect(body.matterId).toBeUndefined()
      expect(body.orgId).toBeUndefined()
      expect(body.recipients).toBeUndefined()
      expect(body.id).toBeUndefined()
    })

    it('increments views for a public visitor', async () => {
      const { app, db } = await createTestApp()
      await authedHeaders(app)
      await insertStorage(db)
      const orgId = await getOrgId(db)
      const creatorId = await getUserId(db)
      await insertFile(db, orgId, { id: 'f1v', name: 'visit-count.txt' })
      const share = await createShareRepo(db).create({ matterId: 'f1v', orgId, creatorId, kind: 'landing' })

      const res = await app.request(`/api/shares/${share.token}`)
      expect(res.status).toBe(200)

      const rows = await db.all<{ views: number }>(sql`SELECT views FROM shares WHERE id = ${share.id}`)
      expect(rows[0]?.views).toBe(1)
    })

    it('deduplicates repeated visitor view requests within a short window', async () => {
      const { app, db } = await createTestApp()
      await authedHeaders(app)
      await insertStorage(db)
      const orgId = await getOrgId(db)
      const creatorId = await getUserId(db)
      await insertFile(db, orgId, { id: 'f1vd', name: 'visit-dedupe.txt' })
      const share = await createShareRepo(db).create({ matterId: 'f1vd', orgId, creatorId, kind: 'landing' })

      const first = await app.request(`/api/shares/${share.token}`)
      expect(first.status).toBe(200)
      const viewCookie = first.headers.get('set-cookie')
      expect(viewCookie).toContain(`sharevw_${share.token}=seen`)

      const second = await app.request(`/api/shares/${share.token}`, {
        headers: viewCookie ? { Cookie: viewCookie } : undefined,
      })
      expect(second.status).toBe(200)

      const rows = await db.all<{ views: number }>(sql`SELECT views FROM shares WHERE id = ${share.id}`)
      expect(rows[0]?.views).toBe(1)
    })

    it('returns 404 for direct share kind (visitor)', async () => {
      const { app, db } = await createTestApp()
      await authedHeaders(app)
      await insertStorage(db)
      const orgId = await getOrgId(db)
      const creatorId = await getUserId(db)
      await insertFile(db, orgId, { id: 'f2', name: 'direct.txt' })
      const share = await createShareRepo(db).create({ matterId: 'f2', orgId, creatorId, kind: 'direct' })

      const res = await app.request(`/api/shares/${share.token}`)
      expect(res.status).toBe(404)
    })

    it('returns 410 for trashed matter', async () => {
      const { app, db } = await createTestApp()
      await authedHeaders(app)
      await insertStorage(db)
      const orgId = await getOrgId(db)
      const creatorId = await getUserId(db)
      await insertFile(db, orgId, { id: 'f3', name: 'gone.txt', status: 'trashed' })
      const now = Date.now()
      await db.run(sql`
        INSERT INTO shares (id, token, kind, matter_id, org_id, creator_id, views, downloads, status, created_at)
        VALUES ('sh-trash', 'token-trash', 'landing', 'f3', ${orgId}, ${creatorId}, 0, 0, 'active', ${now})
      `)

      const res = await app.request('/api/shares/token-trash')
      expect(res.status).toBe(410)
    })

    it('returns 404 for revoked share', async () => {
      const { app, db } = await createTestApp()
      await authedHeaders(app)
      await insertStorage(db)
      const orgId = await getOrgId(db)
      const creatorId = await getUserId(db)
      await insertFile(db, orgId, { id: 'f4', name: 'revoked.txt' })
      const share = await createShareRepo(db).create({ matterId: 'f4', orgId, creatorId, kind: 'landing' })
      await db.run(sql`UPDATE shares SET status = 'revoked' WHERE id = ${share.id}`)

      const res = await app.request(`/api/shares/${share.token}`)
      expect(res.status).toBe(404)
    })

    it('returns requiresPassword=true when password set and no cookie', async () => {
      const { app, db } = await createTestApp()
      await authedHeaders(app)
      await insertStorage(db)
      const orgId = await getOrgId(db)
      const creatorId = await getUserId(db)
      await insertFile(db, orgId, { id: 'f5', name: 'secret.txt' })
      const share = await createShareRepo(db).create({
        matterId: 'f5',
        orgId,
        creatorId,
        kind: 'landing',
        password: 'hunter2',
      })

      const res = await app.request(`/api/shares/${share.token}`)
      expect(res.status).toBe(200)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.requiresPassword).toBe(true)
    })

    it('returns exhausted=true when download limit reached', async () => {
      const { app, db } = await createTestApp()
      await authedHeaders(app)
      await insertStorage(db)
      const orgId = await getOrgId(db)
      const creatorId = await getUserId(db)
      await insertFile(db, orgId, { id: 'f6', name: 'limited.txt' })
      const share = await createShareRepo(db).create({
        matterId: 'f6',
        orgId,
        creatorId,
        kind: 'landing',
        downloadLimit: 3,
      })
      await db.run(sql`UPDATE shares SET downloads = 3 WHERE id = ${share.id}`)

      const res = await app.request(`/api/shares/${share.token}`)
      expect(res.status).toBe(200)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.exhausted).toBe(true)
    })
  })

  // ─── POST /api/shares/:token/sessions ────────────────────────────────────────

  describe('POST /api/shares/:token/sessions', () => {
    it('returns 200 and sets cookie on correct password', async () => {
      const { app, db } = await createTestApp()
      await authedHeaders(app)
      await insertStorage(db)
      const orgId = await getOrgId(db)
      const creatorId = await getUserId(db)
      await insertFile(db, orgId, { id: 'vf1', name: 'vault.txt' })
      const share = await createShareRepo(db).create({
        matterId: 'vf1',
        orgId,
        creatorId,
        kind: 'landing',
        password: 'correcthorse',
      })

      const res = await app.request(`/api/shares/${share.token}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'correcthorse' }),
      })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ ok: true })
      const cookieHeader = res.headers.get('set-cookie')
      expect(cookieHeader).toContain(`sharetk_${share.token}=ok`)
      expect(cookieHeader).toContain('HttpOnly')
    })

    it('returns 403 on wrong password', async () => {
      const { app, db } = await createTestApp()
      await authedHeaders(app)
      await insertStorage(db)
      const orgId = await getOrgId(db)
      const creatorId = await getUserId(db)
      await insertFile(db, orgId, { id: 'vf2', name: 'vault2.txt' })
      const share = await createShareRepo(db).create({
        matterId: 'vf2',
        orgId,
        creatorId,
        kind: 'landing',
        password: 'correcthorse',
      })

      const res = await app.request(`/api/shares/${share.token}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'wrongpassword' }),
      })
      expect(res.status).toBe(403)
      const body = (await res.json()) as { error: { message: string; status: string } }
      expect(body.error.message).toBe('Invalid password')
      expect(body.error.status).toBe('PERMISSION_DENIED')
    })

    it('returns 404 when verifying a password for an unknown token', async () => {
      const { app } = await createTestApp()
      const res = await app.request('/api/shares/no-such-token/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'whatever' }),
      })
      expect(res.status).toBe(404)
      const body = (await res.json()) as { error: { message: string; status: string } }
      expect(body.error.message).toBe('Share not found or revoked')
      expect(body.error.status).toBe('NOT_FOUND')
    })

    it('returns 404 when verifying a password for a direct (non-landing) share', async () => {
      const { app, db } = await createTestApp()
      await authedHeaders(app)
      await insertStorage(db)
      const orgId = await getOrgId(db)
      const creatorId = await getUserId(db)
      await insertFile(db, orgId, { id: 'vf3', name: 'direct-verify.bin' })
      const share = await createShareRepo(db).create({ matterId: 'vf3', orgId, creatorId, kind: 'direct' })

      const res = await app.request(`/api/shares/${share.token}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'whatever' }),
      })
      expect(res.status).toBe(404)
      const body = (await res.json()) as { error: { message: string } }
      expect(body.error.message).toBe('Share not found or revoked')
    })
  })

  // ─── GET /api/shares/:token/objects/:ref — root file download ────────────────

  describe('GET /api/shares/:token/objects/:ref — root file', () => {
    it('returns 302 redirect with no-store cache header for public share', async () => {
      const { app, db } = await createTestApp()
      await authedHeaders(app)
      await insertStorage(db)
      const orgId = await getOrgId(db)
      const creatorId = await getUserId(db)
      await insertFile(db, orgId, { id: 'dl1', name: 'file.txt' })
      const trafficPeriod = currentTrafficPeriod()
      await db.run(sql`
        UPDATE org_quotas
        SET traffic_quota = 2048, traffic_used = 256, traffic_period = ${trafficPeriod}
        WHERE org_id = ${orgId}
      `)
      const share = await createShareRepo(db).create({ matterId: 'dl1', orgId, creatorId, kind: 'landing' })

      const rootRef = await fetchRootRef(app, share.token)
      const res = await app.request(`/api/shares/${share.token}/objects/${rootRef}`, { redirect: 'manual' })
      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toBe(MOCK_PRESIGN_URL)
      expect(res.headers.get('cache-control')).toBe('no-store')

      const rows = await db.all<{ trafficUsed: number }>(
        sql`SELECT traffic_used AS trafficUsed FROM org_quotas WHERE org_id = ${orgId}`,
      )
      expect(rows[0].trafficUsed).toBe(1280)
    })

    it('returns JSON downloadUrl for public share when requested by preview', async () => {
      const { app, db } = await createTestApp()
      await authedHeaders(app)
      await insertStorage(db)
      const orgId = await getOrgId(db)
      const creatorId = await getUserId(db)
      await insertFile(db, orgId, { id: 'dl-url1', name: 'report.docx' })
      const share = await createShareRepo(db).create({ matterId: 'dl-url1', orgId, creatorId, kind: 'landing' })

      const rootRef = await fetchRootRef(app, share.token)
      const res = await app.request(`/api/shares/${share.token}/objects/${rootRef}?downloadUrl=1`, {
        redirect: 'manual',
      })

      expect(res.status).toBe(200)
      expect(res.headers.get('cache-control')).toBe('no-store')
      await expect(res.json()).resolves.toEqual({ downloadUrl: MOCK_PRESIGN_URL })
    })

    it('consumes traffic quota when public share download URL is issued', async () => {
      const { app, db } = await createTestApp()
      await authedHeaders(app)
      await insertStorage(db)
      const orgId = await getOrgId(db)
      const creatorId = await getUserId(db)
      await insertFile(db, orgId, { id: 'dl-traffic-ok', name: 'traffic.txt' })
      const trafficPeriod = currentTrafficPeriod()
      await db.run(sql`
        UPDATE org_quotas
        SET traffic_quota = 2048, traffic_used = 256, traffic_period = ${trafficPeriod}
        WHERE org_id = ${orgId}
      `)
      const share = await createShareRepo(db).create({ matterId: 'dl-traffic-ok', orgId, creatorId, kind: 'landing' })

      const rootRef = await fetchRootRef(app, share.token)
      const res = await app.request(`/api/shares/${share.token}/objects/${rootRef}?downloadUrl=1`, {
        redirect: 'manual',
      })
      expect(res.status).toBe(200)

      const rows = await db.all<{ trafficUsed: number }>(
        sql`SELECT traffic_used AS trafficUsed FROM org_quotas WHERE org_id = ${orgId}`,
      )
      expect(rows[0].trafficUsed).toBe(1280)
    })

    it('refunds traffic and download count when public share signing fails', async () => {
      const { app, db } = await createTestApp()
      await authedHeaders(app)
      await insertStorage(db)
      const orgId = await getOrgId(db)
      const creatorId = await getUserId(db)
      await insertFile(db, orgId, { id: 'dl-sign-fail', name: 'traffic.txt' })
      const trafficPeriod = currentTrafficPeriod()
      await db.run(sql`
        UPDATE org_quotas
        SET traffic_quota = 2048, traffic_used = 256, traffic_period = ${trafficPeriod}
        WHERE org_id = ${orgId}
      `)
      vi.mocked(S3Service.prototype.presignDownload).mockRejectedValueOnce(new Error('sign failed'))
      const share = await createShareRepo(db).create({ matterId: 'dl-sign-fail', orgId, creatorId, kind: 'landing' })

      const rootRef = await fetchRootRef(app, share.token)
      const res = await app.request(`/api/shares/${share.token}/objects/${rootRef}?downloadUrl=1`, {
        redirect: 'manual',
      })
      expect(res.status).toBe(500)

      const trafficRows = await db.all<{ trafficUsed: number }>(
        sql`SELECT traffic_used AS trafficUsed FROM org_quotas WHERE org_id = ${orgId}`,
      )
      expect(trafficRows[0].trafficUsed).toBe(256)

      const shareRows = await db.all<{ downloads: number }>(sql`SELECT downloads FROM shares WHERE id = ${share.id}`)
      expect(shareRows[0].downloads).toBe(0)
    })

    it('returns 422 when public share traffic quota is exhausted', async () => {
      const { app, db } = await createTestApp()
      await authedHeaders(app)
      await insertStorage(db)
      const orgId = await getOrgId(db)
      const creatorId = await getUserId(db)
      await insertFile(db, orgId, { id: 'dl-traffic', name: 'traffic.txt' })
      const trafficPeriod = currentTrafficPeriod()
      await db.run(sql`
        UPDATE org_quotas
        SET traffic_quota = 0, traffic_used = 0, traffic_period = ${trafficPeriod}
        WHERE org_id = ${orgId}
      `)
      await setTrafficPlanEntitlement(db, orgId, 512)
      const share = await createShareRepo(db).create({
        matterId: 'dl-traffic',
        orgId,
        creatorId,
        kind: 'landing',
        downloadLimit: 1,
      })

      const rootRef = await fetchRootRef(app, share.token)
      const res = await app.request(`/api/shares/${share.token}/objects/${rootRef}?downloadUrl=1`, {
        redirect: 'manual',
      })

      expect(res.status).toBe(422)
      const quotaBody = (await res.json()) as { error: { message: string; details: Array<{ reason: string }> } }
      expect(quotaBody.error.message).toBe('Traffic quota exceeded')
      expect(quotaBody.error.details[0].reason).toBe('QUOTA_EXCEEDED')
      expect(S3Service.prototype.presignDownload).not.toHaveBeenCalled()

      const shareRows = await db.all<{ downloads: number }>(sql`SELECT downloads FROM shares WHERE id = ${share.id}`)
      expect(shareRows[0].downloads).toBe(0)
    })

    it('returns 401 when password required and no cookie', async () => {
      const { app, db } = await createTestApp()
      await authedHeaders(app)
      await insertStorage(db)
      const orgId = await getOrgId(db)
      const creatorId = await getUserId(db)
      await insertFile(db, orgId, { id: 'dl2', name: 'secret.txt' })
      const share = await createShareRepo(db).create({
        matterId: 'dl2',
        orgId,
        creatorId,
        kind: 'landing',
        password: 'secret123',
      })

      const rootRef = await fetchRootRef(app, share.token)
      const res = await app.request(`/api/shares/${share.token}/objects/${rootRef}`, { redirect: 'manual' })
      expect(res.status).toBe(401)
    })

    it('returns 302 when password set and valid cookie provided', async () => {
      const { app, db } = await createTestApp()
      await authedHeaders(app)
      await insertStorage(db)
      const orgId = await getOrgId(db)
      const creatorId = await getUserId(db)
      await insertFile(db, orgId, { id: 'dl3', name: 'guarded.txt' })
      const share = await createShareRepo(db).create({
        matterId: 'dl3',
        orgId,
        creatorId,
        kind: 'landing',
        password: 'secret123',
      })

      const rootRef = await fetchRootRef(app, share.token)
      const res = await app.request(`/api/shares/${share.token}/objects/${rootRef}`, {
        redirect: 'manual',
        headers: { Cookie: `sharetk_${share.token}=ok` },
      })
      expect(res.status).toBe(302)
    })

    it('returns 302 for logged-in recipient without cookie (免密)', async () => {
      const { app, db } = await createTestApp()
      const userHeaders = await authedHeaders(app)
      await insertStorage(db)
      const orgId = await getOrgId(db)
      const userId = await getUserId(db)
      await insertFile(db, orgId, { id: 'dl4', name: 'recipient.txt' })
      const share = await createShareRepo(db).create({
        matterId: 'dl4',
        orgId,
        creatorId: userId,
        kind: 'landing',
        password: 'secret456',
        recipients: [{ recipientUserId: userId }],
      })

      const rootRef = await fetchRootRef(app, share.token)
      const res = await app.request(`/api/shares/${share.token}/objects/${rootRef}`, {
        redirect: 'manual',
        headers: userHeaders,
      })
      expect(res.status).toBe(302)
    })

    it('returns 410 when download limit exhausted; counter not incremented past limit', async () => {
      const { app, db } = await createTestApp()
      await authedHeaders(app)
      await insertStorage(db)
      const orgId = await getOrgId(db)
      const creatorId = await getUserId(db)
      await insertFile(db, orgId, { id: 'dl5', name: 'limited.txt' })
      const share = await createShareRepo(db).create({
        matterId: 'dl5',
        orgId,
        creatorId,
        kind: 'landing',
        downloadLimit: 2,
      })
      await db.run(sql`UPDATE shares SET downloads = 2 WHERE id = ${share.id}`)

      const rootRef = await fetchRootRef(app, share.token)
      const res = await app.request(`/api/shares/${share.token}/objects/${rootRef}`, { redirect: 'manual' })
      expect(res.status).toBe(410)

      const rows = await db.all<{ downloads: number }>(sql`SELECT downloads FROM shares WHERE id = ${share.id}`)
      expect(rows[0].downloads).toBe(2)
    })

    it('returns 410 when share is expired', async () => {
      const { app, db } = await createTestApp()
      await authedHeaders(app)
      await insertStorage(db)
      const orgId = await getOrgId(db)
      const creatorId = await getUserId(db)
      await insertFile(db, orgId, { id: 'dl6', name: 'expired.txt' })
      const pastDate = new Date(Date.now() - 1000)
      const share = await createShareRepo(db).create({
        matterId: 'dl6',
        orgId,
        creatorId,
        kind: 'landing',
        expiresAt: pastDate,
      })

      const rootRef = await fetchRootRef(app, share.token)
      const res = await app.request(`/api/shares/${share.token}/objects/${rootRef}`, { redirect: 'manual' })
      expect(res.status).toBe(410)
      const body = (await res.json()) as { error: { message: string } }
      expect(body.error.message).toBe('Share has expired')
    })

    it('returns 410 with AIP-193 body when the shared matter is trashed', async () => {
      const { app, db } = await createTestApp()
      await authedHeaders(app)
      await insertStorage(db)
      const orgId = await getOrgId(db)
      const creatorId = await getUserId(db)
      await insertFile(db, orgId, { id: 'dl-trash', name: 'gone.txt' })
      // The matter is reachable (status active) when the share is created, then
      // gets trashed — resolveByToken returns matter_trashed for the download.
      const share = await createShareRepo(db).create({ matterId: 'dl-trash', orgId, creatorId, kind: 'landing' })
      const rootRef = await fetchRootRef(app, share.token)
      await db.run(sql`UPDATE matters SET status = 'trashed' WHERE id = 'dl-trash'`)

      const res = await app.request(`/api/shares/${share.token}/objects/${rootRef}`, { redirect: 'manual' })
      expect(res.status).toBe(410)
      const body = (await res.json()) as { error: { code: number; message: string; status: string } }
      expect(body.error.code).toBe(410)
      expect(body.error.message).toBe('File no longer available')
      expect(body.error.status).toBe('NOT_FOUND')
    })

    it('returns 400 when downloading a folder share root ref directly', async () => {
      const { app, db } = await createTestApp()
      await authedHeaders(app)
      await insertStorage(db)
      const orgId = await getOrgId(db)
      const creatorId = await getUserId(db)
      await insertFolder(db, orgId, { id: 'dl-folder', name: 'A Folder' })
      const share = await createShareRepo(db).create({ matterId: 'dl-folder', orgId, creatorId, kind: 'landing' })

      const rootRef = await fetchRootRef(app, share.token)
      const res = await app.request(`/api/shares/${share.token}/objects/${rootRef}`, { redirect: 'manual' })
      expect(res.status).toBe(400)
      const body = (await res.json()) as { error: { message: string; status: string } }
      expect(body.error.message).toBe('Cannot download a folder directly')
      expect(body.error.status).toBe('INVALID_ARGUMENT')
    })

    it('returns 404 when the shared file references a missing storage', async () => {
      const { app, db } = await createTestApp()
      await authedHeaders(app)
      // No storage row inserted — the matter points at a storage_id that does
      // not exist, so storage lookup fails after the access gates pass.
      const orgId = await getOrgId(db)
      const creatorId = await getUserId(db)
      const now = Date.now()
      await db.run(sql`
        INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, created_at, updated_at)
        VALUES ('dl-no-storage', ${orgId}, 'dl-no-storage-alias', 'orphan.txt', 'text/plain', 1024, 0, '', 'some/key.txt', 'st-missing', 'active', ${now}, ${now})
      `)
      const share = await createShareRepo(db).create({ matterId: 'dl-no-storage', orgId, creatorId, kind: 'landing' })

      const rootRef = await fetchRootRef(app, share.token)
      const res = await app.request(`/api/shares/${share.token}/objects/${rootRef}`, { redirect: 'manual' })
      expect(res.status).toBe(404)
      const body = (await res.json()) as { error: { message: string; status: string } }
      expect(body.error.message).toBe('Storage not found')
      expect(body.error.status).toBe('NOT_FOUND')
    })
  })

  // ─── GET /api/shares/:token/objects — list folder children ───────────────────

  describe('GET /api/shares/:token/objects', () => {
    it('returns 404 for invalid token', async () => {
      const { app } = await createTestApp()
      const res = await app.request('/api/shares/no-such-token/objects')
      expect(res.status).toBe(404)
    })

    it('returns 410 for trashed matter', async () => {
      const { app, db } = await createTestApp()
      await authedHeaders(app)
      await insertStorage(db)
      const orgId = await getOrgId(db)
      const creatorId = await getUserId(db)
      await insertFolder(db, orgId, { id: 'trashed-dir', name: 'Gone', status: 'trashed' })
      const now = Date.now()
      await db.run(sql`
        INSERT INTO shares (id, token, kind, matter_id, org_id, creator_id, views, downloads, status, created_at)
        VALUES ('sh-trash-ch', 'token-trash-ch', 'landing', 'trashed-dir', ${orgId}, ${creatorId}, 0, 0, 'active', ${now})
      `)
      const res = await app.request('/api/shares/token-trash-ch/objects')
      expect(res.status).toBe(410)
    })

    it('returns 400 for non-folder share', async () => {
      const { app, db } = await createTestApp()
      await authedHeaders(app)
      await insertStorage(db)
      const orgId = await getOrgId(db)
      const creatorId = await getUserId(db)
      await insertFile(db, orgId, { id: 'ch1', name: 'flat.txt' })
      const share = await createShareRepo(db).create({ matterId: 'ch1', orgId, creatorId, kind: 'landing' })

      const res = await app.request(`/api/shares/${share.token}/objects`)
      expect(res.status).toBe(400)
      const body = (await res.json()) as { error: { message: string } }
      expect(body.error.message).toBe('Not a folder share')
    })

    it('returns 410 with AIP-193 body when listing objects of an expired folder share', async () => {
      const { app, db } = await createTestApp()
      await authedHeaders(app)
      await insertStorage(db)
      const orgId = await getOrgId(db)
      const creatorId = await getUserId(db)
      await insertFolder(db, orgId, { id: 'ch-expired', name: 'Expired Folder' })
      const share = await createShareRepo(db).create({
        matterId: 'ch-expired',
        orgId,
        creatorId,
        kind: 'landing',
        expiresAt: new Date(Date.now() - 1000),
      })

      const res = await app.request(`/api/shares/${share.token}/objects`)
      expect(res.status).toBe(410)
      const body = (await res.json()) as { error: { code: number; message: string; status: string } }
      expect(body.error.code).toBe(410)
      expect(body.error.message).toBe('Share has expired')
      expect(body.error.status).toBe('NOT_FOUND')
    })

    it('returns items and breadcrumb for folder share', async () => {
      const { app, db } = await createTestApp()
      await authedHeaders(app)
      await insertStorage(db)
      const orgId = await getOrgId(db)
      const creatorId = await getUserId(db)
      await insertFolder(db, orgId, { id: 'dir1', name: 'Photos' })
      await insertFile(db, orgId, { id: 'img1', name: 'cat.jpg', parent: 'Photos' })
      await insertFolder(db, orgId, { id: 'dir2', name: 'vacation', parent: 'Photos' })
      const share = await createShareRepo(db).create({ matterId: 'dir1', orgId, creatorId, kind: 'landing' })

      const res = await app.request(`/api/shares/${share.token}/objects`)
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        items: Array<Record<string, unknown>>
        breadcrumb: Array<Record<string, unknown>>
      }
      expect(body.items).toHaveLength(2)
      expect(body.breadcrumb).toEqual([{ name: 'Photos', path: '' }])

      const names = body.items.map((i) => i.name)
      expect(names).toContain('cat.jpg')
      expect(names).toContain('vacation')

      // Each item exposes an opaque ref, not the raw matter id
      expect(body.items.every((i) => typeof i.ref === 'string' && i.ref !== 'img1' && i.ref !== 'dir2')).toBe(true)
    })

    it('returns subfolder contents with breadcrumb when parent= provided', async () => {
      const { app, db } = await createTestApp()
      await authedHeaders(app)
      await insertStorage(db)
      const orgId = await getOrgId(db)
      const creatorId = await getUserId(db)
      await insertFolder(db, orgId, { id: 'root1', name: 'Docs' })
      await insertFolder(db, orgId, { id: 'sub1', name: 'Reports', parent: 'Docs' })
      await insertFile(db, orgId, { id: 'rpt1', name: 'q1.pdf', parent: 'Docs/Reports' })
      const share = await createShareRepo(db).create({ matterId: 'root1', orgId, creatorId, kind: 'landing' })

      const res = await app.request(`/api/shares/${share.token}/objects?parent=Reports`)
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        items: Array<Record<string, unknown>>
        breadcrumb: Array<Record<string, unknown>>
      }
      expect(body.items).toHaveLength(1)
      expect(body.items[0].name).toBe('q1.pdf')
      expect(body.breadcrumb).toEqual([
        { name: 'Docs', path: '' },
        { name: 'Reports', path: 'Reports' },
      ])
    })

    it('returns 401 for password-protected share without cookie', async () => {
      const { app, db } = await createTestApp()
      await authedHeaders(app)
      await insertStorage(db)
      const orgId = await getOrgId(db)
      const creatorId = await getUserId(db)
      await insertFolder(db, orgId, { id: 'locked1', name: 'Private' })
      const share = await createShareRepo(db).create({
        matterId: 'locked1',
        orgId,
        creatorId,
        kind: 'landing',
        password: 'pass123',
      })

      const res = await app.request(`/api/shares/${share.token}/objects`)
      expect(res.status).toBe(401)
    })

    it('returns 400 when parent contains traversal segments', async () => {
      const { app, db } = await createTestApp()
      await authedHeaders(app)
      await insertStorage(db)
      const orgId = await getOrgId(db)
      const creatorId = await getUserId(db)
      await insertFolder(db, orgId, { id: 'traversal-dir', name: 'Safe' })
      const share = await createShareRepo(db).create({ matterId: 'traversal-dir', orgId, creatorId, kind: 'landing' })

      const res = await app.request(`/api/shares/${share.token}/objects?parent=../etc`)
      expect(res.status).toBe(400)
      const body = (await res.json()) as { error: { message: string } }
      expect(body.error.message).toBe('Invalid path')
    })

    it('respects explicit page and pageSize query params', async () => {
      const { app, db } = await createTestApp()
      await authedHeaders(app)
      await insertStorage(db)
      const orgId = await getOrgId(db)
      const creatorId = await getUserId(db)
      await insertFolder(db, orgId, { id: 'pg-dir', name: 'Paged' })
      const share = await createShareRepo(db).create({ matterId: 'pg-dir', orgId, creatorId, kind: 'landing' })

      const res = await app.request(`/api/shares/${share.token}/objects?page=2&pageSize=10`)
      expect(res.status).toBe(200)
      const body = (await res.json()) as { page: number; pageSize: number }
      expect(body.page).toBe(2)
      expect(body.pageSize).toBe(10)
    })

    it('falls back to defaults when page/pageSize are non-numeric', async () => {
      const { app, db } = await createTestApp()
      await authedHeaders(app)
      await insertStorage(db)
      const orgId = await getOrgId(db)
      const creatorId = await getUserId(db)
      await insertFolder(db, orgId, { id: 'nan-dir', name: 'NaN' })
      const share = await createShareRepo(db).create({ matterId: 'nan-dir', orgId, creatorId, kind: 'landing' })

      const res = await app.request(`/api/shares/${share.token}/objects?page=abc&pageSize=xyz`)
      expect(res.status).toBe(200)
      const body = (await res.json()) as { page: number; pageSize: number }
      expect(body.page).toBe(1)
      expect(body.pageSize).toBe(50)
    })
  })

  // ─── GET /api/shares/:token/objects/:ref — descendant ref ────────────────────

  describe('GET /api/shares/:token/objects/:ref — descendant', () => {
    it('redirects for valid descendant ref', async () => {
      const { app, db } = await createTestApp()
      await authedHeaders(app)
      await insertStorage(db)
      const orgId = await getOrgId(db)
      const creatorId = await getUserId(db)
      await insertFolder(db, orgId, { id: 'fld1', name: 'Archive' })
      await insertFile(db, orgId, { id: 'arc1', name: 'old.zip', parent: 'Archive' })
      const share = await createShareRepo(db).create({ matterId: 'fld1', orgId, creatorId, kind: 'landing' })

      const childrenRes = await app.request(`/api/shares/${share.token}/objects`)
      const childrenBody = (await childrenRes.json()) as { items: Array<{ ref: string }> }
      const ref = childrenBody.items[0].ref

      const res = await app.request(`/api/shares/${share.token}/objects/${ref}`, { redirect: 'manual' })
      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toBe(MOCK_PRESIGN_URL)
      expect(res.headers.get('cache-control')).toBe('no-store')
    })

    it('returns 400 for invalid/forged ref', async () => {
      const { app, db } = await createTestApp()
      await authedHeaders(app)
      await insertStorage(db)
      const orgId = await getOrgId(db)
      const creatorId = await getUserId(db)
      await insertFolder(db, orgId, { id: 'fld2', name: 'Safe' })
      const share = await createShareRepo(db).create({ matterId: 'fld2', orgId, creatorId, kind: 'landing' })

      const res = await app.request(`/api/shares/${share.token}/objects/invalid-ref`, { redirect: 'manual' })
      expect(res.status).toBe(400)
    })

    it('returns 404 when ref decodes to a matter outside the folder subtree', async () => {
      const { app, db } = await createTestApp()
      await authedHeaders(app)
      await insertStorage(db)
      const orgId = await getOrgId(db)
      const creatorId = await getUserId(db)
      await insertFolder(db, orgId, { id: 'fld3', name: 'Folder3' })
      await insertFile(db, orgId, { id: 'out1', name: 'outside.txt' })
      const share = await createShareRepo(db).create({ matterId: 'fld3', orgId, creatorId, kind: 'landing' })

      const { createHmac } = await import('node:crypto')
      const sig = createHmac('sha256', share.token).update('out1').digest('hex').slice(0, 16)
      const fakeRef = Buffer.from(`out1.${sig}`).toString('base64url')

      const res = await app.request(`/api/shares/${share.token}/objects/${fakeRef}`, { redirect: 'manual' })
      expect(res.status).toBe(404)
    })
  })

  // ─── GET /r/:token — unified redirect for direct shares (ds_) ────────────────

  describe('GET /r/:token (ds_ direct shares)', () => {
    it('returns 302 redirect for valid direct share', async () => {
      const { app, db } = await createTestApp()
      await authedHeaders(app)
      await insertStorage(db)
      const orgId = await getOrgId(db)
      const creatorId = await getUserId(db)
      await insertFile(db, orgId, { id: 'dlx1', name: 'direct.bin' })
      const share = await createShareRepo(db).create({ matterId: 'dlx1', orgId, creatorId, kind: 'direct' })

      const res = await app.request(`/r/${share.token}`, { redirect: 'manual' })
      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toBe(MOCK_PRESIGN_URL)
      expect(res.headers.get('cache-control')).toContain('no-store')
    })

    it('returns 404 for landing share token at /r/', async () => {
      const { app, db } = await createTestApp()
      await authedHeaders(app)
      await insertStorage(db)
      const orgId = await getOrgId(db)
      const creatorId = await getUserId(db)
      await insertFile(db, orgId, { id: 'dlx2', name: 'landing.txt' })
      const share = await createShareRepo(db).create({ matterId: 'dlx2', orgId, creatorId, kind: 'landing' })

      const res = await app.request(`/r/${share.token}`, { redirect: 'manual' })
      expect(res.status).toBe(404)
    })

    it('returns 404 for unknown prefix token', async () => {
      const { app } = await createTestApp()
      const res = await app.request('/r/nosuchthing', { redirect: 'manual' })
      expect(res.status).toBe(404)
    })

    it('returns 410 for trashed matter', async () => {
      const { app, db } = await createTestApp()
      await authedHeaders(app)
      await insertStorage(db)
      const orgId = await getOrgId(db)
      const creatorId = await getUserId(db)
      await insertFile(db, orgId, { id: 'dlx3', name: 'trashed.txt', status: 'trashed' })
      const now = Date.now()
      await db.run(sql`
        INSERT INTO shares (id, token, kind, matter_id, org_id, creator_id, views, downloads, status, created_at)
        VALUES ('sh-dltrash', 'ds_token-dltrash', 'direct', 'dlx3', ${orgId}, ${creatorId}, 0, 0, 'active', ${now})
      `)

      const res = await app.request('/r/ds_token-dltrash', { redirect: 'manual' })
      expect(res.status).toBe(410)
    })

    it('returns 410 when limit exhausted', async () => {
      const { app, db } = await createTestApp()
      await authedHeaders(app)
      await insertStorage(db)
      const orgId = await getOrgId(db)
      const creatorId = await getUserId(db)
      await insertFile(db, orgId, { id: 'dlx4', name: 'limited.bin' })
      const share = await createShareRepo(db).create({
        matterId: 'dlx4',
        orgId,
        creatorId,
        kind: 'direct',
        downloadLimit: 1,
      })
      await db.run(sql`UPDATE shares SET downloads = 1 WHERE id = ${share.id}`)

      const res = await app.request(`/r/${share.token}`, { redirect: 'manual' })
      expect(res.status).toBe(410)
    })

    it('does not require auth (verified: no auth header needed)', async () => {
      const { app, db } = await createTestApp()
      await authedHeaders(app)
      await insertStorage(db)
      const orgId = await getOrgId(db)
      const creatorId = await getUserId(db)
      await insertFile(db, orgId, { id: 'dlx5', name: 'public.bin' })
      const share = await createShareRepo(db).create({ matterId: 'dlx5', orgId, creatorId, kind: 'direct' })

      const res = await app.request(`/r/${share.token}`, { redirect: 'manual' })
      expect(res.status).toBe(302)
    })
  })

  // ─── No auth required on public share routes ─────────────────────────────────

  describe('public routes require no auth', () => {
    it('GET /api/shares/:token succeeds without any auth headers', async () => {
      const { app, db } = await createTestApp()
      await authedHeaders(app)
      await insertStorage(db)
      const orgId = await getOrgId(db)
      const creatorId = await getUserId(db)
      await insertFile(db, orgId, { id: 'pub1', name: 'open.txt' })
      const share = await createShareRepo(db).create({ matterId: 'pub1', orgId, creatorId, kind: 'landing' })

      const res = await app.request(`/api/shares/${share.token}`)
      expect(res.status).toBe(200)
    })
  })
})
