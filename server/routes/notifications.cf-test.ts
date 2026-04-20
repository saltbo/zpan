import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { createApp } from '../app'
import { createAuth } from '../auth'
import { createCloudflarePlatform } from '../platform/cloudflare'

async function buildApp() {
  const platform = createCloudflarePlatform(env)
  const auth = await createAuth(platform.db, env.BETTER_AUTH_SECRET)
  return createApp(platform, auth)
}

async function authedHeaders(app: ReturnType<typeof buildApp>) {
  const email = `cf-notif-${Date.now()}@example.com`
  const res = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Test', email, password: 'password123456' }),
  })
  const cookies = res.headers.getSetCookie()
  return { Cookie: cookies.join('; ') }
}

describe('[CF] Notifications API', () => {
  it('returns 401 without auth', async () => {
    const app = await buildApp()
    const res = await app.request('/api/notifications')
    expect(res.status).toBe(401)
  })

  it('GET /api/notifications returns empty list', async () => {
    const app = await buildApp()
    const headers = await authedHeaders(app)
    const res = await app.request('/api/notifications', { headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: unknown[]; total: number; unreadCount: number }
    expect(body.items).toHaveLength(0)
    expect(body.unreadCount).toBe(0)
  })

  it('GET /api/notifications/unread-count returns 0', async () => {
    const app = await buildApp()
    const headers = await authedHeaders(app)
    const res = await app.request('/api/notifications/unread-count', { headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { count: number }
    expect(body.count).toBe(0)
  })

  it('POST /api/notifications/read-all returns count 0 when empty', async () => {
    const app = await buildApp()
    const headers = await authedHeaders(app)
    const res = await app.request('/api/notifications/read-all', { method: 'POST', headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { count: number }
    expect(body.count).toBe(0)
  })

  it('POST /api/notifications/nonexistent/read returns 404', async () => {
    const app = await buildApp()
    const headers = await authedHeaders(app)
    const res = await app.request('/api/notifications/nonexistent/read', { method: 'POST', headers })
    expect(res.status).toBe(404)
  })
})
