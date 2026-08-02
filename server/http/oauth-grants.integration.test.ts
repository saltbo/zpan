import { AuthorizationScope } from '@shared/authorization'
import {
  OAUTH_ACCESS_TOKEN_SECONDS,
  OAUTH_REFRESH_TOKEN_SECONDS,
  WORKSPACE_AUTHORIZATION_DETAIL_TYPE,
} from '@shared/oauth'
import { sql } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'
import * as authSchema from '../db/auth-schema.js'
import { authedHeaders, createTestApp } from '../test/setup.js'

const CLIENT_ID = 'dynamic-client'
const CLIENT_NAME = 'FlareAuth'
const REDIRECT_URI = 'https://flareauth.example/callback'

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

async function insertClient(db: TestContext['db']) {
  await db.insert(authSchema.oauthClient).values({
    id: CLIENT_ID,
    clientId: CLIENT_ID,
    clientSecret: null,
    disabled: false,
    skipConsent: false,
    enableEndSession: false,
    subjectType: 'public',
    scopes: JSON.stringify([
      'openid',
      'offline_access',
      AuthorizationScope.OBJECTS_READ,
      AuthorizationScope.QUOTA_READ,
    ]),
    name: CLIENT_NAME,
    uri: 'https://flareauth.example',
    redirectUris: JSON.stringify([REDIRECT_URI]),
    tokenEndpointAuthMethod: 'none',
    grantTypes: JSON.stringify(['authorization_code', 'refresh_token']),
    responseTypes: JSON.stringify(['code']),
    public: true,
    type: 'web',
    requirePKCE: true,
  })
}

async function insertGrant(
  db: TestContext['db'],
  input: { userId: string; orgId: string; scopes: AuthorizationScope[] },
) {
  const now = new Date('2026-07-29T12:00:00.000Z')
  await db.insert(authSchema.oauthConsent).values({
    id: 'grant-1',
    clientId: CLIENT_ID,
    userId: input.userId,
    authorizationDetails: [{ type: WORKSPACE_AUTHORIZATION_DETAIL_TYPE, identifier: input.orgId }],
    scopes: JSON.stringify(input.scopes),
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(authSchema.oauthRefreshToken).values({
    id: 'refresh-1',
    token: 'hashed-refresh',
    clientId: CLIENT_ID,
    userId: input.userId,
    authorizationDetails: [{ type: WORKSPACE_AUTHORIZATION_DETAIL_TYPE, identifier: input.orgId }],
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: now,
    scopes: JSON.stringify(input.scopes),
  })
  await db.insert(authSchema.oauthAccessToken).values({
    id: 'access-1',
    token: 'hashed-access',
    clientId: CLIENT_ID,
    userId: input.userId,
    authorizationDetails: [{ type: WORKSPACE_AUTHORIZATION_DETAIL_TYPE, identifier: input.orgId }],
    refreshId: 'refresh-1',
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: now,
    scopes: JSON.stringify(input.scopes),
  })
}

function oauthQuery() {
  return new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: `${AuthorizationScope.OBJECTS_READ} ${AuthorizationScope.QUOTA_READ} openid offline_access`,
    authorization_details: JSON.stringify([{ type: WORKSPACE_AUTHORIZATION_DETAIL_TYPE }]),
  }).toString()
}

describe('OAuth grants API integration', () => {
  it('returns consent context for a dynamically registered application', async () => {
    const { app, db } = await createTestApp()
    await insertClient(db)
    const headers = await authedHeaders(app, 'agent-consent@example.com')
    const { orgId } = await getUserAndPersonalOrg(db, 'agent-consent@example.com')

    const res = await app.request(`/api/oauth-consent?oauthQuery=${encodeURIComponent(oauthQuery())}`, {
      headers,
    })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      clientId: CLIENT_ID,
      clientName: CLIENT_NAME,
      clientOrigin: new URL(REDIRECT_URI).origin,
      workspaces: [{ id: orgId, name: expect.any(String) }],
      requestedWorkspaceIds: [],
      scopes: [AuthorizationScope.OBJECTS_READ, AuthorizationScope.QUOTA_READ],
      standardScopes: ['openid', 'offline_access'],
      redirectUri: REDIRECT_URI,
      grantLifetime: {
        accessTokenSeconds: OAUTH_ACCESS_TOKEN_SECONDS,
        refreshTokenSeconds: OAUTH_REFRESH_TOKEN_SECONDS,
      },
    })
  })

  it('revalidates malformed OAuth consent submissions', async () => {
    const { app, db } = await createTestApp()
    await insertClient(db)
    const headers = await authedHeaders(app, 'agent-submit@example.com')

    const res = await app.request('/api/oauth-consent', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accept: true,
        oauthQuery: `client_id=${CLIENT_ID}&response_type=token`,
        workspaceIds: ['org-1'],
      }),
    })

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: { message: 'Invalid OAuth request' } })
  })

  it('rejects workspace selections outside the server-owned consent context', async () => {
    const { app, db } = await createTestApp()
    await insertClient(db)
    const headers = await authedHeaders(app, 'agent-invalid-workspace@example.com')

    const res = await app.request('/api/oauth-consent', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accept: true,
        oauthQuery: oauthQuery(),
        workspaceIds: ['org-not-owned'],
      }),
    })

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: { message: 'Invalid workspace selection' } })
  })

  it('forwards validated workspace authorization details to Better Auth', async () => {
    const { app, auth, db } = await createTestApp()
    await insertClient(db)
    const headers = await authedHeaders(app, 'agent-valid-workspace@example.com')
    const { orgId } = await getUserAndPersonalOrg(db, 'agent-valid-workspace@example.com')
    const handler = vi
      .spyOn(auth, 'handler')
      .mockResolvedValue(Response.json({ url: 'https://flareauth.example/callback?code=issued' }))

    const res = await app.request('/api/oauth-consent', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ accept: true, oauthQuery: oauthQuery(), workspaceIds: [orgId] }),
    })

    expect(res.status).toBe(200)
    const forwarded = handler.mock.calls[0]?.[0]
    await expect(forwarded?.json()).resolves.toMatchObject({
      accept: true,
      authorization_details: [{ type: WORKSPACE_AUTHORIZATION_DETAIL_TYPE, identifier: orgId }],
    })
  })

  it('lists and revokes the current user dynamic-client grant family', async () => {
    const { app, db } = await createTestApp()
    await insertClient(db)
    const headers = await authedHeaders(app, 'agent-grants@example.com')
    const { userId, orgId } = await getUserAndPersonalOrg(db, 'agent-grants@example.com')
    await insertGrant(db, { userId, orgId, scopes: [AuthorizationScope.OBJECTS_READ, AuthorizationScope.QUOTA_READ] })

    const list = await app.request('/api/oauth-grants', { headers })
    expect(list.status).toBe(200)
    await expect(list.json()).resolves.toEqual({
      items: [
        {
          id: 'grant-1',
          clientId: CLIENT_ID,
          clientName: CLIENT_NAME,
          userId,
          workspaces: [{ id: orgId, name: expect.any(String) }],
          scopes: [AuthorizationScope.OBJECTS_READ, AuthorizationScope.QUOTA_READ],
          createdAt: '2026-07-29T12:00:00.000Z',
          lastUsedAt: null,
          status: 'active',
        },
      ],
    })

    const revoke = await app.request('/api/oauth-grants/grant-1', { method: 'DELETE', headers })
    expect(revoke.status).toBe(204)
    expect(await db.select().from(authSchema.oauthConsent)).toHaveLength(0)
    expect(await db.select().from(authSchema.oauthAccessToken)).toHaveLength(0)
    const [refresh] = await db.select().from(authSchema.oauthRefreshToken)
    expect(refresh.revoked).not.toBeNull()
  })

  it('returns 404 when revoking a missing grant', async () => {
    const { app } = await createTestApp()
    const headers = await authedHeaders(app, 'agent-missing-grant@example.com')

    const revoke = await app.request('/api/oauth-grants/missing-grant', { method: 'DELETE', headers })

    expect(revoke.status).toBe(404)
    await expect(revoke.json()).resolves.toMatchObject({ error: { message: 'OAuth grant not found' } })
  })
})
