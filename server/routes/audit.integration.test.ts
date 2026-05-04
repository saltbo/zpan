import { describe, expect, it } from 'vitest'
import { adminHeaders, authedHeaders, createTestApp, seedProLicense } from '../test/setup.js'

describe('GET /api/admin/audit — auth guards', () => {
  it('returns 401 without auth', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/admin/audit')
    expect(res.status).toBe(401)
  })

  it('returns 403 for authenticated non-admin', async () => {
    const { app } = await createTestApp()
    await adminHeaders(app)
    const headers = await authedHeaders(app, 'user@example.com')
    const res = await app.request('/api/admin/audit', { headers })
    expect(res.status).toBe(403)
  })

  it('returns 402 when admin lacks audit_log feature', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)
    // No Pro license seeded — feature gate should block
    const res = await app.request('/api/admin/audit', { headers })
    expect(res.status).toBe(402)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.feature).toBe('audit_log')
  })
})

describe('GET /api/admin/audit — licensed admin', () => {
  it('returns empty list when no non-auth events exist', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)

    // Filter to non-auth events — admin setup records a sign_up audit event
    const res = await app.request('/api/admin/audit?targetType=file', { headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: unknown[]; total: number; page: number; pageSize: number }
    expect(body.items).toEqual([])
    expect(body.total).toBe(0)
    expect(body.page).toBe(1)
    expect(body.pageSize).toBe(20)
  })

  it('lists events across multiple orgs, newest first', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)

    // Seed events in different orgs
    const earlier = new Date('2026-01-01T00:00:00Z')
    const later = new Date('2026-06-01T00:00:00Z')

    await db.insert((await import('../db/schema.js')).activityEvents).values([
      {
        id: 'evt-a',
        orgId: 'org-a',
        userId: 'user-1',
        action: 'upload',
        targetType: 'file',
        targetId: null,
        targetName: 'a.pdf',
        metadata: null,
        createdAt: earlier,
      },
      {
        id: 'evt-b',
        orgId: 'org-b',
        userId: 'user-2',
        action: 'delete',
        targetType: 'file',
        targetId: null,
        targetName: 'b.pdf',
        metadata: null,
        createdAt: later,
      },
    ])

    const res = await app.request('/api/admin/audit', { headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: Array<{ id: string }>; total: number }
    // admin setup records a sign_up event; seeded events are evt-a and evt-b
    expect(body.total).toBeGreaterThanOrEqual(2)
    // newest first: evt-b (June) before evt-a (Jan), admin sign_up is even newer
    const ids = body.items.map((i) => i.id)
    expect(ids.indexOf('evt-b')).toBeLessThan(ids.indexOf('evt-a'))
  })

  it('filters by orgId', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)

    const { activityEvents } = await import('../db/schema.js')
    await db.insert(activityEvents).values([
      {
        id: 'evt-1',
        orgId: 'org-x',
        userId: 'u1',
        action: 'upload',
        targetType: 'file',
        targetId: null,
        targetName: 'x.pdf',
        metadata: null,
        createdAt: new Date(),
      },
      {
        id: 'evt-2',
        orgId: 'org-y',
        userId: 'u2',
        action: 'upload',
        targetType: 'file',
        targetId: null,
        targetName: 'y.pdf',
        metadata: null,
        createdAt: new Date(),
      },
    ])

    const res = await app.request('/api/admin/audit?orgId=org-x', { headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: Array<{ orgId: string }>; total: number }
    expect(body.total).toBe(1)
    expect(body.items[0].orgId).toBe('org-x')
  })

  it('filters by userId', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)

    const { activityEvents } = await import('../db/schema.js')
    await db.insert(activityEvents).values([
      {
        id: 'evt-3',
        orgId: 'org-z',
        userId: 'alice',
        action: 'upload',
        targetType: 'file',
        targetId: null,
        targetName: 'a.pdf',
        metadata: null,
        createdAt: new Date(),
      },
      {
        id: 'evt-4',
        orgId: 'org-z',
        userId: 'bob',
        action: 'delete',
        targetType: 'file',
        targetId: null,
        targetName: 'b.pdf',
        metadata: null,
        createdAt: new Date(),
      },
    ])

    const res = await app.request('/api/admin/audit?userId=alice', { headers })
    const body = (await res.json()) as { items: Array<{ userId: string }>; total: number }
    expect(body.total).toBe(1)
    expect(body.items[0].userId).toBe('alice')
  })

  it('filters by action', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)

    const { activityEvents } = await import('../db/schema.js')
    await db.insert(activityEvents).values([
      {
        id: 'evt-5',
        orgId: 'org-1',
        userId: 'u1',
        action: 'upload',
        targetType: 'file',
        targetId: null,
        targetName: 'a.pdf',
        metadata: null,
        createdAt: new Date(),
      },
      {
        id: 'evt-6',
        orgId: 'org-1',
        userId: 'u1',
        action: 'delete',
        targetType: 'file',
        targetId: null,
        targetName: 'b.pdf',
        metadata: null,
        createdAt: new Date(),
      },
    ])

    const res = await app.request('/api/admin/audit?action=upload', { headers })
    const body = (await res.json()) as { items: Array<{ action: string }>; total: number }
    expect(body.total).toBe(1)
    expect(body.items[0].action).toBe('upload')
  })

  it('filters by targetType', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)

    const { activityEvents } = await import('../db/schema.js')
    await db.insert(activityEvents).values([
      {
        id: 'evt-7',
        orgId: 'org-1',
        userId: 'u1',
        action: 'create',
        targetType: 'folder',
        targetId: null,
        targetName: 'docs',
        metadata: null,
        createdAt: new Date(),
      },
      {
        id: 'evt-8',
        orgId: 'org-1',
        userId: 'u1',
        action: 'upload',
        targetType: 'file',
        targetId: null,
        targetName: 'a.pdf',
        metadata: null,
        createdAt: new Date(),
      },
    ])

    const res = await app.request('/api/admin/audit?targetType=folder', { headers })
    const body = (await res.json()) as { items: Array<{ targetType: string }>; total: number }
    expect(body.total).toBe(1)
    expect(body.items[0].targetType).toBe('folder')
  })

  it('respects pagination params and returns correct page/pageSize', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)

    const { activityEvents } = await import('../db/schema.js')
    // Insert 3 events
    await db.insert(activityEvents).values(
      [1, 2, 3].map((i) => ({
        id: `pg-evt-${i}`,
        orgId: 'org-pg',
        userId: 'u1',
        action: 'upload',
        targetType: 'file',
        targetId: null,
        targetName: `file-${i}.pdf`,
        metadata: null,
        createdAt: new Date(Date.now() - i * 1000),
      })),
    )

    const res = await app.request('/api/admin/audit?page=2&pageSize=2&orgId=org-pg', { headers })
    const body = (await res.json()) as {
      items: Array<{ id: string }>
      total: number
      page: number
      pageSize: number
    }
    expect(body.total).toBe(3)
    expect(body.page).toBe(2)
    expect(body.pageSize).toBe(2)
    expect(body.items).toHaveLength(1)
  })

  it('response items include actor display info and orgName', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)

    // Get admin user ID via sign-in
    const signInRes = await app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@example.com', password: 'password123456' }),
    })
    const session = (await signInRes.json()) as { user?: { id: string } }
    const userId = session.user?.id ?? 'unknown'

    const { activityEvents } = await import('../db/schema.js')
    await db.insert(activityEvents).values({
      id: 'actor-evt-1',
      orgId: 'some-org',
      userId,
      action: 'upload',
      targetType: 'file',
      targetId: null,
      targetName: 'test.pdf',
      metadata: null,
      createdAt: new Date(),
    })

    const res = await app.request('/api/admin/audit', { headers })
    const body = (await res.json()) as { items: Array<Record<string, unknown>>; total: number }
    // admin setup records a sign_up event; seeded actor-evt-1 is the file upload
    expect(body.total).toBeGreaterThanOrEqual(1)
    // Find the seeded file event (sorted newest-first, so it could be at index 0 or 1)
    const item = body.items.find((i) => i.id === 'actor-evt-1')
    expect(item).toBeDefined()
    expect(item).toHaveProperty('user')
    expect((item!.user as Record<string, unknown>).name).toBeTruthy()
    expect(item).toHaveProperty('orgName')
  })
})
