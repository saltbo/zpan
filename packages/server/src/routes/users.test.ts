import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { authedHeaders, createTestApp } from '../test/setup.js'

async function adminHeaders(app: ReturnType<typeof import('../app')['createApp']>) {
  // Sign up first user (gets promoted to admin via hook)
  await authedHeaders(app, 'admin@example.com', 'password123456')
  // Sign in again to get a session that reflects the admin role
  const signInRes = await app.request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', password: 'password123456' }),
  })
  return { Cookie: signInRes.headers.getSetCookie().join('; ') }
}

async function signUpUser(app: ReturnType<typeof import('../app')['createApp']>, email: string) {
  const res = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Other User', email, password: 'password123456' }),
  })
  return res.json()
}

describe('Admin Users API', () => {
  it('returns 401 without auth', async () => {
    const { app } = createTestApp()
    const res = await app.request('/api/admin/users')
    expect(res.status).toBe(401)
  })

  it('returns 403 for non-admin user', async () => {
    const { app } = createTestApp()
    // Create first user (auto-admin), then second user (non-admin)
    await authedHeaders(app, 'admin@example.com')
    const _headers = await authedHeaders(app, 'regular@example.com')
    // Sign in again to get fresh session with correct role
    const signInRes = await app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'regular@example.com', password: 'password123456' }),
    })
    const freshHeaders = { Cookie: signInRes.headers.getSetCookie().join('; ') }
    const res = await app.request('/api/admin/users', { headers: freshHeaders })
    expect(res.status).toBe(403)
  })

  it('GET /api/admin/users lists users with pagination', async () => {
    const { app } = createTestApp()
    const headers = await adminHeaders(app)

    const res = await app.request('/api/admin/users', { headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: Array<Record<string, unknown>>; total: number }
    expect(body.total).toBe(1)
    expect(body.items).toHaveLength(1)
    expect(body.items[0].email).toBe('admin@example.com')
    expect(body.items[0].orgName).toBeTruthy()
  })

  it('PUT /api/admin/users/:id/status disables a user', async () => {
    const { app, db } = createTestApp()
    const headers = await adminHeaders(app)

    // Create a second user
    await signUpUser(app, 'user2@example.com')

    // Find the second user
    const users = await db.all<{ id: string }>(sql`SELECT id FROM user WHERE email = 'user2@example.com'`)
    const userId = users[0].id

    const res = await app.request(`/api/admin/users/${userId}/status`, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'disabled' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.status).toBe('disabled')

    // Verify user is banned in DB
    const updated = await db.all<{ banned: number }>(sql`SELECT banned FROM user WHERE id = ${userId}`)
    expect(updated[0].banned).toBe(1)
  })

  it('PUT /api/admin/users/:id/status rejects invalid status', async () => {
    const { app } = createTestApp()
    const headers = await adminHeaders(app)
    const res = await app.request('/api/admin/users/someid/status', {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'invalid' }),
    })
    expect(res.status).toBe(400)
  })

  it('PUT /api/admin/users/:id/status returns 404 for missing user', async () => {
    const { app } = createTestApp()
    const headers = await adminHeaders(app)
    const res = await app.request('/api/admin/users/nonexistent/status', {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'disabled' }),
    })
    expect(res.status).toBe(404)
  })

  it('DELETE /api/admin/users/:id deletes a user', async () => {
    const { app, db } = createTestApp()
    const headers = await adminHeaders(app)

    await signUpUser(app, 'todelete@example.com')
    const users = await db.all<{ id: string }>(sql`SELECT id FROM user WHERE email = 'todelete@example.com'`)
    const userId = users[0].id

    const res = await app.request(`/api/admin/users/${userId}`, {
      method: 'DELETE',
      headers,
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.deleted).toBe(true)

    // Verify user no longer exists
    const remaining = await db.all<{ id: string }>(sql`SELECT id FROM user WHERE id = ${userId}`)
    expect(remaining).toHaveLength(0)
  })

  it('disabled user is rejected by auth middleware on existing session', async () => {
    const { app, db } = createTestApp()
    const headers = await adminHeaders(app)

    // Create a second user and get their session before banning
    const userHeaders = await authedHeaders(app, 'banned@example.com')

    const users = await db.all<{ id: string }>(sql`SELECT id FROM user WHERE email = 'banned@example.com'`)
    const userId = users[0].id

    // Disable the user while they have an active session
    await app.request(`/api/admin/users/${userId}/status`, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'disabled' }),
    })

    // Banned user's existing session should be rejected with 403
    const res = await app.request('/api/quotas/me', { headers: userHeaders })
    expect(res.status).toBe(403)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.error).toBe('Account disabled')
  })

  it('DELETE /api/admin/users/:id returns 404 for missing user', async () => {
    const { app } = createTestApp()
    const headers = await adminHeaders(app)
    const res = await app.request('/api/admin/users/nonexistent', {
      method: 'DELETE',
      headers,
    })
    expect(res.status).toBe(404)
  })
})
