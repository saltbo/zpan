import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { matters, storages } from '../db/schema.js'
import { StorageService } from '../services/storage.js'
import { adminHeaders, authedHeaders, createTestApp } from '../test/setup.js'

const validStorage = {
  title: 'My S3 Bucket',
  mode: 'private',
  bucket: 'zpan-files',
  endpoint: 'https://s3.amazonaws.com',
  region: 'us-east-1',
  accessKey: 'AKIAIOSFODNN7EXAMPLE',
  secretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
}

interface Json {
  // biome-ignore lint/suspicious/noExplicitAny: test helper for untyped JSON responses
  [key: string]: any
}

describe('Storages Admin API', () => {
  it('returns 401 without auth', async () => {
    const { app } = createTestApp()
    const res = await app.request('/api/admin/storages')
    expect(res.status).toBe(401)
  })

  it('returns 403 for non-admin user', async () => {
    const { app } = createTestApp()
    const headers = await authedHeaders(app)
    const res = await app.request('/api/admin/storages', { headers })
    expect(res.status).toBe(403)
  })

  it('GET /api/admin/storages returns empty list for admin', async () => {
    const { app, db } = createTestApp()
    const headers = await adminHeaders(app, db)
    const res = await app.request('/api/admin/storages', { headers })
    expect(res.status).toBe(200)
    const body: Json = await res.json()
    expect(body).toEqual({ items: [], total: 0 })
  })

  it('POST /api/admin/storages creates a storage', async () => {
    const { app, db } = createTestApp()
    const headers = await adminHeaders(app, db)
    const res = await app.request('/api/admin/storages', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(validStorage),
    })
    expect(res.status).toBe(201)
    const body: Json = await res.json()
    expect(body.title).toBe('My S3 Bucket')
    expect(body.mode).toBe('private')
    expect(body.bucket).toBe('zpan-files')
    expect(body.capacity).toBe(0)
    expect(body.used).toBe(0)
    expect(body.status).toBe('active')
    expect(body.id).toBeDefined()
  })

  it('POST /api/admin/storages validates required fields', async () => {
    const { app, db } = createTestApp()
    const headers = await adminHeaders(app, db)
    const res = await app.request('/api/admin/storages', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'incomplete' }),
    })
    expect(res.status).toBe(400)
  })

  it('POST /api/admin/storages accepts capacity', async () => {
    const { app, db } = createTestApp()
    const headers = await adminHeaders(app, db)
    const res = await app.request('/api/admin/storages', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...validStorage, capacity: 1073741824 }),
    })
    expect(res.status).toBe(201)
    const body: Json = await res.json()
    expect(body.capacity).toBe(1073741824)
  })

  it('GET /api/admin/storages/:id returns storage detail', async () => {
    const { app, db } = createTestApp()
    const headers = await adminHeaders(app, db)

    const createRes = await app.request('/api/admin/storages', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(validStorage),
    })
    const created: Json = await createRes.json()

    const res = await app.request(`/api/admin/storages/${created.id}`, { headers })
    expect(res.status).toBe(200)
    const body: Json = await res.json()
    expect(body.id).toBe(created.id)
    expect(body.title).toBe('My S3 Bucket')
  })

  it('GET /api/admin/storages/:id returns 404 for missing', async () => {
    const { app, db } = createTestApp()
    const headers = await adminHeaders(app, db)
    const res = await app.request('/api/admin/storages/nonexistent', { headers })
    expect(res.status).toBe(404)
  })

  it('PUT /api/admin/storages/:id updates storage', async () => {
    const { app, db } = createTestApp()
    const headers = await adminHeaders(app, db)

    const createRes = await app.request('/api/admin/storages', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(validStorage),
    })
    const created: Json = await createRes.json()

    const res = await app.request(`/api/admin/storages/${created.id}`, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Updated Title', status: 'disabled' }),
    })
    expect(res.status).toBe(200)
    const body: Json = await res.json()
    expect(body.title).toBe('Updated Title')
    expect(body.status).toBe('disabled')
  })

  it('PUT /api/admin/storages/:id returns 404 for missing', async () => {
    const { app, db } = createTestApp()
    const headers = await adminHeaders(app, db)
    const res = await app.request('/api/admin/storages/nonexistent', {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'x' }),
    })
    expect(res.status).toBe(404)
  })

  it('DELETE /api/admin/storages/:id deletes storage', async () => {
    const { app, db } = createTestApp()
    const headers = await adminHeaders(app, db)

    const createRes = await app.request('/api/admin/storages', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(validStorage),
    })
    const created: Json = await createRes.json()

    const res = await app.request(`/api/admin/storages/${created.id}`, {
      method: 'DELETE',
      headers,
    })
    expect(res.status).toBe(200)

    const getRes = await app.request(`/api/admin/storages/${created.id}`, { headers })
    expect(getRes.status).toBe(404)
  })

  it('DELETE /api/admin/storages/:id returns 409 when files reference it', async () => {
    const { app, db } = createTestApp()
    const headers = await adminHeaders(app, db)

    const createRes = await app.request('/api/admin/storages', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(validStorage),
    })
    const created: Json = await createRes.json()

    const now = new Date()
    await db.insert(matters).values({
      id: 'matter-1',
      uid: 'user-1',
      alias: 'test-alias',
      name: 'test.txt',
      type: 'text/plain',
      storageId: created.id,
      createdAt: now,
      updatedAt: now,
    })

    const res = await app.request(`/api/admin/storages/${created.id}`, {
      method: 'DELETE',
      headers,
    })
    expect(res.status).toBe(409)
  })

  it('DELETE /api/admin/storages/:id returns 404 for missing', async () => {
    const { app, db } = createTestApp()
    const headers = await adminHeaders(app, db)
    const res = await app.request('/api/admin/storages/nonexistent', {
      method: 'DELETE',
      headers,
    })
    expect(res.status).toBe(404)
  })
})

describe('Storage Pool Selection', () => {
  it('selectStorage picks the first active storage', async () => {
    const { app, db } = createTestApp()
    const headers = await adminHeaders(app, db)

    await app.request('/api/admin/storages', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...validStorage, title: 'First' }),
    })
    await app.request('/api/admin/storages', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...validStorage, title: 'Second' }),
    })

    const service = new StorageService(db)
    const selected = await service.selectStorage('private')
    expect(selected.title).toBe('First')
  })

  it('selectStorage skips full storages', async () => {
    const { app, db } = createTestApp()
    const headers = await adminHeaders(app, db)

    const res1 = await app.request('/api/admin/storages', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...validStorage, title: 'Full', capacity: 100 }),
    })
    const full: Json = await res1.json()

    await app.request('/api/admin/storages', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...validStorage, title: 'Available', capacity: 100 }),
    })

    await db.update(storages).set({ used: 100 }).where(eq(storages.id, full.id))

    const service = new StorageService(db)
    const selected = await service.selectStorage('private')
    expect(selected.title).toBe('Available')
  })

  it('selectStorage picks unlimited capacity storage even if used > 0', async () => {
    const { app, db } = createTestApp()
    const headers = await adminHeaders(app, db)

    const res1 = await app.request('/api/admin/storages', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...validStorage, title: 'Unlimited', capacity: 0 }),
    })
    const unlimited: Json = await res1.json()

    await db.update(storages).set({ used: 999999 }).where(eq(storages.id, unlimited.id))

    const service = new StorageService(db)
    const selected = await service.selectStorage('private')
    expect(selected.title).toBe('Unlimited')
  })

  it('selectStorage throws when no storage available', async () => {
    const { db } = createTestApp()
    const service = new StorageService(db)
    await expect(service.selectStorage('private')).rejects.toThrow('No available storage')
  })

  it('selectStorage filters by mode', async () => {
    const { app, db } = createTestApp()
    const headers = await adminHeaders(app, db)

    await app.request('/api/admin/storages', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...validStorage, title: 'Private', mode: 'private' }),
    })
    await app.request('/api/admin/storages', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...validStorage, title: 'Public', mode: 'public' }),
    })

    const service = new StorageService(db)
    const selected = await service.selectStorage('public')
    expect(selected.title).toBe('Public')
  })
})
