import { sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { S3Service } from '../services/s3.js'
import { authedHeaders, createTestApp } from '../test/setup.js'

type TestDb = Awaited<ReturnType<typeof createTestApp>>['db']

async function insertPublicStorage(db: TestDb) {
  const now = Date.now()
  await db.run(sql`
    INSERT INTO storages (id, title, mode, bucket, endpoint, region, access_key, secret_key, file_path, custom_host, capacity, used, status, created_at, updated_at)
    VALUES ('st-me', 'Public', 'public', 'test-bucket', 'https://s3.amazonaws.com', 'us-east-1', 'AKID', 'secret', '', '', 0, 0, 'active', ${now}, ${now})
  `)
}

function makeFile(type: string, bytes = 16): File {
  return new File([new Uint8Array(bytes)], `f.${type.split('/')[1]}`, { type })
}

describe('PUT /api/me/avatar', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(S3Service.prototype, 'putObject').mockResolvedValue(undefined)
  })

  it('returns 401 without auth', async () => {
    const { app } = await createTestApp()
    const form = new FormData()
    form.set('file', makeFile('image/png'))
    const res = await app.request('/api/me/avatar', { method: 'PUT', body: form })
    expect(res.status).toBe(401)
  })

  it('returns 415 when Content-Type is not multipart', async () => {
    const { app } = await createTestApp()
    const headers = await authedHeaders(app)
    const res = await app.request('/api/me/avatar', {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ nope: true }),
    })
    expect(res.status).toBe(415)
  })

  it('returns 400 when file field is missing', async () => {
    const { app } = await createTestApp()
    const headers = await authedHeaders(app)
    const form = new FormData()
    form.set('notFile', 'x')
    const res = await app.request('/api/me/avatar', { method: 'PUT', headers, body: form })
    expect(res.status).toBe(400)
  })

  it('returns 400 when mime is not PNG/JPG/WebP', async () => {
    const { app, db } = await createTestApp()
    await insertPublicStorage(db)
    const headers = await authedHeaders(app)
    const form = new FormData()
    form.set('file', makeFile('image/gif'))
    const res = await app.request('/api/me/avatar', { method: 'PUT', headers, body: form })
    expect(res.status).toBe(400)
  })

  it('returns 413 when file exceeds 2 MiB', async () => {
    const { app, db } = await createTestApp()
    await insertPublicStorage(db)
    const headers = await authedHeaders(app)
    const form = new FormData()
    form.set('file', makeFile('image/png', 3 * 1024 * 1024))
    const res = await app.request('/api/me/avatar', { method: 'PUT', headers, body: form })
    expect(res.status).toBe(413)
  })

  it('returns 503 when no public storage is configured', async () => {
    const { app } = await createTestApp()
    const headers = await authedHeaders(app)
    const form = new FormData()
    form.set('file', makeFile('image/png'))
    const res = await app.request('/api/me/avatar', { method: 'PUT', headers, body: form })
    expect(res.status).toBe(503)
  })

  it('uploads the file to S3, writes user.image, returns the URL', async () => {
    const { app, db } = await createTestApp()
    await insertPublicStorage(db)
    const headers = await authedHeaders(app)
    const form = new FormData()
    form.set('file', makeFile('image/webp'))

    const res = await app.request('/api/me/avatar', { method: 'PUT', headers, body: form })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { url: string }
    expect(body.url).toContain('_system/avatars/')
    expect(body.url).toContain('.webp')
    expect(S3Service.prototype.putObject).toHaveBeenCalledTimes(1)

    const rows = await db.all<{ image: string | null }>(sql`SELECT image FROM user LIMIT 1`)
    expect(rows[0]?.image).toBe(body.url)
  })

  it('is idempotent — re-PUT with same mime returns the same URL', async () => {
    const { app, db } = await createTestApp()
    await insertPublicStorage(db)
    const headers = await authedHeaders(app)

    const form1 = new FormData()
    form1.set('file', makeFile('image/png'))
    const res1 = await app.request('/api/me/avatar', { method: 'PUT', headers, body: form1 })
    const body1 = (await res1.json()) as { url: string }

    const form2 = new FormData()
    form2.set('file', makeFile('image/png'))
    const res2 = await app.request('/api/me/avatar', { method: 'PUT', headers, body: form2 })
    const body2 = (await res2.json()) as { url: string }

    expect(body1.url).toBe(body2.url)
  })
})

describe('DELETE /api/me/avatar', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(S3Service.prototype, 'deleteObject').mockResolvedValue(undefined)
  })

  it('returns 401 without auth', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/me/avatar', { method: 'DELETE' })
    expect(res.status).toBe(401)
  })

  it('clears user.image and removes all mime variants from S3', async () => {
    const { app, db } = await createTestApp()
    await insertPublicStorage(db)
    const headers = await authedHeaders(app)
    await db.run(sql`UPDATE user SET image = 'https://example.com/old.png'`)

    const res = await app.request('/api/me/avatar', { method: 'DELETE', headers })
    expect(res.status).toBe(200)

    const rows = await db.all<{ image: string | null }>(sql`SELECT image FROM user LIMIT 1`)
    expect(rows[0]?.image).toBeNull()
    // 3 mime variants attempted (png, jpg, webp)
    expect(S3Service.prototype.deleteObject).toHaveBeenCalledTimes(3)
  })

  it('succeeds when no public storage exists (DB cleared, S3 skipped)', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await db.run(sql`UPDATE user SET image = 'https://example.com/old.png'`)

    const res = await app.request('/api/me/avatar', { method: 'DELETE', headers })
    expect(res.status).toBe(200)
    const rows = await db.all<{ image: string | null }>(sql`SELECT image FROM user LIMIT 1`)
    expect(rows[0]?.image).toBeNull()
  })
})
