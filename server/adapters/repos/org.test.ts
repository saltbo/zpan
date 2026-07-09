import { nanoid } from 'nanoid'
import { describe, expect, it } from 'vitest'
import * as authSchema from '../../db/auth-schema.js'
import { createTestApp } from '../../test/setup.js'
import { createOrgRepo } from './org.js'

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

async function insertOrg(db: TestDb, overrides: Partial<{ id: string; slug: string; metadata: string | null }> = {}) {
  const id = overrides.id ?? nanoid()
  await db.insert(authSchema.organization).values({
    id,
    name: 'Test Org',
    slug: overrides.slug ?? nanoid(),
    metadata: overrides.metadata !== undefined ? overrides.metadata : null,
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

describe('getMemberRole', () => {
  it('returns the role when the user is a member of the org', async () => {
    const { db } = await createTestApp()
    const userId = await insertUser(db)
    const orgId = await insertOrg(db)
    await insertMember(db, orgId, userId, 'owner')

    const result = await createOrgRepo(db).getMemberRole(orgId, userId)
    expect(result).toBe('owner')
  })

  it('returns editor role when user has editor membership', async () => {
    const { db } = await createTestApp()
    const userId = await insertUser(db)
    const orgId = await insertOrg(db)
    await insertMember(db, orgId, userId, 'editor')

    const result = await createOrgRepo(db).getMemberRole(orgId, userId)
    expect(result).toBe('editor')
  })

  it('returns viewer role when user has viewer membership', async () => {
    const { db } = await createTestApp()
    const userId = await insertUser(db)
    const orgId = await insertOrg(db)
    await insertMember(db, orgId, userId, 'viewer')

    const result = await createOrgRepo(db).getMemberRole(orgId, userId)
    expect(result).toBe('viewer')
  })

  it('returns null when user is not a member of the org', async () => {
    const { db } = await createTestApp()
    const userId = await insertUser(db)
    const orgId = await insertOrg(db)

    const result = await createOrgRepo(db).getMemberRole(orgId, userId)
    expect(result).toBeNull()
  })

  it('returns null when the org does not exist', async () => {
    const { db } = await createTestApp()
    const userId = await insertUser(db)

    const result = await createOrgRepo(db).getMemberRole('nonexistent-org', userId)
    expect(result).toBeNull()
  })

  it('returns null when the user does not exist', async () => {
    const { db } = await createTestApp()
    const orgId = await insertOrg(db)

    const result = await createOrgRepo(db).getMemberRole(orgId, 'nonexistent-user')
    expect(result).toBeNull()
  })

  it('returns only the role for the specified org when user belongs to multiple orgs', async () => {
    const { db } = await createTestApp()
    const userId = await insertUser(db)
    const orgA = await insertOrg(db)
    const orgB = await insertOrg(db)
    await insertMember(db, orgA, userId, 'editor')
    await insertMember(db, orgB, userId, 'viewer')

    expect(await createOrgRepo(db).getMemberRole(orgA, userId)).toBe('editor')
    expect(await createOrgRepo(db).getMemberRole(orgB, userId)).toBe('viewer')
  })
})

describe('isPersonalOrg', () => {
  it('returns true when metadata marks the org as personal', async () => {
    const { db } = await createTestApp()
    const orgId = await insertOrg(db, { slug: 'u1234567890abcdef', metadata: '{"type":"personal"}' })

    const result = await createOrgRepo(db).isPersonalOrg(orgId)
    expect(result).toBe(true)
  })

  it('returns true when the org slug starts with personal-', async () => {
    const { db } = await createTestApp()
    const userId = nanoid()
    const orgId = await insertOrg(db, { slug: `personal-${userId}` })

    const result = await createOrgRepo(db).isPersonalOrg(orgId)
    expect(result).toBe(true)
  })

  it('returns false when the org slug does not start with personal-', async () => {
    const { db } = await createTestApp()
    const orgId = await insertOrg(db, { slug: 'team-org-slug' })

    const result = await createOrgRepo(db).isPersonalOrg(orgId)
    expect(result).toBe(false)
  })

  it('returns false when the org slug is exactly personal (no dash-suffix)', async () => {
    const { db } = await createTestApp()
    const orgId = await insertOrg(db, { slug: 'personal' })

    const result = await createOrgRepo(db).isPersonalOrg(orgId)
    expect(result).toBe(false)
  })

  it('returns false when the org does not exist', async () => {
    const { db } = await createTestApp()

    const result = await createOrgRepo(db).isPersonalOrg('nonexistent-org-id')
    expect(result).toBe(false)
  })

  it('returns false for a slug that contains personal- but does not start with it', async () => {
    const { db } = await createTestApp()
    const orgId = await insertOrg(db, { slug: 'team-personal-space' })

    const result = await createOrgRepo(db).isPersonalOrg(orgId)
    expect(result).toBe(false)
  })
})
