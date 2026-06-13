import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { buildBreadcrumb } from '../services/profile.js'
import { createTestApp } from '../test/setup.js'

async function insertUser(
  db: Awaited<ReturnType<typeof createTestApp>>['db'],
  opts: { id: string; username: string; email: string },
) {
  const now = Date.now()
  await db.run(sql`
    INSERT INTO user (id, name, email, email_verified, username, created_at, updated_at)
    VALUES (${opts.id}, 'Test User', ${opts.email}, 1, ${opts.username}, ${now}, ${now})
  `)
  await db.run(sql`
    INSERT INTO organization (id, name, slug, created_at)
    VALUES (${`org-${opts.id}`}, 'Personal', ${`personal-${opts.id}`}, ${now})
  `)
  await db.run(sql`
    INSERT INTO member (id, organization_id, user_id, role, created_at)
    VALUES (${`member-${opts.id}`}, ${`org-${opts.id}`}, ${opts.id}, 'owner', ${now})
  `)
  return { orgId: `org-${opts.id}` }
}

describe('GET /api/profiles/:username', () => {
  it('returns 404 when user does not exist', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/profiles/nonexistent')
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body).toEqual({ error: 'User not found' })
  })

  it('returns user info and empty shares', async () => {
    const { app, db } = await createTestApp()
    await insertUser(db, { id: 'user-1', username: 'testuser', email: 'test@example.com' })

    const res = await app.request('/api/profiles/testuser')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { user: { username: string }; shares: unknown[] }
    expect(body.user.username).toBe('testuser')
    expect(body.shares).toEqual([])
  })

  it('works without authentication', async () => {
    const { app, db } = await createTestApp()
    await insertUser(db, { id: 'user-1', username: 'testuser', email: 'test@example.com' })

    const res = await app.request('/api/profiles/testuser')
    expect(res.status).toBe(200)
  })

  it('returns user info when user exists but has no personal org', async () => {
    const { app, db } = await createTestApp()
    const now = Date.now()
    await db.run(sql`
      INSERT INTO user (id, name, email, email_verified, username, created_at, updated_at)
      VALUES ('user-2', 'Orphan User', 'orphan@example.com', 1, 'orphanuser', ${now}, ${now})
    `)

    const res = await app.request('/api/profiles/orphanuser')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { user: { username: string }; shares: unknown[] }
    expect(body.user.username).toBe('orphanuser')
    expect(body.shares).toEqual([])
  })
})

describe('GET /api/profiles/:username/browse', () => {
  it('returns 404 for unknown username', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/profiles/nonexistent/browse')
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body).toEqual({ error: 'User not found' })
  })

  it('returns empty items and breadcrumb for known user', async () => {
    const { app, db } = await createTestApp()
    await insertUser(db, { id: 'user-1', username: 'testuser', email: 'test@example.com' })

    const res = await app.request('/api/profiles/testuser/browse')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: unknown[]; breadcrumb: string[] }
    expect(body.items).toEqual([])
    expect(body.breadcrumb).toEqual([])
  })
})

describe('buildBreadcrumb', () => {
  it('returns empty array for empty string', () => {
    expect(buildBreadcrumb('')).toEqual([])
  })

  it('returns single segment for a simple name', () => {
    expect(buildBreadcrumb('photos')).toEqual(['photos'])
  })

  it('splits nested path into segments', () => {
    expect(buildBreadcrumb('a/b/c')).toEqual(['a', 'b', 'c'])
  })

  it('returns two segments for one-level-deep path', () => {
    expect(buildBreadcrumb('Parent/Child')).toEqual(['Parent', 'Child'])
  })
})
