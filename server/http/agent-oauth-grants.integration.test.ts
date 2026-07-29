import { createHash } from 'node:crypto'
import {
  AGENT_OAUTH_ACCESS_TOKEN_SECONDS,
  AGENT_OAUTH_CLIENT_ID,
  AGENT_OAUTH_CLIENT_NAME,
  AGENT_OAUTH_REFRESH_TOKEN_SECONDS,
} from '@shared/agent-oauth'
import { AuthorizationScope } from '@shared/authorization'
import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import * as authSchema from '../db/auth-schema.js'
import { authedHeaders, createTestApp } from '../test/setup.js'

type TestContext = Awaited<ReturnType<typeof createTestApp>>

async function getUserAndPersonalOrg(db: TestContext['db'], email: string) {
  const rows = await db.all<{ userId: string; orgId: string }>(sql`
    SELECT u.id AS userId, o.id AS orgId
    FROM user u
    INNER JOIN member m ON m.user_id = u.id
    INNER JOIN organization o ON o.id = m.organization_id
    WHERE u.email = ${email} AND o.metadata LIKE '%"type":"personal"%'
    LIMIT 1
  `)
  if (!rows[0]) throw new Error(`expected personal org for ${email}`)
  return rows[0]
}

async function insertTeamOrg(db: TestContext['db'], orgId: string, userId: string) {
  const now = Date.now()
  await db.run(sql`
    INSERT INTO organization (id, name, slug, metadata, created_at, updated_at)
    VALUES (${orgId}, ${`Team ${orgId}`}, ${orgId}, '{"type":"team"}', ${now}, ${now})
  `)
  await db.run(sql`
    INSERT INTO member (id, organization_id, user_id, role, created_at)
    VALUES (${`${orgId}-member`}, ${orgId}, ${userId}, 'owner', ${now})
  `)
}

async function insertGrant(
  db: TestContext['db'],
  input: { userId: string; orgId: string; scopes: AuthorizationScope[] },
) {
  const now = new Date('2026-07-29T12:00:00.000Z')
  await db.insert(authSchema.oauthConsent).values({
    id: 'grant-1',
    clientId: AGENT_OAUTH_CLIENT_ID,
    userId: input.userId,
    referenceId: input.orgId,
    scopes: JSON.stringify(input.scopes),
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(authSchema.oauthRefreshToken).values({
    id: 'refresh-1',
    token: 'hashed-refresh',
    clientId: AGENT_OAUTH_CLIENT_ID,
    userId: input.userId,
    referenceId: input.orgId,
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: now,
    scopes: JSON.stringify(input.scopes),
  })
  await db.insert(authSchema.oauthAccessToken).values({
    id: 'access-1',
    token: hashStoredToken('live-agent-token'),
    clientId: AGENT_OAUTH_CLIENT_ID,
    userId: input.userId,
    referenceId: input.orgId,
    refreshId: 'refresh-1',
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: now,
    scopes: JSON.stringify(input.scopes),
  })
}

describe('Agent OAuth grants API integration', () => {
  it('returns server-owned Agent OAuth consent context for the active workspace', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app, 'agent-consent@example.com')
    const { orgId } = await getUserAndPersonalOrg(db, 'agent-consent@example.com')
    const oauthQuery = new URLSearchParams({
      client_id: AGENT_OAUTH_CLIENT_ID,
      redirect_uri: 'http://127.0.0.1:8484/callback',
      response_type: 'code',
      scope: `${AuthorizationScope.OBJECTS_READ} ${AuthorizationScope.QUOTA_READ} openid offline_access`,
    }).toString()

    const res = await app.request(`/api/agent-oauth-consent?oauthQuery=${encodeURIComponent(oauthQuery)}`, { headers })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      clientId: AGENT_OAUTH_CLIENT_ID,
      clientName: AGENT_OAUTH_CLIENT_NAME,
      instanceOrigin: 'http://localhost',
      workspace: { id: orgId, name: expect.any(String) },
      scopes: [AuthorizationScope.OBJECTS_READ, AuthorizationScope.QUOTA_READ],
      standardScopes: ['openid', 'offline_access'],
      redirectUri: 'http://127.0.0.1:8484/callback',
      grantLifetime: {
        accessTokenSeconds: AGENT_OAUTH_ACCESS_TOKEN_SECONDS,
        refreshTokenSeconds: AGENT_OAUTH_REFRESH_TOKEN_SECONDS,
      },
    })
  })

  it('lists and revokes the current user grant family', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app, 'agent-grants@example.com')
    const { userId, orgId } = await getUserAndPersonalOrg(db, 'agent-grants@example.com')
    await insertGrant(db, { userId, orgId, scopes: [AuthorizationScope.OBJECTS_READ, AuthorizationScope.QUOTA_READ] })

    const list = await app.request('/api/agent-oauth-grants', { headers })
    expect(list.status).toBe(200)
    await expect(list.json()).resolves.toEqual({
      items: [
        {
          id: 'grant-1',
          clientId: AGENT_OAUTH_CLIENT_ID,
          clientName: 'ZPan Agent',
          userId,
          orgId,
          workspaceName: expect.any(String),
          scopes: [AuthorizationScope.OBJECTS_READ, AuthorizationScope.QUOTA_READ],
          createdAt: '2026-07-29T12:00:00.000Z',
          lastUsedAt: expect.any(String),
          status: 'active',
        },
      ],
    })

    const revoke = await app.request('/api/agent-oauth-grants/grant-1', { method: 'DELETE', headers })
    expect(revoke.status).toBe(204)
    expect(await db.select().from(authSchema.oauthConsent)).toHaveLength(0)
    expect(await db.select().from(authSchema.oauthAccessToken)).toHaveLength(0)
    const [refresh] = await db.select().from(authSchema.oauthRefreshToken)
    expect(refresh.revoked).not.toBeNull()
  })

  it('enforces live grant membership and fixed workspace for Agent OAuth bearer access', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app, 'agent-scope@example.com')
    const { userId, orgId } = await getUserAndPersonalOrg(db, 'agent-scope@example.com')
    await insertTeamOrg(db, 'other-workspace', userId)
    await insertGrant(db, { userId, orgId, scopes: [AuthorizationScope.OBJECTS_READ] })

    const bearer = { Authorization: 'Bearer live-agent-token' }
    const allowed = await app.request('/api/objects', { headers: bearer })
    expect(allowed.status).toBe(200)

    const wrongWorkspace = await app.request('/api/objects?orgId=other-workspace', { headers: bearer })
    expect(wrongWorkspace.status).toBe(403)

    const revoke = await app.request('/api/agent-oauth-grants/grant-1', { method: 'DELETE', headers })
    expect(revoke.status).toBe(204)

    const revoked = await app.request('/api/objects', { headers: bearer })
    expect(revoked.status).toBe(401)
  })

  it('blocks generic Better Auth OAuth consent mutation endpoints', async () => {
    const { app } = await createTestApp()

    for (const path of ['/api/auth/oauth2/update-consent', '/api/auth/oauth2/delete-consent']) {
      const res = await app.request(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: AGENT_OAUTH_CLIENT_ID }),
      })

      expect(res.status).toBe(403)
      await expect(res.json()).resolves.toMatchObject({
        error_description: 'Manage Agent OAuth grants from the Agent Access API',
      })
    }
  })

  it('returns 404 when revoking a missing Agent OAuth grant', async () => {
    const { app } = await createTestApp()
    const headers = await authedHeaders(app, 'agent-missing-grant@example.com')

    const revoke = await app.request('/api/agent-oauth-grants/missing-grant', { method: 'DELETE', headers })

    expect(revoke.status).toBe(404)
    await expect(revoke.json()).resolves.toMatchObject({
      error: {
        message: 'Agent OAuth grant not found',
      },
    })
  })
})

function hashStoredToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url')
}
