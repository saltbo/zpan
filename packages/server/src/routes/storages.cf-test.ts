import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { createApp } from '../app'
import { createAuth } from '../auth'
import { createCloudflarePlatform } from '../platform/cloudflare'

function buildApp() {
  const platform = createCloudflarePlatform(env)
  const auth = createAuth(platform.db, env.BETTER_AUTH_SECRET)
  return createApp(platform, auth)
}

async function adminHeaders(app: ReturnType<typeof buildApp>) {
  const email = `cf-admin-${Date.now()}@example.com`
  await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Admin', email, password: 'password123456' }),
  })
  const signInRes = await app.request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'password123456' }),
  })
  return { Cookie: signInRes.headers.getSetCookie().join('; ') }
}

async function authedHeaders(app: ReturnType<typeof buildApp>) {
  const email = `cf-user-${Date.now()}@example.com`
  const res = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Test', email, password: 'password123456' }),
  })
  const cookies = res.headers.getSetCookie()
  return { Cookie: cookies.join('; ') }
}

describe('[CF] Admin Storages API', () => {
  it('returns 401 without auth', async () => {
    const app = buildApp()
    const res = await app.request('/api/admin/storages')
    expect(res.status).toBe(401)
  })

  it('GET /api/admin/storages returns empty list for admin', async () => {
    const app = buildApp()
    const headers = await adminHeaders(app)
    const res = await app.request('/api/admin/storages', { headers })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ items: [], total: 0 })
  })

  it('POST creates and GET retrieves a storage', async () => {
    const app = buildApp()
    const headers = await adminHeaders(app)

    const createRes = await app.request('/api/admin/storages', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'CF Storage',
        mode: 'private',
        bucket: 'cf-bucket',
        endpoint: 'https://s3.amazonaws.com',
        accessKey: 'AK',
        secretKey: 'SK',
      }),
    })
    expect(createRes.status).toBe(201)
    const created = (await createRes.json()) as Record<string, unknown>
    expect(created.title).toBe('CF Storage')

    const getRes = await app.request(`/api/admin/storages/${created.id}`, { headers })
    expect(getRes.status).toBe(200)
    const body = (await getRes.json()) as Record<string, unknown>
    expect(body.id).toBe(created.id)
  })
})
