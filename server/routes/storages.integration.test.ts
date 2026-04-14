import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { selectStorage } from '../services/storage.js'
import { adminHeaders, authedHeaders, createTestApp } from '../test/setup.js'

const validStorage = {
  title: 'Test S3',
  mode: 'private',
  bucket: 'test-bucket',
  endpoint: 'https://s3.amazonaws.com',
  region: 'us-east-1',
  accessKey: 'AKIAIOSFODNN7EXAMPLE',
  secretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
}

describe('Admin Storages API', () => {
  it('returns 401 without auth', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/admin/storages')
    expect(res.status).toBe(401)
  })

  it('returns 403 for non-admin user', async () => {
    const { app } = await createTestApp()
    // First user becomes admin
    await authedHeaders(app, 'admin@example.com')
    // Second user is non-admin
    await authedHeaders(app, 'regular@example.com')
    const signInRes = await app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'regular@example.com', password: 'password123456' }),
    })
    const freshHeaders = { Cookie: signInRes.headers.getSetCookie().join('; ') }
    const res = await app.request('/api/admin/storages', { headers: freshHeaders })
    expect(res.status).toBe(403)
  })

  it('GET / returns empty list', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)
    const res = await app.request('/api/admin/storages', { headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: unknown[]; total: number }
    expect(body).toEqual({ items: [], total: 0 })
  })

  it('POST / creates a storage', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)
    const res = await app.request('/api/admin/storages', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(validStorage),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.title).toBe('Test S3')
    expect(body.mode).toBe('private')
    expect(body.bucket).toBe('test-bucket')
    expect(body.status).toBe('active')
    expect(body.capacity).toBe(0)
    expect(body.used).toBe(0)
    expect(body.id).toBeTruthy()
  })

  it('GET / lists created storages', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)

    await app.request('/api/admin/storages', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(validStorage),
    })

    const res = await app.request('/api/admin/storages', { headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: Array<Record<string, unknown>>; total: number }
    expect(body.total).toBe(1)
    expect(body.items).toHaveLength(1)
    expect(body.items[0].title).toBe('Test S3')
  })

  it('GET /:id returns storage detail', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)

    const createRes = await app.request('/api/admin/storages', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(validStorage),
    })
    const created = (await createRes.json()) as { id: string }

    const res = await app.request(`/api/admin/storages/${created.id}`, { headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.id).toBe(created.id)
    expect(body.title).toBe('Test S3')
  })

  it('GET /:id returns 404 for missing storage', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)
    const res = await app.request('/api/admin/storages/nonexistent', { headers })
    expect(res.status).toBe(404)
  })

  it('PUT /:id updates a storage', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)

    const createRes = await app.request('/api/admin/storages', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(validStorage),
    })
    const created = (await createRes.json()) as { id: string }

    const res = await app.request(`/api/admin/storages/${created.id}`, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Updated S3', status: 'disabled' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.title).toBe('Updated S3')
    expect(body.status).toBe('disabled')
  })

  it('PUT /:id returns 404 for missing storage', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)
    const res = await app.request('/api/admin/storages/nonexistent', {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Nope' }),
    })
    expect(res.status).toBe(404)
  })

  it('DELETE /:id deletes a storage', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)

    const createRes = await app.request('/api/admin/storages', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(validStorage),
    })
    const created = (await createRes.json()) as { id: string }

    const res = await app.request(`/api/admin/storages/${created.id}`, {
      method: 'DELETE',
      headers,
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.deleted).toBe(true)
  })

  it('DELETE /:id returns 404 for missing storage', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)
    const res = await app.request('/api/admin/storages/nonexistent', {
      method: 'DELETE',
      headers,
    })
    expect(res.status).toBe(404)
  })

  it('DELETE /:id returns 409 when matters reference the storage', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)

    const createRes = await app.request('/api/admin/storages', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(validStorage),
    })
    const created = (await createRes.json()) as { id: string }

    const now = Date.now()
    await db.run(sql`
      INSERT INTO matters (id, org_id, alias, name, type, storage_id, created_at, updated_at)
      VALUES ('m1', 'org-1', 'test-alias', 'test.txt', 'text/plain', ${created.id}, ${now}, ${now})
    `)

    const res = await app.request(`/api/admin/storages/${created.id}`, {
      method: 'DELETE',
      headers,
    })
    expect(res.status).toBe(409)
  })
})

// Helper to insert a storage row directly into the DB for service-level tests
async function insertStorage(
  db: Awaited<ReturnType<typeof createTestApp>>['db'],
  opts: {
    id: string
    mode: 'private' | 'public'
    status?: string
    capacity?: number
    used?: number
    createdAt?: number
  },
) {
  const now = opts.createdAt ?? Date.now()
  const capacity = opts.capacity ?? 0
  const used = opts.used ?? 0
  const status = opts.status ?? 'active'
  const title = `Storage ${opts.id}`
  await db.run(sql`
    INSERT INTO storages (id, title, mode, bucket, endpoint, region, access_key, secret_key, file_path, custom_host, capacity, used, status, created_at, updated_at)
    VALUES (${opts.id}, ${title}, ${opts.mode}, 'bucket', 'https://s3.example.com', 'us-east-1', 'key', 'secret', '$UID/$RAW_NAME', '', ${capacity}, ${used}, ${status}, ${now}, ${now})
  `)
}

describe('selectStorage service', () => {
  it('returns the single active storage when capacity is unlimited (0)', async () => {
    const { db } = await createTestApp()
    await insertStorage(db, { id: 's1', mode: 'private', capacity: 0, used: 0 })

    const storage = await selectStorage(db, 'private')
    expect(storage.id).toBe('s1')
  })

  it('returns storage when used is below capacity', async () => {
    const { db } = await createTestApp()
    await insertStorage(db, { id: 's1', mode: 'private', capacity: 100, used: 50 })

    const storage = await selectStorage(db, 'private')
    expect(storage.id).toBe('s1')
  })

  it('skips storage where used equals capacity', async () => {
    const { db } = await createTestApp()
    await insertStorage(db, { id: 's1', mode: 'private', capacity: 100, used: 100, createdAt: 1 })
    await insertStorage(db, { id: 's2', mode: 'private', capacity: 200, used: 50, createdAt: 2 })

    const storage = await selectStorage(db, 'private')
    expect(storage.id).toBe('s2')
  })

  it('skips storage where used exceeds capacity', async () => {
    const { db } = await createTestApp()
    await insertStorage(db, { id: 's1', mode: 'private', capacity: 100, used: 110, createdAt: 1 })
    await insertStorage(db, { id: 's2', mode: 'private', capacity: 0, used: 0, createdAt: 2 })

    const storage = await selectStorage(db, 'private')
    expect(storage.id).toBe('s2')
  })

  it('picks the oldest active storage first (sequential fill order)', async () => {
    const { db } = await createTestApp()
    await insertStorage(db, { id: 's1', mode: 'private', capacity: 0, used: 0, createdAt: 1 })
    await insertStorage(db, { id: 's2', mode: 'private', capacity: 0, used: 0, createdAt: 2 })

    const storage = await selectStorage(db, 'private')
    expect(storage.id).toBe('s1')
  })

  it('ignores disabled storages', async () => {
    const { db } = await createTestApp()
    await insertStorage(db, { id: 's1', mode: 'private', status: 'disabled', capacity: 0, createdAt: 1 })
    await insertStorage(db, { id: 's2', mode: 'private', status: 'active', capacity: 0, createdAt: 2 })

    const storage = await selectStorage(db, 'private')
    expect(storage.id).toBe('s2')
  })

  it('ignores storages of a different mode', async () => {
    const { db } = await createTestApp()
    await insertStorage(db, { id: 's1', mode: 'public', capacity: 0 })

    await expect(selectStorage(db, 'private')).rejects.toThrow('No available storage')
  })

  it('throws when no active storage exists for the requested mode', async () => {
    const { db } = await createTestApp()

    await expect(selectStorage(db, 'private')).rejects.toThrow('No available storage')
  })

  it('throws when all storages of the mode are at full capacity', async () => {
    const { db } = await createTestApp()
    await insertStorage(db, { id: 's1', mode: 'private', capacity: 50, used: 50 })
    await insertStorage(db, { id: 's2', mode: 'private', capacity: 100, used: 100 })

    await expect(selectStorage(db, 'private')).rejects.toThrow('No available storage')
  })

  it('returns a public storage when mode is public', async () => {
    const { db } = await createTestApp()
    await insertStorage(db, { id: 's1', mode: 'public', capacity: 0 })

    const storage = await selectStorage(db, 'public')
    expect(storage.id).toBe('s1')
  })

  it('does not return a public storage when private mode is requested', async () => {
    const { db } = await createTestApp()
    await insertStorage(db, { id: 's1', mode: 'private', capacity: 0, createdAt: 1 })
    await insertStorage(db, { id: 's2', mode: 'public', capacity: 0, createdAt: 2 })

    const storage = await selectStorage(db, 'private')
    expect(storage.id).toBe('s1')
  })
})
