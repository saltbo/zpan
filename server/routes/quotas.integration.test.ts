import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { authedHeaders, createTestApp, seedProLicense } from '../test/setup.js'

async function adminHeaders(app: ReturnType<typeof import('../app')['createApp']>) {
  // Sign up first user (gets promoted to admin via hook)
  await authedHeaders(app, 'admin@example.com', 'password123456')
  // Sign in again to get a session that reflects the admin role
  const signInRes = await app.request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', password: 'password123456' }),
  })
  return { Cookie: signInRes.headers.getSetCookie().join('; ') }
}

describe('Admin Quotas API', () => {
  it('returns 401 without auth', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/admin/quotas')
    expect(res.status).toBe(401)
  })

  it('returns 403 for non-admin', async () => {
    const { app } = await createTestApp()
    await authedHeaders(app, 'admin@example.com')
    await authedHeaders(app, 'regular@example.com')
    const signInRes = await app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'regular@example.com', password: 'password123456' }),
    })
    const freshHeaders = { Cookie: signInRes.headers.getSetCookie().join('; ') }
    const res = await app.request('/api/admin/quotas', { headers: freshHeaders })
    expect(res.status).toBe(403)
  })

  it('GET /api/admin/quotas returns the default quota row created at signup', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)
    const res = await app.request('/api/admin/quotas', { headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: Array<Record<string, unknown>>; total: number }
    expect(body.items).toHaveLength(1)
    expect(body.total).toBe(1)
    expect(body.items[0].quota).toBe(10485760)
  })

  it('PUT /api/admin/quotas/:orgId creates quota for org', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)

    // Find the admin's personal org
    const orgs = await db.all<{ id: string }>(
      sql`SELECT o.id FROM organization o WHERE o.metadata LIKE '%"type":"personal"%' LIMIT 1`,
    )
    const orgId = orgs[0].id

    const res = await app.request(`/api/admin/quotas/${orgId}`, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ quota: 1073741824 }), // 1GB
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.orgId).toBe(orgId)
    expect(body.quota).toBe(1073741824)

    // Verify in DB
    const quotas = await db.all<{ quota: number }>(sql`SELECT quota FROM org_quotas WHERE org_id = ${orgId}`)
    expect(quotas[0].quota).toBe(1073741824)
  })

  it('PUT /api/admin/quotas/:orgId updates existing quota', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)

    const orgs = await db.all<{ id: string }>(
      sql`SELECT o.id FROM organization o WHERE o.metadata LIKE '%"type":"personal"%' LIMIT 1`,
    )
    const orgId = orgs[0].id

    // Create initial quota
    await app.request(`/api/admin/quotas/${orgId}`, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ quota: 1000 }),
    })

    // Update it
    const res = await app.request(`/api/admin/quotas/${orgId}`, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ quota: 2000 }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.quota).toBe(2000)
  })

  it('PUT /api/admin/quotas/:orgId rejects negative quota', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)
    const res = await app.request('/api/admin/quotas/some-org', {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ quota: -100 }),
    })
    expect(res.status).toBe(400)
  })

  it('PUT /api/admin/quotas/:orgId returns 402 without Pro license', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)

    const orgs = await db.all<{ id: string }>(
      sql`SELECT o.id FROM organization o WHERE o.metadata LIKE '%"type":"personal"%' LIMIT 1`,
    )
    const orgId = orgs[0].id

    const res = await app.request(`/api/admin/quotas/${orgId}`, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ quota: 1000 }),
    })
    expect(res.status).toBe(402)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.error).toBe('feature_not_available')
    expect(body.feature).toBe('team_quotas')
  })

  it('GET /api/admin/quotas lists quotas with org info', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await adminHeaders(app)

    const orgs = await db.all<{ id: string }>(
      sql`SELECT o.id FROM organization o WHERE o.metadata LIKE '%"type":"personal"%' LIMIT 1`,
    )
    const orgId = orgs[0].id

    // Create a quota
    await app.request(`/api/admin/quotas/${orgId}`, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ quota: 5000 }),
    })

    const res = await app.request('/api/admin/quotas', { headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: Array<Record<string, unknown>>; total: number }
    expect(body.items).toHaveLength(1)
    expect(body.items[0].orgId).toBe(orgId)
    expect(body.items[0].quota).toBe(5000)
    expect(body.items[0].orgName).toBeTruthy()
    expect(body.items[0].orgType).toBe('personal')
  })
})

describe('User Quotas API — /api/quotas', () => {
  it('GET /api/quotas/me returns 401 without auth', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/quotas/me')
    expect(res.status).toBe(401)
  })

  it('GET /api/quotas/me returns the built-in default quota of 10MB when no system option is set', async () => {
    const { app } = await createTestApp()
    const headers = await authedHeaders(app)
    const res = await app.request('/api/quotas/me', { headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.quota).toBe(10485760)
    expect(body.used).toBe(0)
    expect(body.orgId).toBeTruthy()
  })

  it('GET /api/quotas/me returns 404 when user has no org', async () => {
    const { app, db } = await createTestApp()
    const _headers = await authedHeaders(app, 'noorg@example.com')
    // Delete the user's org membership and org to simulate no org
    const users = await db.all<{ id: string }>(sql`SELECT id FROM user WHERE email = 'noorg@example.com'`)
    await db.run(sql`DELETE FROM member WHERE user_id = ${users[0].id}`)
    // Sign in again to get fresh session without org
    const signInRes = await app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'noorg@example.com', password: 'password123456' }),
    })
    const freshHeaders = { Cookie: signInRes.headers.getSetCookie().join('; ') }
    const res = await app.request('/api/quotas/me', { headers: freshHeaders })
    expect(res.status).toBe(404)
  })

  it('GET /api/quotas/me returns quota after admin sets it', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const adminH = await adminHeaders(app)

    // Find admin's org
    const orgs = await db.all<{ id: string }>(
      sql`SELECT o.id FROM organization o WHERE o.metadata LIKE '%"type":"personal"%' LIMIT 1`,
    )
    const orgId = orgs[0].id

    // Set quota as admin
    await app.request(`/api/admin/quotas/${orgId}`, {
      method: 'PUT',
      headers: { ...adminH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ quota: 10000 }),
    })

    // Check as user (admin is also a user)
    const res = await app.request('/api/quotas/me', { headers: adminH })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.quota).toBe(10000)
    expect(body.used).toBe(0)
  })
})
