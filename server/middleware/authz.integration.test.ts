import { AuthorizationScope, CANONICAL_AUTHORIZATION_SCOPES } from '@shared/authorization'
import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { adminHeaders, authedHeaders, createTestApp } from '../test/setup.js'
import { authorize, evaluateAuthorization } from './authz.js'

type TestCtx = Awaited<ReturnType<typeof createTestApp>>
type TestApp = TestCtx['app']
type TestDb = TestCtx['db']
type TestAuth = TestCtx['auth']

// Mounts directly declared scope policies after the production authMiddleware.
// The body is a sentinel proving that the declaration allowed the request.
function mountProbes(app: TestApp) {
  app.get(
    '/api/test-authz/api-perm',
    authorize({
      scopes: [AuthorizationScope.DOWNLOAD_TASKS_CREATE],
    }),
    (c) => c.json({ ok: true }),
  )
  app.get('/api/test-authz/no-downloader', authorize({ scopes: [AuthorizationScope.DOWNLOAD_TASKS_READ] }), (c) =>
    c.json({ ok: true }),
  )
  app.get(
    '/api/test-authz/team-editor',
    authorize({
      scopes: [AuthorizationScope.DOWNLOAD_TASKS_CREATE],
      minTeamRole: 'editor',
    }),
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

async function issueBootstrapToken(app: TestApp): Promise<string> {
  const admin = await adminHeaders(app)
  const codeRes = await app.request('/api/auth/device/code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: 'zpan-cli', scope: 'downloader:register' }),
  })
  const code = (await codeRes.json()) as { device_code: string; user_code: string }
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
  return token.access_token
}

// Registers a downloader and returns its bearer token. Mirrors the device-login
// flow the CLI uses; needed to mint a `downloader` principal.
async function registerDownloader(app: TestApp, name: string): Promise<string> {
  const accessToken = await issueBootstrapToken(app)
  const createRes = await app.request('/api/downloads/downloaders', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      heartbeat: {
        version: '1.0.0',
        hostname: 'host',
        platform: 'linux',
        arch: 'x64',
        engine: 'http',
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

describe('direct protected scope declaration', () => {
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
    const key = await createApiKey(auth, orgId, userId, { 'download-tasks': ['read'] })

    const res = await app.request('/api/test-authz/team-editor', {
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
    const key = await createApiKey(auth, orgId, userId, { 'download-tasks': ['create'] })

    const res = await app.request('/api/test-authz/team-editor', {
      headers: { Authorization: `Bearer ${key}` },
    })
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true })
  })

  it('rejects a workspace API key after its owner is downgraded below editor', async () => {
    const { app, db, auth } = await createTestApp()
    mountProbes(app)
    await authedHeaders(app, 'key-editor@example.com')
    const userId = await getUserId(db, 'key-editor@example.com')
    const teamOrgId = 'team-key-role'
    await db.run(sql`
      INSERT INTO organization (id, name, slug, metadata)
      VALUES (${teamOrgId}, 'Key Role Team', ${teamOrgId}, '{"type":"team"}')
    `)
    await db.run(sql`
      INSERT INTO member (id, organization_id, user_id, role)
      VALUES (${`member-${teamOrgId}`}, ${teamOrgId}, ${userId}, 'editor')
    `)
    const key = await createApiKey(auth, teamOrgId, userId, { 'download-tasks': ['create'] })
    await db.run(sql`
      UPDATE member SET role = 'viewer'
      WHERE organization_id = ${teamOrgId} AND user_id = ${userId}
    `)

    const res = await app.request('/api/test-authz/team-editor', {
      headers: { Authorization: `Bearer ${key}` },
    })
    expect(res.status).toBe(403)
  })

  it('allows a downloader principal when its fixed scopes satisfy the route', async () => {
    const { app } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
    mountProbes(app)
    const downloaderToken = await registerDownloader(app, 'authz-downloader')

    const res = await app.request('/api/test-authz/no-downloader', {
      headers: { Authorization: `Bearer ${downloaderToken}` },
    })
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true })
  })

  it('returns 401 when a one-purpose bootstrap credential is used outside registration', async () => {
    const { app } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
    mountProbes(app)
    const bootstrapToken = await issueBootstrapToken(app)

    const res = await app.request('/api/test-authz/api-perm', {
      headers: { Authorization: `Bearer ${bootstrapToken}` },
    })
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: { message: string; status: string } }
    expect(body.error.message).toBe('Unauthorized')
    expect(body.error.status).toBe('UNAUTHENTICATED')
  })

  it('does not normalize untracked Better Auth bearer sessions as user principals', async () => {
    const { app, db } = await createTestApp()
    mountProbes(app)
    const cookieHeaders = await authedHeaders(app, 'bearer-session@example.com')
    const cookieAllowed = await app.request('/api/test-authz/api-perm', { headers: cookieHeaders })
    expect(cookieAllowed.status).toBe(200)

    const [session] = await db.all<{ token: string }>(sql`
      SELECT s.token
      FROM session s
      INNER JOIN user u ON u.id = s.user_id
      WHERE u.email = 'bearer-session@example.com'
      ORDER BY s.created_at DESC
      LIMIT 1
    `)

    const bearerDenied = await app.request('/api/test-authz/api-perm', {
      headers: { Authorization: `Bearer ${session.token}` },
    })
    expect(bearerDenied.status).toBe(401)
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

  it('denies personal-looking orgs when findPersonalOrg does not prove ownership', async () => {
    const { app, db } = await createTestApp()
    mountProbes(app)
    const headers = await authedHeaders(app, 'personal@example.com')
    const orgId = await getOrgId(db)
    const userId = await getUserId(db, 'personal@example.com')
    await db.run(sql`DELETE FROM member WHERE organization_id = ${orgId}`)

    const res = await app.request('/api/test-authz/team-editor', { headers })
    expect(res.status).toBe(403)

    const otherPersonalOrgId = 'other-personal'
    await db.run(sql`
      INSERT INTO organization (id, name, slug, metadata)
      VALUES (${otherPersonalOrgId}, 'Other Personal', ${otherPersonalOrgId}, '{"type":"personal"}')
    `)
    await db.run(sql`
      INSERT INTO member (id, organization_id, user_id, role)
      VALUES (${`member-${otherPersonalOrgId}`}, ${otherPersonalOrgId}, ${userId}, 'owner')
    `)
    const setActive = await app.request('/api/auth/organization/set-active', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ organizationId: otherPersonalOrgId }),
    })
    const cookies = setActive.headers.getSetCookie()
    if (cookies.length > 0) headers.Cookie = cookies.map((c) => c.split(';')[0]).join('; ')
    await db.run(sql`DELETE FROM member WHERE organization_id = ${otherPersonalOrgId}`)

    const denied = await app.request('/api/test-authz/team-editor', { headers })
    expect(denied.status).toBe(403)
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

  it('records safe audit for authenticated 403 denials only', async () => {
    const { app, db, auth } = await createTestApp()
    mountProbes(app)
    await authedHeaders(app)
    const orgId = await getOrgId(db)
    const userId = await getUserId(db, 'test@example.com')
    const key = await createApiKey(auth, orgId, userId, { 'download-tasks': ['read'] })

    expect((await app.request('/api/test-authz/api-perm')).status).toBe(401)
    expect(
      (await app.request('/api/test-authz/api-perm', { headers: { Authorization: `Bearer ${key}` } })).status,
    ).toBe(403)

    const rows = await db.all<{ action: string; actorType: string; targetName: string; metadata: string }>(sql`
      SELECT action, actor_type AS actorType, target_name AS targetName, metadata
      FROM audit_events
      WHERE action = 'authorization_denied'
    `)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      action: 'authorization_denied',
      actorType: 'api_key',
      targetName: 'scoped route',
    })
    expect(JSON.parse(rows[0].metadata)).toEqual({
      credential: 'api_key',
      method: 'GET',
      reason: 'missing_scope',
    })
  })

  it('keeps the 403 response when denial audit recording fails', async () => {
    const { app, db, auth, deps } = await createTestApp()
    mountProbes(app)
    await authedHeaders(app)
    const orgId = await getOrgId(db)
    const userId = await getUserId(db, 'test@example.com')
    const key = await createApiKey(auth, orgId, userId, { 'download-tasks': ['read'] })
    deps.audit.record = async () => {
      throw new Error('audit unavailable')
    }

    const res = await app.request('/api/test-authz/api-perm', {
      headers: { Authorization: `Bearer ${key}` },
    })

    expect(res.status).toBe(403)
    const body = (await res.json()) as { error: { message: string } }
    expect(body.error.message).toBe('Forbidden')
  })
})

describe('evaluateAuthorization', () => {
  const deps = {
    getMemberRole: async () => 'owner',
    findPersonalOrg: async () => 'org-1',
  }
  const sessionContext = {
    credential: 'session' as const,
    userId: 'user-1',
    workspace: { mode: 'selected' as const, orgId: 'org-1' },
    grantedScopes: new Set(CANONICAL_AUTHORIZATION_SCOPES),
    actor: { type: 'user' as const, ref: 'user-1' },
    state: { firstParty: true as const, role: 'admin' },
  }

  it('uses user roles for sessions without requiring token scopes', async () => {
    await expect(
      evaluateAuthorization({
        context: sessionContext,
        declaration: { scopes: [AuthorizationScope.TEAMS_READ] },
        deps,
      }),
    ).resolves.toMatchObject({ allowed: true })
    await expect(
      evaluateAuthorization({
        context: sessionContext,
        declaration: {
          scopes: [AuthorizationScope.SITE_ANALYTICS_READ],
          siteRole: 'admin',
        },
        deps,
      }),
    ).resolves.toMatchObject({ allowed: true })
    await expect(
      evaluateAuthorization({
        context: { ...sessionContext, state: { firstParty: true, role: 'member' } },
        declaration: {
          scopes: [AuthorizationScope.SITE_ANALYTICS_READ],
          siteRole: 'admin',
        },
        deps,
      }),
    ).resolves.toMatchObject({ allowed: false, status: 403, reason: 'insufficient_site_role' })
  })

  it('uses scopes for downloader and bootstrap credentials', async () => {
    const downloaderContext = {
      credential: 'downloader' as const,
      userId: null,
      workspace: { mode: 'none' as const, orgId: null },
      grantedScopes: new Set([AuthorizationScope.DOWNLOADERS_UPDATE]),
      actor: { type: 'device' as const, ref: 'downloader-1' },
      state: {},
    }
    const bootstrapContext = {
      credential: 'downloader-bootstrap' as const,
      userId: 'user-1',
      workspace: { mode: 'none' as const, orgId: null },
      grantedScopes: new Set([AuthorizationScope.DOWNLOADERS_CREATE]),
      actor: { type: 'user' as const, ref: 'user-1' },
      state: { clientId: 'zpan-cli' as const, scope: 'downloader:register' as const, role: 'admin' },
    }

    await expect(
      evaluateAuthorization({
        context: downloaderContext,
        declaration: { scopes: [AuthorizationScope.DOWNLOADERS_UPDATE] },
        deps,
      }),
    ).resolves.toMatchObject({ allowed: true })
    await expect(
      evaluateAuthorization({
        context: bootstrapContext,
        declaration: { scopes: [AuthorizationScope.DOWNLOADERS_CREATE], siteRole: 'admin' },
        deps,
      }),
    ).resolves.toMatchObject({ allowed: true })
    await expect(
      evaluateAuthorization({
        context: downloaderContext,
        declaration: { scopes: [AuthorizationScope.DOWNLOADERS_CREATE] },
        deps,
      }),
    ).resolves.toMatchObject({ allowed: false, status: 403, reason: 'missing_scope' })
  })

  it('enforces OAuth credential exclusions independently from scopes', async () => {
    const oauthContext = {
      credential: 'oauth' as const,
      userId: 'user-1',
      workspace: { mode: 'bound' as const, orgId: 'org-1' },
      grantedScopes: new Set([AuthorizationScope.OBJECTS_PURGE]),
      actor: { type: 'oauth' as const, ref: 'grant-1', issuer: 'https://realmroot.example' },
      state: { clientId: 'agent-client' },
    }

    await expect(
      evaluateAuthorization({
        context: oauthContext,
        declaration: { scopes: [AuthorizationScope.OBJECTS_PURGE], oauth: false },
        deps,
      }),
    ).resolves.toMatchObject({ allowed: false, status: 403, reason: 'actor_not_allowed' })
    await expect(
      evaluateAuthorization({
        context: sessionContext,
        declaration: { scopes: [AuthorizationScope.OBJECTS_PURGE], oauth: false },
        deps,
      }),
    ).resolves.toMatchObject({ allowed: true })
  })

  it('uses task-upload token scopes', async () => {
    const taskUploadContext = {
      credential: 'download-task-upload' as const,
      userId: 'user-1',
      workspace: { mode: 'bound' as const, orgId: 'org-1' },
      grantedScopes: new Set([AuthorizationScope.OBJECTS_CREATE]),
      actor: { type: 'device' as const, ref: 'downloader-1' },
      state: { downloaderId: 'downloader-1', taskId: 'task-1' },
    }

    await expect(
      evaluateAuthorization({
        context: taskUploadContext,
        declaration: { scopes: [AuthorizationScope.OBJECTS_CREATE] },
        deps,
      }),
    ).resolves.toMatchObject({ allowed: true })
    await expect(
      evaluateAuthorization({
        context: { ...taskUploadContext, grantedScopes: new Set<AuthorizationScope>() },
        declaration: { scopes: [AuthorizationScope.OBJECTS_CREATE] },
        deps,
      }),
    ).resolves.toMatchObject({ allowed: false, status: 403, reason: 'missing_scope' })
  })

  it('evaluates session team roles independently of scopes', async () => {
    const viewerDeps = {
      getMemberRole: async () => 'viewer',
      findPersonalOrg: async () => 'personal-org',
    }

    await expect(
      evaluateAuthorization({
        context: {
          credential: 'session',
          userId: 'user-1',
          workspace: { mode: 'selected', orgId: 'org-1' },
          grantedScopes: new Set(CANONICAL_AUTHORIZATION_SCOPES),
          actor: { type: 'user', ref: 'user-1' },
          state: { firstParty: true },
        },
        declaration: {
          scopes: [AuthorizationScope.DOWNLOAD_TASKS_CREATE],
          minTeamRole: 'editor',
        },
        deps: viewerDeps,
      }),
    ).resolves.toMatchObject({ allowed: false, status: 403, reason: 'insufficient_role' })
  })

  it('uses the bound workspace for current-role checks', async () => {
    let checkedOrgId: string | null = null
    await expect(
      evaluateAuthorization({
        context: {
          credential: 'api_key',
          userId: 'user-1',
          workspace: { mode: 'bound', orgId: 'org-1' },
          grantedScopes: new Set([AuthorizationScope.DOWNLOAD_TASKS_READ]),
          actor: { type: 'api_key', ref: 'key-1' },
          state: { configId: 'remote-download', enabled: true },
        },
        declaration: {
          scopes: [AuthorizationScope.DOWNLOAD_TASKS_READ],
          minTeamRole: 'viewer',
        },
        deps: {
          getMemberRole: async (orgId) => {
            checkedOrgId = orgId
            return 'owner'
          },
          findPersonalOrg: async () => null,
        },
      }),
    ).resolves.toMatchObject({ allowed: true, effectiveOrgId: 'org-1' })
    expect(checkedOrgId).toBe('org-1')
  })
})
