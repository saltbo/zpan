import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { authedHeaders, createTestApp } from '../test/setup.js'

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
  it('returns 401 without auth [spec: quotas/admin-auth-required]', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/quotas')
    expect(res.status).toBe(401)
  })

  it('returns 403 for non-admin [spec: quotas/admin-only]', async () => {
    const { app } = await createTestApp()
    await authedHeaders(app, 'admin@example.com')
    await authedHeaders(app, 'regular@example.com')
    const signInRes = await app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'regular@example.com', password: 'password123456' }),
    })
    const freshHeaders = { Cookie: signInRes.headers.getSetCookie().join('; ') }
    const res = await app.request('/api/quotas', { headers: freshHeaders })
    expect(res.status).toBe(403)
  })

  it('GET /api/quotas returns the default quota row created at signup [spec: quotas/default-row]', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)
    const res = await app.request('/api/quotas', { headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: Array<Record<string, unknown>>; total: number }
    expect(body.items).toHaveLength(1)
    expect(body.total).toBe(1)
    expect(body.items[0].quota).toBe(10485760)
    expect(body.items[0].trafficQuota).toBe(0)
    expect(body.items[0].trafficUsed).toBe(0)
    expect(body.items[0].trafficPeriod).toMatch(/^\d{4}-\d{2}$/)
  })

  it('GET /api/quotas normalizes stale monthly traffic period in the response without writing [spec: quotas/normalizes-stale-period]', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await db.run(sql`UPDATE org_quotas SET traffic_quota = 1000, traffic_used = 900, traffic_period = '1970-01'`)

    const res = await app.request('/api/quotas', { headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: Array<Record<string, unknown>>; total: number }
    expect(body.items[0].trafficUsed).toBe(0)
    expect(body.items[0].trafficPeriod).toMatch(/^\d{4}-\d{2}$/)

    // The listing is a pure read: it normalizes the stale period in the response
    // but must not mutate the row. Persisting the reset is the cron's job.
    const rows = await db.all<{ trafficUsed: number; trafficPeriod: string }>(
      sql`SELECT traffic_used AS trafficUsed, traffic_period AS trafficPeriod FROM org_quotas LIMIT 1`,
    )
    expect(rows[0].trafficUsed).toBe(900)
    expect(rows[0].trafficPeriod).toBe('1970-01')
  })

  it('GET /api/quotas lists quotas with org info [spec: quotas/list-with-org]', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)

    const orgs = await db.all<{ id: string }>(
      sql`SELECT o.id FROM organization o WHERE o.metadata LIKE '%"type":"personal"%' LIMIT 1`,
    )
    const orgId = orgs[0].id

    const res = await app.request('/api/quotas', { headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: Array<Record<string, unknown>>; total: number }
    expect(body.items).toHaveLength(1)
    expect(body.items[0].orgId).toBe(orgId)
    expect(body.items[0].quota).toBe(10485760)
    expect(body.items[0].trafficQuota).toBe(0)
    expect(body.items[0].trafficUsed).toBe(0)
    expect(body.items[0].trafficPeriod).toMatch(/^\d{4}-\d{2}$/)
    expect(body.items[0].orgName).toBeTruthy()
    expect(body.items[0].orgType).toBe('personal')
  })

  it('GET /api/quotas lists effective quota with active entitlements [spec: quotas/effective-with-entitlements]', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    const orgs = await db.all<{ id: string }>(
      sql`SELECT o.id FROM organization o WHERE o.metadata LIKE '%"type":"personal"%' LIMIT 1`,
    )
    const orgId = orgs[0].id
    const now = Date.now()
    await db.run(sql`UPDATE org_quotas SET quota = 0, traffic_quota = 0 WHERE org_id = ${orgId}`)
    await db.run(sql`DELETE FROM org_quota_entitlements WHERE org_id = ${orgId}`)
    await db.run(sql`
      INSERT INTO org_quota_entitlements
        (id, org_id, resource_type, entitlement_type, source, source_id, bytes, starts_at, expires_at, status, metadata, created_at, updated_at)
      VALUES
        ('ent-admin-storage-plan', ${orgId}, 'storage', 'plan', 'test', 'admin-storage-plan', 5000, ${now}, NULL, 'active', NULL, ${now}, ${now}),
        ('ent-admin-storage', ${orgId}, 'storage', 'grant', 'test', 'admin-storage', 3000, ${now}, NULL, 'active', NULL, ${now}, ${now}),
        ('ent-admin-traffic-plan', ${orgId}, 'traffic', 'plan', 'test', 'admin-traffic-plan', 1000, ${now}, NULL, 'active', NULL, ${now}, ${now}),
        ('ent-admin-traffic', ${orgId}, 'traffic', 'grant', 'test', 'admin-traffic', 2000, ${now}, NULL, 'active', NULL, ${now}, ${now}),
        ('ent-admin-revoked', ${orgId}, 'storage', 'grant', 'test', 'admin-revoked', 9000, ${now}, NULL, 'revoked', NULL, ${now}, ${now})
    `)

    const res = await app.request('/api/quotas', { headers })

    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: Array<Record<string, unknown>> }
    expect(body.items[0]).toMatchObject({
      baseQuota: 5000,
      entitlementQuota: 3000,
      quota: 8000,
      baseTrafficQuota: 1000,
      entitlementTrafficQuota: 2000,
      trafficQuota: 3000,
    })
  })

  it('GET /api/quotas exposes active plan and extra quota labels [spec: quotas/plan-labels]', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    const orgs = await db.all<{ id: string }>(
      sql`SELECT o.id FROM organization o WHERE o.metadata LIKE '%"type":"personal"%' LIMIT 1`,
    )
    const orgId = orgs[0].id
    const now = Date.now()
    await db.run(sql`UPDATE org_quotas SET quota = 0, traffic_quota = 0 WHERE org_id = ${orgId}`)
    await db.run(sql`DELETE FROM org_quota_entitlements WHERE org_id = ${orgId}`)
    await db.run(sql`
      INSERT INTO org_quota_entitlements
        (id, org_id, resource_type, entitlement_type, source, source_id, bytes, starts_at, expires_at, status, metadata, created_at, updated_at)
      VALUES
        ('ent-admin-plan-storage', ${orgId}, 'storage', 'plan', 'test', ${`stripe_subscription:sub_storage:${orgId}`}, 3000, ${now}, NULL, 'active', '{"packageName":"Team Plan"}', ${now}, ${now}),
        ('ent-admin-plan-storage-old', ${orgId}, 'storage', 'plan', 'test', ${`stripe_subscription:sub_storage_old:${orgId}`}, 2500, ${now}, NULL, 'revoked', '{"packageName":"Old Team Plan"}', ${now}, ${now}),
        ('ent-admin-extra-storage', ${orgId}, 'storage', 'grant', 'test', 'storage-pack', 700, ${now}, NULL, 'active', '{"packageName":"Storage Pack"}', ${now}, ${now}),
        ('ent-admin-plan-traffic', ${orgId}, 'traffic', 'plan', 'test', ${`stripe_subscription:sub_traffic:${orgId}`}, 4000, ${now}, NULL, 'active', '{"packageName":"Team Plan"}', ${now}, ${now}),
        ('ent-admin-extra-traffic', ${orgId}, 'traffic', 'grant', 'test', 'traffic-pack', 900, ${now}, NULL, 'active', '{"packageName":"Traffic Boost"}', ${now}, ${now})
    `)

    const res = await app.request('/api/quotas', { headers })

    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: Array<Record<string, unknown>> }
    expect(body.items[0]).toMatchObject({
      baseQuota: 3000,
      entitlementQuota: 700,
      quota: 3700,
      baseTrafficQuota: 4000,
      entitlementTrafficQuota: 900,
      trafficQuota: 4900,
      storagePlanName: 'Team Plan',
      storageExtraNames: ['Storage Pack'],
      trafficPlanName: 'Team Plan',
      trafficExtraNames: ['Traffic Boost'],
    })
  })
})

describe('User Quotas API — /api/quotas', () => {
  it('GET /api/quotas/me returns 401 without auth [spec: quotas/me-auth-required]', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/quotas/me')
    expect(res.status).toBe(401)
  })

  it('GET /api/quotas/me returns the built-in default quota of 10MB when no system option is set [spec: quotas/me-default]', async () => {
    const { app } = await createTestApp()
    const headers = await authedHeaders(app)
    const res = await app.request('/api/quotas/me', { headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.quota).toBe(10485760)
    expect(body.used).toBe(0)
    expect(body.trafficQuota).toBe(0)
    expect(body.trafficUsed).toBe(0)
    expect(body.trafficPeriod).toMatch(/^\d{4}-\d{2}$/)
    expect(body.orgId).toBeTruthy()
  })

  it('GET /api/quotas/me returns 404 when user has no org [spec: quotas/me-no-org]', async () => {
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

  it('GET /api/quotas/me returns base quota plus active entitlements and labels [spec: quotas/me-effective]', async () => {
    const { app, db } = await createTestApp()
    const adminH = await adminHeaders(app)
    const orgs = await db.all<{ id: string }>(
      sql`SELECT o.id FROM organization o WHERE o.metadata LIKE '%"type":"personal"%' LIMIT 1`,
    )
    const orgId = orgs[0].id
    const now = Date.now()
    await db.run(sql`UPDATE org_quotas SET quota = 0, traffic_quota = 0 WHERE org_id = ${orgId}`)
    await db.run(sql`DELETE FROM org_quota_entitlements WHERE org_id = ${orgId}`)
    await db.run(sql`
      INSERT INTO org_quota_entitlements
        (id, org_id, resource_type, entitlement_type, source, source_id, bytes, starts_at, expires_at, status, metadata, created_at, updated_at)
      VALUES
        ('ent-user-storage-plan', ${orgId}, 'storage', 'plan', 'test', 'user-storage-plan', 1000, ${now}, NULL, 'active', '{"packageName":"Free"}', ${now}, ${now}),
        ('ent-user-storage', ${orgId}, 'storage', 'grant', 'test', 'user-storage', 4000, ${now}, NULL, 'active', '{"packageName":"Storage Pack"}', ${now}, ${now}),
        ('ent-user-traffic-plan', ${orgId}, 'traffic', 'plan', 'test', 'user-traffic-plan', 2000, ${now}, NULL, 'active', '{"packageName":"Free"}', ${now}, ${now}),
        ('ent-user-traffic', ${orgId}, 'traffic', 'grant', 'test', 'user-traffic', 6000, ${now}, NULL, 'active', '{"packageName":"Traffic Boost"}', ${now}, ${now})
    `)

    const res = await app.request('/api/quotas/me', { headers: adminH })

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body).toMatchObject({
      baseQuota: 1000,
      entitlementQuota: 4000,
      quota: 5000,
      baseTrafficQuota: 2000,
      entitlementTrafficQuota: 6000,
      trafficQuota: 8000,
      storagePlanName: 'Free',
      storageExtraNames: ['Storage Pack'],
      trafficPlanName: 'Free',
      trafficExtraNames: ['Traffic Boost'],
    })
  })
})

describe('Admin quota listing', () => {
  it('normalizes stale traffic periods without historical grant aggregation', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    const now = Date.now()
    const adminOrg = await db.all<{ id: string }>(sql`SELECT id FROM organization LIMIT 1`)

    await db.run(sql`
      INSERT INTO organization (id, name, slug, metadata, created_at, updated_at)
      VALUES ('team-quota-listing', 'Team Quota Listing', 'team-quota-listing', '{"type":"team"}', ${now}, ${now})
    `)
    await db.run(sql`
      INSERT INTO org_quotas (id, org_id, quota, used, traffic_quota, traffic_used, traffic_period)
      VALUES ('team-quota-listing-row', 'team-quota-listing', 2000, 100, 3000, 2500, '1970-01')
    `)
    await db.run(sql`UPDATE org_quotas SET traffic_quota = 1000, traffic_used = 900, traffic_period = '1970-01'`)
    const res = await app.request('/api/quotas', { headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: Array<Record<string, unknown>>; total: number }

    expect(body.total).toBe(2)
    expect(body.items).toHaveLength(2)
    expect(body.items.every((item) => item.trafficUsed === 0)).toBe(true)
    expect(body.items.every((item) => /^\d{4}-\d{2}$/.test(String(item.trafficPeriod)))).toBe(true)

    const adminItem = body.items.find((item) => item.orgId === adminOrg[0].id)
    expect(adminItem).toMatchObject({ baseQuota: 10485760, quota: 10485760 })
  })
})

describe('GET /api/quotas/users', () => {
  it('returns 403 for non-admin [spec: quotas/users-admin-only]', async () => {
    const { app } = await createTestApp()
    await authedHeaders(app, 'admin@example.com')
    const userHeaders = await authedHeaders(app, 'regular@example.com')
    const res = await app.request('/api/quotas/users?ids=whoever', { headers: userHeaders })
    expect(res.status).toBe(403)
  })

  it('returns per-user storage used/total for the given ids [spec: quotas/users-batch]', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await authedHeaders(app, 'target@example.com')
    const rows = await db.all<{ id: string }>(sql`SELECT id FROM user WHERE email = 'target@example.com'`)
    const userId = rows[0].id
    const org = await db.all<{ id: string }>(sql`SELECT id FROM organization WHERE slug = ${`personal-${userId}`}`)
    await db.run(sql`UPDATE org_quotas SET used = 4242 WHERE org_id = ${org[0].id}`)

    const res = await app.request(`/api/quotas/users?ids=${userId}`, { headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: Array<{ userId: string; used: number; total: number }> }
    expect(body.items).toEqual([{ userId, used: 4242, total: 10485760 }])
  })

  it('omits ids that have no personal org [spec: quotas/users-missing-omitted]', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)
    const res = await app.request('/api/quotas/users?ids=ghost-1,ghost-2', { headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: unknown[] }
    expect(body.items).toEqual([])
  })
})
