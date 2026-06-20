import { sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTeamInviteRepo } from '../adapters/repos/team-invite.js'
import * as authSchema from '../db/auth-schema.js'
import { createTestApp, seedBusinessLicense } from '../test/setup.js'

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

// ─── Public invite-link info ────────────────────────────────────────────────────

describe('GET /api/teams/invite-links/:token', () => {
  it('returns 404 for an invalid token', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/teams/invite-links/invalid')
    expect(res.status).toBe(404)
  })

  it('returns invite info for a valid token without auth [spec: teams/invite-info-public]', async () => {
    const { app, db } = await createTestApp()
    const orgId = await insertOrg(db, { name: 'My Team' })
    const inviterId = await insertUser(db)
    const link = await createTeamInviteRepo(db).createInviteLink(orgId, inviterId, 'viewer')

    const res = await app.request(`/api/teams/invite-links/${link.token}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { organizationName: string; role: string }
    expect(body.organizationName).toBe('My Team')
    expect(body.role).toBe('viewer')
  })
})

// ─── POST /:teamId/invite-links ────────────────────────────────────────────────

describe('POST /api/teams/:teamId/invite-links', () => {
  it('returns 401 without auth', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/teams/some-org/invite-links', {
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

    const res = await app.request(`/api/teams/${orgId}/invite-links`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'viewer' }),
    })
    expect(res.status).toBe(403)
  })

  it('returns 201 with token when owner creates an invite link [spec: teams/create-invite]', async () => {
    const { app, db } = await createTestApp()
    const email = `owner-${nanoid()}@example.com`
    const { headers, userId } = await signUpAndGetUser(app, email)

    const orgId = await insertOrg(db)
    await insertMember(db, orgId, userId, 'owner')

    const res = await app.request(`/api/teams/${orgId}/invite-links`, {
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

  it('returns empty list when no pending invitations [spec: teams/list-pending-empty]', async () => {
    const { app, db } = await createTestApp()
    const email = `owner2-${nanoid()}@example.com`
    const { headers, userId } = await signUpAndGetUser(app, email)

    const orgId = await insertOrg(db)
    await insertMember(db, orgId, userId, 'owner')

    const res = await app.request(`/api/teams/${orgId}/invitations`, { headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: unknown[]; total: number; page: number; pageSize: number }
    expect(body.items).toEqual([])
    expect(body.total).toBe(0)
    expect(body.page).toBe(1)
  })
})

// ─── POST /:teamId/members ─────────────────────────────────────────────────────

describe('POST /api/teams/:teamId/members', () => {
  it('returns 401 without auth', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/teams/some-team/members', {
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

    const res = await app.request('/api/teams/some-team/members', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'invalid-token' }),
    })
    expect(res.status).toBe(404)
  })

  it('returns 200 and joins the team with a valid token [spec: teams/join]', async () => {
    const { app, db } = await createTestApp()
    const orgId = await insertOrg(db)
    const inviterId = await insertUser(db)
    const link = await createTeamInviteRepo(db).createInviteLink(orgId, inviterId, 'viewer')

    const email = `newmember-${nanoid()}@example.com`
    const { headers } = await signUpAndGetUser(app, email)

    const res = await app.request(`/api/teams/${orgId}/members`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: link.token }),
    })
    expect(res.status).toBe(200)
  })

  it('returns 409 when user is already a member [spec: teams/join-already-member]', async () => {
    const { app, db } = await createTestApp()
    const orgId = await insertOrg(db)
    const inviterId = await insertUser(db)
    const link = await createTeamInviteRepo(db).createInviteLink(orgId, inviterId, 'viewer')

    const email = `existing-${nanoid()}@example.com`
    const { headers, userId } = await signUpAndGetUser(app, email)
    await insertMember(db, orgId, userId, 'viewer')

    const res = await app.request(`/api/teams/${orgId}/members`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: link.token }),
    })
    expect(res.status).toBe(409)
  })
})

// ─── Activity feed tests (from master) ────────────────────────────────────────

import { authedHeaders } from '../test/setup.js'

type DbType = Awaited<ReturnType<typeof createTestApp>>['db']

async function getOrgId(db: DbType): Promise<string> {
  const rows = await db.all<{ id: string }>(
    sql`SELECT id FROM organization WHERE metadata LIKE '%"type":"personal"%' LIMIT 1`,
  )
  return rows[0].id
}

async function getUserId(db: DbType, email = 'test@example.com'): Promise<string> {
  const rows = await db.all<{ id: string }>(sql`SELECT id FROM user WHERE email = ${email}`)
  return rows[0].id
}

async function insertActivityEvent(
  db: DbType,
  opts: {
    id: string
    orgId: string
    userId: string
    action?: string
    targetType?: string
    targetId?: string | null
    targetName?: string
    metadata?: string | null
    createdAt?: number
  },
) {
  await db.run(sql`
    INSERT INTO activity_events (id, org_id, user_id, action, target_type, target_id, target_name, metadata, created_at)
    VALUES (
      ${opts.id},
      ${opts.orgId},
      ${opts.userId},
      ${opts.action ?? 'upload'},
      ${opts.targetType ?? 'file'},
      ${opts.targetId ?? null},
      ${opts.targetName ?? 'report.pdf'},
      ${opts.metadata ?? null},
      ${opts.createdAt ?? Date.now()}
    )
  `)
}

// ─── Auth guard ────────────────────────────────────────────────────────────────

describe('GET /api/teams/:teamId/activity — auth', () => {
  it('returns 401 without auth', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/teams/some-id/activity')
    expect(res.status).toBe(401)
  })
})

// ─── Access control ────────────────────────────────────────────────────────────

describe('GET /api/teams/:teamId/activity — access control', () => {
  it('returns 403 when authed user is not a member of a non-personal org [spec: teams/access-non-member]', async () => {
    const { app, db } = await createTestApp()

    // Sign up a user (their personal org is created automatically)
    const headers1 = await authedHeaders(app, 'user1@example.com')
    const userId1 = await getUserId(db, 'user1@example.com')

    // Create a non-personal team org and add only user1 as a member
    const now = Date.now()
    await db.run(
      sql`INSERT INTO organization (id, name, slug, metadata, created_at) VALUES ('team-org-1', 'Team One', 'team-one', '{"type":"team"}', ${now})`,
    )
    await db.run(
      sql`INSERT INTO member (id, organization_id, user_id, role, created_at) VALUES ('mem-1', 'team-org-1', ${userId1}, 'owner', ${now})`,
    )

    // Sign up user2 (not a member of the team org) and try to access it
    const headers2 = await authedHeaders(app, 'user2@example.com')

    // Suppress unused variable warning
    void headers1

    const res = await app.request('/api/teams/team-org-1/activity', { headers: headers2 })
    expect(res.status).toBe(403)
  })

  it('returns 200 when authed user is the owner of their personal org', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    const orgId = await getOrgId(db)

    const res = await app.request(`/api/teams/${orgId}/activity`, { headers })
    expect(res.status).toBe(200)
  })

  it('returns 200 when authed user accesses any personal org (personal orgs are public to auth users) [spec: teams/access-personal-public]', async () => {
    const { app, db } = await createTestApp()

    // Sign up user1
    await authedHeaders(app, 'user1@example.com')
    const userId1 = await getUserId(db, 'user1@example.com')

    // Get user1's personal org
    const rows = await db.all<{ id: string }>(
      sql`SELECT id FROM organization WHERE slug = ${`personal-${userId1}`} LIMIT 1`,
    )
    const orgId1 = rows[0].id

    // Sign up user2 and access user1's personal org
    const headers2 = await authedHeaders(app, 'user2@example.com')

    const res = await app.request(`/api/teams/${orgId1}/activity`, { headers: headers2 })
    expect(res.status).toBe(200)
  })

  it('returns 200 when authed user is a member of a non-personal team org [spec: teams/access-team-member]', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    const userId = await getUserId(db)

    const now = Date.now()
    await db.run(
      sql`INSERT INTO organization (id, name, slug, metadata, created_at) VALUES ('team-org-2', 'My Team', 'my-team', '{"type":"team"}', ${now})`,
    )
    await db.run(
      sql`INSERT INTO member (id, organization_id, user_id, role, created_at) VALUES ('mem-t2', 'team-org-2', ${userId}, 'member', ${now})`,
    )

    const res = await app.request('/api/teams/team-org-2/activity', { headers })
    expect(res.status).toBe(200)
  })
})

// ─── Happy path ────────────────────────────────────────────────────────────────

describe('GET /api/teams/:teamId/activity — happy path', () => {
  it('returns empty items list when there are no activity events', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    const orgId = await getOrgId(db)

    const res = await app.request(`/api/teams/${orgId}/activity`, { headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: unknown[]; total: number; page: number; pageSize: number }
    expect(body.items).toEqual([])
    expect(body.total).toBe(0)
  })

  it('returns activity items with user info when events exist [spec: teams/activity-feed]', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    const orgId = await getOrgId(db)
    const userId = await getUserId(db)

    await insertActivityEvent(db, { id: 'evt-1', orgId, userId, targetName: 'document.pdf' })

    const res = await app.request(`/api/teams/${orgId}/activity`, { headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      items: Array<{ id: string; targetName: string; user: { id: string; name: string; image: string | null } }>
      total: number
    }
    expect(body.total).toBe(1)
    expect(body.items).toHaveLength(1)
    expect(body.items[0].id).toBe('evt-1')
    expect(body.items[0].targetName).toBe('document.pdf')
    expect(body.items[0].user).toMatchObject({ id: userId, name: 'Test User' })
  })

  it('includes all expected activity event fields in each item', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    const orgId = await getOrgId(db)
    const userId = await getUserId(db)

    await insertActivityEvent(db, {
      id: 'evt-fields',
      orgId,
      userId,
      action: 'delete',
      targetType: 'folder',
      targetId: 'folder-abc',
      targetName: 'archive',
    })

    const res = await app.request(`/api/teams/${orgId}/activity`, { headers })
    const body = (await res.json()) as {
      items: Array<{
        id: string
        orgId: string
        userId: string
        action: string
        targetType: string
        targetId: string
        targetName: string
      }>
    }
    const item = body.items[0]
    expect(item.orgId).toBe(orgId)
    expect(item.userId).toBe(userId)
    expect(item.action).toBe('delete')
    expect(item.targetType).toBe('folder')
    expect(item.targetId).toBe('folder-abc')
    expect(item.targetName).toBe('archive')
  })

  it('returns user image as null when user has no image', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    const orgId = await getOrgId(db)
    const userId = await getUserId(db)

    await insertActivityEvent(db, { id: 'evt-img', orgId, userId })

    const res = await app.request(`/api/teams/${orgId}/activity`, { headers })
    const body = (await res.json()) as { items: Array<{ user: { image: string | null } }> }
    expect(body.items[0].user.image).toBeNull()
  })
})

// ─── Pagination ────────────────────────────────────────────────────────────────

describe('GET /api/teams/:teamId/activity — pagination', () => {
  it('returns default page=1 and pageSize=20 in response', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    const orgId = await getOrgId(db)

    const res = await app.request(`/api/teams/${orgId}/activity`, { headers })
    const body = (await res.json()) as { page: number; pageSize: number }
    expect(body.page).toBe(1)
    expect(body.pageSize).toBe(20)
  })

  it('respects explicit page and pageSize query params [spec: teams/activity-pagination]', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    const orgId = await getOrgId(db)

    const res = await app.request(`/api/teams/${orgId}/activity?page=2&pageSize=5`, { headers })
    const body = (await res.json()) as { page: number; pageSize: number }
    expect(body.page).toBe(2)
    expect(body.pageSize).toBe(5)
  })

  it('returns correct total count regardless of page', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    const orgId = await getOrgId(db)
    const userId = await getUserId(db)

    const now = Date.now()
    for (let i = 1; i <= 7; i++) {
      await insertActivityEvent(db, { id: `evt-total-${i}`, orgId, userId, createdAt: now + i })
    }

    const res = await app.request(`/api/teams/${orgId}/activity?page=1&pageSize=3`, { headers })
    const body = (await res.json()) as { items: unknown[]; total: number }
    expect(body.total).toBe(7)
    expect(body.items).toHaveLength(3)
  })

  it('returns correct items on second page', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    const orgId = await getOrgId(db)
    const userId = await getUserId(db)

    const now = Date.now()
    for (let i = 1; i <= 5; i++) {
      await insertActivityEvent(db, {
        id: `evt-page-${i}`,
        orgId,
        userId,
        targetName: `file-${i}.pdf`,
        createdAt: now + i,
      })
    }

    // Page 2 with pageSize 3 should yield 2 items (the oldest two)
    const res = await app.request(`/api/teams/${orgId}/activity?page=2&pageSize=3`, { headers })
    const body = (await res.json()) as { items: Array<{ id: string }>; total: number }
    expect(body.total).toBe(5)
    expect(body.items).toHaveLength(2)
  })

  it('returns empty items when page is beyond total results', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    const orgId = await getOrgId(db)
    const userId = await getUserId(db)

    await insertActivityEvent(db, { id: 'evt-single', orgId, userId })

    const res = await app.request(`/api/teams/${orgId}/activity?page=99&pageSize=20`, { headers })
    const body = (await res.json()) as { items: unknown[]; total: number }
    expect(body.total).toBe(1)
    expect(body.items).toHaveLength(0)
  })
})

// ─── Ordering ─────────────────────────────────────────────────────────────────

describe('GET /api/teams/:teamId/activity — ordering', () => {
  it('returns items ordered by newest first [spec: teams/activity-newest-first]', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    const orgId = await getOrgId(db)
    const userId = await getUserId(db)

    const base = Date.now()
    await insertActivityEvent(db, { id: 'evt-old', orgId, userId, targetName: 'old.pdf', createdAt: base })
    await insertActivityEvent(db, { id: 'evt-new', orgId, userId, targetName: 'new.pdf', createdAt: base + 1000 })

    const res = await app.request(`/api/teams/${orgId}/activity`, { headers })
    const body = (await res.json()) as { items: Array<{ id: string }> }
    expect(body.items[0].id).toBe('evt-new')
    expect(body.items[1].id).toBe('evt-old')
  })
})

// ─── Metadata ─────────────────────────────────────────────────────────────────

describe('GET /api/teams/:teamId/activity — metadata', () => {
  it('returns metadata field as stored when metadata is present', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    const orgId = await getOrgId(db)
    const userId = await getUserId(db)

    await insertActivityEvent(db, {
      id: 'evt-meta',
      orgId,
      userId,
      metadata: JSON.stringify({ size: 1024, mime: 'application/pdf' }),
    })

    const res = await app.request(`/api/teams/${orgId}/activity`, { headers })
    const body = (await res.json()) as { items: Array<{ metadata: string | null }> }
    expect(body.items[0].metadata).toBe('{"size":1024,"mime":"application/pdf"}')
  })

  it('returns null metadata when no metadata was stored', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    const orgId = await getOrgId(db)
    const userId = await getUserId(db)

    await insertActivityEvent(db, { id: 'evt-nometa', orgId, userId, metadata: null })

    const res = await app.request(`/api/teams/${orgId}/activity`, { headers })
    const body = (await res.json()) as { items: Array<{ metadata: string | null }> }
    expect(body.items[0].metadata).toBeNull()
  })
})

// ─── Multiple events across orgs ──────────────────────────────────────────────

describe('GET /api/teams/:teamId/activity — isolation', () => {
  it('only returns events for the requested org, not other orgs', async () => {
    const { app, db } = await createTestApp()
    const headers1 = await authedHeaders(app, 'user1@example.com')
    const userId1 = await getUserId(db, 'user1@example.com')

    // Get user1's org
    const allOrgs = await db.all<{ id: string; metadata: string }>(sql`SELECT id, metadata FROM organization`)
    const org1 = allOrgs.find((r) => {
      try {
        return (JSON.parse(r.metadata) as { type?: string }).type === 'personal'
      } catch {
        return false
      }
    })
    if (!org1) throw new Error('personal org for user1 not found')
    const orgId1 = org1.id

    // Sign up user2 to create a second org
    await authedHeaders(app, 'user2@example.com')
    const userId2 = await getUserId(db, 'user2@example.com')
    const allOrgs2 = await db.all<{ id: string; metadata: string }>(sql`SELECT id, metadata FROM organization`)
    const orgsWithPersonal = allOrgs2.filter((r) => {
      try {
        return (JSON.parse(r.metadata) as { type?: string }).type === 'personal'
      } catch {
        return false
      }
    })
    const org2 = orgsWithPersonal.find((r) => r.id !== orgId1)
    if (!org2) throw new Error('personal org for user2 not found')
    const orgId2 = org2.id

    await insertActivityEvent(db, { id: 'evt-org1', orgId: orgId1, userId: userId1, targetName: 'user1-file.pdf' })
    await insertActivityEvent(db, { id: 'evt-org2', orgId: orgId2, userId: userId2, targetName: 'user2-file.pdf' })

    const res = await app.request(`/api/teams/${orgId1}/activity`, { headers: headers1 })
    const body = (await res.json()) as { items: Array<{ id: string }>; total: number }
    expect(body.total).toBe(1)
    expect(body.items[0].id).toBe('evt-org1')
  })

  it('returns items with all expected fields', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    const orgId = await getOrgId(db)
    const userId = await getUserId(db)

    await insertActivityEvent(db, {
      id: 'evt-fields',
      orgId,
      userId,
      action: 'move',
      targetType: 'folder',
      targetId: 'folder-1',
      targetName: 'My Folder',
      metadata: JSON.stringify({ from: '/old', to: '/new' }),
    })

    const res = await app.request(`/api/teams/${orgId}/activity`, { headers })
    const body = (await res.json()) as { items: Array<Record<string, unknown>>; total: number }
    const item = body.items[0]
    expect(item.id).toBe('evt-fields')
    expect(item.action).toBe('move')
    expect(item.targetType).toBe('folder')
    expect(item.targetId).toBe('folder-1')
    expect(item.targetName).toBe('My Folder')
    expect(item.metadata).toBe(JSON.stringify({ from: '/old', to: '/new' }))
    expect(item.user).toBeDefined()
  })
})

// ─── Org logo (PUT/DELETE /:teamId/logo) ─────────────────────────────────────

const CLOUD_LOGO_URL = 'https://avatars.zpan.cloud/team/logo.png'

// Stub the Cloud avatar service and capture each request so tests can assert the
// /avatars/team/:id path, the image content type, and the bearer auth that reach
// Cloud. `seedBusinessLicense` makes the instance Cloud-paired.
function stubCloudAvatarFetch() {
  const calls: { url: string; method: string; contentType: string | null; authorization: string | null }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url)
      if (u.includes('/avatars/')) {
        const headers = new Headers(init?.headers)
        calls.push({
          url: u,
          method: init?.method ?? 'GET',
          contentType: headers.get('content-type'),
          authorization: headers.get('authorization'),
        })
        if (init?.method === 'DELETE') return new Response(null, { status: 204 })
        return new Response(JSON.stringify({ url: CLOUD_LOGO_URL, key: 'avatars/team/logo' }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response('unexpected fetch', { status: 404 })
    }),
  )
  return calls
}

function makeFile(type: string, bytes = 16): File {
  return new File([new Uint8Array(bytes)], `f.${type.split('/')[1]}`, { type })
}

describe('PUT /api/teams/:teamId/logo', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('returns 401 without auth', async () => {
    const { app } = await createTestApp()
    const form = new FormData()
    form.set('file', makeFile('image/png'))
    const res = await app.request('/api/teams/some-org/logo', { method: 'PUT', body: form })
    expect(res.status).toBe(401)
  })

  it('returns 403 when caller is not owner/admin', async () => {
    const { app, db } = await createTestApp()
    const { headers, userId } = await signUpAndGetUser(app, `m-${nanoid()}@example.com`)
    const orgId = await insertOrg(db)
    await insertMember(db, orgId, userId, 'member')

    const form = new FormData()
    form.set('file', makeFile('image/png'))
    const res = await app.request(`/api/teams/${orgId}/logo`, { method: 'PUT', headers, body: form })
    expect(res.status).toBe(403)
  })

  it('returns 400 for an unsupported mime, before any Cloud call', async () => {
    const { app, db } = await createTestApp()
    await seedBusinessLicense(db)
    const { headers, userId } = await signUpAndGetUser(app, `o-${nanoid()}@example.com`)
    const orgId = await insertOrg(db)
    await insertMember(db, orgId, userId, 'owner')
    const calls = stubCloudAvatarFetch()

    const form = new FormData()
    form.set('file', makeFile('application/pdf'))
    const res = await app.request(`/api/teams/${orgId}/logo`, { method: 'PUT', headers, body: form })
    expect(res.status).toBe(400)
    expect(calls).toHaveLength(0)
  })

  it('returns 413 when file > 1 MiB, before any Cloud call', async () => {
    const { app, db } = await createTestApp()
    await seedBusinessLicense(db)
    const { headers, userId } = await signUpAndGetUser(app, `o-${nanoid()}@example.com`)
    const orgId = await insertOrg(db)
    await insertMember(db, orgId, userId, 'owner')
    const calls = stubCloudAvatarFetch()

    const form = new FormData()
    form.set('file', makeFile('image/png', 2 * 1024 * 1024))
    const res = await app.request(`/api/teams/${orgId}/logo`, { method: 'PUT', headers, body: form })
    expect(res.status).toBe(413)
    expect(calls).toHaveLength(0)
  })

  it('returns 503 cloud_required when the instance is not paired to Cloud', async () => {
    const { app, db } = await createTestApp()
    const { headers, userId } = await signUpAndGetUser(app, `o-${nanoid()}@example.com`)
    const orgId = await insertOrg(db)
    await insertMember(db, orgId, userId, 'owner')

    const form = new FormData()
    form.set('file', makeFile('image/png'))
    const res = await app.request(`/api/teams/${orgId}/logo`, { method: 'PUT', headers, body: form })
    expect(res.status).toBe(503)
  })

  it('hosts the logo on Cloud + writes organization.logo + returns URL (owner)', async () => {
    const { app, db } = await createTestApp()
    await seedBusinessLicense(db)
    const { headers, userId } = await signUpAndGetUser(app, `o-${nanoid()}@example.com`)
    const orgId = await insertOrg(db)
    await insertMember(db, orgId, userId, 'owner')
    const calls = stubCloudAvatarFetch()

    const form = new FormData()
    form.set('file', makeFile('image/jpeg'))
    const res = await app.request(`/api/teams/${orgId}/logo`, { method: 'PUT', headers, body: form })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { url: string }
    expect(body.url).toBe(CLOUD_LOGO_URL)

    const put = calls.find((c) => c.method === 'PUT')
    expect(put?.url).toContain(`/avatars/team/${orgId}`)
    expect(put?.contentType).toBe('image/jpeg')
    expect(put?.authorization).toBe('Bearer test-refresh-token')

    const rows = await db.all<{ logo: string | null }>(sql`SELECT logo FROM organization WHERE id = ${orgId}`)
    expect(rows[0]?.logo).toBe(CLOUD_LOGO_URL)
  })

  it('succeeds for admin role (not just owner)', async () => {
    const { app, db } = await createTestApp()
    await seedBusinessLicense(db)
    const { headers, userId } = await signUpAndGetUser(app, `a-${nanoid()}@example.com`)
    const orgId = await insertOrg(db)
    await insertMember(db, orgId, userId, 'admin')
    stubCloudAvatarFetch()

    const form = new FormData()
    form.set('file', makeFile('image/png'))
    const res = await app.request(`/api/teams/${orgId}/logo`, { method: 'PUT', headers, body: form })
    expect(res.status).toBe(200)
  })
})

describe('DELETE /api/teams/:teamId/logo', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('returns 401 without auth', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/teams/some-org/logo', { method: 'DELETE' })
    expect(res.status).toBe(401)
  })

  it('returns 403 when caller is not owner/admin', async () => {
    const { app, db } = await createTestApp()
    const { headers, userId } = await signUpAndGetUser(app, `m-${nanoid()}@example.com`)
    const orgId = await insertOrg(db)
    await insertMember(db, orgId, userId, 'member')

    const res = await app.request(`/api/teams/${orgId}/logo`, { method: 'DELETE', headers })
    expect(res.status).toBe(403)
  })

  it('clears organization.logo + deletes the Cloud logo', async () => {
    const { app, db } = await createTestApp()
    await seedBusinessLicense(db)
    const { headers, userId } = await signUpAndGetUser(app, `o-${nanoid()}@example.com`)
    const orgId = await insertOrg(db)
    await insertMember(db, orgId, userId, 'owner')
    await db.run(sql`UPDATE organization SET logo = 'https://example.com/old.png' WHERE id = ${orgId}`)
    const calls = stubCloudAvatarFetch()

    const res = await app.request(`/api/teams/${orgId}/logo`, { method: 'DELETE', headers })
    expect(res.status).toBe(204)

    const rows = await db.all<{ logo: string | null }>(sql`SELECT logo FROM organization WHERE id = ${orgId}`)
    expect(rows[0]?.logo).toBeNull()
    const del = calls.find((c) => c.method === 'DELETE')
    expect(del?.url).toContain(`/avatars/team/${orgId}`)
  })

  it('succeeds when the instance is not paired to Cloud (DB cleared, Cloud delete skipped)', async () => {
    const { app, db } = await createTestApp()
    const { headers, userId } = await signUpAndGetUser(app, `o-${nanoid()}@example.com`)
    const orgId = await insertOrg(db)
    await insertMember(db, orgId, userId, 'owner')
    await db.run(sql`UPDATE organization SET logo = 'https://example.com/old.png' WHERE id = ${orgId}`)
    const calls = stubCloudAvatarFetch()

    const res = await app.request(`/api/teams/${orgId}/logo`, { method: 'DELETE', headers })
    expect(res.status).toBe(204)
    const rows = await db.all<{ logo: string | null }>(sql`SELECT logo FROM organization WHERE id = ${orgId}`)
    expect(rows[0]?.logo).toBeNull()
    expect(calls).toHaveLength(0)
  })
})

// ─── Admin Teams API (/api/teams admin-console resources) ─────────────────────
// Reuses the module-level TestDb/TestApp aliases declared above.

async function adminHeaders(app: TestApp) {
  await authedHeaders(app, 'admin@example.com', 'password123456')
  const signInRes = await app.request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', password: 'password123456' }),
  })
  return { Cookie: signInRes.headers.getSetCookie().join('; ') }
}

async function seedTeam(
  db: TestDb,
  opts: { id: string; name: string; quota?: number; ownerId?: string; memberIds?: string[] },
) {
  await db.run(sql`
    INSERT INTO organization (id, name, slug, metadata)
    VALUES (${opts.id}, ${opts.name}, ${opts.id}, '{"type":"team"}')
  `)
  await db.run(sql`
    INSERT INTO org_quotas (id, org_id, quota, used, traffic_quota, traffic_used, traffic_period)
    VALUES (${`quota-${opts.id}`}, ${opts.id}, 0, 0, 0, 0, '1970-01')
  `)
  const now = Date.now()
  if (opts.quota !== undefined) {
    await db.run(sql`
      INSERT INTO org_quota_entitlements
        (id, org_id, resource_type, entitlement_type, source, source_id, bytes, starts_at, status, created_at, updated_at)
      VALUES
        (${`ent-${opts.id}`}, ${opts.id}, 'storage', 'plan', 'free_plan', ${`free_plan:${opts.id}`}, ${opts.quota}, ${now}, 'active', ${now}, ${now})
    `)
  }
  for (const [i, uid] of (opts.memberIds ?? []).entries()) {
    const role = uid === opts.ownerId ? 'owner' : 'editor'
    await db.run(sql`
      INSERT INTO member (id, organization_id, user_id, role)
      VALUES (${`m-${opts.id}-${i}`}, ${opts.id}, ${uid}, ${role})
    `)
  }
}

async function userId(db: TestDb, email: string): Promise<string> {
  const rows = await db.all<{ id: string }>(sql`SELECT id FROM user WHERE email = ${email}`)
  return rows[0].id
}

describe('Admin Teams API', () => {
  it('requires admin [spec: teams-admin/admin-only]', async () => {
    const { app } = await createTestApp()
    const noAuth = await app.request('/api/teams')
    expect(noAuth.status).toBe(401)

    // First sign-up becomes admin; a later sign-up is a plain member.
    await authedHeaders(app, 'admin@example.com', 'password123456')
    await authedHeaders(app, 'plain@example.com', 'password123456')
    const signIn = await app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'plain@example.com', password: 'password123456' }),
    })
    const headers = { Cookie: signIn.headers.getSetCookie().join('; ') }
    const forbidden = await app.request('/api/teams', { headers })
    expect(forbidden.status).toBe(403)
  })

  it('lists only team orgs with usage, members, and owner, excluding personal spaces [spec: teams-admin/list]', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    const adminId = await userId(db, 'admin@example.com')
    await seedTeam(db, { id: 'team-a', name: 'Alpha', quota: 20971520, ownerId: adminId, memberIds: [adminId] })
    await seedTeam(db, { id: 'team-b', name: 'Beta' }) // unlimited, no members

    const res = await app.request('/api/teams', { headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: Array<Record<string, unknown>>; total: number }

    // admin's personal org must not appear
    expect(body.items.every((t) => !String(t.slug).startsWith('personal-'))).toBe(true)
    expect(body.total).toBe(2)

    const alpha = body.items.find((t) => t.id === 'team-a')!
    expect(alpha.quotaTotal).toBe(20971520)
    expect(alpha.memberCount).toBe(1)
    expect(alpha.ownerName).toBeTruthy()

    const beta = body.items.find((t) => t.id === 'team-b')!
    expect(beta.quotaTotal).toBe(0)
    expect(beta.memberCount).toBe(0)
    expect(beta.ownerName).toBeNull()
  })

  it('returns a single team detail [spec: teams-admin/detail]', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await seedTeam(db, { id: 'team-x', name: 'Detail', quota: 10485760 })

    const res = await app.request('/api/teams/team-x', { headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { id: string; name: string; quotaTotal: number }
    expect(body.id).toBe('team-x')
    expect(body.name).toBe('Detail')
    expect(body.quotaTotal).toBe(10485760)
  })

  it('returns 404 for a missing or personal org [spec: teams-admin/detail-not-found]', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)

    const missing = await app.request('/api/teams/nope', { headers })
    expect(missing.status).toBe(404)

    const personalOrg = await db.all<{ id: string }>(
      sql`SELECT id FROM organization WHERE slug LIKE 'personal-%' LIMIT 1`,
    )
    const personal = await app.request(`/api/teams/${personalOrg[0].id}`, { headers })
    expect(personal.status).toBe(404)
  })
})

describe('Admin Team Entitlements API', () => {
  it('grants, lists, and revokes a storage entitlement for a team [spec: teams-admin/entitlement-lifecycle]', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await seedTeam(db, { id: 'team-q1', name: 'Quota Team' })

    const grant = await app.request('/api/teams/team-q1/entitlements', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ resourceType: 'storage', bytes: 1024, note: 'starter' }),
    })
    expect(grant.status).toBe(201)
    const granted = (await grant.json()) as { orgId: string; entitlement: { id: string; bytes: number } }
    expect(granted.orgId).toBe('team-q1')
    expect(granted.entitlement.bytes).toBe(1024)

    const list = await app.request('/api/teams/team-q1/entitlements', { headers })
    expect(list.status).toBe(200)
    const listed = (await list.json()) as { items: Array<{ id: string; status: string }> }
    expect(listed.items).toHaveLength(1)
    expect(listed.items[0].status).toBe('active')

    // Effective quota (overview endpoint) reflects the grant
    const quotas = await app.request('/api/quotas', { headers })
    const quotasBody = (await quotas.json()) as { items: Array<{ orgId: string; entitlementQuota: number }> }
    expect(quotasBody.items.find((item) => item.orgId === 'team-q1')?.entitlementQuota).toBe(1024)

    const revoke = await app.request(`/api/teams/team-q1/entitlements/${granted.entitlement.id}`, {
      method: 'DELETE',
      headers,
    })
    expect(revoke.status).toBe(204)
    const afterRevoke = await app.request('/api/teams/team-q1/entitlements', { headers })
    const afterBody = (await afterRevoke.json()) as { items: Array<{ status: string }> }
    expect(afterBody.items[0].status).toBe('revoked')
  })

  it('updates an admin grant bytes [spec: teams-admin/update-entitlement]', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await seedTeam(db, { id: 'team-q2', name: 'Quota Team 2' })

    const grant = await app.request('/api/teams/team-q2/entitlements', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ resourceType: 'storage', bytes: 1024 }),
    })
    const granted = (await grant.json()) as { entitlement: { id: string } }

    const update = await app.request(`/api/teams/team-q2/entitlements/${granted.entitlement.id}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ bytes: 4096 }),
    })
    expect(update.status).toBe(200)
    const updated = (await update.json()) as { entitlement: { bytes: number } }
    expect(updated.entitlement.bytes).toBe(4096)
  })

  it('returns 404 for an unknown org and 403 for non-admin callers [spec: teams-admin/entitlement-guards]', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)
    const missing = await app.request('/api/teams/no-such-org/entitlements', { headers })
    expect(missing.status).toBe(404)

    await authedHeaders(app, 'plain@example.com')
    const signIn = await app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'plain@example.com', password: 'password123456' }),
    })
    const plainHeaders = { Cookie: signIn.headers.getSetCookie().join('; ') }
    const forbidden = await app.request('/api/teams/no-such-org/entitlements', { headers: plainHeaders })
    expect(forbidden.status).toBe(403)
  })
})
