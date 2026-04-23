import { sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as authSchema from '../db/auth-schema.js'
import { S3Service } from '../services/s3.js'
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

  it('returns 200 and joins the team with a valid token', async () => {
    const { app, db } = await createTestApp()
    const orgId = await insertOrg(db)
    const inviterId = await insertUser(db)
    const link = await createInviteLink(db, orgId, inviterId, 'viewer')

    const email = `newmember-${nanoid()}@example.com`
    const { headers } = await signUpAndGetUser(app, email)

    const res = await app.request(`/api/teams/${orgId}/members`, {
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
  it('returns 403 when authed user is not a member of a non-personal org', async () => {
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

  it('returns 200 when authed user accesses any personal org (personal orgs are public to auth users)', async () => {
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

  it('returns 200 when authed user is a member of a non-personal team org', async () => {
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

  it('returns activity items with user info when events exist', async () => {
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

  it('respects explicit page and pageSize query params', async () => {
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
  it('returns items ordered by newest first', async () => {
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

// ─── Org logo upload ──────────────────────────────────────────────────────────

async function insertPublicStorage(db: TestDb) {
  const now = Date.now()
  await db.run(sql`
    INSERT INTO storages (id, title, mode, bucket, endpoint, region, access_key, secret_key, file_path, custom_host, capacity, used, status, created_at, updated_at)
    VALUES ('st-logo', 'Test Public', 'public', 'test-bucket', 'https://s3.amazonaws.com', 'us-east-1', 'AKID', 'secret', '', '', 0, 0, 'active', ${now}, ${now})
  `)
}

describe('POST /api/teams/:teamId/logo — presign', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(S3Service.prototype, 'presignUpload').mockResolvedValue('https://presigned.example.com/upload')
  })

  it('returns 401 without auth', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/teams/some-org/logo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mime: 'image/png', size: 1024 }),
    })
    expect(res.status).toBe(401)
  })

  it('returns 403 when caller is not owner/admin', async () => {
    const { app, db } = await createTestApp()
    const { headers, userId } = await signUpAndGetUser(app, `m-${nanoid()}@example.com`)
    const orgId = await insertOrg(db)
    await insertMember(db, orgId, userId, 'member')
    await insertPublicStorage(db)

    const res = await app.request(`/api/teams/${orgId}/logo`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mime: 'image/png', size: 1024 }),
    })
    expect(res.status).toBe(403)
  })

  it('returns 400 when mime is invalid (gif)', async () => {
    const { app, db } = await createTestApp()
    const { headers, userId } = await signUpAndGetUser(app, `o-${nanoid()}@example.com`)
    const orgId = await insertOrg(db)
    await insertMember(db, orgId, userId, 'owner')
    await insertPublicStorage(db)

    const res = await app.request(`/api/teams/${orgId}/logo`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mime: 'image/gif', size: 1024 }),
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 when size exceeds 2 MiB', async () => {
    const { app, db } = await createTestApp()
    const { headers, userId } = await signUpAndGetUser(app, `o-${nanoid()}@example.com`)
    const orgId = await insertOrg(db)
    await insertMember(db, orgId, userId, 'owner')
    await insertPublicStorage(db)

    const res = await app.request(`/api/teams/${orgId}/logo`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mime: 'image/png', size: 3 * 1024 * 1024 }),
    })
    expect(res.status).toBe(400)
  })

  it('returns 503 when no public storage is configured', async () => {
    const { app, db } = await createTestApp()
    const { headers, userId } = await signUpAndGetUser(app, `o-${nanoid()}@example.com`)
    const orgId = await insertOrg(db)
    await insertMember(db, orgId, userId, 'owner')

    const res = await app.request(`/api/teams/${orgId}/logo`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mime: 'image/png', size: 1024 }),
    })
    expect(res.status).toBe(503)
  })

  it('returns uploadUrl and key for a valid owner request', async () => {
    const { app, db } = await createTestApp()
    const { headers, userId } = await signUpAndGetUser(app, `o-${nanoid()}@example.com`)
    const orgId = await insertOrg(db)
    await insertMember(db, orgId, userId, 'owner')
    await insertPublicStorage(db)

    const res = await app.request(`/api/teams/${orgId}/logo`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mime: 'image/webp', size: 2048 }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { uploadUrl: string; key: string }
    expect(body.uploadUrl).toBe('https://presigned.example.com/upload')
    expect(body.key).toBe(`_system/org-logos/${orgId}.webp`)
  })

  it('succeeds for admin role (not just owner)', async () => {
    const { app, db } = await createTestApp()
    const { headers, userId } = await signUpAndGetUser(app, `a-${nanoid()}@example.com`)
    const orgId = await insertOrg(db)
    await insertMember(db, orgId, userId, 'admin')
    await insertPublicStorage(db)

    const res = await app.request(`/api/teams/${orgId}/logo`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mime: 'image/png', size: 1024 }),
    })
    expect(res.status).toBe(201)
  })
})

describe('POST /api/teams/:teamId/logo/commit', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(S3Service.prototype, 'headObject').mockResolvedValue({ size: 1024, contentType: 'image/png' })
  })

  it('returns 401 without auth', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/teams/some-org/logo/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mime: 'image/png' }),
    })
    expect(res.status).toBe(401)
  })

  it('returns 403 when caller is not owner/admin', async () => {
    const { app, db } = await createTestApp()
    const { headers, userId } = await signUpAndGetUser(app, `v-${nanoid()}@example.com`)
    const orgId = await insertOrg(db)
    await insertMember(db, orgId, userId, 'viewer')
    await insertPublicStorage(db)

    const res = await app.request(`/api/teams/${orgId}/logo/commit`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mime: 'image/png' }),
    })
    expect(res.status).toBe(403)
  })

  it('returns 400 when S3 object is missing', async () => {
    vi.restoreAllMocks()
    vi.spyOn(S3Service.prototype, 'headObject').mockRejectedValue(new Error('Not Found'))

    const { app, db } = await createTestApp()
    const { headers, userId } = await signUpAndGetUser(app, `o-${nanoid()}@example.com`)
    const orgId = await insertOrg(db)
    await insertMember(db, orgId, userId, 'owner')
    await insertPublicStorage(db)

    const res = await app.request(`/api/teams/${orgId}/logo/commit`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mime: 'image/png' }),
    })
    expect(res.status).toBe(400)
  })

  it('persists organization.logo and returns URL', async () => {
    const { app, db } = await createTestApp()
    const { headers, userId } = await signUpAndGetUser(app, `o-${nanoid()}@example.com`)
    const orgId = await insertOrg(db)
    await insertMember(db, orgId, userId, 'owner')
    await insertPublicStorage(db)

    const res = await app.request(`/api/teams/${orgId}/logo/commit`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mime: 'image/jpeg' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { logo: string }
    expect(body.logo).toContain(`_system/org-logos/${orgId}`)
    expect(body.logo).toContain('.jpg')

    const rows = await db.all<{ logo: string | null }>(sql`SELECT logo FROM organization WHERE id = ${orgId}`)
    expect(rows[0]?.logo).toBe(body.logo)
  })
})

describe('DELETE /api/teams/:teamId/logo', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(S3Service.prototype, 'deleteObject').mockResolvedValue(undefined)
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

  it('clears organization.logo and removes S3 object', async () => {
    const { app, db } = await createTestApp()
    const { headers, userId } = await signUpAndGetUser(app, `o-${nanoid()}@example.com`)
    const orgId = await insertOrg(db)
    await insertMember(db, orgId, userId, 'owner')
    await insertPublicStorage(db)

    await db.run(sql`UPDATE organization SET logo = 'https://example.com/old-logo.png' WHERE id = ${orgId}`)

    const res = await app.request(`/api/teams/${orgId}/logo`, { method: 'DELETE', headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean }
    expect(body.ok).toBe(true)

    const rows = await db.all<{ logo: string | null }>(sql`SELECT logo FROM organization WHERE id = ${orgId}`)
    expect(rows[0]?.logo).toBeNull()
    expect(S3Service.prototype.deleteObject).toHaveBeenCalled()
  })

  it('succeeds even when no public storage exists (DB cleared, S3 skipped)', async () => {
    const { app, db } = await createTestApp()
    const { headers, userId } = await signUpAndGetUser(app, `o-${nanoid()}@example.com`)
    const orgId = await insertOrg(db)
    await insertMember(db, orgId, userId, 'owner')

    await db.run(sql`UPDATE organization SET logo = 'https://example.com/old.png' WHERE id = ${orgId}`)

    const res = await app.request(`/api/teams/${orgId}/logo`, { method: 'DELETE', headers })
    expect(res.status).toBe(200)

    const rows = await db.all<{ logo: string | null }>(sql`SELECT logo FROM organization WHERE id = ${orgId}`)
    expect(rows[0]?.logo).toBeNull()
  })
})
