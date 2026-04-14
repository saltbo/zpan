import { nanoid } from 'nanoid'
import { describe, expect, it } from 'vitest'
import * as authSchema from '../db/auth-schema.js'
import { createTestApp } from '../test/setup.js'
import {
  acceptInviteLink,
  createInviteLink,
  getInviteLinkInfo,
  listPendingInvitations,
} from './team-invite.js'

type TestDb = Awaited<ReturnType<typeof createTestApp>>['db']

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

async function insertInvitation(
  db: TestDb,
  organizationId: string,
  inviterId: string,
  email: string,
  status = 'pending',
) {
  const id = nanoid()
  await db.insert(authSchema.invitation).values({
    id,
    organizationId,
    email,
    role: 'viewer',
    status,
    inviterId,
    createdAt: new Date(),
  })
  return id
}

describe('createInviteLink', () => {
  it('creates and returns a new invite link', async () => {
    const { db } = await createTestApp()
    const orgId = await insertOrg(db)
    const inviterId = await insertUser(db)

    const link = await createInviteLink(db, orgId, inviterId, 'viewer')
    expect(link.token).toBeTruthy()
    expect(link.organizationId).toBe(orgId)
    expect(link.role).toBe('viewer')
    expect(link.inviterId).toBe(inviterId)
    expect(link.expiresAt).toBeTruthy()
  })

  it('uses provided expiresIn to set expiry', async () => {
    const { db } = await createTestApp()
    const orgId = await insertOrg(db)
    const inviterId = await insertUser(db)

    const oneHour = 60 * 60 * 1000
    const before = Date.now()
    const link = await createInviteLink(db, orgId, inviterId, 'editor', oneHour)
    const after = Date.now()

    expect(link.expiresAt!.getTime()).toBeGreaterThan(before + oneHour - 1000)
    expect(link.expiresAt!.getTime()).toBeLessThan(after + oneHour + 1000)
  })

  it('generates unique tokens', async () => {
    const { db } = await createTestApp()
    const orgId = await insertOrg(db)
    const inviterId = await insertUser(db)

    const [a, b] = await Promise.all([
      createInviteLink(db, orgId, inviterId, 'viewer'),
      createInviteLink(db, orgId, inviterId, 'viewer'),
    ])
    expect(a.token).not.toBe(b.token)
  })
})

describe('getInviteLinkInfo', () => {
  it('returns invite info for a valid token', async () => {
    const { db } = await createTestApp()
    const orgId = await insertOrg(db, { name: 'My Team' })
    const inviterId = await insertUser(db)

    const link = await createInviteLink(db, orgId, inviterId, 'editor')
    const info = await getInviteLinkInfo(db, link.token)

    expect(info).not.toBeNull()
    expect(info!.organizationId).toBe(orgId)
    expect(info!.organizationName).toBe('My Team')
    expect(info!.role).toBe('editor')
  })

  it('returns null for an unknown token', async () => {
    const { db } = await createTestApp()
    const info = await getInviteLinkInfo(db, 'nonexistent-token')
    expect(info).toBeNull()
  })

  it('returns null for an expired token', async () => {
    const { db } = await createTestApp()
    const orgId = await insertOrg(db)
    const inviterId = await insertUser(db)

    const link = await createInviteLink(db, orgId, inviterId, 'viewer', -1000) // already expired
    const info = await getInviteLinkInfo(db, link.token)
    expect(info).toBeNull()
  })
})

describe('acceptInviteLink', () => {
  it('adds the user as a member and returns ok', async () => {
    const { db } = await createTestApp()
    const orgId = await insertOrg(db)
    const inviterId = await insertUser(db)
    const userId = await insertUser(db)

    const link = await createInviteLink(db, orgId, inviterId, 'viewer')
    const result = await acceptInviteLink(db, link.token, userId)
    expect(result).toBe('ok')
  })

  it('returns invalid for a nonexistent token', async () => {
    const { db } = await createTestApp()
    const userId = await insertUser(db)
    const result = await acceptInviteLink(db, 'bad-token', userId)
    expect(result).toBe('invalid')
  })

  it('returns expired for an expired token', async () => {
    const { db } = await createTestApp()
    const orgId = await insertOrg(db)
    const inviterId = await insertUser(db)
    const userId = await insertUser(db)

    const link = await createInviteLink(db, orgId, inviterId, 'viewer', -1000)
    const result = await acceptInviteLink(db, link.token, userId)
    expect(result).toBe('expired')
  })

  it('returns already_member if user is already in the org', async () => {
    const { db } = await createTestApp()
    const orgId = await insertOrg(db)
    const inviterId = await insertUser(db)
    const userId = await insertUser(db)
    await insertMember(db, orgId, userId, 'viewer')

    const link = await createInviteLink(db, orgId, inviterId, 'viewer')
    const result = await acceptInviteLink(db, link.token, userId)
    expect(result).toBe('already_member')
  })

  it('allows the same link to be used multiple times (not one-time)', async () => {
    const { db } = await createTestApp()
    const orgId = await insertOrg(db)
    const inviterId = await insertUser(db)
    const user1 = await insertUser(db)
    const user2 = await insertUser(db)

    const link = await createInviteLink(db, orgId, inviterId, 'viewer')
    const r1 = await acceptInviteLink(db, link.token, user1)
    const r2 = await acceptInviteLink(db, link.token, user2)
    expect(r1).toBe('ok')
    expect(r2).toBe('ok')
  })
})

describe('listPendingInvitations', () => {
  it('returns empty list when no pending invitations', async () => {
    const { db } = await createTestApp()
    const orgId = await insertOrg(db)
    const result = await listPendingInvitations(db, orgId)
    expect(result).toEqual([])
  })

  it('returns pending invitations for the organization', async () => {
    const { db } = await createTestApp()
    const orgId = await insertOrg(db)
    const inviterId = await insertUser(db)
    await insertInvitation(db, orgId, inviterId, 'test@example.com')

    const result = await listPendingInvitations(db, orgId)
    expect(result).toHaveLength(1)
    expect(result[0].email).toBe('test@example.com')
    expect(result[0].role).toBe('viewer')
  })

  it('excludes non-pending invitations', async () => {
    const { db } = await createTestApp()
    const orgId = await insertOrg(db)
    const inviterId = await insertUser(db)
    await insertInvitation(db, orgId, inviterId, 'accepted@example.com', 'accepted')
    await insertInvitation(db, orgId, inviterId, 'pending@example.com', 'pending')

    const result = await listPendingInvitations(db, orgId)
    expect(result).toHaveLength(1)
    expect(result[0].email).toBe('pending@example.com')
  })

  it('returns invitations for the specified org only', async () => {
    const { db } = await createTestApp()
    const org1 = await insertOrg(db)
    const org2 = await insertOrg(db)
    const inviterId = await insertUser(db)
    await insertInvitation(db, org1, inviterId, 'org1@example.com')
    await insertInvitation(db, org2, inviterId, 'org2@example.com')

    const result = await listPendingInvitations(db, org1)
    expect(result).toHaveLength(1)
    expect(result[0].email).toBe('org1@example.com')
  })
})
