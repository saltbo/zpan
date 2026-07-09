import { sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildBreadcrumb } from '../domain/breadcrumb.js'
import { authedHeaders, createTestApp, seedBusinessLicense } from '../test/setup.js'

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

async function personalOrgId(db: Awaited<ReturnType<typeof createTestApp>>['db'], userId: string): Promise<string> {
  const rows = await db.all<{ id: string }>(sql`
    SELECT o.id
    FROM organization o
    INNER JOIN member m ON m.organization_id = o.id
    WHERE m.user_id = ${userId}
      AND (o.slug LIKE 'personal-%' OR COALESCE(o.metadata, '') LIKE '%"type":"personal"%')
    LIMIT 1
  `)
  if (!rows[0]) throw new Error(`No personal org found for user ${userId}`)
  return rows[0].id
}

describe('User entitlements API (admin)', () => {
  it('GET /api/users/:id/quota returns the user storage used/total [spec: users/quota-personal-org]', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await signUpUser(app, 'quota-sub@example.com')
    const rows = await db.all<{ id: string }>(sql`SELECT id FROM user WHERE email = 'quota-sub@example.com'`)
    const userId = rows[0].id
    const orgId = await personalOrgId(db, userId)
    await db.run(sql`UPDATE org_quotas SET used = 4242 WHERE org_id = ${orgId}`)

    const res = await app.request(`/api/users/${userId}/quota`, { headers })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ used: 4242, total: 10485760, hasPersonalOrg: true })
  })

  it('GET /api/users/:id/quota reports hasPersonalOrg=false when the user has none', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await signUpUser(app, 'quota-noorg@example.com')
    const rows = await db.all<{ id: string }>(sql`SELECT id FROM user WHERE email = 'quota-noorg@example.com'`)
    const userId = rows[0].id
    await db.run(sql`DELETE FROM member WHERE user_id = ${userId}`)

    const res = await app.request(`/api/users/${userId}/quota`, { headers })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ used: 0, total: 0, hasPersonalOrg: false })
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

  it('auth middleware rejects a banned user on an existing session [spec: users/disabled-session-rejected]', async () => {
    const { app, db } = await createTestApp()

    // Capture a live session, then ban the user. Admin ban/unban is served by
    // better-auth's /admin/ban-user; here we only assert our middleware enforces it.
    const userHeaders = await authedHeaders(app, 'banned@example.com')
    await db.run(sql`UPDATE user SET banned = 1 WHERE email = 'banned@example.com'`)

    const res = await app.request('/api/quotas/me', { headers: userHeaders })
    expect(res.status).toBe(403)
    const body = (await res.json()) as { error: { message: string } }
    expect(body.error.message).toBe('Account disabled')
  })

  it('POST /api/users/:id/entitlements grants storage entitlement for a personal org [spec: users/grant-entitlement]', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await signUpUser(app, 'grant-storage@example.com')
    const users = await db.all<{ id: string }>(sql`SELECT id FROM user WHERE email = 'grant-storage@example.com'`)
    const userId = users[0].id
    const orgId = await personalOrgId(db, userId)

    const res = await app.request(`/api/users/${userId}/entitlements`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ resourceType: 'storage', bytes: 123456, note: 'launch bonus' }),
    })

    expect(res.status).toBe(201)
    const body = (await res.json()) as { orgId: string; entitlement: Record<string, unknown> }
    expect(body.orgId).toBe(orgId)
    expect(body.entitlement).toMatchObject({
      orgId,
      resourceType: 'storage',
      entitlementType: 'grant',
      source: 'admin_grant',
      bytes: 123456,
      status: 'active',
    })
    const entitlements = await db.all<{ bytes: number; entitlementType: string; source: string }>(
      sql`SELECT bytes, entitlement_type AS entitlementType, source FROM org_quota_entitlements WHERE org_id = ${orgId} AND source = 'admin_grant'`,
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

    expect(res.status).toBe(204)
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
    const orgId = await personalOrgId(db, userId)
    const now = Date.now()
    await db.run(sql`
      INSERT INTO org_quota_entitlements
        (id, org_id, resource_type, entitlement_type, source, source_id, bytes, starts_at, expires_at, status, metadata, created_at, updated_at)
      VALUES
        ('ent-no-meta', ${orgId}, 'storage', 'grant', 'admin_grant', 'admin_grant:no-meta', 1000, ${now}, NULL, 'active', NULL, ${now}, ${now})
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
    const orgId = await personalOrgId(db, userId)
    const free = await db.all<{ id: string }>(
      sql`SELECT id FROM org_quota_entitlements WHERE org_id = ${orgId} AND source = 'free_plan' LIMIT 1`,
    )

    const res = await app.request(`/api/users/${userId}/entitlements/${free[0].id}`, {
      method: 'DELETE',
      headers,
    })

    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { message: string } }
    expect(body.error.message).toBe('Only admin-granted entitlements can be modified')
  })

  it('PATCH /api/users/:id/entitlements/:eid rejects non-admin-grant sources', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await signUpUser(app, 'free-plan-edit@example.com')
    const users = await db.all<{ id: string }>(sql`SELECT id FROM user WHERE email = 'free-plan-edit@example.com'`)
    const userId = users[0].id
    const orgId = await personalOrgId(db, userId)

    const free = await db.all<{ id: string }>(
      sql`SELECT id FROM org_quota_entitlements WHERE org_id = ${orgId} AND source = 'free_plan' LIMIT 1`,
    )

    const res = await app.request(`/api/users/${userId}/entitlements/${free[0].id}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ bytes: 9999 }),
    })

    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { message: string } }
    expect(body.error.message).toBe('Only admin-granted entitlements can be modified')
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
    const body = (await res.json()) as { error: { message: string } }
    expect(body.error.message).toBe(`Personal organization not found for user: ${userId}`)
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

// ─── User avatar (PUT/DELETE /api/users/me/avatar) ────────────────────────────

const CLOUD_AVATAR_URL = 'https://avatars.zpan.cloud/user/u1.webp'

// Stub the Cloud avatar service and capture each avatar request so tests can
// assert the /avatars/:scope/:id path, the image content type, and the bearer
// auth that reach Cloud. `seedBusinessLicense` makes the instance Cloud-paired
// (active license binding, refresh token 'test-refresh-token').
function stubCloudAvatarFetch() {
  const calls: { url: string; method: string; contentType: string | null; authorization: string | null }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url)
      if (u.includes('/avatars/')) {
        const headers = new Headers(init?.headers)
        calls.push({
          url: u,
          method: init?.method ?? 'GET',
          contentType: headers.get('content-type'),
          authorization: headers.get('authorization'),
        })
        if (init?.method === 'DELETE') return new Response(null, { status: 204 })
        return new Response(JSON.stringify({ url: CLOUD_AVATAR_URL, key: 'avatars/user/u1' }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response('unexpected fetch', { status: 404 })
    }),
  )
  return calls
}

function makeFile(type: string, bytes = 16): File {
  return new File([new Uint8Array(bytes)], `f.${type.split('/')[1]}`, { type })
}

describe('PUT /api/users/me/avatar', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('returns 401 without auth [spec: avatar/auth-required]', async () => {
    const { app } = await createTestApp()
    const form = new FormData()
    form.set('file', makeFile('image/png'))
    const res = await app.request('/api/users/me/avatar', { method: 'PUT', body: form })
    expect(res.status).toBe(401)
  })

  it('returns 415 when Content-Type is not multipart [spec: avatar/multipart-required]', async () => {
    const { app } = await createTestApp()
    const headers = await authedHeaders(app)
    const res = await app.request('/api/users/me/avatar', {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ nope: true }),
    })
    expect(res.status).toBe(415)
  })

  it('returns 400 when file field is missing [spec: avatar/file-required]', async () => {
    const { app } = await createTestApp()
    const headers = await authedHeaders(app)
    const form = new FormData()
    form.set('notFile', 'x')
    const res = await app.request('/api/users/me/avatar', { method: 'PUT', headers, body: form })
    expect(res.status).toBe(400)
  })

  it('returns 400 for an unsupported mime, before any Cloud call [spec: avatar/mime-validated]', async () => {
    const { app, db } = await createTestApp()
    await seedBusinessLicense(db)
    const headers = await authedHeaders(app)
    const calls = stubCloudAvatarFetch()
    const form = new FormData()
    form.set('file', makeFile('application/pdf'))
    const res = await app.request('/api/users/me/avatar', { method: 'PUT', headers, body: form })
    expect(res.status).toBe(400)
    expect(calls).toHaveLength(0)
  })

  it('returns 413 when the file exceeds 1 MiB, before any Cloud call [spec: avatar/size-limit]', async () => {
    const { app, db } = await createTestApp()
    await seedBusinessLicense(db)
    const headers = await authedHeaders(app)
    const calls = stubCloudAvatarFetch()
    const form = new FormData()
    form.set('file', makeFile('image/png', 2 * 1024 * 1024))
    const res = await app.request('/api/users/me/avatar', { method: 'PUT', headers, body: form })
    expect(res.status).toBe(413)
    expect(calls).toHaveLength(0)
  })

  it('returns 503 cloud_required when the instance is not paired to Cloud [spec: avatar/needs-cloud]', async () => {
    const { app } = await createTestApp()
    const headers = await authedHeaders(app)
    const form = new FormData()
    form.set('file', makeFile('image/png'))
    const res = await app.request('/api/users/me/avatar', { method: 'PUT', headers, body: form })
    expect(res.status).toBe(503)
  })

  it('hosts the avatar on Cloud, writes user.image, returns the URL [spec: avatar/upload]', async () => {
    const { app, db } = await createTestApp()
    await seedBusinessLicense(db)
    const headers = await authedHeaders(app)
    const calls = stubCloudAvatarFetch()
    const form = new FormData()
    form.set('file', makeFile('image/webp'))

    const res = await app.request('/api/users/me/avatar', { method: 'PUT', headers, body: form })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { url: string }
    expect(body.url).toBe(CLOUD_AVATAR_URL)

    const put = calls.find((c) => c.method === 'PUT')
    expect(put?.url).toMatch(/\/avatars\/user\//)
    expect(put?.contentType).toBe('image/webp')
    expect(put?.authorization).toBe('Bearer test-refresh-token')

    const rows = await db.all<{ image: string | null }>(sql`SELECT image FROM user LIMIT 1`)
    expect(rows[0]?.image).toBe(CLOUD_AVATAR_URL)
  })
})

describe('DELETE /api/users/me/avatar', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('returns 401 without auth', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/users/me/avatar', { method: 'DELETE' })
    expect(res.status).toBe(401)
  })

  it('clears user.image and deletes the Cloud avatar [spec: avatar/delete]', async () => {
    const { app, db } = await createTestApp()
    await seedBusinessLicense(db)
    const headers = await authedHeaders(app)
    await db.run(sql`UPDATE user SET image = 'https://example.com/old.png'`)
    const calls = stubCloudAvatarFetch()

    const res = await app.request('/api/users/me/avatar', { method: 'DELETE', headers })
    expect(res.status).toBe(204)

    const rows = await db.all<{ image: string | null }>(sql`SELECT image FROM user LIMIT 1`)
    expect(rows[0]?.image).toBeNull()

    const del = calls.find((c) => c.method === 'DELETE')
    expect(del?.url).toMatch(/\/avatars\/user\//)
  })

  it('succeeds when the instance is not paired to Cloud (DB cleared, Cloud delete skipped) [spec: avatar/delete-unbound]', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await db.run(sql`UPDATE user SET image = 'https://example.com/old.png'`)
    const calls = stubCloudAvatarFetch()

    const res = await app.request('/api/users/me/avatar', { method: 'DELETE', headers })
    expect(res.status).toBe(204)
    const rows = await db.all<{ image: string | null }>(sql`SELECT image FROM user LIMIT 1`)
    expect(rows[0]?.image).toBeNull()
    expect(calls).toHaveLength(0)
  })
})

// ─── Public user profile (GET /api/users/:username) ───────────────────────────

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

describe('GET /api/users/:username', () => {
  it('returns 404 when user does not exist [spec: profile/user-not-found]', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/users/nonexistent')
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: { message: string } }
    expect(body.error.message).toBe('User not found')
  })

  it('returns user info and empty shares [spec: profile/user-info]', async () => {
    const { app, db } = await createTestApp()
    await insertUser(db, { id: 'user-1', username: 'testuser', email: 'test@example.com' })

    const res = await app.request('/api/users/testuser')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { user: { username: string }; shares: unknown[] }
    expect(body.user.username).toBe('testuser')
    expect(body.shares).toEqual([])
  })

  it('works without authentication [spec: profile/public]', async () => {
    const { app, db } = await createTestApp()
    await insertUser(db, { id: 'user-1', username: 'testuser', email: 'test@example.com' })

    const res = await app.request('/api/users/testuser')
    expect(res.status).toBe(200)
  })

  it('returns user info when user exists but has no personal org [spec: profile/no-personal-org]', async () => {
    const { app, db } = await createTestApp()
    const now = Date.now()
    await db.run(sql`
      INSERT INTO user (id, name, email, email_verified, username, created_at, updated_at)
      VALUES ('user-2', 'Orphan User', 'orphan@example.com', 1, 'orphanuser', ${now}, ${now})
    `)

    const res = await app.request('/api/users/orphanuser')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { user: { username: string }; shares: unknown[] }
    expect(body.user.username).toBe('orphanuser')
    expect(body.shares).toEqual([])
  })
})

describe('GET /api/users/:username/objects', () => {
  it('returns 404 for unknown username [spec: profile/unknown-username]', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/users/nonexistent/objects')
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: { message: string } }
    expect(body.error.message).toBe('User not found')
  })

  it('returns empty items and breadcrumb for known user [spec: profile/empty-listing]', async () => {
    const { app, db } = await createTestApp()
    await insertUser(db, { id: 'user-1', username: 'testuser', email: 'test@example.com' })

    const res = await app.request('/api/users/testuser/objects')
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

  it('splits nested path into segments [spec: profile/breadcrumb-segments]', () => {
    expect(buildBreadcrumb('a/b/c')).toEqual(['a', 'b', 'c'])
  })

  it('returns two segments for one-level-deep path', () => {
    expect(buildBreadcrumb('Parent/Child')).toEqual(['Parent', 'Child'])
  })
})
