import { eq, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { shareRecipients, shares } from '../db/schema.js'
import * as emailService from '../services/email.js'
import { S3Service } from '../services/s3.js'
import { authedHeaders, createTestApp } from '../test/setup.js'

type TestApp = Awaited<ReturnType<typeof createTestApp>>['app']
type TestDb = Awaited<ReturnType<typeof createTestApp>>['db']

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function _signUpAndGetUser(app: TestApp, email: string) {
  const res = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Test User', email, password: 'password123456' }),
  })
  const cookies = res.headers.getSetCookie().join('; ')
  const body = (await res.json()) as { user?: { id: string } }
  return { headers: { Cookie: cookies }, userId: body.user?.id ?? '' }
}

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

// ─── POST /api/shares auth guard ─────────────────────────────────────────────

describe('POST /api/shares (auth guard)', () => {
  it('returns 401 without auth', async () => {
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
    vi.spyOn(emailService, 'sendEmail').mockResolvedValue(undefined)
  })

  it('creates a landing share without password and returns 201 with correct shape', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'f1', name: 'doc.txt' })

    const res = await createShare(app, headers, { matterId: 'f1', kind: 'landing' })
    expect(res.status).toBe(201)

    const body = (await res.json()) as Record<string, unknown>
    expect(typeof body.id).toBe('string')
    expect(typeof body.token).toBe('string')
    expect(body.kind).toBe('landing')
    expect((body.urls as Record<string, string>).landing).toMatch(/^\/s\//)
    expect((body.urls as Record<string, string>).direct).toBeUndefined()
  })

  it('creates a landing share with password and stores passwordHash in DB', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'f2', name: 'secret.txt' })

    const res = await createShare(app, headers, { matterId: 'f2', kind: 'landing', password: 'hunter2' })
    expect(res.status).toBe(201)

    const body = (await res.json()) as Record<string, unknown>
    const shareId = body.id as string

    const rows = await db.select({ passwordHash: shares.passwordHash }).from(shares).where(eq(shares.id, shareId))
    expect(rows[0]?.passwordHash).not.toBeNull()
    expect(rows[0]?.passwordHash).not.toBe('')
  })

  it('creates a landing share with recipients and inserts share_recipients rows', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'f3', name: 'report.txt' })

    const recipients = [{ recipientEmail: 'alice@example.com' }, { recipientEmail: 'bob@example.com' }]

    const res = await createShare(app, headers, { matterId: 'f3', kind: 'landing', recipients })
    expect(res.status).toBe(201)

    const body = (await res.json()) as Record<string, unknown>
    const shareId = body.id as string

    const rows = await db.select().from(shareRecipients).where(eq(shareRecipients.shareId, shareId))
    expect(rows).toHaveLength(2)
  })

  it('creates a direct share for a file and returns direct url', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'f4', name: 'photo.jpg' })

    const res = await createShare(app, headers, { matterId: 'f4', kind: 'direct' })
    expect(res.status).toBe(201)

    const body = (await res.json()) as Record<string, unknown>
    expect(body.kind).toBe('direct')
    expect((body.urls as Record<string, string>).direct).toMatch(/^\/dl\//)
    expect((body.urls as Record<string, string>).landing).toBeUndefined()
  })

  it('returns 400 with DIRECT_NO_FOLDER when creating direct share for a folder', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFolder(db, orgId, { id: 'fo1', name: 'My Folder' })

    const res = await createShare(app, headers, { matterId: 'fo1', kind: 'direct' })
    expect(res.status).toBe(400)

    const body = (await res.json()) as Record<string, unknown>
    expect(body.code).toBe('DIRECT_NO_FOLDER')
  })

  it('returns 400 with DIRECT_NO_PASSWORD when creating direct share with password', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'f5', name: 'file.txt' })

    const res = await createShare(app, headers, { matterId: 'f5', kind: 'direct', password: 'secret' })
    expect(res.status).toBe(400)

    const body = (await res.json()) as Record<string, unknown>
    expect(body.code).toBe('DIRECT_NO_PASSWORD')
  })

  it('returns 404 when matterId does not belong to current org', async () => {
    const { app } = await createTestApp()
    const headers = await authedHeaders(app)

    const res = await createShare(app, headers, { matterId: 'nonexistent-matter', kind: 'landing' })
    expect(res.status).toBe(404)

    const body = (await res.json()) as Record<string, unknown>
    expect(body.code).toBe('MATTER_NOT_FOUND')
  })

  it('sets expiresAt when provided in request', async () => {
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

  it('sets downloadLimit when provided in request', async () => {
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
    vi.spyOn(emailService, 'sendEmail').mockResolvedValue(undefined)
  })

  it('returns empty list for a new user with no shares', async () => {
    const { app } = await createTestApp()
    const headers = await authedHeaders(app)

    const res = await app.request('/api/shares', { headers })
    expect(res.status).toBe(200)

    const body = (await res.json()) as { items: unknown[]; total: number; page: number; pageSize: number }
    expect(body.items).toHaveLength(0)
    expect(body.total).toBe(0)
  })

  it('returns shares with pagination fields in response', async () => {
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

  it('does not return shares belonging to another user', async () => {
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

  it('filters shares by status=active', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'st1', name: 'active.txt' })
    await insertFile(db, orgId, { id: 'st2', name: 'revoked.txt' })

    const res1 = await createShare(app, headers, { matterId: 'st1', kind: 'landing' })
    const _body1 = (await res1.json()) as Record<string, unknown>
    const res2 = await createShare(app, headers, { matterId: 'st2', kind: 'landing' })
    const body2 = (await res2.json()) as Record<string, unknown>

    // Revoke the second share
    await app.request(`/api/shares/${body2.id}`, { method: 'DELETE', headers })

    const resActive = await app.request('/api/shares?status=active', { headers })
    const activeBody = (await resActive.json()) as { items: unknown[]; total: number }
    expect(activeBody.total).toBe(1)

    const resRevoked = await app.request('/api/shares?status=revoked', { headers })
    const revokedBody = (await resRevoked.json()) as { items: unknown[]; total: number }
    expect(revokedBody.total).toBe(1)
  })
})

// ─── GET /api/shares/:id auth guard ──────────────────────────────────────────

describe('GET /api/shares/:id (auth guard)', () => {
  it('returns 401 without auth', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/shares/some-id')
    expect(res.status).toBe(401)
  })
})

// ─── GET /api/shares/:id ──────────────────────────────────────────────────────

describe('GET /api/shares/:id', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(emailService, 'sendEmail').mockResolvedValue(undefined)
  })

  it('returns full share data including recipients and matter for creator', async () => {
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
    const createBody = (await createRes.json()) as Record<string, unknown>
    const shareId = createBody.id as string

    const res = await app.request(`/api/shares/${shareId}`, { headers })
    expect(res.status).toBe(200)

    const body = (await res.json()) as Record<string, unknown>
    expect(body.id).toBe(shareId)
    expect(Array.isArray(body.recipients)).toBe(true)
    expect((body.recipients as unknown[]).length).toBe(1)
    expect(body).toHaveProperty('matter')
    const matter = body.matter as Record<string, unknown>
    expect(matter.name).toBe('get-detail.txt')
  })

  it('returns 404 when share belongs to another user', async () => {
    const { app, db } = await createTestApp()
    await insertStorage(db)

    const headersA = await authedHeaders(app, `ownerA-${nanoid()}@example.com`)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'ga1', name: 'owned-by-a.txt' })

    const createRes = await createShare(app, headersA, { matterId: 'ga1', kind: 'landing' })
    const createBody = (await createRes.json()) as Record<string, unknown>
    const shareId = createBody.id as string

    // User B tries to get User A's share
    const headersB = await authedHeaders(app, `otherB-${nanoid()}@example.com`)
    const res = await app.request(`/api/shares/${shareId}`, { headers: headersB })
    expect(res.status).toBe(404)
  })

  it('returns 404 for a non-existent share id', async () => {
    const { app } = await createTestApp()
    const headers = await authedHeaders(app)

    const res = await app.request('/api/shares/nonexistent-share-id', { headers })
    expect(res.status).toBe(404)
  })
})

// ─── DELETE /api/shares/:id auth guard ───────────────────────────────────────

describe('DELETE /api/shares/:id (auth guard)', () => {
  it('returns 401 without auth', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/shares/some-id', { method: 'DELETE' })
    expect(res.status).toBe(401)
  })
})

// ─── POST /:token/save ────────────────────────────────────────────────────────

describe('POST /api/shares/:token/save', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(emailService, 'sendEmail').mockResolvedValue(undefined)
    vi.spyOn(S3Service.prototype, 'copyObject').mockResolvedValue(undefined)
    vi.spyOn(S3Service.prototype, 'streamCopy').mockResolvedValue(undefined)
  })

  it('returns 404 when share token does not exist', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    const orgId = await getOrgId(db)

    const res = await app.request('/api/shares/nonexistent-token/save', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetOrgId: orgId, targetParent: '' }),
    })
    expect(res.status).toBe(404)
  })

  it('returns 400 with DIRECT_SAVE_FORBIDDEN for direct shares', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'sv-direct', name: 'direct-file.txt' })

    // Create direct share
    const createRes = await createShare(app, headers, { matterId: 'sv-direct', kind: 'direct' })
    const createBody = (await createRes.json()) as Record<string, unknown>
    const token = createBody.token as string

    const res = await app.request(`/api/shares/${token}/save`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetOrgId: orgId, targetParent: '' }),
    })
    expect(res.status).toBe(400)

    const body = (await res.json()) as Record<string, unknown>
    expect(body.code).toBe('DIRECT_SAVE_FORBIDDEN')
  })

  it('returns 410 when the shared matter has been trashed', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'sv-trashed', name: 'will-trash.txt' })

    const createRes = await createShare(app, headers, { matterId: 'sv-trashed', kind: 'landing' })
    const createBody = (await createRes.json()) as Record<string, unknown>
    const token = createBody.token as string

    // Trash the matter
    await db.run(sql`UPDATE matters SET status = 'trashed' WHERE id = 'sv-trashed'`)

    const res = await app.request(`/api/shares/${token}/save`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetOrgId: orgId, targetParent: '' }),
    })
    expect(res.status).toBe(410)
  })

  it('saves a landing share file to personal drive and returns 201', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'sv-ok', name: 'shareable.txt' })

    const createRes = await createShare(app, headers, { matterId: 'sv-ok', kind: 'landing' })
    const createBody = (await createRes.json()) as Record<string, unknown>
    const token = createBody.token as string

    const res = await app.request(`/api/shares/${token}/save`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetOrgId: orgId, targetParent: '' }),
    })
    expect(res.status).toBe(201)
  })

  it('returns 401 without auth', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/shares/sometoken/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetOrgId: 'org1', targetParent: '' }),
    })
    expect(res.status).toBe(401)
  })

  it('returns 400 QUOTA_EXCEEDED when target org quota is exhausted', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)

    // Insert a file with non-zero size (100 bytes)
    await insertFile(db, orgId, { id: 'sv-quota', name: 'big-file.txt' })

    // The personal org already has an org_quota row created during sign-up.
    // Update it to set used=quota so adding even 1 byte will exceed it.
    await db.run(sql`UPDATE org_quotas SET quota = 1, used = 1 WHERE org_id = ${orgId}`)

    const createRes = await createShare(app, headers, { matterId: 'sv-quota', kind: 'landing' })
    const createBody = (await createRes.json()) as Record<string, unknown>
    const token = createBody.token as string

    const res = await app.request(`/api/shares/${token}/save`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetOrgId: orgId, targetParent: '' }),
    })
    expect(res.status).toBe(400)

    const body = (await res.json()) as Record<string, unknown>
    expect(body.code).toBe('QUOTA_EXCEEDED')
  })

  it('returns 403 when targetOrgId is not a personal org and user has no member role', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'sv-forbidden', name: 'forbidden.txt' })

    const createRes = await createShare(app, headers, { matterId: 'sv-forbidden', kind: 'landing' })
    const createBody = (await createRes.json()) as Record<string, unknown>
    const token = createBody.token as string

    // Use a non-existent team org as target (user has no member record there, and it's not personal)
    const fakeTeamOrgId = `team-org-${nanoid()}`
    await db.run(sql`
      INSERT INTO organization (id, name, slug, metadata, created_at)
      VALUES (${fakeTeamOrgId}, 'Team Org', ${fakeTeamOrgId}, '{"type":"team"}', ${Date.now()})
    `)

    const res = await app.request(`/api/shares/${token}/save`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetOrgId: fakeTeamOrgId, targetParent: '' }),
    })
    expect(res.status).toBe(403)
  })

  it('allows password-protected share save when the user is a listed recipient', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'sv-recip', name: 'recipient-file.txt' })

    // Sign up user B to get their userId
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

    // User A creates a password-protected landing share with user B as recipient
    const createRes = await createShare(app, headers, {
      matterId: 'sv-recip',
      kind: 'landing',
      password: 'secretPass123',
      recipients: [{ recipientUserId: userBId }],
    })
    const createBody = (await createRes.json()) as Record<string, unknown>
    const token = createBody.token as string

    // User B saves without cookie — should be allowed because they are a recipient
    const res = await app.request(`/api/shares/${token}/save`, {
      method: 'POST',
      headers: { ...headersB, 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetOrgId: orgIdB, targetParent: '' }),
    })
    // Should NOT get 401 — recipient bypasses cookie requirement
    expect(res.status).not.toBe(401)
  })

  it('returns 401 for password-protected share when user is not a recipient and no cookie', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'sv-pw', name: 'protected.txt' })

    // Create share with password as user A
    const createRes = await createShare(app, headers, {
      matterId: 'sv-pw',
      kind: 'landing',
      password: 'topSecret123',
    })
    const createBody = (await createRes.json()) as Record<string, unknown>
    const token = createBody.token as string

    // User B tries to save without cookie
    const headersB = await authedHeaders(app, `pw-user-b-${nanoid()}@example.com`)
    const res = await app.request(`/api/shares/${token}/save`, {
      method: 'POST',
      headers: { ...headersB, 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetOrgId: orgId, targetParent: '' }),
    })
    expect(res.status).toBe(401)
  })
})

// ─── DELETE /api/shares/:id ───────────────────────────────────────────────────

describe('DELETE /api/shares/:id', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(emailService, 'sendEmail').mockResolvedValue(undefined)
  })

  it('creator can delete their share and share status becomes revoked in DB', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'del1', name: 'delete-me.txt' })

    const createRes = await createShare(app, headers, { matterId: 'del1', kind: 'landing' })
    const createBody = (await createRes.json()) as Record<string, unknown>
    const shareId = createBody.id as string

    const res = await app.request(`/api/shares/${shareId}`, { method: 'DELETE', headers })
    expect(res.status).toBe(204)

    const rows = await db.select({ status: shares.status }).from(shares).where(eq(shares.id, shareId))
    expect(rows[0]?.status).toBe('revoked')
  })

  it('returns 403 when non-creator tries to delete a share', async () => {
    const { app, db } = await createTestApp()
    await insertStorage(db)

    const headersA = await authedHeaders(app, `del-owner-${nanoid()}@example.com`)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'del2', name: 'other-share.txt' })

    const createRes = await createShare(app, headersA, { matterId: 'del2', kind: 'landing' })
    const createBody = (await createRes.json()) as Record<string, unknown>
    const shareId = createBody.id as string

    const headersB = await authedHeaders(app, `del-other-${nanoid()}@example.com`)
    const res = await app.request(`/api/shares/${shareId}`, { method: 'DELETE', headers: headersB })
    expect(res.status).toBe(403)
  })

  it('returns 404 for non-existent share', async () => {
    const { app } = await createTestApp()
    const headers = await authedHeaders(app)

    const res = await app.request('/api/shares/does-not-exist', { method: 'DELETE', headers })
    expect(res.status).toBe(404)
  })
})
