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

async function signUpUser(app: ReturnType<typeof import('../app')['createApp']>, email: string, name = 'Other User') {
  const res = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email, password: 'password123456' }),
  })
  return res.json()
}

describe('Admin Users API', () => {
  it('returns 401 without auth', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/admin/users')
    expect(res.status).toBe(401)
  })

  it('returns 403 for non-admin user', async () => {
    const { app } = await createTestApp()
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
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)

    const res = await app.request('/api/admin/users', { headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: Array<Record<string, unknown>>; total: number }
    expect(body.total).toBe(1)
    expect(body.items).toHaveLength(1)
    expect(body.items[0].email).toBe('admin@example.com')
    expect(body.items[0].orgName).toBeTruthy()
  })

  it('GET /api/admin/users filters by name, username, or email with filtered totals', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)
    await signUpUser(app, 'match-email@example.com', 'Email Match')
    await signUpUser(app, 'username-target@example.com', 'Plain Name')
    await signUpUser(app, 'other@example.com', 'Other Person')

    const byName = await app.request('/api/admin/users?search=email%20match', { headers })
    expect(byName.status).toBe(200)
    const byNameBody = (await byName.json()) as { items: Array<Record<string, unknown>>; total: number }
    expect(byNameBody.total).toBe(1)
    expect(byNameBody.items[0].email).toBe('match-email@example.com')

    const byUsername = await app.request('/api/admin/users?search=username-target', { headers })
    const byUsernameBody = (await byUsername.json()) as { items: Array<Record<string, unknown>>; total: number }
    expect(byUsernameBody.total).toBe(1)
    expect(byUsernameBody.items[0].email).toBe('username-target@example.com')

    const byEmail = await app.request('/api/admin/users?search=other@example.com', { headers })
    const byEmailBody = (await byEmail.json()) as { items: Array<Record<string, unknown>>; total: number }
    expect(byEmailBody.total).toBe(1)
    expect(byEmailBody.items[0].email).toBe('other@example.com')
  })

  it('PATCH /api/admin/users/:id disables a user', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)

    // Create a second user
    await signUpUser(app, 'user2@example.com')

    // Find the second user
    const users = await db.all<{ id: string }>(sql`SELECT id FROM user WHERE email = 'user2@example.com'`)
    const userId = users[0].id

    const res = await app.request(`/api/admin/users/${userId}`, {
      method: 'PATCH',
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

  it('PATCH /api/admin/users/:id rejects invalid status', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)
    const res = await app.request('/api/admin/users/someid', {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'invalid' }),
    })
    expect(res.status).toBe(400)
  })

  it('PATCH /api/admin/users/:id returns 404 for missing user', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)
    const res = await app.request('/api/admin/users/nonexistent', {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'disabled' }),
    })
    expect(res.status).toBe(404)
  })

  it('DELETE /api/admin/users/:id deletes a user', async () => {
    const { app, db } = await createTestApp()
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
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)

    // Create a second user and get their session before banning
    const userHeaders = await authedHeaders(app, 'banned@example.com')

    const users = await db.all<{ id: string }>(sql`SELECT id FROM user WHERE email = 'banned@example.com'`)
    const userId = users[0].id

    // Disable the user while they have an active session
    await app.request(`/api/admin/users/${userId}`, {
      method: 'PATCH',
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
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)
    const res = await app.request('/api/admin/users/nonexistent', {
      method: 'DELETE',
      headers,
    })
    expect(res.status).toBe(404)
  })

  it('PATCH /api/admin/users/batch disables and enables users', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await signUpUser(app, 'batch1@example.com')
    await signUpUser(app, 'batch2@example.com')
    const users = await db.all<{ id: string }>(
      sql`SELECT id FROM user WHERE email IN ('batch1@example.com', 'batch2@example.com') ORDER BY email`,
    )
    const ids = users.map((row) => row.id)

    const disable = await app.request('/api/admin/users/batch', {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'disable', ids }),
    })
    expect(disable.status).toBe(200)
    expect((await disable.json()) as Record<string, unknown>).toMatchObject({ updated: 2, ids, status: 'disabled' })
    const disabled = await db.all<{ banned: number }>(sql`SELECT banned FROM user WHERE id IN (${ids[0]}, ${ids[1]})`)
    expect(disabled.every((row) => row.banned === 1)).toBe(true)

    const enable = await app.request('/api/admin/users/batch', {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'enable', ids }),
    })
    expect(enable.status).toBe(200)
    const enabled = await db.all<{ banned: number }>(sql`SELECT banned FROM user WHERE id IN (${ids[0]}, ${ids[1]})`)
    expect(enabled.every((row) => row.banned === 0)).toBe(true)
  })

  it('PATCH /api/admin/users/batch sets quota for personal orgs', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await signUpUser(app, 'quota1@example.com')
    await signUpUser(app, 'quota2@example.com')
    const users = await db.all<{ id: string }>(
      sql`SELECT id FROM user WHERE email IN ('quota1@example.com', 'quota2@example.com') ORDER BY email`,
    )
    const ids = users.map((row) => row.id)

    const res = await app.request('/api/admin/users/batch', {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'set_quota', ids, quota: 123456 }),
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as { updated: number; orgIds: string[]; quota: number }
    expect(body.updated).toBe(2)
    expect(body.quota).toBe(123456)
    const quotas = await db.all<{ quota: number }>(
      sql`SELECT quota FROM org_quotas WHERE org_id IN (${body.orgIds[0]}, ${body.orgIds[1]})`,
    )
    expect(quotas.map((row) => row.quota)).toEqual([123456, 123456])
  })

  it('PATCH /api/admin/users/batch creates missing personal quota rows', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await signUpUser(app, 'quota-missing@example.com')
    const users = await db.all<{ id: string }>(sql`SELECT id FROM user WHERE email = 'quota-missing@example.com'`)
    const userId = users[0].id
    const orgs = await db.all<{ id: string }>(sql`SELECT id FROM organization WHERE slug = ${`personal-${userId}`}`)
    await db.run(sql`DELETE FROM org_quotas WHERE org_id = ${orgs[0].id}`)

    const res = await app.request('/api/admin/users/batch', {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'set_quota', ids: [userId], quota: 654321 }),
    })

    expect(res.status).toBe(200)
    const quotas = await db.all<{ quota: number }>(sql`SELECT quota FROM org_quotas WHERE org_id = ${orgs[0].id}`)
    expect(quotas).toHaveLength(1)
    expect(quotas[0].quota).toBe(654321)
  })

  it('PATCH /api/admin/users/batch fails when selected user has no personal org', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await signUpUser(app, 'no-personal-org@example.com')
    const users = await db.all<{ id: string }>(sql`SELECT id FROM user WHERE email = 'no-personal-org@example.com'`)
    const userId = users[0].id
    await db.run(sql`DELETE FROM member WHERE user_id = ${userId}`)

    const res = await app.request('/api/admin/users/batch', {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'set_quota', ids: [userId], quota: 123456 }),
    })

    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: `Personal organization not found for user(s): ${userId}` })
  })

  it('DELETE /api/admin/users/batch deletes selected users', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await signUpUser(app, 'delete1@example.com')
    await signUpUser(app, 'delete2@example.com')
    const users = await db.all<{ id: string }>(
      sql`SELECT id FROM user WHERE email IN ('delete1@example.com', 'delete2@example.com') ORDER BY email`,
    )
    const ids = users.map((row) => row.id)

    const res = await app.request('/api/admin/users/batch', {
      method: 'DELETE',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    })

    expect(res.status).toBe(200)
    expect((await res.json()) as Record<string, unknown>).toMatchObject({ deleted: 2, ids })
    const remaining = await db.all<{ id: string }>(sql`SELECT id FROM user WHERE id IN (${ids[0]}, ${ids[1]})`)
    expect(remaining).toHaveLength(0)
  })

  it('batch operations reject missing users instead of skipping them', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)
    const patch = await app.request('/api/admin/users/batch', {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'disable', ids: ['missing-user'] }),
    })
    expect(patch.status).toBe(404)
    expect(await patch.json()).toEqual({ error: 'User not found: missing-user' })

    const quota = await app.request('/api/admin/users/batch', {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'set_quota', ids: ['missing-user'], quota: 123456 }),
    })
    expect(quota.status).toBe(404)
    expect(await quota.json()).toEqual({ error: 'User not found: missing-user' })

    const del = await app.request('/api/admin/users/batch', {
      method: 'DELETE',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: ['missing-user'] }),
    })
    expect(del.status).toBe(404)
    expect(await del.json()).toEqual({ error: 'User not found: missing-user' })
  })

  it('PATCH /api/admin/users/batch rejects non-positive quota values', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)
    const res = await app.request('/api/admin/users/batch', {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'set_quota', ids: ['some-user'], quota: 0 }),
    })
    expect(res.status).toBe(400)
  })
})
