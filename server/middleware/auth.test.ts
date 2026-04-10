import { describe, expect, it } from 'vitest'
import { authedHeaders, createTestApp } from '../test/setup.js'
import { requireAdmin } from './auth.js'

function createAdminTestApp() {
  const { app, db, auth } = createTestApp()
  // Add a test-only route protected by requireAdmin
  app.get('/api/admin-only', requireAdmin, (c) => c.json({ ok: true }))
  return { app, db, auth }
}

// Signs up then signs in to get a session cookie that reflects the post-hook role update
async function authedHeadersWithFreshSession(
  app: ReturnType<typeof createTestApp>['app'],
  email: string,
  password = 'password123456',
  name = 'Test User',
) {
  await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email, password }),
  })
  const signInRes = await app.request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const cookies = signInRes.headers.getSetCookie()
  return { Cookie: cookies.join('; ') }
}

describe('requireAdmin middleware', () => {
  it('returns 403 when user is not authenticated', async () => {
    const { app } = createAdminTestApp()
    const res = await app.request('/api/admin-only')
    expect(res.status).toBe(401)
  })

  it('returns 403 when authenticated user does not have admin role', async () => {
    const { app } = createAdminTestApp()
    // First user becomes admin; second does not
    await authedHeadersWithFreshSession(app, 'admin@example.com', 'password123456', 'Admin')
    const headers = await authedHeaders(app, 'regular@example.com', 'password123456')
    const res = await app.request('/api/admin-only', { headers })
    expect(res.status).toBe(403)
  })

  it('returns Forbidden error body when user lacks admin role', async () => {
    const { app } = createAdminTestApp()
    await authedHeadersWithFreshSession(app, 'admin@example.com', 'password123456', 'Admin')
    const headers = await authedHeaders(app, 'regular@example.com', 'password123456')
    const res = await app.request('/api/admin-only', { headers })
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Forbidden')
  })

  it('allows request when user has admin role', async () => {
    const { app } = createAdminTestApp()
    // First signup → role updated to admin by hook; sign in to get fresh session
    const headers = await authedHeadersWithFreshSession(app, 'admin@example.com', 'password123456', 'Admin')
    const res = await app.request('/api/admin-only', { headers })
    expect(res.status).toBe(200)
  })

  it('returns expected body when admin accesses protected route', async () => {
    const { app } = createAdminTestApp()
    const headers = await authedHeadersWithFreshSession(app, 'admin@example.com', 'password123456', 'Admin')
    const res = await app.request('/api/admin-only', { headers })
    const body = (await res.json()) as { ok: boolean }
    expect(body.ok).toBe(true)
  })
})
