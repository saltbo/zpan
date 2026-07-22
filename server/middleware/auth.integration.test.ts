import { and, eq, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { describe, expect, it } from 'vitest'
import * as authSchema from '../db/auth-schema.js'
import { authedHeaders, createTestApp } from '../test/setup.js'
import { requireAdmin, requireTeamRole } from './auth.js'

type TestCtx = Awaited<ReturnType<typeof createTestApp>>
type TestDb = TestCtx['db']
type TestApp = TestCtx['app']

async function createAdminTestApp() {
  const { app, db, auth } = await createTestApp()
  // Add a test-only route protected by requireAdmin
  app.get('/api/admin-only', requireAdmin, (c) => c.json({ ok: true }))
  return { app, db, auth }
}

// Signs up then signs in to get a session cookie that reflects the post-hook role update
async function authedHeadersWithFreshSession(
  app: Awaited<ReturnType<typeof createTestApp>>['app'],
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
    const { app } = await createAdminTestApp()
    const res = await app.request('/api/admin-only')
    expect(res.status).toBe(401)
  })

  it('returns 403 when authenticated user does not have admin role', async () => {
    const { app } = await createAdminTestApp()
    // First user becomes admin; second does not
    await authedHeadersWithFreshSession(app, 'admin@example.com', 'password123456', 'Admin')
    const headers = await authedHeaders(app, 'regular@example.com', 'password123456')
    const res = await app.request('/api/admin-only', { headers })
    expect(res.status).toBe(403)
  })

  it('returns Forbidden error body when user lacks admin role', async () => {
    const { app } = await createAdminTestApp()
    await authedHeadersWithFreshSession(app, 'admin@example.com', 'password123456', 'Admin')
    const headers = await authedHeaders(app, 'regular@example.com', 'password123456')
    const res = await app.request('/api/admin-only', { headers })
    const body = (await res.json()) as { error: { message: string } }
    expect(body.error.message).toBe('Forbidden')
  })

  it('allows request when user has admin role', async () => {
    const { app } = await createAdminTestApp()
    // First signup → role updated to admin by hook; sign in to get fresh session
    const headers = await authedHeadersWithFreshSession(app, 'admin@example.com', 'password123456', 'Admin')
    const res = await app.request('/api/admin-only', { headers })
    expect(res.status).toBe(200)
  })

  it('returns expected body when admin accesses protected route', async () => {
    const { app } = await createAdminTestApp()
    const headers = await authedHeadersWithFreshSession(app, 'admin@example.com', 'password123456', 'Admin')
    const res = await app.request('/api/admin-only', { headers })
    const body = (await res.json()) as { ok: boolean }
    expect(body.ok).toBe(true)
  })
})

describe('authenticated user activity', () => {
  it('records a successful Better Auth sign-in', async () => {
    const { app, db } = await createTestApp()
    await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Login User', email: 'login-activity@example.com', password: 'password123456' }),
    })
    await db.run(sql`UPDATE user SET last_active_at = NULL WHERE email = 'login-activity@example.com'`)

    const response = await app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'login-activity@example.com', password: 'password123456' }),
    })
    const [row] = await db
      .select({ lastActiveAt: authSchema.user.lastActiveAt })
      .from(authSchema.user)
      .where(eq(authSchema.user.email, 'login-activity@example.com'))

    expect(response.status).toBe(200)
    expect(row.lastActiveAt).not.toBeNull()
  })

  it('updates Better Auth lastActiveAt without creating an audit event', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app, 'active-user@example.com', 'password123456')
    const oldActivity = new Date('2026-01-01T00:00:00.000Z')
    const profileUpdatedAt = new Date('2026-02-01T00:00:00.000Z')
    await db.run(sql`
      UPDATE user
      SET last_active_at = ${oldActivity.getTime()}, updated_at = ${profileUpdatedAt.getTime()}
      WHERE email = 'active-user@example.com'
    `)

    const first = await app.request('/api/quotas/me', { headers })
    const [afterFirst] = await db
      .select({ lastActiveAt: authSchema.user.lastActiveAt, updatedAt: authSchema.user.updatedAt })
      .from(authSchema.user)
      .where(eq(authSchema.user.email, 'active-user@example.com'))
    const second = await app.request('/api/quotas/me', { headers })
    const [afterSecond] = await db
      .select({ lastActiveAt: authSchema.user.lastActiveAt, updatedAt: authSchema.user.updatedAt })
      .from(authSchema.user)
      .where(eq(authSchema.user.email, 'active-user@example.com'))

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(afterFirst.lastActiveAt?.getTime()).toBeGreaterThan(oldActivity.getTime())
    expect(afterSecond.lastActiveAt).toEqual(afterFirst.lastActiveAt)
    expect(afterSecond.updatedAt).toEqual(profileUpdatedAt)
    expect(await db.all(sql`SELECT id FROM audit_events WHERE action = 'user_access'`)).toEqual([])
  })
})

// --- requireTeamRole helpers ---

async function insertOrg(db: TestDb, slug: string) {
  const id = nanoid()
  await db.insert(authSchema.organization).values({
    id,
    name: 'Team Org',
    slug,
    createdAt: new Date(),
  })
  return id
}

async function insertMember(db: TestDb, organizationId: string, userId: string, role: string) {
  await db.insert(authSchema.member).values({
    id: nanoid(),
    organizationId,
    userId,
    role,
    createdAt: new Date(),
  })
}

// Sign up, sign in, and return both the cookie headers and the resolved user id
async function signUpAndGetSession(app: TestApp, _db: TestDb, email: string) {
  const signUpRes = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Test User', email, password: 'password123456' }),
  })
  const body = (await signUpRes.json()) as { user: { id: string } }
  const userId = body.user.id
  const signUpCookies = signUpRes.headers.getSetCookie().join('; ')
  return { userId, cookies: signUpCookies }
}

// Call the better-auth setActiveOrganization endpoint and return updated cookies
async function setActiveOrg(app: TestApp, cookies: string, orgId: string): Promise<string> {
  const res = await app.request('/api/auth/organization/set-active', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookies,
      Origin: 'http://localhost:3000',
    },
    body: JSON.stringify({ organizationId: orgId }),
  })
  const setCookies = res.headers.getSetCookie()
  if (setCookies.length > 0) {
    // Merge updated cookies into the original cookie string
    const updated = new Map<string, string>()
    for (const c of cookies.split('; ')) {
      const eqIdx = c.indexOf('=')
      if (eqIdx >= 0) updated.set(c.slice(0, eqIdx), c.slice(eqIdx + 1))
    }
    for (const c of setCookies) {
      const [pair] = c.split(';')
      const eqIdx = pair.indexOf('=')
      if (eqIdx >= 0) updated.set(pair.slice(0, eqIdx).trim(), pair.slice(eqIdx + 1).trim())
    }
    return [...updated.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
  }
  return cookies
}

function createTeamRoleTestApp() {
  return createTestApp().then(({ app, db }) => {
    app.get('/api/test/viewer', requireTeamRole('viewer'), (c) => c.json({ ok: true }))
    app.post('/api/test/editor', requireTeamRole('editor'), (c) => c.json({ ok: true }))
    return { app, db }
  })
}

describe('requireTeamRole — personal org bypass', () => {
  it('viewer-level route passes for personal org owner', async () => {
    const { app } = await createTeamRoleTestApp()
    const headers = await authedHeaders(app)
    const res = await app.request('/api/test/viewer', { headers })
    expect(res.status).toBe(200)
  })

  it('editor-level route passes for personal org owner (no membership check in personal orgs)', async () => {
    const { app } = await createTeamRoleTestApp()
    const headers = await authedHeaders(app)
    const res = await app.request('/api/test/editor', { method: 'POST', headers })
    expect(res.status).toBe(200)
  })
})

describe('requireTeamRole — team org with owner role', () => {
  it('viewer-level route passes for owner', async () => {
    const { app, db } = await createTeamRoleTestApp()
    const { userId, cookies } = await signUpAndGetSession(app, db, 'owner@example.com')
    const teamOrgId = await insertOrg(db, `team-${nanoid()}`)
    await insertMember(db, teamOrgId, userId, 'owner')
    const updatedCookies = await setActiveOrg(app, cookies, teamOrgId)

    const res = await app.request('/api/test/viewer', { headers: { Cookie: updatedCookies } })
    expect(res.status).toBe(200)
  })

  it('editor-level route passes for owner', async () => {
    const { app, db } = await createTeamRoleTestApp()
    const { userId, cookies } = await signUpAndGetSession(app, db, 'owner2@example.com')
    const teamOrgId = await insertOrg(db, `team-${nanoid()}`)
    await insertMember(db, teamOrgId, userId, 'owner')
    const updatedCookies = await setActiveOrg(app, cookies, teamOrgId)

    const res = await app.request('/api/test/editor', { method: 'POST', headers: { Cookie: updatedCookies } })
    expect(res.status).toBe(200)
  })
})

describe('requireTeamRole — team org with editor role', () => {
  it('editor-level route passes for editor', async () => {
    const { app, db } = await createTeamRoleTestApp()
    const { userId, cookies } = await signUpAndGetSession(app, db, 'editor@example.com')
    const teamOrgId = await insertOrg(db, `team-${nanoid()}`)
    await insertMember(db, teamOrgId, userId, 'editor')
    const updatedCookies = await setActiveOrg(app, cookies, teamOrgId)

    const res = await app.request('/api/test/editor', { method: 'POST', headers: { Cookie: updatedCookies } })
    expect(res.status).toBe(200)
  })

  it('viewer-level route passes for editor', async () => {
    const { app, db } = await createTeamRoleTestApp()
    const { userId, cookies } = await signUpAndGetSession(app, db, 'editor2@example.com')
    const teamOrgId = await insertOrg(db, `team-${nanoid()}`)
    await insertMember(db, teamOrgId, userId, 'editor')
    const updatedCookies = await setActiveOrg(app, cookies, teamOrgId)

    const res = await app.request('/api/test/viewer', { headers: { Cookie: updatedCookies } })
    expect(res.status).toBe(200)
  })
})

describe('requireTeamRole — team org with viewer role', () => {
  it('viewer-level route passes for viewer', async () => {
    const { app, db } = await createTeamRoleTestApp()
    const { userId, cookies } = await signUpAndGetSession(app, db, 'viewer@example.com')
    const teamOrgId = await insertOrg(db, `team-${nanoid()}`)
    await insertMember(db, teamOrgId, userId, 'viewer')
    const updatedCookies = await setActiveOrg(app, cookies, teamOrgId)

    const res = await app.request('/api/test/viewer', { headers: { Cookie: updatedCookies } })
    expect(res.status).toBe(200)
  })

  it('editor-level route returns 403 for viewer', async () => {
    const { app, db } = await createTeamRoleTestApp()
    const { userId, cookies } = await signUpAndGetSession(app, db, 'viewer2@example.com')
    const teamOrgId = await insertOrg(db, `team-${nanoid()}`)
    await insertMember(db, teamOrgId, userId, 'viewer')
    const updatedCookies = await setActiveOrg(app, cookies, teamOrgId)

    const res = await app.request('/api/test/editor', { method: 'POST', headers: { Cookie: updatedCookies } })
    expect(res.status).toBe(403)
  })

  it('editor-level route returns Forbidden error body for viewer', async () => {
    const { app, db } = await createTeamRoleTestApp()
    const { userId, cookies } = await signUpAndGetSession(app, db, 'viewer3@example.com')
    const teamOrgId = await insertOrg(db, `team-${nanoid()}`)
    await insertMember(db, teamOrgId, userId, 'viewer')
    const updatedCookies = await setActiveOrg(app, cookies, teamOrgId)

    const res = await app.request('/api/test/editor', { method: 'POST', headers: { Cookie: updatedCookies } })
    const body = (await res.json()) as { error: { message: string } }
    expect(body.error.message).toBe('Forbidden')
  })
})

describe('requireTeamRole — team org with no membership', () => {
  it('viewer-level route returns 403 when user has no membership in the team org', async () => {
    const { app, db } = await createTeamRoleTestApp()
    const { userId, cookies } = await signUpAndGetSession(app, db, 'nomember@example.com')
    const teamOrgId = await insertOrg(db, `team-${nanoid()}`)
    // Insert a member row so setActiveOrg succeeds, then remove it to simulate lost membership
    await insertMember(db, teamOrgId, userId, 'viewer')
    const updatedCookies = await setActiveOrg(app, cookies, teamOrgId)
    await db
      .delete(authSchema.member)
      .where(and(eq(authSchema.member.organizationId, teamOrgId), eq(authSchema.member.userId, userId)))

    const res = await app.request('/api/test/viewer', { headers: { Cookie: updatedCookies } })
    expect(res.status).toBe(403)
  })

  it('editor-level route returns 403 when user has no membership in the team org', async () => {
    const { app, db } = await createTeamRoleTestApp()
    const { userId, cookies } = await signUpAndGetSession(app, db, 'nomember2@example.com')
    const teamOrgId = await insertOrg(db, `team-${nanoid()}`)
    await insertMember(db, teamOrgId, userId, 'viewer')
    const updatedCookies = await setActiveOrg(app, cookies, teamOrgId)
    await db
      .delete(authSchema.member)
      .where(and(eq(authSchema.member.organizationId, teamOrgId), eq(authSchema.member.userId, userId)))

    const res = await app.request('/api/test/editor', { method: 'POST', headers: { Cookie: updatedCookies } })
    expect(res.status).toBe(403)
  })
})

describe('requireTeamRole — unknown role', () => {
  it('editor-level route returns 403 for a user with an unknown role', async () => {
    const { app, db } = await createTeamRoleTestApp()
    const { userId, cookies } = await signUpAndGetSession(app, db, 'contrib@example.com')
    const teamOrgId = await insertOrg(db, `team-${nanoid()}`)
    // Insert as owner first so setActiveOrg succeeds, then downgrade to unknown role
    await insertMember(db, teamOrgId, userId, 'owner')
    const updatedCookies = await setActiveOrg(app, cookies, teamOrgId)
    await db
      .update(authSchema.member)
      .set({ role: 'contributor' })
      .where(and(eq(authSchema.member.organizationId, teamOrgId), eq(authSchema.member.userId, userId)))

    const res = await app.request('/api/test/editor', { method: 'POST', headers: { Cookie: updatedCookies } })
    expect(res.status).toBe(403)
  })

  it('viewer-level route returns 403 for a user with an unknown role', async () => {
    const { app, db } = await createTeamRoleTestApp()
    const { userId, cookies } = await signUpAndGetSession(app, db, 'contrib2@example.com')
    const teamOrgId = await insertOrg(db, `team-${nanoid()}`)
    await insertMember(db, teamOrgId, userId, 'owner')
    const updatedCookies = await setActiveOrg(app, cookies, teamOrgId)
    await db
      .update(authSchema.member)
      .set({ role: 'contributor' })
      .where(and(eq(authSchema.member.organizationId, teamOrgId), eq(authSchema.member.userId, userId)))

    const res = await app.request('/api/test/viewer', { headers: { Cookie: updatedCookies } })
    expect(res.status).toBe(403)
  })
})
