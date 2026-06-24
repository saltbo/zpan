import { FREE_STORAGE_LIMIT } from '@shared/constants'
import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { createStorageRepo } from '../../adapters/repos/storage.js'
import { adminHeaders, authedHeaders, createTestApp, seedBusinessLicense, seedProLicense } from '../../test/setup.js'

const validStorage = {
  bucket: 'test-bucket',
  endpoint: 'https://s3.amazonaws.com',
  region: 'us-east-1',
  accessKey: 'AKIAIOSFODNN7EXAMPLE',
  secretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
}

describe('Admin Storages API', () => {
  it('returns 401 without auth [spec: storages/auth-required]', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/site/storages')
    expect(res.status).toBe(401)
  })

  it('returns 403 for non-admin user [spec: storages/admin-only]', async () => {
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
    const res = await app.request('/api/site/storages', { headers: freshHeaders })
    expect(res.status).toBe(403)
  })

  it('GET / returns empty list', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)
    const res = await app.request('/api/site/storages', { headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: unknown[]; total: number }
    expect(body).toEqual({ items: [], total: 0, page: 1, pageSize: 0 })
  })

  it('POST / creates a storage [spec: storages/create]', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)
    const res = await app.request('/api/site/storages', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(validStorage),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.bucket).toBe('test-bucket')
    expect(body.status).toBe('active')
    expect(body.capacity).toBe(0)
    expect(body.forcePathStyle).toBe(true)
    expect(body.used).toBe(0)
    expect(body.id).toBeTruthy()
  })

  it('POST / persists forcePathStyle false [spec: storages/force-path-style]', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)
    const res = await app.request('/api/site/storages', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...validStorage, forcePathStyle: false }),
    })
    expect(res.status).toBe(201)
    const created = (await res.json()) as { id: string; forcePathStyle: boolean }
    expect(created.forcePathStyle).toBe(false)

    const getRes = await app.request(`/api/site/storages/${created.id}`, { headers })
    expect(getRes.status).toBe(200)
    const body = (await getRes.json()) as { forcePathStyle: boolean }
    expect(body.forcePathStyle).toBe(false)
  })

  it('POST / returns 402 when Community storage limit is reached [spec: storages/community-limit]', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)

    for (let i = 0; i < FREE_STORAGE_LIMIT; i++) {
      const res = await app.request('/api/site/storages', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...validStorage, bucket: `bucket-${i}` }),
      })
      expect(res.status).toBe(201)
    }

    const res = await app.request('/api/site/storages', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...validStorage, bucket: 'bucket-overflow' }),
    })

    expect(res.status).toBe(402)
    const body = (await res.json()) as {
      error: { message: string; details: Array<{ reason: string; metadata: Record<string, string> }> }
    }
    expect(body.error.message).toBe('Feature not available')
    expect(body.error.details[0].reason).toBe('FEATURE_NOT_AVAILABLE')
    expect(body.error.details[0].metadata.feature).toBe('storages_unlimited')
    expect(body.error.details[0].metadata.limit).toBe(String(FREE_STORAGE_LIMIT))
  })

  it('GET / lists created storages [spec: storages/list]', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)

    await app.request('/api/site/storages', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(validStorage),
    })

    const res = await app.request('/api/site/storages', { headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: Array<Record<string, unknown>>; total: number }
    expect(body.total).toBe(1)
    expect(body.items).toHaveLength(1)
    expect(body.items[0].bucket).toBe('test-bucket')
    expect(body.items[0].forcePathStyle).toBe(true)
  })

  it('GET /:id returns storage detail [spec: storages/detail]', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)

    const createRes = await app.request('/api/site/storages', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(validStorage),
    })
    const created = (await createRes.json()) as { id: string }

    const res = await app.request(`/api/site/storages/${created.id}`, { headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.id).toBe(created.id)
    expect(body.bucket).toBe('test-bucket')
  })

  it('GET /:id returns 404 for missing storage', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)
    const res = await app.request('/api/site/storages/nonexistent', { headers })
    expect(res.status).toBe(404)
  })

  it('PUT /:id updates a storage [spec: storages/update]', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)

    const createRes = await app.request('/api/site/storages', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(validStorage),
    })
    const created = (await createRes.json()) as { id: string }

    const res = await app.request(`/api/site/storages/${created.id}`, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ bucket: 'updated-bucket', status: 'disabled', forcePathStyle: false }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.bucket).toBe('updated-bucket')
    expect(body.status).toBe('disabled')
    expect(body.forcePathStyle).toBe(false)
  })

  it('PUT /:id returns 404 for missing storage', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)
    const res = await app.request('/api/site/storages/nonexistent', {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ bucket: 'nope' }),
    })
    expect(res.status).toBe(404)
  })

  it('PUT /:id/egress-billing updates storage credits billing [spec: storages/egress-billing]', async () => {
    const { app, db } = await createTestApp()
    await seedBusinessLicense(db)
    const headers = await adminHeaders(app)

    const createRes = await app.request('/api/site/storages', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(validStorage),
    })
    const created = (await createRes.json()) as { id: string }

    const res = await app.request(`/api/site/storages/${created.id}/egress-billing`, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true, unitBytes: 1024, creditsPerUnit: 2 }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.egressCreditBillingEnabled).toBe(true)
    expect(body.egressCreditUnitBytes).toBe(1024)
    expect(body.egressCreditPerUnit).toBe(2)
  })

  it('PUT /:id/egress-billing returns 402 when quota_store is unavailable', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)

    const createRes = await app.request('/api/site/storages', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(validStorage),
    })
    const created = (await createRes.json()) as { id: string }

    const res = await app.request(`/api/site/storages/${created.id}/egress-billing`, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true, unitBytes: 1024, creditsPerUnit: 2 }),
    })
    expect(res.status).toBe(402)
    const body = (await res.json()) as {
      error: { message: string; details: Array<{ reason: string; metadata: Record<string, string> }> }
    }
    expect(body.error.message).toBe('Feature not available')
    expect(body.error.details[0].reason).toBe('FEATURE_NOT_AVAILABLE')
    expect(body.error.details[0].metadata.feature).toBe('quota_store')
  })

  it('PUT /:id/egress-billing returns 404 for missing storage when disabled', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)
    const res = await app.request('/api/site/storages/nonexistent/egress-billing', {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false, unitBytes: 1024, creditsPerUnit: 2 }),
    })
    expect(res.status).toBe(404)
  })

  it('PUT /:id/egress-billing returns 404 for missing storage when enabled without quota_store', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    const res = await app.request('/api/site/storages/nonexistent/egress-billing', {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true, unitBytes: 1024, creditsPerUnit: 2 }),
    })
    expect(res.status).toBe(404)
  })

  it('DELETE /:id deletes a storage [spec: storages/delete]', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)

    const createRes = await app.request('/api/site/storages', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(validStorage),
    })
    const created = (await createRes.json()) as { id: string }

    const res = await app.request(`/api/site/storages/${created.id}`, {
      method: 'DELETE',
      headers,
    })
    expect(res.status).toBe(204)
  })

  it('DELETE /:id returns 404 for missing storage', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)
    const res = await app.request('/api/site/storages/nonexistent', {
      method: 'DELETE',
      headers,
    })
    expect(res.status).toBe(404)
  })

  it('DELETE /:id returns 409 when matters reference the storage [spec: storages/delete-in-use]', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)

    const createRes = await app.request('/api/site/storages', {
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

    const res = await app.request(`/api/site/storages/${created.id}`, {
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
  await db.run(sql`
    INSERT INTO storages (id, bucket, endpoint, region, access_key, secret_key, file_path, custom_host, capacity, used, status, created_at, updated_at)
    VALUES (${opts.id}, 'bucket', 'https://s3.example.com', 'us-east-1', 'key', 'secret', '$UID/$RAW_NAME', '', ${capacity}, ${used}, ${status}, ${now}, ${now})
  `)
}

describe('selectStorage service', () => {
  it('returns the single active storage when capacity is unlimited (0) [spec: storages/select-active]', async () => {
    const { db } = await createTestApp()
    await insertStorage(db, { id: 's1', capacity: 0, used: 0 })

    const storage = await createStorageRepo(db).select()
    expect(storage.id).toBe('s1')
  })

  it('returns storage when used is below capacity', async () => {
    const { db } = await createTestApp()
    await insertStorage(db, { id: 's1', capacity: 100, used: 50 })

    const storage = await createStorageRepo(db).select()
    expect(storage.id).toBe('s1')
  })

  it('skips storage where used equals capacity', async () => {
    const { db } = await createTestApp()
    await insertStorage(db, { id: 's1', capacity: 100, used: 100, createdAt: 1 })
    await insertStorage(db, { id: 's2', capacity: 200, used: 50, createdAt: 2 })

    const storage = await createStorageRepo(db).select()
    expect(storage.id).toBe('s2')
  })

  it('skips storage where used exceeds capacity', async () => {
    const { db } = await createTestApp()
    await insertStorage(db, { id: 's1', capacity: 100, used: 110, createdAt: 1 })
    await insertStorage(db, { id: 's2', capacity: 0, used: 0, createdAt: 2 })

    const storage = await createStorageRepo(db).select()
    expect(storage.id).toBe('s2')
  })

  it('picks the oldest active storage first (sequential fill order)', async () => {
    const { db } = await createTestApp()
    await insertStorage(db, { id: 's1', capacity: 0, used: 0, createdAt: 1 })
    await insertStorage(db, { id: 's2', capacity: 0, used: 0, createdAt: 2 })

    const storage = await createStorageRepo(db).select()
    expect(storage.id).toBe('s1')
  })

  it('ignores disabled storages', async () => {
    const { db } = await createTestApp()
    await insertStorage(db, { id: 's1', status: 'disabled', capacity: 0, createdAt: 1 })
    await insertStorage(db, { id: 's2', status: 'active', capacity: 0, createdAt: 2 })

    const storage = await createStorageRepo(db).select()
    expect(storage.id).toBe('s2')
  })

  it('throws when no active storage exists', async () => {
    const { db } = await createTestApp()

    await expect(createStorageRepo(db).select()).rejects.toThrow('No available storage')
  })

  it('throws when all storages are at full capacity', async () => {
    const { db } = await createTestApp()
    await insertStorage(db, { id: 's1', capacity: 50, used: 50 })
    await insertStorage(db, { id: 's2', capacity: 100, used: 100 })

    await expect(createStorageRepo(db).select()).rejects.toThrow('No available storage')
  })
})
