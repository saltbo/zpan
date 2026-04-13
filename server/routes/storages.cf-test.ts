import { env } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { createApp } from '../app'
import { createAuth } from '../auth'
import { user } from '../db/auth-schema'
import { createCloudflarePlatform } from '../platform/cloudflare'

async function buildApp() {
  const platform = createCloudflarePlatform(env)
  const auth = await createAuth(platform.db, env.BETTER_AUTH_SECRET)
  return createApp(platform, auth)
}

async function adminHeaders(app: ReturnType<typeof buildApp>) {
  const email = `cf-admin-${Date.now()}@example.com`
  await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Admin', email, password: 'password123456' }),
  })

  const platform = createCloudflarePlatform(env)
  await platform.db.update(user).set({ role: 'admin' }).where(eq(user.email, email))

  const signInRes = await app.request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'password123456' }),
  })
  return { Cookie: signInRes.headers.getSetCookie().join('; ') }
}

const validStorage = {
  title: 'CF Test S3',
  mode: 'private',
  bucket: 'cf-test-bucket',
  endpoint: 'https://s3.amazonaws.com',
  region: 'us-east-1',
  accessKey: 'AKIAIOSFODNN7EXAMPLE',
  secretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
}

describe('[CF] Admin Storages API', () => {
  it('returns 401 without auth', async () => {
    const app = await buildApp()
    const res = await app.request('/api/admin/storages')
    expect(res.status).toBe(401)
  })

  it('GET /api/admin/storages returns empty list', async () => {
    const app = await buildApp()
    const headers = await adminHeaders(app)
    const res = await app.request('/api/admin/storages', { headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: unknown[]; total: number }
    expect(body).toEqual({ items: [], total: 0 })
  })

  it('POST /api/admin/storages creates a storage', async () => {
    const app = await buildApp()
    const headers = await adminHeaders(app)
    const res = await app.request('/api/admin/storages', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(validStorage),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.title).toBe('CF Test S3')
    expect(body.status).toBe('active')
    expect(body.id).toBeTruthy()
  })

  it('GET /api/admin/storages/:id returns storage detail', async () => {
    const app = await buildApp()
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
  })

  it('PUT /api/admin/storages/:id updates a storage', async () => {
    const app = await buildApp()
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
      body: JSON.stringify({ title: 'Updated CF S3' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.title).toBe('Updated CF S3')
  })

  it('DELETE /api/admin/storages/:id deletes a storage', async () => {
    const app = await buildApp()
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
})
