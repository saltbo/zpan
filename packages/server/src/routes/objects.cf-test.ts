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

  it('POST /api/objects returns 501', async () => {
    const app = buildApp()
    const headers = await authedHeaders(app)
    const res = await app.request('/api/objects', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'test.txt', type: 'text/plain', storageId: 's1' }),
    })
    expect(res.status).toBe(501)
  })
})
