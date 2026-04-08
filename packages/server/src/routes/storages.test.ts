import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { authedHeaders, createTestApp } from '../test/setup.js'

const VALID_STORAGE = {
  title: 'Test S3',
  mode: 'private' as const,
  bucket: 'my-bucket',
  endpoint: 'https://s3.amazonaws.com',
  accessKey: 'AK',
  secretKey: 'SK',
}

async function adminHeaders(app: ReturnType<typeof import('../app')['createApp']>) {
  await authedHeaders(app, 'admin@example.com', 'password123456')
  const signInRes = await app.request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', password: 'password123456' }),
  })
  return { Cookie: signInRes.headers.getSetCookie().join('; ') }
}

async function createStorageViaAPI(
  app: ReturnType<typeof import('../app')['createApp']>,
  headers: Record<string, string>,
  overrides: Record<string, unknown> = {},
) {
  const res = await app.request('/api/admin/storages', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...VALID_STORAGE, ...overrides }),
  })
  return res
}

describe('Admin Storages API', () => {
  it('returns 401 without auth', async () => {
    const { app } = createTestApp()
    const res = await app.request('/api/admin/storages')
    expect(res.status).toBe(401)
  })

  it('returns 403 for non-admin user', async () => {
    const { app } = createTestApp()
    await authedHeaders(app, 'admin@example.com')
    const headers = await authedHeaders(app, 'regular@example.com')
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
    const { app } = createTestApp()
    const headers = await adminHeaders(app)
    const res = await app.request('/api/admin/storages', { headers })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ items: [], total: 0 })
  })

  it('POST / creates a storage', async () => {
    const { app } = createTestApp()
    const headers = await adminHeaders(app)
    const res = await createStorageViaAPI(app, headers)
    expect(res.status).toBe(201)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.title).toBe('Test S3')
    expect(body.mode).toBe('private')
    expect(body.bucket).toBe('my-bucket')
    expect(body.status).toBe('active')
    expect(body.capacity).toBe(0)
    expect(body.used).toBe(0)
    expect(body.id).toBeTruthy()
  })

  it('POST / rejects invalid input', async () => {
    const { app } = createTestApp()
    const headers = await adminHeaders(app)
    const res = await app.request('/api/admin/storages', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '' }),
    })
    expect(res.status).toBe(400)
  })

  it('GET /:id returns storage detail', async () => {
    const { app } = createTestApp()
    const headers = await adminHeaders(app)
    const createRes = await createStorageViaAPI(app, headers)
    const created = (await createRes.json()) as Record<string, unknown>

    const res = await app.request(`/api/admin/storages/${created.id}`, { headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.id).toBe(created.id)
    expect(body.title).toBe('Test S3')
  })

  it('GET /:id returns 404 for missing storage', async () => {
    const { app } = createTestApp()
    const headers = await adminHeaders(app)
    const res = await app.request('/api/admin/storages/nonexistent', { headers })
    expect(res.status).toBe(404)
  })

  it('PUT /:id updates storage', async () => {
    const { app } = createTestApp()
    const headers = await adminHeaders(app)
    const createRes = await createStorageViaAPI(app, headers)
    const created = (await createRes.json()) as Record<string, unknown>

    const res = await app.request(`/api/admin/storages/${created.id}`, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Updated S3', capacity: 1073741824 }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.title).toBe('Updated S3')
    expect(body.capacity).toBe(1073741824)
  })

  it('PUT /:id returns 400 for invalid update input', async () => {
    const { app } = createTestApp()
    const headers = await adminHeaders(app)
    const createRes = await createStorageViaAPI(app, headers)
    const created = (await createRes.json()) as Record<string, unknown>

    const res = await app.request(`/api/admin/storages/${created.id}`, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: 'not-a-url' }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.error).toBeTruthy()
  })

  it('PUT /:id returns 404 for missing storage', async () => {
    const { app } = createTestApp()
    const headers = await adminHeaders(app)
    const res = await app.request('/api/admin/storages/nonexistent', {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Nope' }),
    })
    expect(res.status).toBe(404)
  })

  it('DELETE /:id deletes storage', async () => {
    const { app } = createTestApp()
    const headers = await adminHeaders(app)
    const createRes = await createStorageViaAPI(app, headers)
    const created = (await createRes.json()) as Record<string, unknown>

    const res = await app.request(`/api/admin/storages/${created.id}`, {
      method: 'DELETE',
      headers,
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.deleted).toBe(true)

    const getRes = await app.request(`/api/admin/storages/${created.id}`, { headers })
    expect(getRes.status).toBe(404)
  })

  it('DELETE /:id returns 404 for missing storage', async () => {
    const { app } = createTestApp()
    const headers = await adminHeaders(app)
    const res = await app.request('/api/admin/storages/nonexistent', {
      method: 'DELETE',
      headers,
    })
    expect(res.status).toBe(404)
  })

  it('DELETE /:id returns 409 when storage has referenced files', async () => {
    const { app, db } = createTestApp()
    const headers = await adminHeaders(app)
    const createRes = await createStorageViaAPI(app, headers)
    const created = (await createRes.json()) as Record<string, unknown>
    const storageId = created.id as string
    const now = Date.now()

    await db.run(sql`
      INSERT INTO matters (id, org_id, alias, name, type, storage_id, created_at, updated_at)
      VALUES (${'m1'}, ${'org-1'}, ${'alias-1'}, ${'file.txt'}, ${'text/plain'}, ${storageId}, ${now}, ${now})
    `)

    const res = await app.request(`/api/admin/storages/${storageId}`, {
      method: 'DELETE',
      headers,
    })
    expect(res.status).toBe(409)
  })

  it('GET / lists all storages after creation', async () => {
    const { app } = createTestApp()
    const headers = await adminHeaders(app)
    await createStorageViaAPI(app, headers, { title: 'S3-1' })
    await createStorageViaAPI(app, headers, { title: 'S3-2', mode: 'public' })

    const res = await app.request('/api/admin/storages', { headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: Array<Record<string, unknown>>; total: number }
    expect(body.total).toBe(2)
    expect(body.items).toHaveLength(2)
  })
})
