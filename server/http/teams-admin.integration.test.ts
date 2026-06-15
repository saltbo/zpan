import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { authedHeaders, createTestApp } from '../test/setup.js'

type TestDb = Awaited<ReturnType<typeof createTestApp>>['db']
type TestApp = Awaited<ReturnType<typeof createTestApp>>['app']

async function adminHeaders(app: TestApp) {
  await authedHeaders(app, 'admin@example.com', 'password123456')
  const signInRes = await app.request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', password: 'password123456' }),
  })
  return { Cookie: signInRes.headers.getSetCookie().join('; ') }
}

async function seedTeam(
  db: TestDb,
  opts: { id: string; name: string; quota?: number; ownerId?: string; memberIds?: string[] },
) {
  await db.run(sql`
    INSERT INTO organization (id, name, slug, metadata)
    VALUES (${opts.id}, ${opts.name}, ${opts.id}, '{"type":"team"}')
  `)
  await db.run(sql`
    INSERT INTO org_quotas (id, org_id, quota, used, traffic_quota, traffic_used, traffic_period)
    VALUES (${`quota-${opts.id}`}, ${opts.id}, 0, 0, 0, 0, '1970-01')
  `)
  const now = Date.now()
  if (opts.quota !== undefined) {
    await db.run(sql`
      INSERT INTO org_quota_entitlements
        (id, org_id, resource_type, entitlement_type, source, source_id, bytes, starts_at, status, created_at, updated_at)
      VALUES
        (${`ent-${opts.id}`}, ${opts.id}, 'storage', 'plan', 'free_plan', ${`free_plan:${opts.id}`}, ${opts.quota}, ${now}, 'active', ${now}, ${now})
    `)
  }
  for (const [i, uid] of (opts.memberIds ?? []).entries()) {
    const role = uid === opts.ownerId ? 'owner' : 'editor'
    await db.run(sql`
      INSERT INTO member (id, organization_id, user_id, role)
      VALUES (${`m-${opts.id}-${i}`}, ${opts.id}, ${uid}, ${role})
    `)
  }
}

async function userId(db: TestDb, email: string): Promise<string> {
  const rows = await db.all<{ id: string }>(sql`SELECT id FROM user WHERE email = ${email}`)
  return rows[0].id
}

describe('Admin Teams API', () => {
  it('requires admin [spec: teams-admin/admin-only]', async () => {
    const { app } = await createTestApp()
    const noAuth = await app.request('/api/teams')
    expect(noAuth.status).toBe(401)

    // First sign-up becomes admin; a later sign-up is a plain member.
    await authedHeaders(app, 'admin@example.com', 'password123456')
    await authedHeaders(app, 'plain@example.com', 'password123456')
    const signIn = await app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'plain@example.com', password: 'password123456' }),
    })
    const headers = { Cookie: signIn.headers.getSetCookie().join('; ') }
    const forbidden = await app.request('/api/teams', { headers })
    expect(forbidden.status).toBe(403)
  })

  it('lists only team orgs with usage, members, and owner, excluding personal spaces [spec: teams-admin/list]', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    const adminId = await userId(db, 'admin@example.com')
    await seedTeam(db, { id: 'team-a', name: 'Alpha', quota: 20971520, ownerId: adminId, memberIds: [adminId] })
    await seedTeam(db, { id: 'team-b', name: 'Beta' }) // unlimited, no members

    const res = await app.request('/api/teams', { headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: Array<Record<string, unknown>>; total: number }

    // admin's personal org must not appear
    expect(body.items.every((t) => !String(t.slug).startsWith('personal-'))).toBe(true)
    expect(body.total).toBe(2)

    const alpha = body.items.find((t) => t.id === 'team-a')!
    expect(alpha.quotaTotal).toBe(20971520)
    expect(alpha.memberCount).toBe(1)
    expect(alpha.ownerName).toBeTruthy()

    const beta = body.items.find((t) => t.id === 'team-b')!
    expect(beta.quotaTotal).toBe(0)
    expect(beta.memberCount).toBe(0)
    expect(beta.ownerName).toBeNull()
  })

  it('returns a single team detail [spec: teams-admin/detail]', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await seedTeam(db, { id: 'team-x', name: 'Detail', quota: 10485760 })

    const res = await app.request('/api/teams/team-x', { headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { id: string; name: string; quotaTotal: number }
    expect(body.id).toBe('team-x')
    expect(body.name).toBe('Detail')
    expect(body.quotaTotal).toBe(10485760)
  })

  it('returns 404 for a missing or personal org [spec: teams-admin/detail-not-found]', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)

    const missing = await app.request('/api/teams/nope', { headers })
    expect(missing.status).toBe(404)

    const personalOrg = await db.all<{ id: string }>(
      sql`SELECT id FROM organization WHERE slug LIKE 'personal-%' LIMIT 1`,
    )
    const personal = await app.request(`/api/teams/${personalOrg[0].id}`, { headers })
    expect(personal.status).toBe(404)
  })
})

describe('Admin Team Entitlements API', () => {
  it('grants, lists, and revokes a storage entitlement for a team [spec: teams-admin/entitlement-lifecycle]', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await seedTeam(db, { id: 'team-q1', name: 'Quota Team' })

    const grant = await app.request('/api/teams/team-q1/entitlements', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ resourceType: 'storage', bytes: 1024, note: 'starter' }),
    })
    expect(grant.status).toBe(201)
    const granted = (await grant.json()) as { orgId: string; entitlement: { id: string; bytes: number } }
    expect(granted.orgId).toBe('team-q1')
    expect(granted.entitlement.bytes).toBe(1024)

    const list = await app.request('/api/teams/team-q1/entitlements', { headers })
    expect(list.status).toBe(200)
    const listed = (await list.json()) as { items: Array<{ id: string; status: string }> }
    expect(listed.items).toHaveLength(1)
    expect(listed.items[0].status).toBe('active')

    // Effective quota (overview endpoint) reflects the grant
    const quotas = await app.request('/api/quotas', { headers })
    const quotasBody = (await quotas.json()) as { items: Array<{ orgId: string; entitlementQuota: number }> }
    expect(quotasBody.items.find((item) => item.orgId === 'team-q1')?.entitlementQuota).toBe(1024)

    const revoke = await app.request(`/api/teams/team-q1/entitlements/${granted.entitlement.id}`, {
      method: 'DELETE',
      headers,
    })
    expect(revoke.status).toBe(200)
    const afterRevoke = await app.request('/api/teams/team-q1/entitlements', { headers })
    const afterBody = (await afterRevoke.json()) as { items: Array<{ status: string }> }
    expect(afterBody.items[0].status).toBe('revoked')
  })

  it('updates an admin grant bytes [spec: teams-admin/update-entitlement]', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await seedTeam(db, { id: 'team-q2', name: 'Quota Team 2' })

    const grant = await app.request('/api/teams/team-q2/entitlements', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ resourceType: 'storage', bytes: 1024 }),
    })
    const granted = (await grant.json()) as { entitlement: { id: string } }

    const update = await app.request(`/api/teams/team-q2/entitlements/${granted.entitlement.id}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ bytes: 4096 }),
    })
    expect(update.status).toBe(200)
    const updated = (await update.json()) as { entitlement: { bytes: number } }
    expect(updated.entitlement.bytes).toBe(4096)
  })

  it('returns 404 for an unknown org and 403 for non-admin callers [spec: teams-admin/entitlement-guards]', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)
    const missing = await app.request('/api/teams/no-such-org/entitlements', { headers })
    expect(missing.status).toBe(404)

    await authedHeaders(app, 'plain@example.com')
    const signIn = await app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'plain@example.com', password: 'password123456' }),
    })
    const plainHeaders = { Cookie: signIn.headers.getSetCookie().join('; ') }
    const forbidden = await app.request('/api/teams/no-such-org/entitlements', { headers: plainHeaders })
    expect(forbidden.status).toBe(403)
  })
})
