import { describe, expect, it } from 'vitest'
import { adminHeaders, authedHeaders, createTestApp, seedBusinessLicense } from '../../test/setup.js'

const publishedAnnouncement = {
  title: 'Maintenance window',
  body: 'Uploads will pause for ten minutes.',
  status: 'published',
  priority: 10,
}

type TestContext = Awaited<ReturnType<typeof createTestApp>>

async function createPublishedAnnouncement(ctx: TestContext) {
  const headers = await adminHeaders(ctx.app)
  await seedBusinessLicense(ctx.db)
  const res = await ctx.app.request('/api/site/announcements', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(publishedAnnouncement),
  })
  return (await res.json()) as { id: string; title: string }
}

describe('Admin Announcements API', () => {
  it('returns 401 without auth', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/site/announcements?scope=all')
    expect(res.status).toBe(401)
  })

  it('returns 403 for non-admin users [spec: announcements/admin-only]', async () => {
    const { app, db } = await createTestApp()
    await adminHeaders(app)
    await seedBusinessLicense(db)
    const headers = await authedHeaders(app, 'user@example.com')

    const res = await app.request('/api/site/announcements?scope=all', { headers })
    expect(res.status).toBe(403)
  })

  it('returns 402 when site announcements are not available', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)

    const res = await app.request('/api/site/announcements?scope=all', { headers })
    expect(res.status).toBe(402)
    const body = (await res.json()) as { error: { details: { reason: string; metadata?: { feature?: string } }[] } }
    expect(body.error.details[0]?.reason).toBe('FEATURE_NOT_AVAILABLE')
    expect(body.error.details[0]?.metadata?.feature).toBe('site_announcements')
  })

  it('creates, lists, updates, and deletes an announcement [spec: announcements/crud]', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await seedBusinessLicense(db)

    const createRes = await app.request('/api/site/announcements', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...publishedAnnouncement, status: 'draft' }),
    })
    expect(createRes.status).toBe(201)
    const created = (await createRes.json()) as { id: string; status: string }
    expect(created.status).toBe('draft')

    const updateRes = await app.request(`/api/site/announcements/${created.id}`, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...publishedAnnouncement, title: 'Updated title' }),
    })
    expect(updateRes.status).toBe(200)
    const updated = (await updateRes.json()) as { title: string; status: string }
    expect(updated.title).toBe('Updated title')
    expect(updated.status).toBe('published')

    const listRes = await app.request('/api/site/announcements?status=published', { headers })
    expect(listRes.status).toBe(200)
    const list = (await listRes.json()) as { items: Array<{ id: string }>; total: number }
    expect(list.total).toBe(1)
    expect(list.items[0].id).toBe(created.id)

    const deleteRes = await app.request(`/api/site/announcements/${created.id}`, { method: 'DELETE', headers })
    expect(deleteRes.status).toBe(200)
  })
})

describe('User Announcements API', () => {
  it('returns 401 without auth', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/site/announcements')
    expect(res.status).toBe(401)
  })

  it('returns 402 when site announcements are not available', async () => {
    const { app } = await createTestApp()
    await adminHeaders(app)
    const headers = await authedHeaders(app, 'reader@example.com')

    const res = await app.request('/api/site/announcements', { headers })
    expect(res.status).toBe(402)
    const body = (await res.json()) as { error: { details: { reason: string; metadata?: { feature?: string } }[] } }
    expect(body.error.details[0]?.reason).toBe('FEATURE_NOT_AVAILABLE')
    expect(body.error.details[0]?.metadata?.feature).toBe('site_announcements')
  })

  it('returns active announcements [spec: announcements/user-active]', async () => {
    const ctx = await createTestApp()
    const { app } = ctx
    const created = await createPublishedAnnouncement(ctx)
    const headers = await authedHeaders(app, 'reader@example.com')

    const activeRes = await app.request('/api/site/announcements?scope=active', { headers })
    expect(activeRes.status).toBe(200)
    const active = (await activeRes.json()) as { items: Array<{ id: string }>; total: number }
    expect(active.total).toBe(1)
    expect(active.items[0].id).toBe(created.id)
  })

  it('keeps archived announcements in history but not active list [spec: announcements/archived-history]', async () => {
    const { app, db } = await createTestApp()
    const admin = await adminHeaders(app)
    await seedBusinessLicense(db)
    const createRes = await app.request('/api/site/announcements', {
      method: 'POST',
      headers: { ...admin, 'Content-Type': 'application/json' },
      body: JSON.stringify(publishedAnnouncement),
    })
    const created = (await createRes.json()) as { id: string }

    const archiveRes = await app.request(`/api/site/announcements/${created.id}`, {
      method: 'PUT',
      headers: { ...admin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...publishedAnnouncement, status: 'archived' }),
    })
    expect(archiveRes.status).toBe(200)

    const headers = await authedHeaders(app, 'reader@example.com')
    const activeRes = await app.request('/api/site/announcements?scope=active', { headers })
    const active = (await activeRes.json()) as { items: unknown[]; total: number }
    expect(active.total).toBe(0)

    const historyRes = await app.request('/api/site/announcements', { headers })
    const history = (await historyRes.json()) as { items: Array<{ id: string; status: string }>; total: number }
    expect(history.total).toBe(1)
    expect(history.items[0]).toMatchObject({ id: created.id, status: 'archived' })
  })

  it('does not include draft announcements in history [spec: announcements/no-drafts]', async () => {
    const { app, db } = await createTestApp()
    const admin = await adminHeaders(app)
    await seedBusinessLicense(db)
    await app.request('/api/site/announcements', {
      method: 'POST',
      headers: { ...admin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...publishedAnnouncement, status: 'draft' }),
    })
    const headers = await authedHeaders(app, 'reader@example.com')

    const res = await app.request('/api/site/announcements', { headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: unknown[]; total: number }
    expect(body.total).toBe(0)
  })

  it('rejects invalid pagination query values [spec: announcements/pagination-validation]', async () => {
    const ctx = await createTestApp()
    const { app } = ctx
    await createPublishedAnnouncement(ctx)
    const headers = await authedHeaders(app, 'reader@example.com')

    const res = await app.request('/api/site/announcements?page=abc&pageSize=xyz', { headers })
    expect(res.status).toBe(400)
  })
})
