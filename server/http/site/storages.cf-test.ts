import { env } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { FREE_STORAGE_LIMIT } from '../../../shared/constants'
import { createStorageRepo } from '../../adapters/repos/storage'
import { createApp } from '../../app'
import { createAuth } from '../../auth'
import { user } from '../../db/auth-schema'
import { createCloudflarePlatform } from '../../platform/cloudflare'

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
  bucket: 'cf-test-bucket',
  endpoint: 'https://s3.amazonaws.com',
  region: 'us-east-1',
  accessKey: 'AKIAIOSFODNN7EXAMPLE',
  secretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
}

describe('[CF] Admin Storages API', () => {
  it('returns 401 without auth', async () => {
    const app = await buildApp()
    const res = await app.request('/api/site/storages')
    expect(res.status).toBe(401)
  })

  it('GET /api/site/storages returns empty list', async () => {
    const app = await buildApp()
    const headers = await adminHeaders(app)
    const res = await app.request('/api/site/storages', { headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: unknown[]; total: number }
    expect(body).toEqual({ items: [], total: 0, page: 1, pageSize: 0 })
  })

  it('POST /api/site/storages creates a storage', async () => {
    const app = await buildApp()
    const headers = await adminHeaders(app)
    const res = await app.request('/api/site/storages', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...validStorage,
        bucket: `cf-test-bucket-${Date.now()}`,
      }),
    })
    if (res.status === 402) {
      const body = (await res.json()) as {
        error: { details: Array<{ reason: string; metadata: Record<string, string> }> }
      }
      expect(body.error.details[0].reason).toBe('FEATURE_NOT_AVAILABLE')
      expect(body.error.details[0].metadata.feature).toBe('storages_unlimited')
      expect(body.error.details[0].metadata.limit).toBe(String(FREE_STORAGE_LIMIT))
      return
    }

    expect(res.status).toBe(201)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.status).toBe('active')
    expect(body.id).toBeTruthy()
  })

  it('POST /api/site/storages returns 402 when Community storage limit is reached', async () => {
    const app = await buildApp()
    const headers = await adminHeaders(app)

    for (let i = 0; i <= FREE_STORAGE_LIMIT; i++) {
      const res = await app.request('/api/site/storages', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...validStorage,
          bucket: `cf-bucket-${Date.now()}-${i}`,
        }),
      })
      if (res.status === 402) {
        const body = (await res.json()) as {
          error: { details: Array<{ reason: string; metadata: Record<string, string> }> }
        }
        expect(body.error.details[0].reason).toBe('FEATURE_NOT_AVAILABLE')
        expect(body.error.details[0].metadata.feature).toBe('storages_unlimited')
        expect(body.error.details[0].metadata.limit).toBe(String(FREE_STORAGE_LIMIT))
        return
      }

      expect(res.status).toBe(201)
    }

    throw new Error('expected storage limit enforcement in Community mode')
  })

  it('GET /api/site/storages/:id returns storage detail', async () => {
    const app = await buildApp()
    const headers = await adminHeaders(app)
    const platform = createCloudflarePlatform(env)
    const created = await createStorageRepo(platform.db).create({
      ...validStorage,
      title: `CF Detail ${Date.now()}`,
      bucket: `cf-detail-${Date.now()}`,
    })

    const res = await app.request(`/api/site/storages/${created.id}`, { headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.id).toBe(created.id)
  })

  it('PUT /api/site/storages/:id updates a storage', async () => {
    const app = await buildApp()
    const headers = await adminHeaders(app)
    const platform = createCloudflarePlatform(env)
    const created = await createStorageRepo(platform.db).create({
      ...validStorage,
      bucket: `cf-update-${Date.now()}`,
    })

    const res = await app.request(`/api/site/storages/${created.id}`, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ bucket: 'updated-cf-bucket' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.bucket).toBe('updated-cf-bucket')
  })

  it('PUT /api/site/storages/:id/egress-billing enforces quota_store for enabling', async () => {
    const app = await buildApp()
    const headers = await adminHeaders(app)
    const platform = createCloudflarePlatform(env)
    const created = await createStorageRepo(platform.db).create({
      ...validStorage,
      title: `CF Egress Billing ${Date.now()}`,
      bucket: `cf-egress-billing-${Date.now()}`,
    })

    const res = await app.request(`/api/site/storages/${created.id}/egress-billing`, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true, unitBytes: 1024, creditsPerUnit: 2 }),
    })
    expect(res.status).toBe(402)
    const body = (await res.json()) as {
      error: { details: Array<{ reason: string; metadata: Record<string, string> }> }
    }
    expect(body.error.details[0].reason).toBe('FEATURE_NOT_AVAILABLE')
    expect(body.error.details[0].metadata.feature).toBe('quota_store')
  })

  it('DELETE /api/site/storages/:id deletes a storage', async () => {
    const app = await buildApp()
    const headers = await adminHeaders(app)
    const platform = createCloudflarePlatform(env)
    const created = await createStorageRepo(platform.db).create({
      ...validStorage,
      title: `CF Delete ${Date.now()}`,
      bucket: `cf-delete-${Date.now()}`,
    })

    const res = await app.request(`/api/site/storages/${created.id}`, {
      method: 'DELETE',
      headers,
    })
    expect(res.status).toBe(204)
  })
})
