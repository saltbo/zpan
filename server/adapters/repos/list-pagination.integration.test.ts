import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { auditEvents, siteInvitations } from '../../db/schema'
import { createTestApp } from '../../test/setup'
import type { CreatedAtIdBoundary, KeysetPage, KeysetPageOpts } from '../../usecases/ports'
import { createAuditRepo } from './audit'
import { createSiteInvitationRepo } from './site-invitations'
import { createTeamRepo } from './team'
import { createUserAdminRepo } from './user-admin'

// Walks a repo's cursor to the end with `pageSize`, returning each page's item ids.
async function walk<T extends { id: string }>(
  list: (opts: KeysetPageOpts) => Promise<KeysetPage<T>>,
  pageSize: number,
): Promise<string[][]> {
  const pages: string[][] = []
  let after: CreatedAtIdBoundary | undefined
  for (let i = 0; i < 50; i++) {
    const page = await list({ pageSize, after })
    pages.push(page.items.map((item) => item.id))
    if (!page.nextBoundary) return pages
    after = page.nextBoundary
  }
  throw new Error('cursor never ended')
}

describe('audit repo cursor paging', () => {
  async function seed(count: number) {
    const { db } = await createTestApp()
    // Pairs share a second, so ids break ties.
    await db.insert(auditEvents).values(
      Array.from({ length: count }, (_, i) => ({
        id: `evt-${String(i).padStart(2, '0')}`,
        orgId: i % 2 === 0 ? 'org-a' : 'org-b',
        userId: null,
        action: i % 3 === 0 ? 'upload' : 'delete',
        targetType: 'file',
        targetId: null,
        targetName: `f${i}`,
        metadata: null,
        createdAt: new Date(1_700_000_000_000 + Math.floor(i / 2) * 1000),
      })),
    )
    return createAuditRepo(db)
  }

  it('list pages one org newest first with ids breaking timestamp ties', async () => {
    const repo = await seed(9)
    const pages = await walk((opts) => repo.list('org-a', opts), 2)
    expect(pages.map((p) => p.length)).toEqual([2, 2, 1])
    const all = pages.flat()
    expect(all).toHaveLength(5)
    expect(new Set(all).size).toBe(5)
    const full = (await repo.list('org-a', { pageSize: 100 })).items.map((e) => e.id)
    expect(all).toEqual(full)
    expect(full).toEqual(['evt-08', 'evt-06', 'evt-04', 'evt-02', 'evt-00'])
  })

  it('listAdminAudit pages through filters without repeating or skipping events', async () => {
    const repo = await seed(11)
    const full = (await repo.listAdminAudit({ pageSize: 100 })).items.map((e) => e.id)
    expect(full).toHaveLength(11)
    const pages = await walk((opts) => repo.listAdminAudit(opts), 3)
    expect(pages.map((p) => p.length)).toEqual([3, 3, 3, 2])
    expect(pages.flat()).toEqual(full)

    const filtered = await walk((opts) => repo.listAdminAudit({ ...opts, action: 'upload', orgId: 'org-a' }), 2)
    const expected = (await repo.listAdminAudit({ pageSize: 100, action: 'upload', orgId: 'org-a' })).items.map(
      (e) => e.id,
    )
    expect(filtered.flat()).toEqual(expected)
    expect(expected.length).toBeGreaterThan(0)
  })

  it('returns an empty page and no boundary when nothing matches', async () => {
    const repo = await seed(3)
    expect(await repo.listAdminAudit({ pageSize: 5, action: 'nope' })).toEqual({ items: [], nextBoundary: null })
  })
})

describe('site invitation repo cursor paging', () => {
  it('pages every invitation once, newest first, across timestamp ties', async () => {
    const { db } = await createTestApp()
    const base = 1_700_000_000_000
    await db.insert(siteInvitations).values(
      Array.from({ length: 7 }, (_, i) => ({
        id: `inv-${i}`,
        email: `u${i}@example.com`,
        token: `token-${i}`,
        invitedBy: 'nobody',
        expiresAt: new Date(base + 1_000_000),
        createdAt: new Date(base + Math.floor(i / 3) * 1000),
        updatedAt: new Date(base),
      })),
    )
    const repo = createSiteInvitationRepo(db)
    const pages = await walk((opts) => repo.listSiteInvitations(opts), 3)
    expect(pages.map((p) => p.length)).toEqual([3, 3, 1])
    expect(pages.flat()).toEqual(['inv-6', 'inv-5', 'inv-4', 'inv-3', 'inv-2', 'inv-1', 'inv-0'])
  })
})

describe('team repo cursor paging', () => {
  async function insertOrg(
    db: Awaited<ReturnType<typeof createTestApp>>['db'],
    id: string,
    slug: string,
    metadata: string | null,
    createdAt: number,
  ) {
    await db.run(sql`
      INSERT INTO organization (id, name, slug, metadata, created_at)
      VALUES (${id}, ${id}, ${slug}, ${metadata}, ${createdAt})
    `)
  }

  it('never lets personal orgs appear or take a slot, and orders newest first', async () => {
    const { db } = await createTestApp()
    const base = 1_800_000_000_000
    for (let i = 1; i <= 5; i++) await insertOrg(db, `team-${i}`, `team-${i}`, '{"type":"team"}', base + i)
    // Legacy team rows carry no metadata at all.
    await insertOrg(db, 'team-legacy', 'legacy', null, base + 0)
    // Newer than every team: a post-query filter would let these fill page one.
    await insertOrg(db, 'z-personal-slug', 'personal-abc', null, base + 100)
    await insertOrg(db, 'z-personal-meta', 'plain-slug', '{"type":"personal"}', base + 101)
    await insertOrg(db, 'z-personal-both', 'personal-def', '{"type":"personal"}', base + 102)
    // Invalid metadata JSON must not hide or break a team.
    await insertOrg(db, 'team-badjson', 'badjson', 'not json', base - 1)

    const repo = createTeamRepo(db)
    const pages = await walk((opts) => repo.listTeams(opts), 2)
    const all = pages.flat()
    expect(all).toEqual(['team-5', 'team-4', 'team-3', 'team-2', 'team-1', 'team-legacy', 'team-badjson'])
    expect(pages.map((p) => p.length)).toEqual([2, 2, 2, 1])
    for (const id of all) expect(id).not.toMatch(/personal/)
  })

  it('excludes the personal spaces created at sign-up', async () => {
    const { app, db } = await createTestApp()
    await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Solo', email: 'solo@example.com', password: 'password123456' }),
    })
    const orgs = await db.all<{ id: string }>(sql`SELECT id FROM organization`)
    expect(orgs.length).toBeGreaterThan(0)
    expect(await createTeamRepo(db).listTeams({ pageSize: 10 })).toEqual({ items: [], nextBoundary: null })
  })
})

describe('user admin repo listUsers', () => {
  async function seedUsers(
    db: Awaited<ReturnType<typeof createTestApp>>['db'],
    rows: Array<[string, string, string | null]>,
  ) {
    const now = 1_700_000_000
    for (const [index, [name, email, username]] of rows.entries()) {
      await db.run(sql`
        INSERT INTO user (id, name, email, email_verified, username, created_at, updated_at)
        VALUES (${`user-${String(index).padStart(2, '0')}`}, ${name}, ${email}, 1, ${username}, ${now + Math.floor(index / 2)}, ${now})
      `)
    }
  }

  it('pages newest first with id tie-breaks and no repeats', async () => {
    const { db } = await createTestApp()
    await seedUsers(
      db,
      Array.from({ length: 7 }, (_, i) => [`Name ${i}`, `n${i}@example.com`, null] as [string, string, null]),
    )
    const repo = createUserAdminRepo(db)
    const pages = await walk((opts) => repo.listUsers(opts), 3)
    expect(pages.map((p) => p.length)).toEqual([3, 3, 1])
    expect(pages.flat()).toEqual(['user-06', 'user-05', 'user-04', 'user-03', 'user-02', 'user-01', 'user-00'])
  })

  it('matches name, email, and username without regard to case', async () => {
    const { db } = await createTestApp()
    await seedUsers(db, [
      ['Annabel Lee', 'ann@example.com', null],
      ['Robert', 'BOB@Example.com', null],
      ['Cat', 'cat@example.com', 'Zebra_Fan'],
    ])
    const repo = createUserAdminRepo(db)
    const emails = async (search: string) => (await repo.listUsers({ pageSize: 10, search })).items.map((u) => u.email)
    expect(await emails('annabel')).toEqual(['ann@example.com'])
    expect(await emails('ANNABEL')).toEqual(['ann@example.com'])
    expect(await emails('bob@example')).toEqual(['BOB@Example.com'])
    expect(await emails('ZEBRA')).toEqual(['cat@example.com'])
    expect(await emails('  zebra  ')).toEqual(['cat@example.com'])
    expect(await emails('nothing')).toEqual([])
  })

  it('treats %, _ and backslash in the term as literal characters', async () => {
    const { db } = await createTestApp()
    await seedUsers(db, [
      ['a_b', 'u0@example.com', null],
      ['axb', 'u1@example.com', null],
      ['100% sure', 'u2@example.com', null],
      ['100 sure', 'u3@example.com', null],
      ['back\\slash', 'u4@example.com', null],
      ['backXslash', 'u5@example.com', null],
    ])
    const repo = createUserAdminRepo(db)
    const names = async (search: string) => (await repo.listUsers({ pageSize: 10, search })).items.map((u) => u.name)
    expect(await names('a_b')).toEqual(['a_b'])
    expect(await names('100%')).toEqual(['100% sure'])
    expect(await names('%')).toEqual(['100% sure'])
    expect(await names('_')).toEqual(['a_b'])
    expect(await names('back\\s')).toEqual(['back\\slash'])
  })

  it('treats a blank search as no filter and maps banned to a boolean', async () => {
    const { db } = await createTestApp()
    await seedUsers(db, [['One', 'one@example.com', null]])
    const repo = createUserAdminRepo(db)
    const blank = await repo.listUsers({ pageSize: 10, search: '   ' })
    expect(blank.items).toHaveLength(1)
    expect(blank.items[0].banned).toBe(false)
  })

  it('pages a search result with the same filter', async () => {
    const { db } = await createTestApp()
    await seedUsers(db, [
      ['Match 1', 'm1@example.com', null],
      ['Other', 'o@example.com', null],
      ['Match 2', 'm2@example.com', null],
      ['Match 3', 'm3@example.com', null],
    ])
    const repo = createUserAdminRepo(db)
    const pages = await walk((opts) => repo.listUsers({ ...opts, search: 'match' }), 2)
    expect(pages).toEqual([['user-03', 'user-02'], ['user-00']])
  })
})
