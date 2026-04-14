import { nanoid } from 'nanoid'
import { describe, expect, it } from 'vitest'
import * as authSchema from '../db/auth-schema.js'
import { createInviteLink } from '../services/team-invite.js'
import { createTestApp } from '../test/setup.js'

type TestDb = Awaited<ReturnType<typeof createTestApp>>['db']
type TestApp = Awaited<ReturnType<typeof createTestApp>>['app']

async function insertUser(db: TestDb, overrides: Partial<{ id: string; email: string }> = {}) {
  const id = overrides.id ?? nanoid()
  await db.insert(authSchema.user).values({
    id,
    name: 'Test User',
    email: overrides.email ?? `${id}@example.com`,
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  return id
}

async function insertOrg(db: TestDb, overrides: Partial<{ id: string; name: string }> = {}) {
  const id = overrides.id ?? nanoid()
  await db.insert(authSchema.organization).values({
    id,
    name: overrides.name ?? 'Test Org',
    slug: nanoid(),
    createdAt: new Date(),
  })
  return id
}

async function insertMember(db: TestDb, organizationId: string, userId: string, role = 'owner') {
  await db.insert(authSchema.member).values({
    id: nanoid(),
    organizationId,
    userId,
    role,
    createdAt: new Date(),
  })
}

async function signUpAndGetUser(app: TestApp, email: string) {
  const res = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Test User', email, password: 'password123456' }),
  })
  const headers = { Cookie: res.headers.getSetCookie().join('; ') }
  const body = (await res.json()) as { user?: { id: string } }
  return { headers, userId: body.user?.id ?? '' }
}

// ─── Public invite-info ────────────────────────────────────────────────────────

describe('GET /api/teams/invite-info', () => {
  it('returns 400 when token is missing', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/teams/invite-info')
    expect(res.status).toBe(400)
  })

  it('returns 404 for an invalid token', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/teams/invite-info?token=invalid')
    expect(res.status).toBe(404)
  })

  it('returns invite info for a valid token without auth', async () => {
    const { app, db } = await createTestApp()
    const orgId = await insertOrg(db, { name: 'My Team' })
    const inviterId = await insertUser(db)
    const link = await createInviteLink(db, orgId, inviterId, 'viewer')

    const res = await app.request(`/api/teams/invite-info?token=${link.token}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { organizationName: string; role: string }
    expect(body.organizationName).toBe('My Team')
    expect(body.role).toBe('viewer')
  })
})

// ─── POST /:teamId/invite-link ─────────────────────────────────────────────────

describe('POST /api/teams/:teamId/invite-link', () => {
  it('returns 401 without auth', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/teams/some-org/invite-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'viewer' }),
    })
    expect(res.status).toBe(401)
  })

  it('returns 403 when user is not an owner', async () => {
    const { app, db } = await createTestApp()
    const email = `member-${nanoid()}@example.com`
    const { headers, userId } = await signUpAndGetUser(app, email)

    const orgId = await insertOrg(db)
    await insertMember(db, orgId, userId, 'member')

    const res = await app.request(`/api/teams/${orgId}/invite-link`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'viewer' }),
    })
    expect(res.status).toBe(403)
  })

  it('returns 201 with token when owner creates an invite link', async () => {
    const { app, db } = await createTestApp()
    const email = `owner-${nanoid()}@example.com`
    const { headers, userId } = await signUpAndGetUser(app, email)

    const orgId = await insertOrg(db)
    await insertMember(db, orgId, userId, 'owner')

    const res = await app.request(`/api/teams/${orgId}/invite-link`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'editor' }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { token: string; expiresAt: string }
    expect(body.token).toBeTruthy()
    expect(body.expiresAt).toBeTruthy()
  })
})

// ─── GET /:teamId/invitations ─────────────────────────────────────────────────

describe('GET /api/teams/:teamId/invitations', () => {
  it('returns 401 without auth', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/teams/some-org/invitations')
    expect(res.status).toBe(401)
  })

  it('returns 403 when user is not an owner', async () => {
    const { app, db } = await createTestApp()
    const email = `viewer-${nanoid()}@example.com`
    const { headers, userId } = await signUpAndGetUser(app, email)

    const orgId = await insertOrg(db)
    await insertMember(db, orgId, userId, 'viewer')

    const res = await app.request(`/api/teams/${orgId}/invitations`, { headers })
    expect(res.status).toBe(403)
  })

  it('returns empty list when no pending invitations', async () => {
    const { app, db } = await createTestApp()
    const email = `owner2-${nanoid()}@example.com`
    const { headers, userId } = await signUpAndGetUser(app, email)

    const orgId = await insertOrg(db)
    await insertMember(db, orgId, userId, 'owner')

    const res = await app.request(`/api/teams/${orgId}/invitations`, { headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { invitations: unknown[] }
    expect(body.invitations).toEqual([])
  })
})

// ─── POST /join ────────────────────────────────────────────────────────────────

describe('POST /api/teams/join', () => {
  it('returns 401 without auth', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/teams/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'some-token' }),
    })
    expect(res.status).toBe(401)
  })

  it('returns 404 for an invalid token', async () => {
    const { app } = await createTestApp()
    const email = `joiner-${nanoid()}@example.com`
    const { headers } = await signUpAndGetUser(app, email)

    const res = await app.request('/api/teams/join', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'invalid-token' }),
    })
    expect(res.status).toBe(404)
  })

  it('returns 200 and joins the team with a valid token', async () => {
    const { app, db } = await createTestApp()
    const orgId = await insertOrg(db)
    const inviterId = await insertUser(db)
    const link = await createInviteLink(db, orgId, inviterId, 'viewer')

    const email = `newmember-${nanoid()}@example.com`
    const { headers } = await signUpAndGetUser(app, email)

    const res = await app.request('/api/teams/join', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: link.token }),
    })
    expect(res.status).toBe(200)
  })

  it('returns 409 when user is already a member', async () => {
    const { app, db } = await createTestApp()
    const orgId = await insertOrg(db)
    const inviterId = await insertUser(db)
    const link = await createInviteLink(db, orgId, inviterId, 'viewer')

    const email = `existing-${nanoid()}@example.com`
    const { headers, userId } = await signUpAndGetUser(app, email)
    await insertMember(db, orgId, userId, 'viewer')

    const res = await app.request('/api/teams/join', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: link.token }),
    })
    expect(res.status).toBe(409)
  })
})
