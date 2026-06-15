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

async function signUpUser(app: ReturnType<typeof import('../app')['createApp']>, email: string, name = 'Other User') {
  const res = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email, password: 'password123456' }),
  })
  return res.json()
}

describe('Admin Users API', () => {
  it('returns 401 without auth [spec: users/auth-required]', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/users')
    expect(res.status).toBe(401)
  })

  it('returns 403 for non-admin user [spec: users/admin-only]', async () => {
    const { app } = await createTestApp()
    // Create first user (auto-admin), then second user (non-admin)
    await authedHeaders(app, 'admin@example.com')
    const _headers = await authedHeaders(app, 'regular@example.com')
    // Sign in again to get fresh session with correct role
    const signInRes = await app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'regular@example.com', password: 'password123456' }),
    })
    const freshHeaders = { Cookie: signInRes.headers.getSetCookie().join('; ') }
    const res = await app.request('/api/users', { headers: freshHeaders })
    expect(res.status).toBe(403)
  })

  it('GET /api/users lists users with pagination [spec: users/list]', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)

    const res = await app.request('/api/users', { headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: Array<Record<string, unknown>>; total: number }
    expect(body.total).toBe(1)
    expect(body.items).toHaveLength(1)
    expect(body.items[0].email).toBe('admin@example.com')
    expect(body.items[0].orgName).toBeTruthy()
  })

  it('GET /api/users returns quota from the personal organization [spec: users/quota-personal-org]', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await signUpUser(app, 'quota-list@example.com')
    const users = await db.all<{ id: string }>(sql`SELECT id FROM user WHERE email = 'quota-list@example.com'`)
    const userId = users[0].id
    const personalOrgs = await db.all<{ id: string }>(
      sql`SELECT id FROM organization WHERE slug = ${`personal-${userId}`}`,
    )

    await db.run(sql`UPDATE org_quotas SET quota = 0, used = 789 WHERE org_id = ${personalOrgs[0].id}`)
    await db.run(sql`DELETE FROM org_quota_entitlements WHERE org_id = ${personalOrgs[0].id}`)
    await db.run(sql`
      INSERT INTO org_quota_entitlements
        (id, org_id, resource_type, entitlement_type, source, source_id, bytes, starts_at, expires_at, status, metadata, created_at, updated_at)
      VALUES
        ('ent-user-list-storage', ${personalOrgs[0].id}, 'storage', 'plan', 'test', 'user-list-storage', 123456, ${Date.now()}, NULL, 'active', NULL, ${Date.now()}, ${Date.now()})
    `)
    await db.run(
      sql`INSERT INTO organization (id, name, slug, metadata) VALUES ('team-org', 'Team Org', 'team-org', '{}')`,
    )
    await db.run(
      sql`INSERT INTO member (id, organization_id, user_id, role) VALUES ('team-member', 'team-org', ${userId}, 'member')`,
    )

    const res = await app.request('/api/users?search=quota-list@example.com', { headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: Array<Record<string, unknown>>; total: number }

    expect(body.total).toBe(1)
    expect(body.items[0]).toMatchObject({
      email: 'quota-list@example.com',
      orgId: personalOrgs[0].id,
      quotaUsed: 789,
      quotaDefault: 0,
      quotaTotal: 123456,
    })
  })

  it('GET /api/users computes quota total from active plan and extra storage entitlements [spec: users/quota-entitlements]', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await signUpUser(app, 'quota-plan@example.com')
    const users = await db.all<{ id: string }>(sql`SELECT id FROM user WHERE email = 'quota-plan@example.com'`)
    const userId = users[0].id
    const personalOrgs = await db.all<{ id: string }>(
      sql`SELECT id FROM organization WHERE slug = ${`personal-${userId}`}`,
    )
    const orgId = personalOrgs[0].id
    const now = Date.now()

    await db.run(sql`UPDATE org_quotas SET quota = 0, used = 900 WHERE org_id = ${orgId}`)
    await db.run(sql`DELETE FROM org_quota_entitlements WHERE org_id = ${orgId}`)
    await db.run(sql`
      INSERT INTO org_quota_entitlements
        (id, org_id, resource_type, entitlement_type, source, source_id, bytes, starts_at, expires_at, status, metadata, created_at, updated_at)
      VALUES
        ('ent-user-plan-storage', ${orgId}, 'storage', 'plan', 'test', ${`stripe_subscription:sub_storage:${orgId}`}, 5000, ${now}, NULL, 'active', '{"packageName":"Small Plan"}', ${now}, ${now}),
        ('ent-user-plan-storage-old', ${orgId}, 'storage', 'plan', 'test', ${`stripe_subscription:sub_storage_old:${orgId}`}, 4000, ${now}, NULL, 'revoked', '{"packageName":"Old Plan"}', ${now}, ${now}),
        ('ent-user-extra-storage', ${orgId}, 'storage', 'grant', 'test', 'storage-pack', 1000, ${now}, NULL, 'active', '{"packageName":"Storage Pack"}', ${now}, ${now}),
        ('ent-user-expired-storage', ${orgId}, 'storage', 'grant', 'test', 'expired-storage-pack', 9000, ${now}, ${now - 1}, 'active', '{"packageName":"Expired Pack"}', ${now}, ${now})
    `)

    const res = await app.request('/api/users?search=quota-plan@example.com', { headers })

    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: Array<Record<string, unknown>>; total: number }
    expect(body.items[0]).toMatchObject({
      email: 'quota-plan@example.com',
      orgId,
      quotaUsed: 900,
      quotaDefault: 0,
      quotaTotal: 6000,
    })
  })

  it('GET /api/users filters by name, username, or email with filtered totals [spec: users/filter]', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)
    await signUpUser(app, 'match-email@example.com', 'Email Match')
    await signUpUser(app, 'username-target@example.com', 'Plain Name')
    await signUpUser(app, 'other@example.com', 'Other Person')

    const byName = await app.request('/api/users?search=email%20match', { headers })
    expect(byName.status).toBe(200)
    const byNameBody = (await byName.json()) as { items: Array<Record<string, unknown>>; total: number }
    expect(byNameBody.total).toBe(1)
    expect(byNameBody.items[0].email).toBe('match-email@example.com')

    const byUsername = await app.request('/api/users?search=username-target', { headers })
    const byUsernameBody = (await byUsername.json()) as { items: Array<Record<string, unknown>>; total: number }
    expect(byUsernameBody.total).toBe(1)
    expect(byUsernameBody.items[0].email).toBe('username-target@example.com')

    const byEmail = await app.request('/api/users?search=other@example.com', { headers })
    const byEmailBody = (await byEmail.json()) as { items: Array<Record<string, unknown>>; total: number }
    expect(byEmailBody.total).toBe(1)
    expect(byEmailBody.items[0].email).toBe('other@example.com')
  })

  it('GET /api/users/:id returns user detail for an admin', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await signUpUser(app, 'detail@example.com')
    const rows = await db.all<{ id: string }>(sql`SELECT id FROM user WHERE email = 'detail@example.com'`)
    const userId = rows[0].id

    const res = await app.request(`/api/users/${userId}`, { headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { id: string }
    expect(body.id).toBe(userId)
  })

  it('GET /api/users/:id returns 404 for a missing user', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)
    const res = await app.request('/api/users/nonexistent', { headers })
    expect(res.status).toBe(404)
  })

  it('GET /api/users/:id/entitlements lists entitlements for an admin', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await signUpUser(app, 'entlist@example.com')
    const rows = await db.all<{ id: string }>(sql`SELECT id FROM user WHERE email = 'entlist@example.com'`)
    const userId = rows[0].id

    const res = await app.request(`/api/users/${userId}/entitlements`, { headers })
    expect(res.status).toBe(200)
  })

  it('GET /api/users/:id/entitlements returns 404 for a missing user', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)
    const res = await app.request('/api/users/nonexistent/entitlements', { headers })
    expect(res.status).toBe(404)
  })

  it('PATCH /api/users/:id disables a user [spec: users/disable]', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)

    // Create a second user
    await signUpUser(app, 'user2@example.com')

    // Find the second user
    const users = await db.all<{ id: string }>(sql`SELECT id FROM user WHERE email = 'user2@example.com'`)
    const userId = users[0].id

    const res = await app.request(`/api/users/${userId}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'disabled' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.status).toBe('disabled')

    // Verify user is banned in DB
    const updated = await db.all<{ banned: number }>(sql`SELECT banned FROM user WHERE id = ${userId}`)
    expect(updated[0].banned).toBe(1)
  })

  it('PATCH /api/users/:id rejects invalid status [spec: users/invalid-status]', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)
    const res = await app.request('/api/users/someid', {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'invalid' }),
    })
    expect(res.status).toBe(400)
  })

  it('PATCH /api/users/:id returns 404 for missing user [spec: users/patch-missing]', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)
    const res = await app.request('/api/users/nonexistent', {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'disabled' }),
    })
    expect(res.status).toBe(404)
  })

  it('DELETE /api/users/:id deletes a user [spec: users/delete]', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)

    await signUpUser(app, 'todelete@example.com')
    const users = await db.all<{ id: string }>(sql`SELECT id FROM user WHERE email = 'todelete@example.com'`)
    const userId = users[0].id

    const res = await app.request(`/api/users/${userId}`, {
      method: 'DELETE',
      headers,
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.deleted).toBe(true)

    // Verify user no longer exists
    const remaining = await db.all<{ id: string }>(sql`SELECT id FROM user WHERE id = ${userId}`)
    expect(remaining).toHaveLength(0)
  })

  it('disabled user is rejected by auth middleware on existing session [spec: users/disabled-session-rejected]', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)

    // Create a second user and get their session before banning
    const userHeaders = await authedHeaders(app, 'banned@example.com')

    const users = await db.all<{ id: string }>(sql`SELECT id FROM user WHERE email = 'banned@example.com'`)
    const userId = users[0].id

    // Disable the user while they have an active session
    await app.request(`/api/users/${userId}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'disabled' }),
    })

    // Banned user's existing session should be rejected with 403
    const res = await app.request('/api/quotas/me', { headers: userHeaders })
    expect(res.status).toBe(403)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.error).toBe('Account disabled')
  })

  it('DELETE /api/users/:id returns 404 for missing user', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)
    const res = await app.request('/api/users/nonexistent', {
      method: 'DELETE',
      headers,
    })
    expect(res.status).toBe(404)
  })

  it('PATCH /api/users disables and enables users [spec: users/batch]', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await signUpUser(app, 'batch1@example.com')
    await signUpUser(app, 'batch2@example.com')
    const users = await db.all<{ id: string }>(
      sql`SELECT id FROM user WHERE email IN ('batch1@example.com', 'batch2@example.com') ORDER BY email`,
    )
    const ids = users.map((row) => row.id)

    const disable = await app.request('/api/users', {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'disable', ids }),
    })
    expect(disable.status).toBe(200)
    expect((await disable.json()) as Record<string, unknown>).toMatchObject({ updated: 2, ids, status: 'disabled' })
    const disabled = await db.all<{ banned: number }>(sql`SELECT banned FROM user WHERE id IN (${ids[0]}, ${ids[1]})`)
    expect(disabled.every((row) => row.banned === 1)).toBe(true)

    const enable = await app.request('/api/users', {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'enable', ids }),
    })
    expect(enable.status).toBe(200)
    const enabled = await db.all<{ banned: number }>(sql`SELECT banned FROM user WHERE id IN (${ids[0]}, ${ids[1]})`)
    expect(enabled.every((row) => row.banned === 0)).toBe(true)
  })

  it('POST /api/users/:id/entitlements grants storage entitlement for a personal org [spec: users/grant-entitlement]', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await signUpUser(app, 'grant-storage@example.com')
    const users = await db.all<{ id: string }>(sql`SELECT id FROM user WHERE email = 'grant-storage@example.com'`)
    const userId = users[0].id
    const orgs = await db.all<{ id: string }>(sql`SELECT id FROM organization WHERE slug = ${`personal-${userId}`}`)

    const res = await app.request(`/api/users/${userId}/entitlements`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ resourceType: 'storage', bytes: 123456, note: 'launch bonus' }),
    })

    expect(res.status).toBe(201)
    const body = (await res.json()) as { orgId: string; entitlement: Record<string, unknown> }
    expect(body.orgId).toBe(orgs[0].id)
    expect(body.entitlement).toMatchObject({
      orgId: orgs[0].id,
      resourceType: 'storage',
      entitlementType: 'grant',
      source: 'admin_grant',
      bytes: 123456,
      status: 'active',
    })
    const entitlements = await db.all<{ bytes: number; entitlementType: string; source: string }>(
      sql`SELECT bytes, entitlement_type AS entitlementType, source FROM org_quota_entitlements WHERE org_id = ${orgs[0].id} AND source = 'admin_grant'`,
    )
    expect(entitlements).toEqual([{ bytes: 123456, entitlementType: 'grant', source: 'admin_grant' }])
  })

  it('PATCH /api/users/:id/entitlements/:eid updates an admin grant [spec: users/update-entitlement]', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    const user = (await signUpUser(app, 'edit-grant@example.com')) as { user: { id: string } }
    const userId = user.user.id

    const grant = await app.request(`/api/users/${userId}/entitlements`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ resourceType: 'storage', bytes: 1000 }),
    })
    const { entitlement } = (await grant.json()) as { entitlement: { id: string } }

    const expiresAt = '2030-01-01T00:00:00.000Z'
    const res = await app.request(`/api/users/${userId}/entitlements/${entitlement.id}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ bytes: 5000, expiresAt, note: 'bumped' }),
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as { entitlement: Record<string, unknown> }
    expect(body.entitlement).toMatchObject({ id: entitlement.id, bytes: 5000, status: 'active' })
    const rows = await db.all<{ bytes: number; expiresAt: number }>(
      sql`SELECT bytes, expires_at AS expiresAt FROM org_quota_entitlements WHERE id = ${entitlement.id}`,
    )
    expect(rows[0].bytes).toBe(5000)
    expect(rows[0].expiresAt).toBe(new Date(expiresAt).getTime())
  })

  it('DELETE /api/users/:id/entitlements/:eid revokes an admin grant [spec: users/revoke-entitlement]', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    const user = (await signUpUser(app, 'revoke-grant@example.com')) as { user: { id: string } }
    const userId = user.user.id

    const grant = await app.request(`/api/users/${userId}/entitlements`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ resourceType: 'storage', bytes: 2000 }),
    })
    const { entitlement } = (await grant.json()) as { entitlement: { id: string } }

    const res = await app.request(`/api/users/${userId}/entitlements/${entitlement.id}`, {
      method: 'DELETE',
      headers,
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as { entitlement: Record<string, unknown> }
    expect(body.entitlement).toMatchObject({ id: entitlement.id, status: 'revoked' })
    const rows = await db.all<{ status: string }>(
      sql`SELECT status FROM org_quota_entitlements WHERE id = ${entitlement.id}`,
    )
    expect(rows[0].status).toBe('revoked')
  })

  it('PATCH /api/users/:id/entitlements/:eid preserves unspecified fields', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    const user = (await signUpUser(app, 'patch-partial@example.com')) as { user: { id: string } }
    const userId = user.user.id

    const grant = await app.request(`/api/users/${userId}/entitlements`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ resourceType: 'storage', bytes: 1000, expiresAt: '2030-01-01T00:00:00.000Z' }),
    })
    const { entitlement } = (await grant.json()) as { entitlement: { id: string } }

    const bytesOnly = await app.request(`/api/users/${userId}/entitlements/${entitlement.id}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ bytes: 7000 }),
    })
    expect(bytesOnly.status).toBe(200)
    let rows = await db.all<{ bytes: number; expiresAt: number | null }>(
      sql`SELECT bytes, expires_at AS expiresAt FROM org_quota_entitlements WHERE id = ${entitlement.id}`,
    )
    expect(rows[0].bytes).toBe(7000)
    expect(rows[0].expiresAt).toBe(new Date('2030-01-01T00:00:00.000Z').getTime())

    const expiryOnly = await app.request(`/api/users/${userId}/entitlements/${entitlement.id}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresAt: null }),
    })
    expect(expiryOnly.status).toBe(200)
    rows = await db.all<{ bytes: number; expiresAt: number | null }>(
      sql`SELECT bytes, expires_at AS expiresAt FROM org_quota_entitlements WHERE id = ${entitlement.id}`,
    )
    expect(rows[0].bytes).toBe(7000)
    expect(rows[0].expiresAt).toBeNull()
  })

  it('PATCH /api/users/:id/entitlements/:eid handles a grant with no metadata', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await signUpUser(app, 'no-metadata-grant@example.com')
    const users = await db.all<{ id: string }>(sql`SELECT id FROM user WHERE email = 'no-metadata-grant@example.com'`)
    const userId = users[0].id
    const orgs = await db.all<{ id: string }>(sql`SELECT id FROM organization WHERE slug = ${`personal-${userId}`}`)
    const now = Date.now()
    await db.run(sql`
      INSERT INTO org_quota_entitlements
        (id, org_id, resource_type, entitlement_type, source, source_id, bytes, starts_at, expires_at, status, metadata, created_at, updated_at)
      VALUES
        ('ent-no-meta', ${orgs[0].id}, 'storage', 'grant', 'admin_grant', 'admin_grant:no-meta', 1000, ${now}, NULL, 'active', NULL, ${now}, ${now})
    `)

    const res = await app.request(`/api/users/${userId}/entitlements/ent-no-meta`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: 'first note' }),
    })

    expect(res.status).toBe(200)
    const rows = await db.all<{ metadata: string }>(
      sql`SELECT metadata FROM org_quota_entitlements WHERE id = 'ent-no-meta'`,
    )
    expect(JSON.parse(rows[0].metadata)).toMatchObject({ note: 'first note' })
  })

  it('PATCH and DELETE entitlement return 404 for an unknown entitlement id', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)
    const user = (await signUpUser(app, 'unknown-ent@example.com')) as { user: { id: string } }
    const userId = user.user.id

    const patch = await app.request(`/api/users/${userId}/entitlements/does-not-exist`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ bytes: 1 }),
    })
    expect(patch.status).toBe(404)

    const del = await app.request(`/api/users/${userId}/entitlements/does-not-exist`, {
      method: 'DELETE',
      headers,
    })
    expect(del.status).toBe(404)
  })

  it('PATCH and DELETE entitlement return 404 when the user has no personal org', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await signUpUser(app, 'no-org-edit@example.com')
    const users = await db.all<{ id: string }>(sql`SELECT id FROM user WHERE email = 'no-org-edit@example.com'`)
    const userId = users[0].id
    await db.run(sql`DELETE FROM member WHERE user_id = ${userId}`)

    const patch = await app.request(`/api/users/${userId}/entitlements/any`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ bytes: 1 }),
    })
    expect(patch.status).toBe(404)

    const del = await app.request(`/api/users/${userId}/entitlements/any`, {
      method: 'DELETE',
      headers,
    })
    expect(del.status).toBe(404)
  })

  it('DELETE /api/users/:id/entitlements/:eid rejects non-admin-grant sources [spec: users/entitlement-source-guard]', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await signUpUser(app, 'free-plan-revoke@example.com')
    const users = await db.all<{ id: string }>(sql`SELECT id FROM user WHERE email = 'free-plan-revoke@example.com'`)
    const userId = users[0].id
    const orgs = await db.all<{ id: string }>(sql`SELECT id FROM organization WHERE slug = ${`personal-${userId}`}`)
    const free = await db.all<{ id: string }>(
      sql`SELECT id FROM org_quota_entitlements WHERE org_id = ${orgs[0].id} AND source = 'free_plan' LIMIT 1`,
    )

    const res = await app.request(`/api/users/${userId}/entitlements/${free[0].id}`, {
      method: 'DELETE',
      headers,
    })

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Only admin-granted entitlements can be modified' })
  })

  it('PATCH /api/users/:id/entitlements/:eid rejects non-admin-grant sources', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await signUpUser(app, 'free-plan-edit@example.com')
    const users = await db.all<{ id: string }>(sql`SELECT id FROM user WHERE email = 'free-plan-edit@example.com'`)
    const userId = users[0].id
    const orgs = await db.all<{ id: string }>(sql`SELECT id FROM organization WHERE slug = ${`personal-${userId}`}`)
    const orgId = orgs[0].id

    const free = await db.all<{ id: string }>(
      sql`SELECT id FROM org_quota_entitlements WHERE org_id = ${orgId} AND source = 'free_plan' LIMIT 1`,
    )

    const res = await app.request(`/api/users/${userId}/entitlements/${free[0].id}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ bytes: 9999 }),
    })

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Only admin-granted entitlements can be modified' })
  })

  it('POST /api/users/:id/entitlements rejects traffic grants', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)
    const user = (await signUpUser(app, 'traffic-grant@example.com')) as { user: { id: string } }

    const res = await app.request(`/api/users/${user.user.id}/entitlements`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ resourceType: 'traffic', bytes: 123456 }),
    })

    expect(res.status).toBe(400)
  })

  it('POST /api/users/:id/entitlements fails when selected user has no personal org', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await signUpUser(app, 'no-personal-org@example.com')
    const users = await db.all<{ id: string }>(sql`SELECT id FROM user WHERE email = 'no-personal-org@example.com'`)
    const userId = users[0].id
    await db.run(sql`DELETE FROM member WHERE user_id = ${userId}`)

    const res = await app.request(`/api/users/${userId}/entitlements`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ resourceType: 'storage', bytes: 123456 }),
    })

    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: `Personal organization not found for user: ${userId}` })
  })

  it('DELETE /api/users deletes selected users', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await signUpUser(app, 'delete1@example.com')
    await signUpUser(app, 'delete2@example.com')
    const users = await db.all<{ id: string }>(
      sql`SELECT id FROM user WHERE email IN ('delete1@example.com', 'delete2@example.com') ORDER BY email`,
    )
    const ids = users.map((row) => row.id)

    const res = await app.request('/api/users', {
      method: 'DELETE',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    })

    expect(res.status).toBe(200)
    expect((await res.json()) as Record<string, unknown>).toMatchObject({ deleted: 2, ids })
    const remaining = await db.all<{ id: string }>(sql`SELECT id FROM user WHERE id IN (${ids[0]}, ${ids[1]})`)
    expect(remaining).toHaveLength(0)
  })

  it('batch operations reject missing users instead of skipping them', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)
    const patch = await app.request('/api/users', {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'disable', ids: ['missing-user'] }),
    })
    expect(patch.status).toBe(404)
    expect(await patch.json()).toEqual({ error: 'User not found: missing-user' })

    const del = await app.request('/api/users', {
      method: 'DELETE',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: ['missing-user'] }),
    })
    expect(del.status).toBe(404)
    expect(await del.json()).toEqual({ error: 'User not found: missing-user' })
  })

  it('POST /api/users/:id/entitlements rejects non-positive bytes', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)
    const user = (await signUpUser(app, 'zero-grant@example.com')) as { user: { id: string } }
    const res = await app.request(`/api/users/${user.user.id}/entitlements`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ resourceType: 'storage', bytes: 0 }),
    })
    expect(res.status).toBe(400)
  })
})
