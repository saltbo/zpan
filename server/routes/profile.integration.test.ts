import { sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildBreadcrumb } from '../services/profile.js'
import { S3Service } from '../services/s3.js'
import { authedHeaders, createTestApp } from '../test/setup.js'

async function insertUser(
  db: Awaited<ReturnType<typeof createTestApp>>['db'],
  opts: { id: string; username: string; email: string },
) {
  const now = Date.now()
  await db.run(sql`
    INSERT INTO user (id, name, email, email_verified, username, created_at, updated_at)
    VALUES (${opts.id}, 'Test User', ${opts.email}, 1, ${opts.username}, ${now}, ${now})
  `)
  await db.run(sql`
    INSERT INTO organization (id, name, slug, created_at)
    VALUES (${`org-${opts.id}`}, 'Personal', ${`personal-${opts.id}`}, ${now})
  `)
  await db.run(sql`
    INSERT INTO member (id, organization_id, user_id, role, created_at)
    VALUES (${`member-${opts.id}`}, ${`org-${opts.id}`}, ${opts.id}, 'owner', ${now})
  `)
  return { orgId: `org-${opts.id}` }
}

async function insertStorage(db: Awaited<ReturnType<typeof createTestApp>>['db']) {
  const now = Date.now()
  await db.run(sql`
    INSERT INTO storages (id, title, mode, bucket, endpoint, region, access_key, secret_key, file_path, custom_host, capacity, used, status, created_at, updated_at)
    VALUES ('st-1', 'Test S3', 'public', 'test-bucket', 'https://s3.amazonaws.com', 'us-east-1', 'AKID', 'secret', '', '', 0, 0, 'active', ${now}, ${now})
  `)
}

describe('GET /api/profiles/:username', () => {
  it('returns 404 when user does not exist', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/profiles/nonexistent')
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body).toEqual({ error: 'User not found' })
  })

  it('returns user info and empty shares', async () => {
    const { app, db } = await createTestApp()
    await insertUser(db, { id: 'user-1', username: 'testuser', email: 'test@example.com' })

    const res = await app.request('/api/profiles/testuser')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { user: { username: string }; shares: unknown[] }
    expect(body.user.username).toBe('testuser')
    expect(body.shares).toEqual([])
  })

  it('works without authentication', async () => {
    const { app, db } = await createTestApp()
    await insertUser(db, { id: 'user-1', username: 'testuser', email: 'test@example.com' })

    const res = await app.request('/api/profiles/testuser')
    expect(res.status).toBe(200)
  })

  it('returns user info when user exists but has no personal org', async () => {
    const { app, db } = await createTestApp()
    const now = Date.now()
    await db.run(sql`
      INSERT INTO user (id, name, email, email_verified, username, created_at, updated_at)
      VALUES ('user-2', 'Orphan User', 'orphan@example.com', 1, 'orphanuser', ${now}, ${now})
    `)

    const res = await app.request('/api/profiles/orphanuser')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { user: { username: string }; shares: unknown[] }
    expect(body.user.username).toBe('orphanuser')
    expect(body.shares).toEqual([])
  })
})

describe('GET /api/profiles/:username/browse', () => {
  it('returns 404 for unknown username', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/profiles/nonexistent/browse')
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body).toEqual({ error: 'User not found' })
  })

  it('returns empty items and breadcrumb for known user', async () => {
    const { app, db } = await createTestApp()
    await insertUser(db, { id: 'user-1', username: 'testuser', email: 'test@example.com' })

    const res = await app.request('/api/profiles/testuser/browse')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: unknown[]; breadcrumb: string[] }
    expect(body.items).toEqual([])
    expect(body.breadcrumb).toEqual([])
  })
})

describe('buildBreadcrumb', () => {
  it('returns empty array for empty string', () => {
    expect(buildBreadcrumb('')).toEqual([])
  })

  it('returns single segment for a simple name', () => {
    expect(buildBreadcrumb('photos')).toEqual(['photos'])
  })

  it('splits nested path into segments', () => {
    expect(buildBreadcrumb('a/b/c')).toEqual(['a', 'b', 'c'])
  })

  it('returns two segments for one-level-deep path', () => {
    expect(buildBreadcrumb('Parent/Child')).toEqual(['Parent', 'Child'])
  })
})

describe('POST /api/profile/avatar', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(S3Service.prototype, 'presignUpload').mockResolvedValue('https://presigned.example.com/upload')
  })

  it('returns 401 when not authenticated', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/profile/avatar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mime: 'image/png', size: 1024 }),
    })
    expect(res.status).toBe(401)
  })

  it('returns 400 when mime type is not allowed (gif is not accepted)', async () => {
    const { app, db } = await createTestApp()
    await insertStorage(db)
    const headers = await authedHeaders(app)

    const res = await app.request('/api/profile/avatar', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mime: 'image/gif', size: 1024 }),
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 when size exceeds 2 MiB', async () => {
    const { app, db } = await createTestApp()
    await insertStorage(db)
    const headers = await authedHeaders(app)

    const res = await app.request('/api/profile/avatar', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mime: 'image/png', size: 3 * 1024 * 1024 }),
    })
    // Schema validation (zValidator) rejects sizes > MAX_AVATAR_SIZE with 400
    expect(res.status).toBe(400)
  })

  it('returns 503 when no public storage is configured', async () => {
    const { app } = await createTestApp()
    const headers = await authedHeaders(app)

    const res = await app.request('/api/profile/avatar', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mime: 'image/png', size: 1024 }),
    })
    expect(res.status).toBe(503)
  })

  it('returns uploadUrl and key for valid png request', async () => {
    const { app, db } = await createTestApp()
    await insertStorage(db)
    const headers = await authedHeaders(app)

    const res = await app.request('/api/profile/avatar', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mime: 'image/png', size: 1024 }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { uploadUrl: string; key: string }
    expect(body.uploadUrl).toBe('https://presigned.example.com/upload')
    expect(body.key).toMatch(/^_system\/avatars\/.+\.png$/)
  })

  it('returns key with jpg extension for jpeg mime', async () => {
    const { app, db } = await createTestApp()
    await insertStorage(db)
    const headers = await authedHeaders(app)

    const res = await app.request('/api/profile/avatar', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mime: 'image/jpeg', size: 2048 }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { uploadUrl: string; key: string }
    expect(body.key).toMatch(/\.jpg$/)
  })
})

describe('POST /api/profile/avatar/commit', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(S3Service.prototype, 'headObject').mockResolvedValue({ size: 1024, contentType: 'image/png' })
  })

  it('returns 401 when not authenticated', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/profile/avatar/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mime: 'image/png' }),
    })
    expect(res.status).toBe(401)
  })

  it('returns 400 when avatar object does not exist in S3', async () => {
    vi.restoreAllMocks()
    vi.spyOn(S3Service.prototype, 'headObject').mockRejectedValue(new Error('Not Found'))

    const { app, db } = await createTestApp()
    await insertStorage(db)
    const headers = await authedHeaders(app)

    const res = await app.request('/api/profile/avatar/commit', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mime: 'image/png' }),
    })
    expect(res.status).toBe(400)
  })

  it('persists user.image and returns image URL', async () => {
    const { app, db } = await createTestApp()
    await insertStorage(db)
    const headers = await authedHeaders(app)

    const res = await app.request('/api/profile/avatar/commit', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mime: 'image/jpeg' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { image: string }
    expect(body.image).toContain('_system/avatars/')
    expect(body.image).toContain('.jpg')

    const rows = await db.all<{ image: string | null }>(sql`SELECT image FROM user LIMIT 1`)
    expect(rows[0]?.image).toBe(body.image)
  })
})

describe('DELETE /api/profile/avatar', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(S3Service.prototype, 'headObject').mockResolvedValue({ size: 1024, contentType: 'image/png' })
    vi.spyOn(S3Service.prototype, 'deleteObject').mockResolvedValue(undefined)
  })

  it('returns 401 when not authenticated', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/profile/avatar', { method: 'DELETE' })
    expect(res.status).toBe(401)
  })

  it('clears user.image and removes S3 object', async () => {
    const { app, db } = await createTestApp()
    await insertStorage(db)
    const headers = await authedHeaders(app)

    await db.run(sql`UPDATE user SET image = 'https://example.com/avatar.png'`)

    const res = await app.request('/api/profile/avatar', {
      method: 'DELETE',
      headers,
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean }
    expect(body.ok).toBe(true)

    const rows = await db.all<{ image: string | null }>(sql`SELECT image FROM user LIMIT 1`)
    expect(rows[0]?.image).toBeNull()
    expect(S3Service.prototype.deleteObject).toHaveBeenCalled()
  })

  it('succeeds even when S3 object does not exist', async () => {
    vi.restoreAllMocks()
    vi.spyOn(S3Service.prototype, 'headObject').mockRejectedValue(new Error('Not Found'))

    const { app, db } = await createTestApp()
    await insertStorage(db)
    const headers = await authedHeaders(app)

    const res = await app.request('/api/profile/avatar', {
      method: 'DELETE',
      headers,
    })
    expect(res.status).toBe(200)
  })
})
