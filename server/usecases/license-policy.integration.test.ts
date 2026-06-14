import { FREE_TEAM_LIMIT } from '@shared/constants'
import { nanoid } from 'nanoid'
import { describe, expect, it } from 'vitest'
import { createLicenseBindingRepo } from '../adapters/repos/license-binding.js'
import { createMemberCountRepo } from '../adapters/repos/member-count.js'
import * as authSchema from '../db/auth-schema.js'
import { createTestApp, seedProLicense } from '../test/setup.js'
import { checkTeamLimit } from './licensing.js'

type TestDb = Awaited<ReturnType<typeof createTestApp>>['db']

function depsFor(db: TestDb) {
  return { memberCount: createMemberCountRepo(db), licenseBinding: createLicenseBindingRepo(db) }
}

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

async function insertOrg(db: TestDb, overrides: Partial<{ id: string; slug: string }> = {}) {
  const id = overrides.id ?? nanoid()
  await db.insert(authSchema.organization).values({
    id,
    name: 'Test Org',
    slug: overrides.slug ?? nanoid(),
    createdAt: new Date(),
  })
  return id
}

async function insertMember(db: TestDb, organizationId: string, userId: string, role = 'member') {
  await db.insert(authSchema.member).values({
    id: nanoid(),
    organizationId,
    userId,
    role,
    createdAt: new Date(),
  })
}

// ---------------------------------------------------------------------------
// MemberCountRepo.countUserOrgs
// ---------------------------------------------------------------------------

describe('countUserOrgs', () => {
  it('returns 0 when the user has no org memberships', async () => {
    const { db } = await createTestApp()
    const userId = await insertUser(db)

    const count = await createMemberCountRepo(db).countUserOrgs(userId)
    expect(count).toBe(0)
  })

  it('returns 1 when the user belongs to exactly one org', async () => {
    const { db } = await createTestApp()
    const userId = await insertUser(db)
    const orgId = await insertOrg(db)
    await insertMember(db, orgId, userId)

    const count = await createMemberCountRepo(db).countUserOrgs(userId)
    expect(count).toBe(1)
  })

  it('returns 2 when the user belongs to two orgs', async () => {
    const { db } = await createTestApp()
    const userId = await insertUser(db)
    const orgA = await insertOrg(db)
    const orgB = await insertOrg(db)
    await insertMember(db, orgA, userId)
    await insertMember(db, orgB, userId)

    const count = await createMemberCountRepo(db).countUserOrgs(userId)
    expect(count).toBe(2)
  })

  it('counts only memberships belonging to the queried user', async () => {
    const { db } = await createTestApp()
    const userA = await insertUser(db)
    const userB = await insertUser(db)
    const orgId = await insertOrg(db)
    await insertMember(db, orgId, userA)
    await insertMember(db, orgId, userB)

    expect(await createMemberCountRepo(db).countUserOrgs(userA)).toBe(1)
    expect(await createMemberCountRepo(db).countUserOrgs(userB)).toBe(1)
  })

  it('returns 0 for a user id that has no rows', async () => {
    const { db } = await createTestApp()
    const count = await createMemberCountRepo(db).countUserOrgs('nonexistent-user')
    expect(count).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// checkTeamLimit
// ---------------------------------------------------------------------------

describe('checkTeamLimit', () => {
  it('always returns limit equal to FREE_TEAM_LIMIT constant (2)', async () => {
    const { db } = await createTestApp()
    const userId = await insertUser(db)

    const result = await checkTeamLimit(depsFor(db), userId)
    expect(result.limit).toBe(FREE_TEAM_LIMIT)
    expect(result.limit).toBe(2)
  })

  it('allowed=true when user has 0 orgs and no license', async () => {
    const { db } = await createTestApp()
    const userId = await insertUser(db)

    const result = await checkTeamLimit(depsFor(db), userId)
    expect(result.allowed).toBe(true)
    expect(result.count).toBe(0)
  })

  it('allowed=true when user has 1 org and no license', async () => {
    const { db } = await createTestApp()
    const userId = await insertUser(db)
    const orgA = await insertOrg(db)
    await insertMember(db, orgA, userId)

    const result = await checkTeamLimit(depsFor(db), userId)
    expect(result.allowed).toBe(true)
    expect(result.count).toBe(1)
  })

  it('allowed=false when user has 2 orgs (at the free limit) and no license', async () => {
    const { db } = await createTestApp()
    const userId = await insertUser(db)
    const orgA = await insertOrg(db)
    const orgB = await insertOrg(db)
    await insertMember(db, orgA, userId)
    await insertMember(db, orgB, userId)

    const result = await checkTeamLimit(depsFor(db), userId)
    expect(result.allowed).toBe(false)
    expect(result.count).toBe(2)
  })

  it('allowed=false when user has 3 orgs and no license', async () => {
    const { db } = await createTestApp()
    const userId = await insertUser(db)
    for (let i = 0; i < 3; i++) {
      const orgId = await insertOrg(db)
      await insertMember(db, orgId, userId)
    }

    const result = await checkTeamLimit(depsFor(db), userId)
    expect(result.allowed).toBe(false)
    expect(result.count).toBe(3)
  })

  it('allowed=true when user has 2 orgs but holds a license granting teams_unlimited', async () => {
    const { db } = await createTestApp()
    await seedProLicense(db)
    const userId = await insertUser(db)
    for (let i = 0; i < 2; i++) {
      const orgId = await insertOrg(db)
      await insertMember(db, orgId, userId)
    }

    const result = await checkTeamLimit(depsFor(db), userId)
    expect(result.allowed).toBe(true)
    expect(result.count).toBe(2)
  })

  it('allowed=true when user has 10 orgs with a teams_unlimited license', async () => {
    const { db } = await createTestApp()
    await seedProLicense(db)
    const userId = await insertUser(db)
    for (let i = 0; i < 10; i++) {
      const orgId = await insertOrg(db)
      await insertMember(db, orgId, userId)
    }

    const result = await checkTeamLimit(depsFor(db), userId)
    expect(result.allowed).toBe(true)
    expect(result.count).toBe(10)
  })
})
