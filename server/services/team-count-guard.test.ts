import { COMMUNITY_TEAM_LIMIT } from '@shared/constants'
import { nanoid } from 'nanoid'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as authSchema from '../db/auth-schema.js'
import { createTestApp } from '../test/setup.js'
import { checkTeamLimit, countUserOrgs } from './team-count-guard.js'

// ---------------------------------------------------------------------------
// Mock the licensing layer — we test the guard logic, not the license DB reads
// ---------------------------------------------------------------------------

vi.mock('../licensing/has-feature', () => ({
  loadBindingState: vi.fn(),
  hasFeature: vi.fn(),
}))

import { hasFeature, loadBindingState } from '../licensing/has-feature'

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
// countUserOrgs
// ---------------------------------------------------------------------------

describe('countUserOrgs', () => {
  it('returns 0 when the user has no org memberships', async () => {
    const { db } = await createTestApp()
    const userId = await insertUser(db)

    const count = await countUserOrgs(db, userId)
    expect(count).toBe(0)
  })

  it('returns 1 when the user belongs to exactly one org', async () => {
    const { db } = await createTestApp()
    const userId = await insertUser(db)
    const orgId = await insertOrg(db)
    await insertMember(db, orgId, userId)

    const count = await countUserOrgs(db, userId)
    expect(count).toBe(1)
  })

  it('returns 2 when the user belongs to two orgs', async () => {
    const { db } = await createTestApp()
    const userId = await insertUser(db)
    const orgA = await insertOrg(db)
    const orgB = await insertOrg(db)
    await insertMember(db, orgA, userId)
    await insertMember(db, orgB, userId)

    const count = await countUserOrgs(db, userId)
    expect(count).toBe(2)
  })

  it('counts only memberships belonging to the queried user', async () => {
    const { db } = await createTestApp()
    const userA = await insertUser(db)
    const userB = await insertUser(db)
    const orgId = await insertOrg(db)
    await insertMember(db, orgId, userA)
    await insertMember(db, orgId, userB)

    // userA has 1 membership, unaffected by userB's membership
    expect(await countUserOrgs(db, userA)).toBe(1)
    expect(await countUserOrgs(db, userB)).toBe(1)
  })

  it('returns 0 for a user id that has no rows', async () => {
    const { db } = await createTestApp()
    const count = await countUserOrgs(db, 'nonexistent-user')
    expect(count).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// checkTeamLimit
// ---------------------------------------------------------------------------

describe('checkTeamLimit', () => {
  beforeEach(() => {
    vi.mocked(loadBindingState).mockResolvedValue({ bound: false })
    vi.mocked(hasFeature).mockReturnValue(false)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('always returns limit equal to COMMUNITY_TEAM_LIMIT constant (3)', async () => {
    const { db } = await createTestApp()
    const userId = await insertUser(db)

    const result = await checkTeamLimit(db, userId)
    expect(result.limit).toBe(COMMUNITY_TEAM_LIMIT)
    expect(result.limit).toBe(3)
  })

  it('allowed=true when user has 0 orgs and no teams_unlimited feature', async () => {
    const { db } = await createTestApp()
    const userId = await insertUser(db)

    const result = await checkTeamLimit(db, userId)
    expect(result.allowed).toBe(true)
    expect(result.count).toBe(0)
  })

  it('allowed=true when user has 2 orgs and no teams_unlimited feature', async () => {
    const { db } = await createTestApp()
    const userId = await insertUser(db)
    const orgA = await insertOrg(db)
    const orgB = await insertOrg(db)
    await insertMember(db, orgA, userId)
    await insertMember(db, orgB, userId)

    const result = await checkTeamLimit(db, userId)
    expect(result.allowed).toBe(true)
    expect(result.count).toBe(2)
  })

  it('allowed=false when user has exactly 3 orgs and no teams_unlimited feature', async () => {
    const { db } = await createTestApp()
    const userId = await insertUser(db)
    for (let i = 0; i < 3; i++) {
      const orgId = await insertOrg(db)
      await insertMember(db, orgId, userId)
    }

    const result = await checkTeamLimit(db, userId)
    expect(result.allowed).toBe(false)
    expect(result.count).toBe(3)
  })

  it('allowed=false when user has 4 orgs and no teams_unlimited feature', async () => {
    const { db } = await createTestApp()
    const userId = await insertUser(db)
    for (let i = 0; i < 4; i++) {
      const orgId = await insertOrg(db)
      await insertMember(db, orgId, userId)
    }

    const result = await checkTeamLimit(db, userId)
    expect(result.allowed).toBe(false)
    expect(result.count).toBe(4)
  })

  it('allowed=true when user has 3 orgs but has teams_unlimited feature', async () => {
    vi.mocked(hasFeature).mockReturnValue(true)
    const { db } = await createTestApp()
    const userId = await insertUser(db)
    for (let i = 0; i < 3; i++) {
      const orgId = await insertOrg(db)
      await insertMember(db, orgId, userId)
    }

    const result = await checkTeamLimit(db, userId)
    expect(result.allowed).toBe(true)
    expect(result.count).toBe(3)
  })

  it('allowed=true when user has 10 orgs with teams_unlimited feature', async () => {
    vi.mocked(hasFeature).mockReturnValue(true)
    const { db } = await createTestApp()
    const userId = await insertUser(db)
    for (let i = 0; i < 10; i++) {
      const orgId = await insertOrg(db)
      await insertMember(db, orgId, userId)
    }

    const result = await checkTeamLimit(db, userId)
    expect(result.allowed).toBe(true)
    expect(result.count).toBe(10)
  })

  it('calls loadBindingState with the db to determine licensing state', async () => {
    const { db } = await createTestApp()
    const userId = await insertUser(db)

    await checkTeamLimit(db, userId)

    expect(loadBindingState).toHaveBeenCalledWith(db)
  })

  it('calls hasFeature with teams_unlimited and the binding state', async () => {
    const mockState = { bound: true, features: ['teams_unlimited'] }
    vi.mocked(loadBindingState).mockResolvedValue(mockState as Awaited<ReturnType<typeof loadBindingState>>)
    const { db } = await createTestApp()
    const userId = await insertUser(db)

    await checkTeamLimit(db, userId)

    expect(hasFeature).toHaveBeenCalledWith('teams_unlimited', mockState)
  })

  it('returns correct count in the result', async () => {
    const { db } = await createTestApp()
    const userId = await insertUser(db)
    const orgId = await insertOrg(db)
    await insertMember(db, orgId, userId)

    const result = await checkTeamLimit(db, userId)
    expect(result.count).toBe(1)
  })
})
