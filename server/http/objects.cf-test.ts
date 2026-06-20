import { env } from 'cloudflare:workers'
import { sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { S3Service } from '../adapters/gateways/s3'
import { createApp } from '../app'
import { createAuth } from '../auth'
import { createCloudflarePlatform } from '../platform/cloudflare'

async function buildApp() {
  const platform = createCloudflarePlatform(env)
  const auth = await createAuth(platform.db, env.BETTER_AUTH_SECRET)
  return createApp(platform, auth)
}

async function authedHeaders(app: ReturnType<typeof buildApp>) {
  const email = `cf-obj-${Date.now()}@example.com`
  const res = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Test', email, password: 'password123456' }),
  })
  const cookies = res.headers.getSetCookie()
  return { Cookie: cookies.join('; ') }
}

describe('[CF] Objects API', () => {
  it('returns 401 without auth', async () => {
    const app = await buildApp()
    const res = await app.request('/api/objects')
    expect(res.status).toBe(401)
  })

  it('GET /api/objects returns empty list', async () => {
    const app = await buildApp()
    const headers = await authedHeaders(app)
    const res = await app.request('/api/objects', { headers })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ items: [], total: 0, page: 1, pageSize: 20 })
  })

  it('POST /api/objects returns 400 for invalid input', async () => {
    const app = await buildApp()
    const headers = await authedHeaders(app)
    const res = await app.request('/api/objects', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    })
    expect(res.status).toBe(400)
  })

  it('POST /api/objects returns 503 when no storage configured', async () => {
    const app = await buildApp()
    const headers = await authedHeaders(app)
    const res = await app.request('/api/objects', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'test.txt', type: 'text/plain' }),
    })
    expect(res.status).toBe(503)
  })

  it('GET /api/objects/:id returns 404 for missing object', async () => {
    const app = await buildApp()
    const headers = await authedHeaders(app)
    const res = await app.request('/api/objects/nonexistent', { headers })
    expect(res.status).toBe(404)
  })

  it('PATCH /api/objects/:id returns 404 for missing object', async () => {
    const app = await buildApp()
    const headers = await authedHeaders(app)
    const res = await app.request('/api/objects/nonexistent', {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Nope' }),
    })
    expect(res.status).toBe(404)
  })

  it('DELETE /api/objects/:id returns 404 for missing object', async () => {
    const app = await buildApp()
    const headers = await authedHeaders(app)
    const res = await app.request('/api/objects/nonexistent', {
      method: 'DELETE',
      headers,
    })
    expect(res.status).toBe(404)
  })
})

// ─── Upload + trash lifecycle against D1 ──────────────────────────────────────
// The D1 instance is shared across tests, so each test uses a fresh signed-up
// user (its own personal org) and a unique storage id to stay isolated.

async function buildAppWithDb() {
  const platform = createCloudflarePlatform(env)
  const auth = await createAuth(platform.db, env.BETTER_AUTH_SECRET)
  return { app: createApp(platform, auth), db: platform.db }
}

async function signUp(app: ReturnType<typeof createApp>, db: Awaited<ReturnType<typeof buildAppWithDb>>['db']) {
  const email = `cf-obj-life-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`
  const res = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'CF', email, password: 'password123456' }),
  })
  const headers = { Cookie: res.headers.getSetCookie().join('; ') }
  const orgRows = await db.all<{ id: string }>(
    sql`SELECT id FROM organization WHERE metadata LIKE '%"type":"personal"%' ORDER BY created_at DESC LIMIT 1`,
  )
  return { headers, orgId: orgRows[0].id }
}

async function insertStorage(db: Awaited<ReturnType<typeof buildAppWithDb>>['db'], id: string) {
  const now = Date.now()
  await db.run(sql`
    INSERT OR IGNORE INTO storages (id, title, bucket, endpoint, region, access_key, secret_key, file_path, custom_host, capacity, used, status, created_at, updated_at)
    VALUES (${id}, 'CF S3', 'cf-bucket', 'https://s3.amazonaws.com', 'us-east-1', 'AK', 'SK', '', '', 0, 0, 'active', ${now}, ${now})
  `)
}

describe('[CF] Objects upload + trash lifecycle (D1)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(S3Service.prototype, 'presignUpload').mockResolvedValue('https://cf-presigned-upload.example.com')
    vi.spyOn(S3Service.prototype, 'deleteObject').mockResolvedValue(undefined)
    vi.spyOn(S3Service.prototype, 'deleteObjects').mockResolvedValue(undefined)
    vi.spyOn(S3Service.prototype, 'headObject').mockResolvedValue({
      size: 64,
      contentType: 'text/plain',
      etag: 'cf-etag',
    })
  })

  it('creates a file draft, finalizes it via completions, then soft-deletes, restores, and purges', async () => {
    const { app, db } = await buildAppWithDb()
    const { headers } = await signUp(app, db)
    await insertStorage(db, `st-cf-life-${Date.now()}`)

    // Create draft → single-PUT upload instructions.
    const createRes = await app.request('/api/objects', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'cf-upload.txt', type: 'text/plain', size: 64, parent: '', dirtype: 0 }),
    })
    expect(createRes.status).toBe(201)
    const created = (await createRes.json()) as {
      id: string
      status: string
      upload: { sessionId: string; urls: string[] }
    }
    expect(created.status).toBe('draft')
    expect(created.upload.urls).toEqual(['https://cf-presigned-upload.example.com'])

    // Finalize via completions (HEAD etag matches).
    const completeRes = await app.request(
      `/api/objects/${created.id}/uploads/${created.upload.sessionId}/completions`,
      {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ parts: [{ partNumber: 1, etag: 'cf-etag' }] }),
      },
    )
    expect(completeRes.status).toBe(200)
    expect(((await completeRes.json()) as { status: string }).status).toBe('active')

    // Soft delete → 204, then it appears in the trash listing.
    const trashRes = await app.request(`/api/objects/${created.id}`, { method: 'DELETE', headers })
    expect(trashRes.status).toBe(204)
    const trashList = await app.request('/api/trash/objects', { headers })
    const trashBody = (await trashList.json()) as { items: Array<{ id: string }> }
    expect(trashBody.items.some((m) => m.id === created.id)).toBe(true)

    // Restore → live again.
    const restoreRes = await app.request(`/api/trash/objects/${created.id}/restorations`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(restoreRes.status).toBe(200)
    expect(((await restoreRes.json()) as { trashedAt: number | null }).trashedAt).toBeNull()

    // Soft delete again, then permanently purge → 204.
    await app.request(`/api/objects/${created.id}`, { method: 'DELETE', headers })
    const purgeRes = await app.request(`/api/trash/objects/${created.id}`, { method: 'DELETE', headers })
    expect(purgeRes.status).toBe(204)
    const gone = await app.request(`/api/objects/${created.id}`, { headers })
    expect(gone.status).toBe(404)
  })

  it('aborts an in-progress upload via DELETE /uploads/:sid and discards the draft', async () => {
    const { app, db } = await buildAppWithDb()
    const { headers } = await signUp(app, db)
    await insertStorage(db, `st-cf-abort-${Date.now()}`)

    const createRes = await app.request('/api/objects', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'cf-abort.txt', type: 'text/plain', size: 64, parent: '', dirtype: 0 }),
    })
    expect(createRes.status).toBe(201)
    const created = (await createRes.json()) as { id: string; upload: { sessionId: string } }

    const abortRes = await app.request(`/api/objects/${created.id}/uploads/${created.upload.sessionId}`, {
      method: 'DELETE',
      headers,
    })
    expect(abortRes.status).toBe(204)
    const gone = await app.request(`/api/objects/${created.id}`, { headers })
    expect(gone.status).toBe(404)
  })
})
