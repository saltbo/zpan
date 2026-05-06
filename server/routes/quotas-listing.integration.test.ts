import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { authedHeaders, createTestApp } from '../test/setup.js'

async function adminHeaders(app: ReturnType<typeof import('../app')['createApp']>) {
  await authedHeaders(app, 'admin@example.com', 'password123456')
  const signInRes = await app.request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', password: 'password123456' }),
  })
  return { Cookie: signInRes.headers.getSetCookie().join('; ') }
}

describe('Admin quota listing', () => {
  it('normalizes stale traffic periods and aggregates active grants', async () => {
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
    await db.run(sql`
      INSERT INTO quota_grants (id, org_id, source, external_event_id, bytes, active, created_at)
      VALUES
        ('grant-active-a', ${adminOrg[0].id}, 'stripe', 'evt-active-a', 500, 1, ${now}),
        ('grant-active-b', ${adminOrg[0].id}, 'stripe', 'evt-active-b', 700, 1, ${now}),
        ('grant-inactive', ${adminOrg[0].id}, 'stripe', 'evt-inactive', 900, 0, ${now})
    `)

    const res = await app.request('/api/admin/quotas', { headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: Array<Record<string, unknown>>; total: number }

    expect(body.total).toBe(2)
    expect(body.items).toHaveLength(2)
    expect(body.items.every((item) => item.trafficUsed === 0)).toBe(true)
    expect(body.items.every((item) => /^\d{4}-\d{2}$/.test(String(item.trafficPeriod)))).toBe(true)

    const adminItem = body.items.find((item) => item.orgId === adminOrg[0].id)
    expect(adminItem).toMatchObject({ baseQuota: 10485760, grantedQuota: 1200, quota: 10486960 })
  })
})
