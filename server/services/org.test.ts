import { nanoid } from 'nanoid'
import { describe, expect, it } from 'vitest'
import * as authSchema from '../db/auth-schema.js'
import { createTestApp } from '../test/setup.js'
import { findPersonalOrg } from './org.js'

type TestDb = Awaited<ReturnType<typeof createTestApp>>['db']

async function insertUser(db: TestDb, overrides: Partial<{ id: string; name: string; email: string }> = {}) {
  const id = overrides.id ?? nanoid()
  await db.insert(authSchema.user).values({
    id,
    name: overrides.name ?? 'Test User',
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

async function insertMember(db: TestDb, organizationId: string, userId: string) {
  await db.insert(authSchema.member).values({
    id: nanoid(),
    organizationId,
    userId,
    role: 'owner',
    createdAt: new Date(),
  })
}

describe('findPersonalOrg', () => {
  it('returns the org id when a personal org exists for the user', async () => {
    const { db } = await createTestApp()
    const userId = await insertUser(db)
    const orgId = await insertOrg(db, { slug: `personal-${userId}` })
    await insertMember(db, orgId, userId)

    const result = await findPersonalOrg(db, userId)
    expect(result).toBe(orgId)
  })

  it('returns null when user has no memberships', async () => {
    const { db } = await createTestApp()
    const userId = await insertUser(db)

    const result = await findPersonalOrg(db, userId)
    expect(result).toBeNull()
  })

  it("returns null when the org's slug is not the user's personal slug", async () => {
    const { db } = await createTestApp()
    const userId = await insertUser(db)
    const orgId = await insertOrg(db, { slug: 'some-team-org' })
    await insertMember(db, orgId, userId)

    const result = await findPersonalOrg(db, userId)
    expect(result).toBeNull()
  })

  it('finds the personal org among multiple memberships', async () => {
    const { db } = await createTestApp()
    const userId = await insertUser(db)
    const teamOrgId = await insertOrg(db, { slug: 'some-team-org' })
    const personalOrgId = await insertOrg(db, { slug: `personal-${userId}` })
    await insertMember(db, teamOrgId, userId)
    await insertMember(db, personalOrgId, userId)

    const result = await findPersonalOrg(db, userId)
    expect(result).toBe(personalOrgId)
  })

  it('returns null when the personal slug exists but member row was deleted', async () => {
    const { db } = await createTestApp()
    const userId = await insertUser(db)
    await insertOrg(db, { slug: `personal-${userId}` })
    // No member row inserted — membership is load-bearing

    const result = await findPersonalOrg(db, userId)
    expect(result).toBeNull()
  })
})
