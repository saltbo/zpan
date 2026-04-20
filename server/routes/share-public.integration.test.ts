import { sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { S3Service } from '../services/s3.js'
import { createShare } from '../services/share.js'
import { authedHeaders, createTestApp } from '../test/setup.js'

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
    const share = await createShare(db, { matterId: 'f1', orgId, creatorId, kind: 'landing' })

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
    const share = await createShare(db, { matterId: 'f1v', orgId, creatorId, kind: 'landing' })

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
    const share = await createShare(db, { matterId: 'f1vd', orgId, creatorId, kind: 'landing' })

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
    const share = await createShare(db, { matterId: 'f2', orgId, creatorId, kind: 'direct' })

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
    const share = await createShare(db, { matterId: 'f4', orgId, creatorId, kind: 'landing' })
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
    const share = await createShare(db, {
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
    const share = await createShare(db, {
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
    const share = await createShare(db, {
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
    const share = await createShare(db, {
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
    const share = await createShare(db, { matterId: 'dl1', orgId, creatorId, kind: 'landing' })

    const rootRef = await fetchRootRef(app, share.token)
    const res = await app.request(`/api/shares/${share.token}/objects/${rootRef}`, { redirect: 'manual' })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(MOCK_PRESIGN_URL)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('returns 401 when password required and no cookie', async () => {
    const { app, db } = await createTestApp()
    await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    const creatorId = await getUserId(db)
    await insertFile(db, orgId, { id: 'dl2', name: 'secret.txt' })
    const share = await createShare(db, {
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
    const share = await createShare(db, {
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
    const share = await createShare(db, {
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
    const share = await createShare(db, {
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
    const share = await createShare(db, {
      matterId: 'dl6',
      orgId,
      creatorId,
      kind: 'landing',
      expiresAt: pastDate,
    })

    const rootRef = await fetchRootRef(app, share.token)
    const res = await app.request(`/api/shares/${share.token}/objects/${rootRef}`, { redirect: 'manual' })
    expect(res.status).toBe(410)
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
    const share = await createShare(db, { matterId: 'ch1', orgId, creatorId, kind: 'landing' })

    const res = await app.request(`/api/shares/${share.token}/objects`)
    expect(res.status).toBe(400)
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
    const share = await createShare(db, { matterId: 'dir1', orgId, creatorId, kind: 'landing' })

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
    const share = await createShare(db, { matterId: 'root1', orgId, creatorId, kind: 'landing' })

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
    const share = await createShare(db, {
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
    const share = await createShare(db, { matterId: 'traversal-dir', orgId, creatorId, kind: 'landing' })

    const res = await app.request(`/api/shares/${share.token}/objects?parent=../etc`)
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Invalid path')
  })

  it('respects explicit page and pageSize query params', async () => {
    const { app, db } = await createTestApp()
    await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    const creatorId = await getUserId(db)
    await insertFolder(db, orgId, { id: 'pg-dir', name: 'Paged' })
    const share = await createShare(db, { matterId: 'pg-dir', orgId, creatorId, kind: 'landing' })

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
    const share = await createShare(db, { matterId: 'nan-dir', orgId, creatorId, kind: 'landing' })

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
    const share = await createShare(db, { matterId: 'fld1', orgId, creatorId, kind: 'landing' })

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
    const share = await createShare(db, { matterId: 'fld2', orgId, creatorId, kind: 'landing' })

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
    const share = await createShare(db, { matterId: 'fld3', orgId, creatorId, kind: 'landing' })

    const { createHmac } = await import('node:crypto')
    const sig = createHmac('sha256', share.token).update('out1').digest('hex').slice(0, 16)
    const fakeRef = Buffer.from(`out1.${sig}`).toString('base64url')

    const res = await app.request(`/api/shares/${share.token}/objects/${fakeRef}`, { redirect: 'manual' })
    expect(res.status).toBe(404)
  })
})

// ─── GET /dl/:token — unchanged public short-link for direct shares ──────────

describe('GET /dl/:token', () => {
  it('returns 302 redirect for valid direct share', async () => {
    const { app, db } = await createTestApp()
    await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    const creatorId = await getUserId(db)
    await insertFile(db, orgId, { id: 'dlx1', name: 'direct.bin' })
    const share = await createShare(db, { matterId: 'dlx1', orgId, creatorId, kind: 'direct' })

    const res = await app.request(`/dl/${share.token}`, { redirect: 'manual' })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(MOCK_PRESIGN_URL)
    expect(res.headers.get('cache-control')).toContain('no-store')
  })

  it('returns 404 for landing share via /dl/', async () => {
    const { app, db } = await createTestApp()
    await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    const creatorId = await getUserId(db)
    await insertFile(db, orgId, { id: 'dlx2', name: 'landing.txt' })
    const share = await createShare(db, { matterId: 'dlx2', orgId, creatorId, kind: 'landing' })

    const res = await app.request(`/dl/${share.token}`, { redirect: 'manual' })
    expect(res.status).toBe(404)
  })

  it('returns 404 for unknown token', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/dl/nosuchthing', { redirect: 'manual' })
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
      VALUES ('sh-dltrash', 'token-dltrash', 'direct', 'dlx3', ${orgId}, ${creatorId}, 0, 0, 'active', ${now})
    `)

    const res = await app.request('/dl/token-dltrash', { redirect: 'manual' })
    expect(res.status).toBe(410)
  })

  it('returns 410 when limit exhausted', async () => {
    const { app, db } = await createTestApp()
    await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    const creatorId = await getUserId(db)
    await insertFile(db, orgId, { id: 'dlx4', name: 'limited.bin' })
    const share = await createShare(db, {
      matterId: 'dlx4',
      orgId,
      creatorId,
      kind: 'direct',
      downloadLimit: 1,
    })
    await db.run(sql`UPDATE shares SET downloads = 1 WHERE id = ${share.id}`)

    const res = await app.request(`/dl/${share.token}`, { redirect: 'manual' })
    expect(res.status).toBe(410)
  })

  it('does not require auth (verified: no auth header needed)', async () => {
    const { app, db } = await createTestApp()
    await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    const creatorId = await getUserId(db)
    await insertFile(db, orgId, { id: 'dlx5', name: 'public.bin' })
    const share = await createShare(db, { matterId: 'dlx5', orgId, creatorId, kind: 'direct' })

    const res = await app.request(`/dl/${share.token}`, { redirect: 'manual' })
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
    const share = await createShare(db, { matterId: 'pub1', orgId, creatorId, kind: 'landing' })

    const res = await app.request(`/api/shares/${share.token}`)
    expect(res.status).toBe(200)
  })
})
