import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { authedHeaders, createTestApp } from '../test/setup.js'

// Admin user management moved off our own /api/users/* routes onto better-auth's
// admin plugin (/api/auth/admin/*), which the frontend admin client now calls.
// These tests prove that contract holds in OUR wiring: the admin() plugin is
// mounted, the first signup is promoted to admin, and an admin session can list,
// ban/unban and remove users through better-auth directly.

async function adminCookie(app: ReturnType<typeof import('../app')['createApp']>) {
  await authedHeaders(app, 'admin@example.com', 'password123456')
  const signIn = await app.request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', password: 'password123456' }),
  })
  // Origin matches the test app's baseURL — better-auth's CSRF check requires it
  // on state-changing admin POSTs (ban/unban/remove), exactly as a browser sends.
  return { Cookie: signIn.headers.getSetCookie().join('; '), Origin: 'http://localhost:3000' }
}

describe('better-auth admin user endpoints (migration target)', () => {
  it('GET /api/auth/admin/list-users returns users for an admin session [spec: users/list]', async () => {
    const { app } = await createTestApp()
    const headers = await adminCookie(app)
    await authedHeaders(app, 'member@example.com', 'password123456')

    const res = await app.request('/api/auth/admin/list-users?limit=50&offset=0', { headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { users: Array<{ email: string }>; total: number }
    expect(body.total).toBeGreaterThanOrEqual(2)
    expect(body.users.map((u) => u.email)).toEqual(expect.arrayContaining(['admin@example.com', 'member@example.com']))
  })

  it('rejects list-users for a non-admin session [spec: users/admin-only]', async () => {
    const { app } = await createTestApp()
    await authedHeaders(app, 'admin@example.com', 'password123456')
    const memberHeaders = await authedHeaders(app, 'member@example.com', 'password123456')

    const res = await app.request('/api/auth/admin/list-users?limit=50&offset=0', { headers: memberHeaders })
    expect(res.status).toBe(403)
  })

  it('POST /api/auth/admin/ban-user sets banned, and our middleware then rejects the user [spec: users/disable]', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminCookie(app)
    const memberHeaders = await authedHeaders(app, 'ban-me@example.com', 'password123456')
    const rows = await db.all<{ id: string }>(sql`SELECT id FROM user WHERE email = 'ban-me@example.com'`)
    const userId = rows[0].id

    const adminRows = await db.all<{ id: string }>(sql`SELECT id FROM user WHERE email = 'admin@example.com'`)
    const adminId = adminRows[0].id

    const ban = await app.request('/api/auth/admin/ban-user', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    })
    expect(ban.status).toBe(200)

    const banned = await db.all<{ banned: number }>(sql`SELECT banned FROM user WHERE id = ${userId}`)
    expect(banned[0].banned).toBe(1)

    // The disable is audited with the acting admin as the actor.
    const disableEvt = await db.all<{ user_id: string; target_id: string }>(
      sql`SELECT user_id, target_id FROM activity_events WHERE action = 'user_disable' AND target_id = ${userId}`,
    )
    expect(disableEvt).toEqual([{ user_id: adminId, target_id: userId }])

    // The banned user's existing session is rejected by our auth middleware.
    const blocked = await app.request('/api/quotas/me', { headers: memberHeaders })
    expect(blocked.status).toBe(403)

    // Unban restores access and is audited as user_enable.
    const unban = await app.request('/api/auth/admin/unban-user', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    })
    expect(unban.status).toBe(200)
    const restored = await db.all<{ banned: number }>(sql`SELECT banned FROM user WHERE id = ${userId}`)
    expect(restored[0].banned).toBe(0)
    const enableEvt = await db.all<{ user_id: string }>(
      sql`SELECT user_id FROM activity_events WHERE action = 'user_enable' AND target_id = ${userId}`,
    )
    expect(enableEvt).toEqual([{ user_id: adminId }])
  })

  it('does NOT audit a failed admin action (ban of a nonexistent user) [spec: users/patch-missing]', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminCookie(app)

    const res = await app.request('/api/auth/admin/ban-user', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'does-not-exist' }),
    })
    expect(res.status).toBe(404)

    const evts = await db.all(sql`SELECT 1 FROM activity_events WHERE action = 'user_disable'`)
    expect(evts).toHaveLength(0)
  })

  it('POST /api/auth/admin/remove-user deletes the user [spec: users/delete]', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminCookie(app)
    await authedHeaders(app, 'delete-me@example.com', 'password123456')
    const rows = await db.all<{ id: string }>(sql`SELECT id FROM user WHERE email = 'delete-me@example.com'`)
    const userId = rows[0].id

    const adminRows = await db.all<{ id: string }>(sql`SELECT id FROM user WHERE email = 'admin@example.com'`)
    const adminId = adminRows[0].id

    const res = await app.request('/api/auth/admin/remove-user', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    })
    expect(res.status).toBe(200)

    const remaining = await db.all<{ id: string }>(sql`SELECT id FROM user WHERE id = ${userId}`)
    expect(remaining).toHaveLength(0)

    const deleteEvt = await db.all<{ user_id: string; target_id: string }>(
      sql`SELECT user_id, target_id FROM activity_events WHERE action = 'user_delete' AND target_id = ${userId}`,
    )
    expect(deleteEvt).toEqual([{ user_id: adminId, target_id: userId }])
  })
})
