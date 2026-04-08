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
    const app = buildApp()
    const res = await app.request('/api/objects')
    expect(res.status).toBe(401)
  })

  it('GET /api/objects returns empty list', async () => {
    const app = buildApp()
    const headers = await authedHeaders(app)
    const res = await app.request('/api/objects', { headers })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ items: [], total: 0, page: 1, pageSize: 20 })
  })

  it('POST /api/objects returns 400 for invalid input', async () => {
    const app = buildApp()
    const headers = await authedHeaders(app)
    const res = await app.request('/api/objects', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    })
    expect(res.status).toBe(400)
  })

  it('POST /api/objects returns 500 when no storage configured', async () => {
    const app = buildApp()
    const headers = await authedHeaders(app)
    const res = await app.request('/api/objects', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'test.txt', type: 'text/plain' }),
    })
    expect(res.status).toBe(500)
  })

  it('GET /api/objects/:id returns 404 for missing object', async () => {
    const app = buildApp()
    const headers = await authedHeaders(app)
    const res = await app.request('/api/objects/nonexistent', { headers })
    expect(res.status).toBe(404)
  })

  it('PATCH /api/objects/:id returns 404 for missing object', async () => {
    const app = buildApp()
    const headers = await authedHeaders(app)
    const res = await app.request('/api/objects/nonexistent', {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Nope' }),
    })
    expect(res.status).toBe(404)
  })

  it('DELETE /api/objects/:id returns 404 for missing object', async () => {
    const app = buildApp()
    const headers = await authedHeaders(app)
    const res = await app.request('/api/objects/nonexistent', {
      method: 'DELETE',
      headers,
    })
    expect(res.status).toBe(404)
  })
})
