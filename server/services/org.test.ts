import { nanoid } from 'nanoid'
import { describe, expect, it } from 'vitest'
import * as authSchema from '../db/auth-schema.js'
import { createTestApp } from '../test/setup.js'
import { findPersonalOrg } from './org.js'

type TestDb = ReturnType<typeof createTestApp>['db']

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
    metadata: overrides.metadata !== undefined ? overrides.metadata : JSON.stringify({ type: 'personal' }),
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
    const { db } = createTestApp()
    const userId = await insertUser(db)
    const orgId = await insertOrg(db, { metadata: JSON.stringify({ type: 'personal' }) })
    await insertMember(db, orgId, userId)

    const result = await findPersonalOrg(db, userId)
    expect(result).toBe(orgId)
  })

  it('returns null when user has no memberships', async () => {
    const { db } = createTestApp()
    const userId = await insertUser(db)

    const result = await findPersonalOrg(db, userId)
    expect(result).toBeNull()
  })

  it('returns null when user only belongs to a non-personal org', async () => {
    const { db } = createTestApp()
    const userId = await insertUser(db)
    const orgId = await insertOrg(db, { metadata: JSON.stringify({ type: 'team' }) })
    await insertMember(db, orgId, userId)

    const result = await findPersonalOrg(db, userId)
    expect(result).toBeNull()
  })

  it('returns null when org metadata is null', async () => {
    const { db } = createTestApp()
    const userId = await insertUser(db)
    const orgId = await insertOrg(db, { metadata: null })
    await insertMember(db, orgId, userId)

    const result = await findPersonalOrg(db, userId)
    expect(result).toBeNull()
  })

  it('returns null when org metadata is invalid JSON', async () => {
    const { db } = createTestApp()
    const userId = await insertUser(db)
    const orgId = await insertOrg(db, { metadata: 'not-valid-json' })
    await insertMember(db, orgId, userId)

    const result = await findPersonalOrg(db, userId)
    expect(result).toBeNull()
  })

  it('returns null when org metadata is valid JSON but missing type field', async () => {
    const { db } = createTestApp()
    const userId = await insertUser(db)
    const orgId = await insertOrg(db, { metadata: JSON.stringify({ other: 'value' }) })
    await insertMember(db, orgId, userId)

    const result = await findPersonalOrg(db, userId)
    expect(result).toBeNull()
  })

  it('finds the personal org among multiple memberships', async () => {
    const { db } = createTestApp()
    const userId = await insertUser(db)
    const teamOrgId = await insertOrg(db, { metadata: JSON.stringify({ type: 'team' }) })
    const personalOrgId = await insertOrg(db, { metadata: JSON.stringify({ type: 'personal' }) })
    await insertMember(db, teamOrgId, userId)
    await insertMember(db, personalOrgId, userId)

    const result = await findPersonalOrg(db, userId)
    expect(result).toBe(personalOrgId)
  })
})
