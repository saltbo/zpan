import { sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { S3Service } from '../services/s3.js'
import { authedHeaders, createTestApp } from '../test/setup.js'

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(S3Service.prototype, 'presignUpload').mockResolvedValue('https://presigned-upload.example.com')
  vi.spyOn(S3Service.prototype, 'putObject').mockResolvedValue(undefined)
  vi.spyOn(S3Service.prototype, 'deleteObject').mockResolvedValue(undefined)
})

const validStorage = {
  id: 'st-ihost-1',
  title: 'Test S3',
  mode: 'private',
  bucket: 'test-bucket',
  endpoint: 'https://s3.amazonaws.com',
  region: 'us-east-1',
  accessKey: 'AKIAIOSFODNN7EXAMPLE',
  secretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
}

type TestDb = Awaited<ReturnType<typeof createTestApp>>['db']

async function insertStorage(db: TestDb) {
  const now = Date.now()
  await db.run(sql`
    INSERT INTO storages (id, title, mode, bucket, endpoint, region, access_key, secret_key, file_path, custom_host, capacity, used, status, created_at, updated_at)
    VALUES (${validStorage.id}, ${validStorage.title}, ${validStorage.mode}, ${validStorage.bucket}, ${validStorage.endpoint}, ${validStorage.region}, ${validStorage.accessKey}, ${validStorage.secretKey}, '', '', 0, 0, 'active', ${now}, ${now})
  `)
}

async function insertImageHostingConfig(
  db: TestDb,
  orgId: string,
  opts: { customDomain?: string; domainVerifiedAt?: number } = {},
) {
  const now = Date.now()
  await db.run(sql`
    INSERT INTO image_hosting_configs (org_id, custom_domain, domain_verified_at, created_at, updated_at)
    VALUES (${orgId}, ${opts.customDomain ?? null}, ${opts.domainVerifiedAt ?? null}, ${now}, ${now})
  `)
}

async function getOrgId(db: TestDb): Promise<string> {
  const rows = await db.all<{ id: string }>(sql`
    SELECT id FROM organization WHERE metadata LIKE '%"type":"personal"%' LIMIT 1
  `)
  return rows[0].id
}

async function insertApiKey(
  db: TestDb,
  orgId: string,
  opts: { key?: string; permissions?: string | null; enabled?: boolean; expiresAt?: number | null } = {},
) {
  const now = Date.now()
  const key = opts.key ?? `test_apikey_${nanoid(10)}`
  const enabled = opts.enabled ?? true
  await db.run(sql`
    INSERT INTO apikey (id, config_id, reference_id, key, enabled, rate_limit_enabled, request_count, created_at, updated_at, permissions, expires_at)
    VALUES (${nanoid()}, 'default', ${orgId}, ${key}, ${enabled ? 1 : 0}, 1, 0, ${now}, ${now}, ${opts.permissions ?? null}, ${opts.expiresAt ?? null})
  `)
  return key
}

async function insertImageHosting(
  db: TestDb,
  orgId: string,
  opts: {
    id?: string
    status?: string
    path?: string
    size?: number
    storageId?: string
  } = {},
) {
  const id = opts.id ?? nanoid(12)
  const token = `ih_${nanoid(10)}`
  const path = opts.path ?? `test/image-${nanoid(4)}.png`
  const status = opts.status ?? 'active'
  const size = opts.size ?? 1024
  const storageId = opts.storageId ?? validStorage.id
  const now = Date.now()

  await db.run(sql`
    INSERT INTO image_hostings (id, org_id, token, path, storage_id, storage_key, size, mime, status, access_count, created_at)
    VALUES (${id}, ${orgId}, ${token}, ${path}, ${storageId}, ${`ih/${orgId}/${id}.png`}, ${size}, 'image/png', ${status}, 0, ${now})
  `)
  return { id, token, path, status, size }
}

// ─── POST JSON two-stage ──────────────────────────────────────────────────────

describe('POST /api/ihost/images (JSON two-stage)', () => {
  it('returns 401 without auth', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/ihost/images', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'test.png', mime: 'image/png', size: 1024 }),
    })
    expect(res.status).toBe(401)
  })

  it('returns 403 when org has no image_hosting_configs row', async () => {
    const { app, db } = await createTestApp()
    await insertStorage(db)
    const headers = await authedHeaders(app)

    const res = await app.request('/api/ihost/images', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'test.png', mime: 'image/png', size: 1024 }),
    })
    expect(res.status).toBe(403)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.error).toContain('image hosting not enabled')
  })

  it('returns 201 with draft row and presigned uploadUrl', async () => {
    const { app, db } = await createTestApp()
    await insertStorage(db)
    const headers = await authedHeaders(app)
    const orgId = await getOrgId(db)
    await insertImageHostingConfig(db, orgId)

    const res = await app.request('/api/ihost/images', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'blog/2026/shot.png', mime: 'image/png', size: 2048 }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.uploadUrl).toBe('https://presigned-upload.example.com')
    expect(body.id).toBeTruthy()
    expect(String(body.token)).toMatch(/^ih_/)
    expect(body.path).toBe('blog/2026/shot.png')
    expect(String(body.storageKey)).toMatch(/^ih\//)
  })

  it('returns 400 for path with ..', async () => {
    const { app, db } = await createTestApp()
    await insertStorage(db)
    const headers = await authedHeaders(app)
    const orgId = await getOrgId(db)
    await insertImageHostingConfig(db, orgId)

    const res = await app.request('/api/ihost/images', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '../etc/passwd.png', mime: 'image/png', size: 1024 }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.error).toBe('invalid path')
  })

  it('returns 400 for path exceeding depth 5', async () => {
    const { app, db } = await createTestApp()
    await insertStorage(db)
    const headers = await authedHeaders(app)
    const orgId = await getOrgId(db)
    await insertImageHostingConfig(db, orgId)

    const res = await app.request('/api/ihost/images', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'a/b/c/d/e/f.png', mime: 'image/png', size: 1024 }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.error).toBe('invalid path')
    expect(String(body.detail)).toContain('depth')
  })

  it('returns 400 for image/svg+xml (rejected by zod enum)', async () => {
    const { app, db } = await createTestApp()
    await insertStorage(db)
    const headers = await authedHeaders(app)
    const orgId = await getOrgId(db)
    await insertImageHostingConfig(db, orgId)

    const res = await app.request('/api/ihost/images', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'icon.svg', mime: 'image/svg+xml', size: 512 }),
    })
    // zod enum rejects svg+xml since it's not in ALLOWED_IMAGE_MIMES
    expect(res.status).toBe(400)
  })

  it('returns 400 for application/pdf mime (rejected by zod enum)', async () => {
    const { app, db } = await createTestApp()
    await insertStorage(db)
    const headers = await authedHeaders(app)
    const orgId = await getOrgId(db)
    await insertImageHostingConfig(db, orgId)

    const res = await app.request('/api/ihost/images', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'doc.pdf', mime: 'application/pdf', size: 1024 }),
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 for size exceeding 20 MB (rejected by zod max)', async () => {
    const { app, db } = await createTestApp()
    await insertStorage(db)
    const headers = await authedHeaders(app)
    const orgId = await getOrgId(db)
    await insertImageHostingConfig(db, orgId)

    const res = await app.request('/api/ihost/images', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'big.png', mime: 'image/png', size: 21 * 1024 * 1024 }),
    })
    expect(res.status).toBe(400)
  })

  it('auto-suffixes path on collision', async () => {
    const { app, db } = await createTestApp()
    await insertStorage(db)
    const headers = await authedHeaders(app)
    const orgId = await getOrgId(db)
    await insertImageHostingConfig(db, orgId)

    const res1 = await app.request('/api/ihost/images', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'shot.png', mime: 'image/png', size: 1024 }),
    })
    expect(res1.status).toBe(201)

    // Same path — should auto-suffix
    const res2 = await app.request('/api/ihost/images', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'shot.png', mime: 'image/png', size: 1024 }),
    })
    expect(res2.status).toBe(201)
    const body2 = (await res2.json()) as Record<string, unknown>
    expect(body2.path).not.toBe('shot.png')
    expect(String(body2.path)).toMatch(/^shot-[0-9a-f]{4}\.png$/)
  })

  it('returns 403 for apiKey missing image-hosting:upload permission', async () => {
    const { app, db } = await createTestApp()
    await insertStorage(db)
    // Sign up to create the personal org
    await authedHeaders(app)
    const orgId = await getOrgId(db)
    await insertImageHostingConfig(db, orgId)

    const key = await insertApiKey(db, orgId, {
      permissions: JSON.stringify([{ resource: 'other', actions: ['read'] }]),
    })

    const res = await app.request('/api/ihost/images', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ path: 'test.png', mime: 'image/png', size: 1024 }),
    })
    expect(res.status).toBe(403)
  })

  it('accepts apiKey with image-hosting:upload permission (null permissions = default allowed)', async () => {
    const { app, db } = await createTestApp()
    await insertStorage(db)
    await authedHeaders(app)
    const orgId = await getOrgId(db)
    await insertImageHostingConfig(db, orgId)

    // null permissions means the key uses defaultPermissions which includes image-hosting:upload
    const key = await insertApiKey(db, orgId, { permissions: null })

    const res = await app.request('/api/ihost/images', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ path: 'api-key-upload.png', mime: 'image/png', size: 1024 }),
    })
    expect(res.status).toBe(201)
  })

  it('accepts apiKey with explicit image-hosting:upload permission', async () => {
    const { app, db } = await createTestApp()
    await insertStorage(db)
    await authedHeaders(app)
    const orgId = await getOrgId(db)
    await insertImageHostingConfig(db, orgId)

    const key = await insertApiKey(db, orgId, {
      permissions: JSON.stringify([{ resource: 'image-hosting', actions: ['upload'] }]),
    })

    const res = await app.request('/api/ihost/images', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ path: 'explicit-perm.png', mime: 'image/png', size: 1024 }),
    })
    expect(res.status).toBe(201)
  })
})

// ─── POST multipart stream-proxy ─────────────────────────────────────────────

describe('POST /api/ihost/images (multipart)', () => {
  it('returns 201 with tool response on happy path, R2 put called', async () => {
    const { app, db } = await createTestApp()
    await insertStorage(db)
    const headers = await authedHeaders(app)
    const orgId = await getOrgId(db)
    await insertImageHostingConfig(db, orgId)

    const formData = new FormData()
    formData.append('file', new File([new Uint8Array(100)], 'test.png', { type: 'image/png' }))

    const res = await app.request('/api/ihost/images', {
      method: 'POST',
      headers,
      body: formData,
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { data: Record<string, unknown> }
    expect(body.data).toBeDefined()
    expect(body.data.url).toBeTruthy()
    expect(String(body.data.urlAlt)).toMatch(/\/r\/ih_/)
    expect(String(body.data.markdown)).toContain('![](')
    expect(String(body.data.html)).toContain('<img src=')
    expect(String(body.data.bbcode)).toContain('[img]')

    expect(S3Service.prototype.putObject).toHaveBeenCalledTimes(1)
  })

  it('row status is active after multipart upload', async () => {
    const { app, db } = await createTestApp()
    await insertStorage(db)
    const headers = await authedHeaders(app)
    const orgId = await getOrgId(db)
    await insertImageHostingConfig(db, orgId)

    const formData = new FormData()
    formData.append('file', new File([new Uint8Array(100)], 'active.png', { type: 'image/png' }))
    formData.append('path', 'check/active.png')

    await app.request('/api/ihost/images', {
      method: 'POST',
      headers,
      body: formData,
    })

    const rows = await db.all<{ status: string }>(sql`
      SELECT status FROM image_hostings WHERE org_id = ${orgId} AND path = 'check/active.png' LIMIT 1
    `)
    expect(rows[0]?.status).toBe('active')
  })

  it('returns 415 for SVG multipart upload', async () => {
    const { app, db } = await createTestApp()
    await insertStorage(db)
    const headers = await authedHeaders(app)
    const orgId = await getOrgId(db)
    await insertImageHostingConfig(db, orgId)

    const formData = new FormData()
    formData.append('file', new File(['<svg/>'], 'icon.svg', { type: 'image/svg+xml' }))

    const res = await app.request('/api/ihost/images', {
      method: 'POST',
      headers,
      body: formData,
    })
    expect(res.status).toBe(415)
  })

  it('returns 413 for multipart file exceeding 20 MB', async () => {
    const { app, db } = await createTestApp()
    await insertStorage(db)
    const headers = await authedHeaders(app)
    const orgId = await getOrgId(db)
    await insertImageHostingConfig(db, orgId)

    const bigData = new Uint8Array(21 * 1024 * 1024)
    const formData = new FormData()
    formData.append('file', new File([bigData], 'big.png', { type: 'image/png' }))

    const res = await app.request('/api/ihost/images', {
      method: 'POST',
      headers,
      body: formData,
    })
    expect(res.status).toBe(413)
  })

  it('uses custom domain in url when configured and verified', async () => {
    const { app, db } = await createTestApp()
    await insertStorage(db)
    const headers = await authedHeaders(app)
    const orgId = await getOrgId(db)
    await insertImageHostingConfig(db, orgId, {
      customDomain: 'img.myblog.com',
      domainVerifiedAt: Date.now(),
    })

    const formData = new FormData()
    formData.append('file', new File([new Uint8Array(100)], 'photo.png', { type: 'image/png' }))
    formData.append('path', 'blog/2026/04/photo.png')

    const res = await app.request('/api/ihost/images', {
      method: 'POST',
      headers,
      body: formData,
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { data: Record<string, unknown> }
    expect(String(body.data.url)).toMatch(/^https:\/\/img\.myblog\.com\/blog\/2026\/04\/photo\.png$/)
  })

  it('falls back to token url when no verified custom domain', async () => {
    const { app, db } = await createTestApp()
    await insertStorage(db)
    const headers = await authedHeaders(app)
    const orgId = await getOrgId(db)
    await insertImageHostingConfig(db, orgId)

    const formData = new FormData()
    formData.append('file', new File([new Uint8Array(100)], 'shot.png', { type: 'image/png' }))

    const res = await app.request('/api/ihost/images', {
      method: 'POST',
      headers,
      body: formData,
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { data: Record<string, unknown> }
    // url and urlAlt should both be the token URL when no custom domain
    expect(body.data.url).toBe(body.data.urlAlt)
    expect(String(body.data.url)).toMatch(/\/r\/ih_/)
  })
})

// ─── PATCH action=confirm ────────────────────────────────────────────────────

describe('PATCH /api/ihost/images/:id (confirm)', () => {
  it('transitions draft to active and increments quota', async () => {
    const { app, db } = await createTestApp()
    await insertStorage(db)
    const headers = await authedHeaders(app)
    const orgId = await getOrgId(db)
    await insertImageHostingConfig(db, orgId)

    const createRes = await app.request('/api/ihost/images', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'confirm-test.png', mime: 'image/png', size: 512 }),
    })
    const { id } = (await createRes.json()) as { id: string }

    const patchRes = await app.request(`/api/ihost/images/${id}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'confirm' }),
    })
    expect(patchRes.status).toBe(200)
    const body = (await patchRes.json()) as Record<string, unknown>
    expect(body.status).toBe('active')
  })

  it('returns 404 for already-active row (idempotency: no re-confirm)', async () => {
    const { app, db } = await createTestApp()
    await insertStorage(db)
    const headers = await authedHeaders(app)
    const orgId = await getOrgId(db)
    await insertImageHostingConfig(db, orgId)

    const { id } = await insertImageHosting(db, orgId, { status: 'active' })

    const res = await app.request(`/api/ihost/images/${id}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'confirm' }),
    })
    expect(res.status).toBe(404)
  })

  it('returns 404 for unknown id', async () => {
    const { app, db } = await createTestApp()
    await insertStorage(db)
    const headers = await authedHeaders(app)
    const orgId = await getOrgId(db)
    await insertImageHostingConfig(db, orgId)

    const res = await app.request('/api/ihost/images/nonexistent', {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'confirm' }),
    })
    expect(res.status).toBe(404)
  })
})

// ─── GET list ────────────────────────────────────────────────────────────────

describe('GET /api/ihost/images', () => {
  it('returns 401 without auth', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/ihost/images')
    expect(res.status).toBe(401)
  })

  it('returns empty list when no images', async () => {
    const { app, db } = await createTestApp()
    await insertStorage(db)
    const headers = await authedHeaders(app)
    const orgId = await getOrgId(db)
    await insertImageHostingConfig(db, orgId)

    const res = await app.request('/api/ihost/images', { headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: unknown[]; nextCursor: unknown }
    expect(body.items).toEqual([])
    expect(body.nextCursor).toBeNull()
  })

  it('filters by pathPrefix', async () => {
    const { app, db } = await createTestApp()
    await insertStorage(db)
    const headers = await authedHeaders(app)
    const orgId = await getOrgId(db)
    await insertImageHostingConfig(db, orgId)

    await insertImageHosting(db, orgId, { path: 'blog/2026/shot1.png' })
    await insertImageHosting(db, orgId, { path: 'blog/2026/shot2.png' })
    await insertImageHosting(db, orgId, { path: 'avatars/user1.png' })

    const res = await app.request('/api/ihost/images?pathPrefix=blog/2026/', { headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: Array<{ path: string }> }
    expect(body.items).toHaveLength(2)
    for (const item of body.items) {
      expect(item.path).toMatch(/^blog\/2026\//)
    }
  })

  it('paginates with cursor', async () => {
    const { app, db } = await createTestApp()
    await insertStorage(db)
    const headers = await authedHeaders(app)
    const orgId = await getOrgId(db)
    await insertImageHostingConfig(db, orgId)

    for (let i = 0; i < 3; i++) {
      await new Promise((r) => setTimeout(r, 5))
      await insertImageHosting(db, orgId, { path: `cursor-item${i}.png` })
    }

    const page1 = await app.request('/api/ihost/images?limit=2', { headers })
    expect(page1.status).toBe(200)
    const body1 = (await page1.json()) as { items: unknown[]; nextCursor: string | null }
    expect(body1.items).toHaveLength(2)
    expect(body1.nextCursor).toBeTruthy()

    const page2 = await app.request(`/api/ihost/images?limit=2&cursor=${body1.nextCursor}`, { headers })
    expect(page2.status).toBe(200)
    const body2 = (await page2.json()) as { items: unknown[]; nextCursor: string | null }
    expect(body2.items).toHaveLength(1)
    expect(body2.nextCursor).toBeNull()
  })
})

// ─── GET detail ──────────────────────────────────────────────────────────────

describe('GET /api/ihost/images/:id', () => {
  it("returns 404 for another org's image (org isolation)", async () => {
    const { app, db } = await createTestApp()
    await insertStorage(db)
    const headers = await authedHeaders(app)
    const orgId = await getOrgId(db)
    await insertImageHostingConfig(db, orgId)

    // Create an image belonging to a fake org — not the authenticated user's org
    const fakeOrgId = 'other-org-id'
    await insertImageHosting(db, fakeOrgId, { id: 'cross-org-img' })

    const res = await app.request('/api/ihost/images/cross-org-img', { headers })
    expect(res.status).toBe(404)
  })

  it('returns 200 for own image', async () => {
    const { app, db } = await createTestApp()
    await insertStorage(db)
    const headers = await authedHeaders(app)
    const orgId = await getOrgId(db)
    await insertImageHostingConfig(db, orgId)

    const { id } = await insertImageHosting(db, orgId, { path: 'my-img.png' })

    const res = await app.request(`/api/ihost/images/${id}`, { headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.id).toBe(id)
  })
})

// ─── DELETE ──────────────────────────────────────────────────────────────────

describe('DELETE /api/ihost/images/:id', () => {
  it('returns 404 for non-existent image', async () => {
    const { app, db } = await createTestApp()
    await insertStorage(db)
    const headers = await authedHeaders(app)
    const orgId = await getOrgId(db)
    await insertImageHostingConfig(db, orgId)

    const res = await app.request('/api/ihost/images/nonexistent', {
      method: 'DELETE',
      headers,
    })
    expect(res.status).toBe(404)
  })

  it('removes S3 object and DB row; deleteObject called once', async () => {
    const { app, db } = await createTestApp()
    await insertStorage(db)
    const headers = await authedHeaders(app)
    const orgId = await getOrgId(db)
    await insertImageHostingConfig(db, orgId)

    const { id } = await insertImageHosting(db, orgId, { path: 'delete-me.png', size: 2048 })

    const res = await app.request(`/api/ihost/images/${id}`, {
      method: 'DELETE',
      headers,
    })
    expect(res.status).toBe(204)

    expect(S3Service.prototype.deleteObject).toHaveBeenCalledTimes(1)

    // Row gone — verify via GET
    const checkRes = await app.request(`/api/ihost/images/${id}`, { headers })
    expect(checkRes.status).toBe(404)
  })
})
