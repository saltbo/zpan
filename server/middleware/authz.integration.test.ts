import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { adminHeaders, authedHeaders, createTestApp } from '../test/setup.js'
import { requirePermission } from './authz.js'

type TestCtx = Awaited<ReturnType<typeof createTestApp>>
type TestApp = TestCtx['app']
type TestDb = TestCtx['db']
type TestAuth = TestCtx['auth']

// Mounts the permission-gated probe routes on a real app so requirePermission
// runs after the production authMiddleware (which resolves the principal,
// userId, orgId, and deps from the request). Each route maps to one guard in
// requirePermission; the body is a sentinel proving the middleware called next.
function mountProbes(app: TestApp) {
  app.get('/api/test-authz/api-perm', requirePermission('remoteDownload', 'create'), (c) => c.json({ ok: true }))
  app.get('/api/test-authz/no-downloader', requirePermission('remoteDownload', 'read'), (c) => c.json({ ok: true }))
  app.get(
    '/api/test-authz/team-editor',
    requirePermission('remoteDownload', 'create', { minTeamRole: 'editor' }),
    (c) => c.json({ ok: true }),
  )
}

// Creates an API key via the real better-auth plugin (keys are properly hashed)
// scoped to the given permissions. Returns the raw key usable as a Bearer token.
async function createApiKey(
  auth: TestAuth,
  orgId: string,
  userId: string,
  permissions?: Record<string, string[]>,
): Promise<string> {
  // biome-ignore lint/suspicious/noExplicitAny: better-auth plugin API is not fully typed
  const result = (await (auth.api as any).createApiKey({
    body: {
      configId: 'ihost',
      organizationId: orgId,
      userId,
      ...(permissions ? { permissions } : {}),
    },
  })) as { key: string }
  return result.key
}

async function getOrgId(db: TestDb): Promise<string> {
  const rows = await db.all<{ id: string }>(sql`
    SELECT id FROM organization WHERE metadata LIKE '%"type":"personal"%' LIMIT 1
  `)
  return rows[0].id
}

async function getUserId(db: TestDb, email: string): Promise<string> {
  const rows = await db.all<{ id: string }>(sql`SELECT id FROM user WHERE email = ${email}`)
  return rows[0].id
}

// Registers a downloader and returns its bearer token. Mirrors the device-login
// flow the CLI uses; needed to mint a `downloader` principal.
async function registerDownloader(app: TestApp, name: string): Promise<string> {
  const admin = await adminHeaders(app)
  const codeRes = await app.request('/api/auth/device/code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: 'zpan-cli', scope: 'downloader:register' }),
  })
  const code = (await codeRes.json()) as { device_code: string; user_code: string }
  // Claim the user code with the admin session before approving (device flow).
  await app.request(`/api/auth/device?user_code=${encodeURIComponent(code.user_code)}`, { headers: admin })
  await app.request('/api/auth/device/approve', {
    method: 'POST',
    headers: { ...admin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ userCode: code.user_code }),
  })
  const tokenRes = await app.request('/api/auth/device/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: code.device_code,
      client_id: 'zpan-cli',
    }),
  })
  const token = (await tokenRes.json()) as { access_token: string }
  const createRes = await app.request('/api/downloads/downloaders', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      heartbeat: {
        version: '1.0.0',
        hostname: 'host',
        platform: 'linux',
        arch: 'x64',
        engine: 'builtin',
        capabilities: [],
        maxConcurrentTasks: 1,
        currentTasks: 0,
        downloadBps: 0,
        uploadBps: 0,
        freeDiskBytes: 0,
      },
    }),
  })
  const created = (await createRes.json()) as { token: string }
  return created.token
}

describe('requirePermission middleware', () => {
  it('returns 401 when there is no principal (unauthenticated)', async () => {
    const { app } = await createTestApp()
    mountProbes(app)
    const res = await app.request('/api/test-authz/api-perm')
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: { message: string; status: string } }
    expect(body.error.message).toBe('Unauthorized')
    expect(body.error.status).toBe('UNAUTHENTICATED')
  })

  it('returns 403 when an api-key principal lacks the required permission', async () => {
    const { app, db, auth } = await createTestApp()
    mountProbes(app)
    await authedHeaders(app)
    const orgId = await getOrgId(db)
    const userId = await getUserId(db, 'test@example.com')
    // Key authenticates (valid) but carries only `read`, not the `create` the
    // probe route demands, so the api-key branch denies with 403.
    const key = await createApiKey(auth, orgId, userId, { remoteDownload: ['read'] })

    const res = await app.request('/api/test-authz/api-perm', {
      headers: { Authorization: `Bearer ${key}` },
    })
    expect(res.status).toBe(403)
    const body = (await res.json()) as { error: { message: string; status: string } }
    expect(body.error.message).toBe('Forbidden')
    expect(body.error.status).toBe('PERMISSION_DENIED')
  })

  it('allows an api-key principal that has the required permission', async () => {
    const { app, db, auth } = await createTestApp()
    mountProbes(app)
    await authedHeaders(app)
    const orgId = await getOrgId(db)
    const userId = await getUserId(db, 'test@example.com')
    const key = await createApiKey(auth, orgId, userId, { remoteDownload: ['create'] })

    const res = await app.request('/api/test-authz/api-perm', {
      headers: { Authorization: `Bearer ${key}` },
    })
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true })
  })

  it('returns 401 for a downloader principal when allowDownloader is not set', async () => {
    const { app } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
    mountProbes(app)
    const downloaderToken = await registerDownloader(app, 'authz-downloader')

    const res = await app.request('/api/test-authz/no-downloader', {
      headers: { Authorization: `Bearer ${downloaderToken}` },
    })
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: { message: string; status: string } }
    expect(body.error.message).toBe('Unauthorized')
    expect(body.error.status).toBe('UNAUTHENTICATED')
  })

  it('returns 403 when a team member role is below the required minTeamRole', async () => {
    const { app, db } = await createTestApp()
    mountProbes(app)
    const headers = await authedHeaders(app, 'viewer@example.com')
    const userId = await getUserId(db, 'viewer@example.com')
    const teamOrgId = 'team-low-role'
    await db.run(sql`
      INSERT INTO organization (id, name, slug, metadata)
      VALUES (${teamOrgId}, 'Low Role Team', ${teamOrgId}, '{"type":"team"}')
    `)
    await db.run(sql`
      INSERT INTO member (id, organization_id, user_id, role)
      VALUES (${`member-${teamOrgId}`}, ${teamOrgId}, ${userId}, 'viewer')
    `)
    const setActive = await app.request('/api/auth/organization/set-active', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ organizationId: teamOrgId }),
    })
    const cookies = setActive.headers.getSetCookie()
    if (cookies.length > 0) headers.Cookie = cookies.map((c) => c.split(';')[0]).join('; ')

    const res = await app.request('/api/test-authz/team-editor', { headers })
    expect(res.status).toBe(403)
    const body = (await res.json()) as { error: { message: string; status: string } }
    expect(body.error.message).toBe('Forbidden')
    expect(body.error.status).toBe('PERMISSION_DENIED')
  })

  it('allows a team member whose role meets the required minTeamRole', async () => {
    const { app, db } = await createTestApp()
    mountProbes(app)
    const headers = await authedHeaders(app, 'editor@example.com')
    const userId = await getUserId(db, 'editor@example.com')
    const teamOrgId = 'team-ok-role'
    await db.run(sql`
      INSERT INTO organization (id, name, slug, metadata)
      VALUES (${teamOrgId}, 'OK Role Team', ${teamOrgId}, '{"type":"team"}')
    `)
    await db.run(sql`
      INSERT INTO member (id, organization_id, user_id, role)
      VALUES (${`member-${teamOrgId}`}, ${teamOrgId}, ${userId}, 'editor')
    `)
    const setActive = await app.request('/api/auth/organization/set-active', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ organizationId: teamOrgId }),
    })
    const cookies = setActive.headers.getSetCookie()
    if (cookies.length > 0) headers.Cookie = cookies.map((c) => c.split(';')[0]).join('; ')

    const res = await app.request('/api/test-authz/team-editor', { headers })
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true })
  })

  it('allows a personal-org user without a member row via the isPersonalOrg fallback', async () => {
    const { app, db } = await createTestApp()
    mountProbes(app)
    const headers = await authedHeaders(app, 'personal@example.com')
    const orgId = await getOrgId(db)
    // Drop the member row so getMemberRole returns null, forcing the
    // isPersonalOrg branch (a personal org owner still has full access).
    await db.run(sql`DELETE FROM member WHERE organization_id = ${orgId}`)

    const res = await app.request('/api/test-authz/team-editor', { headers })
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true })
  })

  it('returns 403 for a team org with no member row that is not personal', async () => {
    const { app, db } = await createTestApp()
    mountProbes(app)
    const headers = await authedHeaders(app, 'orphan@example.com')
    const userId = await getUserId(db, 'orphan@example.com')
    const teamOrgId = 'team-no-member'
    await db.run(sql`
      INSERT INTO organization (id, name, slug, metadata)
      VALUES (${teamOrgId}, 'No Member Team', ${teamOrgId}, '{"type":"team"}')
    `)
    // Member row only needed so set-active accepts it; remove it afterwards to
    // hit the "no member row, not personal" final 403.
    await db.run(sql`
      INSERT INTO member (id, organization_id, user_id, role)
      VALUES (${`member-${teamOrgId}`}, ${teamOrgId}, ${userId}, 'owner')
    `)
    const setActive = await app.request('/api/auth/organization/set-active', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ organizationId: teamOrgId }),
    })
    const cookies = setActive.headers.getSetCookie()
    if (cookies.length > 0) headers.Cookie = cookies.map((c) => c.split(';')[0]).join('; ')
    await db.run(sql`DELETE FROM member WHERE organization_id = ${teamOrgId}`)

    const res = await app.request('/api/test-authz/team-editor', { headers })
    expect(res.status).toBe(403)
    const body = (await res.json()) as { error: { message: string } }
    expect(body.error.message).toBe('Forbidden')
  })
})
