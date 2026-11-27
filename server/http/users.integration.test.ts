import { sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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
        ('EntNoMetadata1', ${orgId}, 'storage', 'grant', 'admin_grant', 'admin_grant:no-meta', 1000, ${now}, NULL, 'active', NULL, ${now}, ${now})
    `)

    const res = await app.request(`/api/users/${userId}/entitlements/EntNoMetadata1`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: 'first note' }),
    })

    expect(res.status).toBe(200)
    const rows = await db.all<{ metadata: string }>(
      sql`SELECT metadata FROM org_quota_entitlements WHERE id = 'EntNoMetadata1'`,
    )
    expect(JSON.parse(rows[0].metadata)).toMatchObject({ note: 'first note' })
  })

  it('PATCH and DELETE entitlement return 404 for an unknown entitlement id', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)
    const user = (await signUpUser(app, 'unknown-ent@example.com')) as { user: { id: string } }
    const userId = user.user.id

    const patch = await app.request(`/api/users/${userId}/entitlements/DoesNotExist1`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ bytes: 1 }),
    })
    expect(patch.status).toBe(404)

    const del = await app.request(`/api/users/${userId}/entitlements/DoesNotExist1`, {
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

  describe('Cloud failures answer with a product message [spec: error-messages/external-failure]', () => {
    async function upload(cloud: Response | null, language: string) {
      const { app, db } = await createTestApp()
      if (cloud) {
        await seedBusinessLicense(db)
        vi.stubGlobal(
          'fetch',
          vi.fn(async () => cloud.clone()),
        )
      }
      const headers = await authedHeaders(app)
      const form = new FormData()
      form.set('file', makeFile('image/png'))
      const res = await app.request('/api/users/me/avatar', {
        method: 'PUT',
        headers: { ...headers, 'Accept-Language': language },
        body: form,
      })
      return { status: res.status, body: (await res.json()) as ErrorBody }
    }

    type ErrorBody = { error: { message: string; details: { reason: string }[] } }
    const cases = [
      {
        name: 'an unpaired instance',
        cloud: null,
        status: 503,
        en: 'This needs a connection to ZPan Cloud',
        zh: '需要连接 ZPan Cloud',
      },
      {
        name: 'an inactive license',
        cloud: Response.json({ error: 'license_inactive' }, { status: 403 }),
        status: 403,
        en: 'The license is not active',
        zh: '授权未激活',
        reason: 'LICENSE_INACTIVE',
      },
      {
        name: 'a Cloud outage',
        cloud: new Response('upstream exploded', { status: 502 }),
        status: 500,
        en: 'ZPan Cloud could not complete the request. Try again later.',
        zh: 'ZPan Cloud 未能完成请求，请稍后再试。',
        reason: 'CLOUD_REQUEST_FAILED',
      },
    ]

    for (const c of cases) {
      it(`answers ${c.name} in the request language, without the code`, async () => {
        const en = await upload(c.cloud, 'en')
        const zh = await upload(c.cloud, 'zh-CN')
        expect(en.status).toBe(c.status)
        expect(en.body.error.message).toBe(c.en)
        expect(zh.body.error.message).toBe(c.zh)
        expect(zh.body.error.details).toEqual(en.body.error.details)
        if (c.reason) expect(en.body.error.details[0].reason).toBe(c.reason)
        expect(JSON.stringify(en.body)).not.toMatch(/cloud_required|license_inactive|cloud_request_failed/)
      })
    }
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

type ProfileTestDb = Awaited<ReturnType<typeof createTestApp>>['db']

async function insertProfileMatter(
  db: ProfileTestDb,
  orgId: string,
  id: string,
  opts: {
    name?: string
    status?: string
    dirtype?: number
    trashedAt?: number | null
    purgedAt?: number | null
  } = {},
) {
  const now = Math.floor(Date.now() / 1000)
  const dirtype = opts.dirtype ?? 0
  await db.run(sql`
    INSERT INTO matters (
      id, org_id, alias, name, type, size, dirtype, parent, object, storage_id,
      status, trashed_at, purged_at, created_at, updated_at
    )
    VALUES (
      ${id}, ${orgId}, ${`${id}-alias`}, ${opts.name ?? `${id}.txt`},
      ${dirtype === 0 ? 'text/plain' : 'folder'}, ${dirtype === 0 ? 100 : 0}, ${dirtype},
      '', ${dirtype === 0 ? `objects/${id}` : ''}, 'profile-storage',
      ${opts.status ?? 'active'}, ${opts.trashedAt ?? null}, ${opts.purgedAt ?? null}, ${now}, ${now}
    )
  `)
}

async function insertProfileShare(
  db: ProfileTestDb,
  creatorId: string,
  orgId: string,
  matterId: string,
  opts: {
    id?: string
    token?: string
    kind?: 'landing' | 'direct'
    status?: 'active' | 'revoked'
    private?: boolean
    expiresAt?: number | null
    downloadLimit?: number | null
    downloads?: number
  } = {},
) {
  const now = Math.floor(Date.now() / 1000)
  const id = opts.id ?? `share-${matterId}`
  const token = opts.token ?? `token-${matterId}`
  await db.run(sql`
    INSERT INTO shares (
      id, token, kind, matter_id, org_id, creator_id, password_hash, expires_at,
      download_limit, views, downloads, status, private, created_at
    )
    VALUES (
      ${id}, ${token}, ${opts.kind ?? 'landing'}, ${matterId}, ${orgId}, ${creatorId},
      NULL, ${opts.expiresAt ?? null}, ${opts.downloadLimit ?? null}, 0, ${opts.downloads ?? 0},
      ${opts.status ?? 'active'}, ${opts.private ? 1 : 0}, ${now}
    )
  `)
  return { id, token }
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

  it('returns public landing shares and hides private ones without authentication [spec: profile/public-shares]', async () => {
    const { app, db } = await createTestApp()
    const { orgId } = await insertUser(db, {
      id: 'curated-user',
      username: 'curated',
      email: 'curated@example.com',
    })
    await insertProfileMatter(db, orgId, 'curated-file', { name: 'Public.txt' })
    await insertProfileMatter(db, orgId, 'curated-folder', { name: 'Photos', dirtype: 1 })
    await insertProfileMatter(db, orgId, 'private-file', { name: 'Hidden.txt' })
    await insertProfileShare(db, 'curated-user', orgId, 'curated-file', { token: 'public-file' })
    await insertProfileShare(db, 'curated-user', orgId, 'curated-folder', { token: 'public-folder' })
    await insertProfileShare(db, 'curated-user', orgId, 'private-file', {
      token: 'hidden-file',
      private: true,
    })

    const res = await app.request('/api/users/curated')

    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      shares: Array<{ token: string; name: string; type: string; size: number | null; isFolder: boolean }>
    }
    expect(body.shares).toEqual([
      { token: 'public-folder', name: 'Photos', type: 'folder', size: 0, isFolder: true },
      { token: 'public-file', name: 'Public.txt', type: 'text/plain', size: 100, isFolder: false },
    ])
  })

  it('never leaks forged listed direct or recipient-targeted shares [spec: profile/privacy-boundaries]', async () => {
    const { app, db } = await createTestApp()
    const { orgId } = await insertUser(db, {
      id: 'privacy-user',
      username: 'privacy',
      email: 'privacy@example.com',
    })
    await insertProfileMatter(db, orgId, 'private-direct')
    await insertProfileMatter(db, orgId, 'private-targeted')
    const direct = await insertProfileShare(db, 'privacy-user', orgId, 'private-direct', { kind: 'direct' })
    const targeted = await insertProfileShare(db, 'privacy-user', orgId, 'private-targeted')
    await db.run(sql`
      INSERT INTO share_recipients (id, share_id, recipient_email, created_at)
      VALUES ('private-recipient', ${targeted.id}, 'recipient@example.com', ${Math.floor(Date.now() / 1000)})
    `)

    const res = await app.request('/api/users/privacy')
    expect(res.status).toBe(200)
    expect(((await res.json()) as { shares: unknown[] }).shares).toEqual([])
    expect(direct.token).toBeTruthy()
  })

  it('filters every unavailable selected share at read time [spec: profile/availability-filtering]', async () => {
    const { app, db } = await createTestApp()
    const { orgId } = await insertUser(db, {
      id: 'availability-user',
      username: 'availability',
      email: 'availability@example.com',
    })
    const now = Math.floor(Date.now() / 1000)
    const matters = [
      ['available', {}],
      ['revoked', {}],
      ['expired', {}],
      ['exhausted', {}],
      ['trashed', { trashedAt: now }],
      ['purged', { purgedAt: now }],
      ['draft', { status: 'draft' }],
    ] as const
    for (const [id, options] of matters) await insertProfileMatter(db, orgId, id, options)

    await insertProfileShare(db, 'availability-user', orgId, 'available', { token: 'only-available' })
    await insertProfileShare(db, 'availability-user', orgId, 'revoked', { status: 'revoked' })
    await insertProfileShare(db, 'availability-user', orgId, 'expired', { expiresAt: now - 1 })
    await insertProfileShare(db, 'availability-user', orgId, 'exhausted', {
      downloadLimit: 2,
      downloads: 2,
    })
    await insertProfileShare(db, 'availability-user', orgId, 'trashed')
    await insertProfileShare(db, 'availability-user', orgId, 'purged')
    await insertProfileShare(db, 'availability-user', orgId, 'draft')
    await insertProfileShare(db, 'availability-user', orgId, 'missing-target', { token: 'missing-target' })

    const res = await app.request('/api/users/availability')
    expect(res.status).toBe(200)
    expect(((await res.json()) as { shares: Array<{ token: string }> }).shares.map((share) => share.token)).toEqual([
      'only-available',
    ])
  })
})

describe('GET /api/users (admin list)', () => {
  type UserPage = {
    items: Array<{ id: string; name: string; email: string; username: string | null; createdAt: string }>
    nextPageToken: string | null
  }

  async function listPage(
    app: ReturnType<typeof import('../app')['createApp']>,
    headers: Record<string, string>,
    params: Record<string, string>,
  ) {
    const res = await app.request(`/api/users?${new URLSearchParams(params)}`, { headers })
    return { res, body: (await res.clone().json()) as UserPage }
  }

  it('returns 401 without a session', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/users')
    expect(res.status).toBe(401)
  })

  it('returns 403 for a non-admin user', async () => {
    const { app } = await createTestApp()
    await adminHeaders(app)
    const headers = await authedHeaders(app, 'plain@example.com')
    const res = await app.request('/api/users', { headers })
    expect(res.status).toBe(403)
  })

  it('returns every user exactly once across cursor pages, newest first', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    for (const n of [1, 2, 3, 4, 5]) await signUpUser(app, `member${n}@example.com`, `Member ${n}`)
    // Force ties on createdAt so the id tie-breaker is exercised.
    await db.run(sql`UPDATE user SET created_at = 1700000000 WHERE email LIKE 'member%'`)

    const ids: string[] = []
    const sizes: number[] = []
    let token: string | null = null
    for (let i = 0; i < 6; i++) {
      const params: Record<string, string> = { pageSize: '2' }
      if (token) params.pageToken = token
      const { res, body } = await listPage(app, headers, params)
      expect(res.status).toBe(200)
      sizes.push(body.items.length)
      ids.push(...body.items.map((item) => item.id))
      token = body.nextPageToken
      if (!token) break
    }
    expect(sizes).toEqual([2, 2, 2])
    expect(new Set(ids).size).toBe(6)
    // The admin signed up first with a fresh timestamp, so it leads; the tied members follow by id desc.
    const { body: all } = await listPage(app, headers, { pageSize: '100' })
    expect(all.nextPageToken).toBeNull()
    expect(all.items.map((item) => item.id)).toEqual(ids)
    expect(all.items[0].email).toBe('admin@example.com')
    const tied = all.items.slice(1).map((item) => item.id)
    expect(tied).toEqual([...tied].sort().reverse())
  })

  it('searches name, email, and username case-insensitively [spec: list-pagination/user-search]', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await signUpUser(app, 'ann@example.com', 'Annabel Lee')
    await signUpUser(app, 'bob@example.com', 'Robert')
    await signUpUser(app, 'cat@example.com', 'Cat')
    await db.run(sql`UPDATE user SET username = 'Zebra_Fan' WHERE email = 'cat@example.com'`)

    const byName = await listPage(app, headers, { q: 'ANNABEL' })
    expect(byName.body.items.map((u) => u.email)).toEqual(['ann@example.com'])
    const byEmail = await listPage(app, headers, { q: 'BOB@EXAMPLE' })
    expect(byEmail.body.items.map((u) => u.email)).toEqual(['bob@example.com'])
    const byUsername = await listPage(app, headers, { q: 'zebra' })
    expect(byUsername.body.items.map((u) => u.email)).toEqual(['cat@example.com'])
    const none = await listPage(app, headers, { q: 'nobody-matches-this' })
    expect(none.body).toEqual({ items: [], nextPageToken: null })
  })

  it('treats LIKE wildcards in the search term as literal characters', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)
    await signUpUser(app, 'u1@example.com', 'a_b')
    await signUpUser(app, 'u2@example.com', 'axb')
    await signUpUser(app, 'u3@example.com', '100% sure')
    await signUpUser(app, 'u4@example.com', '100 sure')

    const underscore = await listPage(app, headers, { q: 'a_b' })
    expect(underscore.body.items.map((u) => u.name)).toEqual(['a_b'])
    const percent = await listPage(app, headers, { q: '100%' })
    expect(percent.body.items.map((u) => u.name)).toEqual(['100% sure'])
    const wildcardOnly = await listPage(app, headers, { q: '%' })
    expect(wildcardOnly.body.items.map((u) => u.name)).toEqual(['100% sure'])
  })

  it('pages the search result with the same filter', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)
    for (const n of [1, 2, 3]) await signUpUser(app, `team${n}@example.com`, `Teammate ${n}`)
    await signUpUser(app, 'other@example.com', 'Someone else')

    const first = await listPage(app, headers, { q: 'teammate', pageSize: '2' })
    expect(first.body.items).toHaveLength(2)
    expect(first.body.nextPageToken).toBeTruthy()
    const second = await listPage(app, headers, {
      q: 'teammate',
      pageSize: '2',
      pageToken: first.body.nextPageToken as string,
    })
    expect(second.body.items).toHaveLength(1)
    expect(second.body.nextPageToken).toBeNull()
    const names = [...first.body.items, ...second.body.items].map((u) => u.name).sort()
    expect(names).toEqual(['Teammate 1', 'Teammate 2', 'Teammate 3'])
  })

  it('rejects a tampered page token with 400 INVALID_PAGE_TOKEN', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)
    for (const n of [1, 2]) await signUpUser(app, `t${n}@example.com`, `T ${n}`)
    const first = await listPage(app, headers, { pageSize: '1' })
    const { res } = await listPage(app, headers, { pageSize: '1', pageToken: `${first.body.nextPageToken}x` })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: { details: [{ reason: 'INVALID_PAGE_TOKEN' }] } })

    const garbage = await listPage(app, headers, { pageToken: 'garbage' })
    expect(garbage.res.status).toBe(400)
  })

  it('rejects a token reused with a different search or page size', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)
    for (const n of [1, 2, 3]) await signUpUser(app, `s${n}@example.com`, `Sample ${n}`)
    const first = await listPage(app, headers, { q: 'sample', pageSize: '1' })
    const token = first.body.nextPageToken as string
    expect(token).toBeTruthy()

    const otherSearch = await listPage(app, headers, { q: 'other', pageSize: '1', pageToken: token })
    expect(otherSearch.res.status).toBe(400)
    const noSearch = await listPage(app, headers, { pageSize: '1', pageToken: token })
    expect(noSearch.res.status).toBe(400)
    const otherSize = await listPage(app, headers, { q: 'sample', pageSize: '2', pageToken: token })
    expect(otherSize.res.status).toBe(400)
    expect(await otherSize.res.json()).toMatchObject({ error: { details: [{ reason: 'INVALID_PAGE_TOKEN' }] } })

    const same = await listPage(app, headers, { q: 'sample', pageSize: '1', pageToken: token })
    expect(same.res.status).toBe(200)
  })
})
