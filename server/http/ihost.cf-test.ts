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
  const email = `cf-ihost-${Date.now()}@example.com`
  const res = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Test', email, password: 'password123456' }),
  })
  const cookies = res.headers.getSetCookie()
  return { Cookie: cookies.join('; ') }
}

describe('[CF] IHost API routing regression', () => {
  it('GET /api/ihost/images returns 401 without auth (route exists)', async () => {
    const app = await buildApp()
    const res = await app.request('/api/ihost/images')
    expect(res.status).toBe(401)
  })

  it('POST /api/ihost/images returns 403 when image hosting not enabled', async () => {
    const app = await buildApp()
    const headers = await authedHeaders(app)
    const res = await app.request('/api/ihost/images', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'test.png', mime: 'image/png', size: 1024 }),
    })
    expect(res.status).toBe(403)
  })

  it('POST /api/ihost/images/presign returns 403 when image hosting not enabled', async () => {
    const app = await buildApp()
    const headers = await authedHeaders(app)
    const res = await app.request('/api/ihost/images/presign', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'test.png', mime: 'image/png', size: 1024 }),
    })
    // 403 = authenticated but no image_hosting_configs row
    expect(res.status).toBe(403)
  })

  it('GET /api/ihost/images/:id returns 401 without auth (route exists)', async () => {
    const app = await buildApp()
    const res = await app.request('/api/ihost/images/some-id')
    expect(res.status).toBe(401)
  })
})
