import { sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { confirmImageHosting, deleteImageHosting } from '../services/image-hosting.js'
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
type TestAuth = Awaited<ReturnType<typeof createTestApp>>['auth']

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
  if (!rows[0]) throw new Error('No personal org found — was authedHeaders called?')
  return rows[0].id
}

async function getUserId(db: TestDb): Promise<string> {
  const rows = await db.all<{ id: string }>(sql`SELECT id FROM user LIMIT 1`)
  if (!rows[0]) throw new Error('No user found — was authedHeaders called?')
  return rows[0].id
}

// Creates an API key via the real better-auth plugin (keys are properly hashed).
// Returns the raw key string that can be used as a Bearer token.
async function createTestApiKey(
  auth: TestAuth,
  orgId: string,
  userId: string,
  permissions?: Record<string, string[]>,
): Promise<string> {
  // biome-ignore lint/suspicious/noExplicitAny: better-auth plugin API not fully typed
  const result = (await (auth.api as any).createApiKey({
    body: {
      organizationId: orgId,
      userId,
      ...(permissions ? { permissions } : {}),
    },
  })) as { key: string }
  return result.key
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

// ─── POST /images — content type handling ────────────────────────────────────

describe('POST /api/ihost/images (content type handling)', () => {
  it('returns 400 for application/json without base64 file field', async () => {
    const { app, db } = await createTestApp()
    await insertStorage(db)
    const headers = await authedHeaders(app)
    const orgId = await getOrgId(db)
    await insertImageHostingConfig(db, orgId)

    const res = await app.request('/api/ihost/images', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'test.png', mime: 'image/png', size: 1024 }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, unknown>
    expect(String(body.error)).toContain('file field')
  })

  it('returns 401 for application/json without any auth', async () => {
    const { app } = await createTestApp()

    const res = await app.request('/api/ihost/images', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: 'abc' }),
    })
    expect(res.status).toBe(401)
  })

  it('returns 415 for text/plain', async () => {
    const { app, db } = await createTestApp()
    await insertStorage(db)
    const headers = await authedHeaders(app)
    const orgId = await getOrgId(db)
    await insertImageHostingConfig(db, orgId)

    const res = await app.request('/api/ihost/images', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'text/plain' },
      body: 'hello',
    })
    expect(res.status).toBe(415)
  })

  it('accepts base64 PNG via application/json (uPic upload)', async () => {
    const { app, db } = await createTestApp()
    await insertStorage(db)
    const headers = await authedHeaders(app)
    const orgId = await getOrgId(db)
    await insertImageHostingConfig(db, orgId)

    // Minimal 1x1 white PNG as base64
    const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=='

    const res = await app.request('/api/ihost/images', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: pngBase64 }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as Record<string, unknown>
    const data = body.data as Record<string, unknown>
    expect(data.url).toBeDefined()
  })

  it('returns 400 for invalid base64 in JSON', async () => {
    const { app, db } = await createTestApp()
    await insertStorage(db)
    const headers = await authedHeaders(app)
    const orgId = await getOrgId(db)
    await insertImageHostingConfig(db, orgId)

    const res = await app.request('/api/ihost/images', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: '!!!not-base64!!!' }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, unknown>
    expect(String(body.error)).toContain('base64')
  })
})

// ─── POST /images/presign (JSON two-stage) ────────────────────────────────────

describe('POST /api/ihost/images/presign (JSON two-stage)', () => {
  it('returns 401 without auth', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/ihost/images/presign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'test.png', mime: 'image/png', size: 1024 }),
    })
    expect(res.status).toBe(401)
  })

  it('returns 401 for API key (presign requires session auth)', async () => {
    const { app, db, auth } = await createTestApp()
    await insertStorage(db)
    await authedHeaders(app)
    const orgId = await getOrgId(db)
    const userId = await getUserId(db)
    await insertImageHostingConfig(db, orgId)

    const key = await createTestApiKey(auth, orgId, userId)
    const res = await app.request('/api/ihost/images/presign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ path: 'test.png', mime: 'image/png', size: 1024 }),
    })
    expect(res.status).toBe(401)
  })

  it('returns 403 when org has no image_hosting_configs row', async () => {
    const { app, db } = await createTestApp()
    await insertStorage(db)
    const headers = await authedHeaders(app)

    const res = await app.request('/api/ihost/images/presign', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'test.png', mime: 'image/png', size: 1024 }),
    })
    expect(res.status).toBe(403)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.error).toContain('image hosting not enabled')
  })

  it('returns 503 when no storage is configured', async () => {
    // Do NOT insertStorage — selectStorage will throw → 503
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    const orgId = await getOrgId(db)
    await insertImageHostingConfig(db, orgId)

    const res = await app.request('/api/ihost/images/presign', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'test.png', mime: 'image/png', size: 1024 }),
    })
    expect(res.status).toBe(503)
    const body = (await res.json()) as Record<string, unknown>
    expect(String(body.error)).toContain('storage')
  })

  it('returns 201 with draft row and presigned uploadUrl', async () => {
    const { app, db } = await createTestApp()
    await insertStorage(db)
    const headers = await authedHeaders(app)
    const orgId = await getOrgId(db)
    await insertImageHostingConfig(db, orgId)

    const res = await app.request('/api/ihost/images/presign', {
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

    const res = await app.request('/api/ihost/images/presign', {
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

    const res = await app.request('/api/ihost/images/presign', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'a/b/c/d/e/f.png', mime: 'image/png', size: 1024 }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.error).toBe('invalid path')
    expect(String(body.detail)).toContain('depth')
  })

  it('returns 400 for disallowed mime (image/svg+xml)', async () => {
    // zValidator rejects disallowed mimes with 400 (Zod enum check)
    const { app, db } = await createTestApp()
    await insertStorage(db)
    const headers = await authedHeaders(app)
    const orgId = await getOrgId(db)
    await insertImageHostingConfig(db, orgId)

    const res = await app.request('/api/ihost/images/presign', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'icon.svg', mime: 'image/svg+xml', size: 512 }),
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 for disallowed mime (application/pdf)', async () => {
    // zValidator rejects disallowed mimes with 400 (Zod enum check)
    const { app, db } = await createTestApp()
    await insertStorage(db)
    const headers = await authedHeaders(app)
    const orgId = await getOrgId(db)
    await insertImageHostingConfig(db, orgId)

    const res = await app.request('/api/ihost/images/presign', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'doc.pdf', mime: 'application/pdf', size: 1024 }),
    })
    expect(res.status).toBe(400)
  })

  it('returns 413 for size exceeding 20 MB', async () => {
    const { app, db } = await createTestApp()
    await insertStorage(db)
    const headers = await authedHeaders(app)
    const orgId = await getOrgId(db)
    await insertImageHostingConfig(db, orgId)

    const res = await app.request('/api/ihost/images/presign', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'big.png', mime: 'image/png', size: 21 * 1024 * 1024 }),
    })
    expect(res.status).toBe(413)
  })

  it('auto-suffixes path on collision', async () => {
    const { app, db } = await createTestApp()
    await insertStorage(db)
    const headers = await authedHeaders(app)
    const orgId = await getOrgId(db)
    await insertImageHostingConfig(db, orgId)

    const res1 = await app.request('/api/ihost/images/presign', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'shot.png', mime: 'image/png', size: 1024 }),
    })
    expect(res1.status).toBe(201)

    // Same path — should auto-suffix
    const res2 = await app.request('/api/ihost/images/presign', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'shot.png', mime: 'image/png', size: 1024 }),
    })
    expect(res2.status).toBe(201)
    const body2 = (await res2.json()) as Record<string, unknown>
    expect(body2.path).not.toBe('shot.png')
    expect(String(body2.path)).toMatch(/^shot-[0-9a-f]{4}\.png$/)
  })

  it('returns 400 for JSON body missing required fields (zod failure)', async () => {
    const { app, db } = await createTestApp()
    await insertStorage(db)
    const headers = await authedHeaders(app)
    const orgId = await getOrgId(db)
    await insertImageHostingConfig(db, orgId)

    const res = await app.request('/api/ihost/images/presign', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mime: 'image/png' }), // missing path and size
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 for path containing //', async () => {
    const { app, db } = await createTestApp()
    await insertStorage(db)
    const headers = await authedHeaders(app)
    const orgId = await getOrgId(db)
    await insertImageHostingConfig(db, orgId)

    const res = await app.request('/api/ihost/images/presign', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'a//b.png', mime: 'image/png', size: 1024 }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.error).toBe('invalid path')
    expect(String(body.detail)).toContain('//')
  })

  it('returns 400 for path starting with / (multipart)', async () => {
    const { app, db } = await createTestApp()
    await insertStorage(db)
    const headers = await authedHeaders(app)
    const orgId = await getOrgId(db)
    await insertImageHostingConfig(db, orgId)

    const formData = new FormData()
    formData.append('file', new File([new Uint8Array(50)], 'test.png', { type: 'image/png' }))
    formData.append('path', '/absolute/path.png') // starts with /

    const res = await app.request('/api/ihost/images', {
      method: 'POST',
      headers,
      body: formData,
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.error).toBe('invalid path')
    expect(String(body.detail)).toContain('must not start with /')
  })

  it('returns 400 for path ending with / (multipart)', async () => {
    const { app, db } = await createTestApp()
    await insertStorage(db)
    const headers = await authedHeaders(app)
    const orgId = await getOrgId(db)
    await insertImageHostingConfig(db, orgId)

    const formData = new FormData()
    formData.append('file', new File([new Uint8Array(50)], 'test.png', { type: 'image/png' }))
    formData.append('path', 'folder/') // ends with /

    const res = await app.request('/api/ihost/images', {
      method: 'POST',
      headers,
      body: formData,
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.error).toBe('invalid path')
    expect(String(body.detail)).toContain('must not end with /')
  })

  it('returns 400 for path with invalid characters (multipart)', async () => {
    const { app, db } = await createTestApp()
    await insertStorage(db)
    const headers = await authedHeaders(app)
    const orgId = await getOrgId(db)
    await insertImageHostingConfig(db, orgId)

    const formData = new FormData()
    formData.append('file', new File([new Uint8Array(50)], 'test.png', { type: 'image/png' }))
    formData.append('path', 'images/$bad.png') // $ not in [a-zA-Z0-9._/-]

    const res = await app.request('/api/ihost/images', {
      method: 'POST',
      headers,
      body: formData,
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.error).toBe('invalid path')
    expect(String(body.detail)).toContain('invalid characters')
  })

  it('derives default path from blob filename (uses nanoid fallback)', async () => {
    const { app, db } = await createTestApp()
    await insertStorage(db)
    const headers = await authedHeaders(app)
    const orgId = await getOrgId(db)
    await insertImageHostingConfig(db, orgId)

    const formData = new FormData()
    // Filename 'blob' triggers deriveDefaultPath's nanoid fallback
    formData.append('file', new File([new Uint8Array(50)], 'blob', { type: 'image/png' }))

    const res = await app.request('/api/ihost/images', {
      method: 'POST',
      headers,
      body: formData,
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { data: { url: string } }
    expect(body.data.url).toBeTruthy()
  })

  it('returns 400 for path exceeding 256 characters (multipart, bypasses zod)', async () => {
    // presign path is guarded by zod max(256), so use multipart to reach validatePath length check
    const { app, db } = await createTestApp()
    await insertStorage(db)
    const headers = await authedHeaders(app)
    const orgId = await getOrgId(db)
    await insertImageHostingConfig(db, orgId)

    const veryLongPath = `${'a'.repeat(253)}.png` // 257 chars — exceeds MAX_PATH_LENGTH (256)
    const formData = new FormData()
    formData.append('file', new File([new Uint8Array(50)], 'test.png', { type: 'image/png' }))
    formData.append('path', veryLongPath)

    const res = await app.request('/api/ihost/images', {
      method: 'POST',
      headers,
      body: formData,
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.error).toBe('invalid path')
    expect(String(body.detail)).toContain('exceeds')
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

  it('returns 413 from Content-Length header before parsing body', async () => {
    // Sends explicit Content-Length > MAX_IMAGE_SIZE with a tiny body — triggers
    // the header-based early reject (before formData.get('file') is called)
    const { app, db } = await createTestApp()
    await insertStorage(db)
    const headers = await authedHeaders(app)
    const orgId = await getOrgId(db)
    await insertImageHostingConfig(db, orgId)

    const boundary = '----FormBoundary'
    const bodyText = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="x.png"\r\nContent-Type: image/png\r\n\r\nXX\r\n--${boundary}--`

    const res = await app.request('/api/ihost/images', {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': String(21 * 1024 * 1024), // claim oversized
      },
      body: bodyText,
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

  it('cleans up DB row and refunds quota when S3 put fails', async () => {
    const { app, db } = await createTestApp()
    await insertStorage(db)
    const headers = await authedHeaders(app)
    const orgId = await getOrgId(db)
    await insertImageHostingConfig(db, orgId)

    vi.spyOn(S3Service.prototype, 'putObject').mockRejectedValueOnce(new Error('S3 failure'))

    const formData = new FormData()
    formData.append('file', new File([new Uint8Array(100)], 'fail.png', { type: 'image/png' }))
    formData.append('path', 'fail/upload.png')

    // Hono catches the thrown error and returns 500
    const res = await app.request('/api/ihost/images', {
      method: 'POST',
      headers,
      body: formData,
    })
    expect(res.status).toBe(500)

    // Row should NOT exist in DB after cleanup
    const rows = await db.all<{ id: string }>(sql`
      SELECT id FROM image_hostings WHERE org_id = ${orgId} AND path = 'fail/upload.png' LIMIT 1
    `)
    expect(rows).toHaveLength(0)

    // Quota should be refunded — used must be back to 0
    const quota = await db.all<{ used: number }>(sql`
      SELECT used FROM org_quotas WHERE org_id = ${orgId} LIMIT 1
    `)
    expect(quota[0]?.used).toBe(0)
  })

  it('accepts apiKey with default permissions for multipart upload', async () => {
    const { app, db, auth } = await createTestApp()
    await insertStorage(db)
    await authedHeaders(app)
    const orgId = await getOrgId(db)
    const userId = await getUserId(db)
    await insertImageHostingConfig(db, orgId)

    const key = await createTestApiKey(auth, orgId, userId)

    const formData = new FormData()
    formData.append('file', new File([new Uint8Array(100)], 'apikey.png', { type: 'image/png' }))

    const res = await app.request('/api/ihost/images', {
      method: 'POST',
      body: formData,
      headers: { Authorization: `Bearer ${key}` },
    })
    expect(res.status).toBe(201)
  })

  it('returns 415 for non-image MIME (application/pdf) in multipart', async () => {
    const { app, db } = await createTestApp()
    await insertStorage(db)
    const headers = await authedHeaders(app)
    const orgId = await getOrgId(db)
    await insertImageHostingConfig(db, orgId)

    const formData = new FormData()
    formData.append('file', new File([new Uint8Array(100)], 'doc.pdf', { type: 'application/pdf' }))

    const res = await app.request('/api/ihost/images', {
      method: 'POST',
      headers,
      body: formData,
    })
    expect(res.status).toBe(415)
    const body = (await res.json()) as Record<string, unknown>
    expect(String(body.error)).toContain('Unsupported')
  })

  it('infers MIME from file extension when type is application/octet-stream', async () => {
    const { app, db } = await createTestApp()
    await insertStorage(db)
    const headers = await authedHeaders(app)
    const orgId = await getOrgId(db)
    await insertImageHostingConfig(db, orgId)

    const formData = new FormData()
    // Simulate uPic/PicGo sending a .png file with octet-stream MIME
    formData.append('file', new File([new Uint8Array(100)], 'test.png', { type: 'application/octet-stream' }))

    const res = await app.request('/api/ihost/images', {
      method: 'POST',
      headers,
      body: formData,
    })
    // Should NOT be 415 — MIME inferred as image/png from .png extension
    // Will be 500 (no real S3) or success, but definitely not 415
    expect(res.status).not.toBe(415)
  })

  it('infers MIME from file extension when type is empty', async () => {
    const { app, db } = await createTestApp()
    await insertStorage(db)
    const headers = await authedHeaders(app)
    const orgId = await getOrgId(db)
    await insertImageHostingConfig(db, orgId)

    const formData = new FormData()
    formData.append('file', new File([new Uint8Array(100)], 'photo.jpg', { type: '' }))

    const res = await app.request('/api/ihost/images', {
      method: 'POST',
      headers,
      body: formData,
    })
    expect(res.status).not.toBe(415)
  })

  it('returns 400 when file field is missing in multipart', async () => {
    const { app, db } = await createTestApp()
    await insertStorage(db)
    const headers = await authedHeaders(app)
    const orgId = await getOrgId(db)
    await insertImageHostingConfig(db, orgId)

    const formData = new FormData()
    formData.append('other', 'value') // no 'file' field

    const res = await app.request('/api/ihost/images', {
      method: 'POST',
      headers,
      body: formData,
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, unknown>
    expect(String(body.error)).toContain('file field')
  })

  it('returns 422 when quota is exceeded on multipart upload', async () => {
    const { app, db } = await createTestApp()
    await insertStorage(db)
    const headers = await authedHeaders(app)
    const orgId = await getOrgId(db)
    await insertImageHostingConfig(db, orgId)

    // Set quota to 50 bytes so a 100-byte upload exceeds it
    await db.run(sql`UPDATE org_quotas SET quota = 50 WHERE org_id = ${orgId}`)

    const formData = new FormData()
    formData.append('file', new File([new Uint8Array(100)], 'big.png', { type: 'image/png' }))

    const res = await app.request('/api/ihost/images', {
      method: 'POST',
      headers,
      body: formData,
    })
    expect(res.status).toBe(422)
    const body = (await res.json()) as Record<string, unknown>
    expect(String(body.error)).toContain('Quota')
  })

  it('uses nanoid fallback path after exhausting collision retries', async () => {
    const { app, db } = await createTestApp()
    await insertStorage(db)
    const headers = await authedHeaders(app)
    const orgId = await getOrgId(db)
    await insertImageHostingConfig(db, orgId)

    // Mock Math.random so randomHex4() always returns '8000'
    vi.spyOn(Math, 'random').mockReturnValue(0.5)

    // Seed original + the single retry candidate so all 5 retries collide
    await insertImageHosting(db, orgId, { path: 'retry.png' })
    await insertImageHosting(db, orgId, { path: 'retry-8000.png' })

    const res = await app.request('/api/ihost/images', {
      method: 'POST',
      headers,
      body: (() => {
        const fd = new FormData()
        fd.append('file', new File([new Uint8Array(50)], 'retry.png', { type: 'image/png' }))
        fd.append('path', 'retry.png')
        return fd
      })(),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { data: { url: string } }
    // The resolved path is not in the response for multipart — just verify success
    expect(body.data.url).toBeTruthy()
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

    const createRes = await app.request('/api/ihost/images/presign', {
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

  it('returns 422 when org quota is exceeded on confirm', async () => {
    const { app, db } = await createTestApp()
    await insertStorage(db)
    const headers = await authedHeaders(app)
    const orgId = await getOrgId(db)
    await insertImageHostingConfig(db, orgId)

    // Sign-up creates an org_quotas row with the default quota.
    // Lower it to 50 bytes so a 100-byte image exceeds it.
    await db.run(sql`UPDATE org_quotas SET quota = 50 WHERE org_id = ${orgId}`)

    const createRes = await app.request('/api/ihost/images/presign', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'quota-test.png', mime: 'image/png', size: 100 }),
    })
    expect(createRes.status).toBe(201)
    const { id } = (await createRes.json()) as { id: string }

    // Confirm should fail — size (100) > quota (50)
    const patchRes = await app.request(`/api/ihost/images/${id}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'confirm' }),
    })
    expect(patchRes.status).toBe(422)
    const body = (await patchRes.json()) as Record<string, unknown>
    expect(String(body.error)).toContain('Quota')
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

  it('excludes draft images from listing', async () => {
    const { app, db } = await createTestApp()
    await insertStorage(db)
    const headers = await authedHeaders(app)
    const orgId = await getOrgId(db)
    await insertImageHostingConfig(db, orgId)

    await insertImageHosting(db, orgId, { path: 'active.png', status: 'active' })
    await insertImageHosting(db, orgId, { path: 'draft.png', status: 'draft' })

    const res = await app.request('/api/ihost/images', { headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: Array<{ path: string }> }
    expect(body.items).toHaveLength(1)
    expect(body.items[0].path).toBe('active.png')
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

    // Create a second org (FK constraint requires org to exist) and insert an
    // image for it — the authenticated user should NOT see it.
    const otherOrgId = `other-org-${nanoid(6)}`
    const now = Date.now()
    await db.run(sql`
      INSERT INTO organization (id, name, slug, created_at)
      VALUES (${otherOrgId}, 'Other Org', ${`slug-${otherOrgId}`}, ${now})
    `)
    await insertImageHosting(db, otherOrgId, { id: 'cross-org-img' })

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
  it('returns 403 when image hosting is not configured', async () => {
    const { app, db } = await createTestApp()
    await insertStorage(db)
    const headers = await authedHeaders(app)
    // Do NOT call insertImageHostingConfig — config row will be absent

    const res = await app.request('/api/ihost/images/fake-id', {
      method: 'DELETE',
      headers,
    })
    expect(res.status).toBe(403)
    const body = (await res.json()) as Record<string, unknown>
    expect(String(body.error)).toContain('image hosting not enabled')
  })

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

  it('still deletes DB row when storage record is missing (S3 delete skipped)', async () => {
    const { app, db } = await createTestApp()
    await insertStorage(db)
    const headers = await authedHeaders(app)
    const orgId = await getOrgId(db)
    await insertImageHostingConfig(db, orgId)

    // Insert image referencing a storage id that will be deleted
    const { id } = await insertImageHosting(db, orgId, { path: 'orphan.png', size: 512 })

    // Remove the storage row so getStorage returns null
    await db.run(sql`DELETE FROM storages WHERE id = ${validStorage.id}`)

    const res = await app.request(`/api/ihost/images/${id}`, {
      method: 'DELETE',
      headers,
    })
    expect(res.status).toBe(204)

    // S3 deleteObject should NOT have been called (storage was null)
    expect(S3Service.prototype.deleteObject).not.toHaveBeenCalled()

    // DB row must be gone
    const checkRes = await app.request(`/api/ihost/images/${id}`, { headers })
    expect(checkRes.status).toBe(404)
  })
})

// ─── POST /api/ihost/images — API key auth error paths ───────────────────────

describe('POST /api/ihost/images — API key auth error paths', () => {
  it('returns 401 when API key verification returns valid: false', async () => {
    const { app, db, auth } = await createTestApp()
    await insertStorage(db)
    await authedHeaders(app)
    const orgId = await getOrgId(db)
    const userId = await getUserId(db)
    await insertImageHostingConfig(db, orgId)

    // Create a valid key then mock verifyApiKey to return valid: false
    const key = await createTestApiKey(auth, orgId, userId)
    // biome-ignore lint/suspicious/noExplicitAny: mocking better-auth plugin
    vi.spyOn(auth.api as any, 'verifyApiKey').mockResolvedValueOnce({
      valid: false,
      error: { message: 'Insufficient permissions', code: 'INSUFFICIENT_PERMISSIONS' },
      key: null,
    })

    const formData = new FormData()
    formData.append('file', new File([new Uint8Array(100)], 'test.png', { type: 'image/png' }))

    const res = await app.request('/api/ihost/images', {
      method: 'POST',
      body: formData,
      headers: { Authorization: `Bearer ${key}` },
    })
    expect(res.status).toBe(401)
    const body = (await res.json()) as Record<string, unknown>
    expect(String(body.error)).toContain('Insufficient permissions')
  })

  it('returns 401 when API key verification throws an exception', async () => {
    const { app, db, auth } = await createTestApp()
    await insertStorage(db)
    await authedHeaders(app)
    const orgId = await getOrgId(db)
    const userId = await getUserId(db)
    await insertImageHostingConfig(db, orgId)

    const key = await createTestApiKey(auth, orgId, userId)
    // biome-ignore lint/suspicious/noExplicitAny: mocking better-auth plugin
    vi.spyOn(auth.api as any, 'verifyApiKey').mockRejectedValueOnce(new Error('auth service unavailable'))

    const formData = new FormData()
    formData.append('file', new File([new Uint8Array(100)], 'test.png', { type: 'image/png' }))

    const res = await app.request('/api/ihost/images', {
      method: 'POST',
      body: formData,
      headers: { Authorization: `Bearer ${key}` },
    })
    expect(res.status).toBe(401)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.error).toBe('Invalid API key')
  })

  it('returns 503 when no storage is configured for multipart upload via API key', async () => {
    // Do NOT insertStorage — selectStorage will throw → 503
    const { app, db, auth } = await createTestApp()
    await authedHeaders(app)
    const orgId = await getOrgId(db)
    const userId = await getUserId(db)
    await insertImageHostingConfig(db, orgId)

    const key = await createTestApiKey(auth, orgId, userId)

    const formData = new FormData()
    formData.append('file', new File([new Uint8Array(100)], 'test.png', { type: 'image/png' }))

    const res = await app.request('/api/ihost/images', {
      method: 'POST',
      body: formData,
      headers: { Authorization: `Bearer ${key}` },
    })
    expect(res.status).toBe(503)
    const body = (await res.json()) as Record<string, unknown>
    expect(String(body.error)).toContain('storage')
  })
})

// ─── Service unit tests (direct calls) ───────────────────────────────────────

describe('image-hosting service — direct calls', () => {
  it('deleteImageHosting returns null for nonexistent image', async () => {
    const { db } = await createTestApp()
    const result = await deleteImageHosting(db, 'no-such-id', 'no-such-org')
    expect(result).toBeNull()
  })

  it('confirmImageHosting with size=0 skips quota and confirms successfully', async () => {
    const { db } = await createTestApp()
    const orgId = `org-sz0-${nanoid(6)}`
    const now = Date.now()
    await db.run(
      sql`INSERT INTO organization (id, name, slug, created_at) VALUES (${orgId}, 'T', ${`slug-${orgId}`}, ${now})`,
    )

    const id = nanoid(12)
    const token = `ih_${nanoid(10)}`
    await db.run(sql`
      INSERT INTO image_hostings (id, org_id, token, path, storage_id, storage_key, size, mime, status, access_count, created_at)
      VALUES (${id}, ${orgId}, ${token}, 'sz0.png', 'st1', 'ih/x/y.png', 0, 'image/png', 'draft', 0, ${now})
    `)

    const result = await confirmImageHosting(db, id, orgId)
    expect(result.row).toBeTruthy()
    expect(result.row?.status).toBe('active')
  })
})
