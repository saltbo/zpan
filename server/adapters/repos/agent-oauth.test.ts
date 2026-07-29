import { createHash } from 'node:crypto'
import { AGENT_OAUTH_CLIENT_ID } from '@shared/agent-oauth'
import { AuthorizationScope } from '@shared/authorization'
import { eq, isNull } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import * as authSchema from '../../db/auth-schema'
import { createTestApp } from '../../test/setup'
import { createAgentOAuthGateway } from './agent-oauth'

describe('Agent OAuth gateway', () => {
  it('provisions the system public native client', async () => {
    const { db } = await createTestApp()
    const [client] = await db
      .select()
      .from(authSchema.oauthClient)
      .where(eq(authSchema.oauthClient.clientId, AGENT_OAUTH_CLIENT_ID))

    expect(client).toMatchObject({
      clientId: AGENT_OAUTH_CLIENT_ID,
      tokenEndpointAuthMethod: 'none',
      public: true,
      type: 'native',
      requirePKCE: true,
      disabled: false,
    })
    expect(JSON.parse(client.redirectUris)).toEqual([
      'http://localhost:8484/callback',
      'http://127.0.0.1:8484/callback',
    ])
    expect(JSON.parse(client.grantTypes ?? '[]')).toEqual(['authorization_code', 'refresh_token'])
  })

  it('verifies access tokens only while consent is live and scoped to the workspace', async () => {
    const { db } = await createTestApp()
    const userId = 'oauth-user'
    const orgId = 'oauth-org'
    await insertUserAndOrg(db, userId, orgId)
    await db.insert(authSchema.oauthConsent).values({
      id: 'grant-1',
      clientId: AGENT_OAUTH_CLIENT_ID,
      userId,
      referenceId: orgId,
      scopes: JSON.stringify([AuthorizationScope.OBJECTS_READ]),
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    await db.insert(authSchema.oauthAccessToken).values({
      id: 'access-1',
      token: hashStoredToken('opaque-token'),
      clientId: AGENT_OAUTH_CLIENT_ID,
      userId,
      referenceId: orgId,
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
      scopes: JSON.stringify([AuthorizationScope.OBJECTS_READ]),
    })

    const token = await createAgentOAuthGateway().verifyAccessToken(db, 'opaque-token')

    expect(token).toEqual({
      grantId: 'grant-1',
      userId,
      orgId,
      clientId: AGENT_OAUTH_CLIENT_ID,
      scopes: [AuthorizationScope.OBJECTS_READ],
    })

    await db.delete(authSchema.oauthConsent).where(eq(authSchema.oauthConsent.id, 'grant-1'))
    await expect(createAgentOAuthGateway().verifyAccessToken(db, 'opaque-token')).resolves.toBeNull()
  })

  it('requires the managed client, workspace, and granted scopes before minting claims', async () => {
    const { db } = await createTestApp()
    const userId = 'oauth-user'
    const orgId = 'oauth-org'
    await insertUserAndOrg(db, userId, orgId)
    await db.insert(authSchema.oauthConsent).values({
      id: 'grant-1',
      clientId: AGENT_OAUTH_CLIENT_ID,
      userId,
      referenceId: orgId,
      scopes: JSON.stringify([AuthorizationScope.OBJECTS_READ]),
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    await expect(
      createAgentOAuthGateway().assertLiveGrant(db, {
        userId,
        clientId: AGENT_OAUTH_CLIENT_ID,
        scopes: [AuthorizationScope.OBJECTS_READ],
      }),
    ).rejects.toThrow('agent_oauth_workspace_required')

    await expect(
      createAgentOAuthGateway().assertLiveGrant(db, {
        userId,
        clientId: 'other-client',
        orgId,
        scopes: [AuthorizationScope.OBJECTS_READ],
      }),
    ).rejects.toThrow('agent_oauth_client_denied')

    await expect(
      createAgentOAuthGateway().assertLiveGrant(db, {
        userId,
        clientId: AGENT_OAUTH_CLIENT_ID,
        orgId,
        scopes: [AuthorizationScope.OBJECTS_READ, AuthorizationScope.QUOTA_READ],
      }),
    ).rejects.toThrow('agent_oauth_scope_denied')
  })

  it('revokes only the managed client grant for the selected workspace', async () => {
    const { db } = await createTestApp()
    const userId = 'oauth-user'
    const orgId = 'oauth-org'
    await insertUserAndOrg(db, userId, orgId)
    await db.insert(authSchema.organization).values({ id: 'oauth-org-2', name: 'OAuth Org 2', slug: 'oauth-org-2' })
    await db
      .insert(authSchema.member)
      .values({ id: 'oauth-org-2-member', organizationId: 'oauth-org-2', userId, role: 'owner' })
    await db.insert(authSchema.oauthClient).values({
      id: 'other-client',
      clientId: 'other-client',
      clientSecret: null,
      disabled: false,
      skipConsent: false,
      enableEndSession: false,
      subjectType: 'public',
      scopes: JSON.stringify([AuthorizationScope.OBJECTS_READ]),
      name: 'Other Client',
      redirectUris: JSON.stringify(['http://localhost/callback']),
      tokenEndpointAuthMethod: 'none',
      grantTypes: JSON.stringify(['authorization_code']),
      responseTypes: JSON.stringify(['code']),
      public: true,
      type: 'native',
      requirePKCE: true,
    })
    await db.insert(authSchema.oauthConsent).values({
      id: 'grant-1',
      clientId: AGENT_OAUTH_CLIENT_ID,
      userId,
      referenceId: orgId,
      scopes: JSON.stringify([AuthorizationScope.OBJECTS_READ]),
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    await db.insert(authSchema.oauthConsent).values([
      {
        id: 'grant-2',
        clientId: AGENT_OAUTH_CLIENT_ID,
        userId,
        referenceId: 'oauth-org-2',
        scopes: JSON.stringify([AuthorizationScope.OBJECTS_READ]),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'other-grant',
        clientId: 'other-client',
        userId,
        referenceId: orgId,
        scopes: JSON.stringify([AuthorizationScope.OBJECTS_READ]),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ])
    await db.insert(authSchema.oauthRefreshToken).values({
      id: 'refresh-1',
      token: 'hashed-refresh',
      clientId: AGENT_OAUTH_CLIENT_ID,
      userId,
      referenceId: orgId,
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
      scopes: JSON.stringify([AuthorizationScope.OBJECTS_READ]),
    })
    await db.insert(authSchema.oauthRefreshToken).values([
      {
        id: 'refresh-2',
        token: 'hashed-refresh-2',
        clientId: AGENT_OAUTH_CLIENT_ID,
        userId,
        referenceId: 'oauth-org-2',
        expiresAt: new Date(Date.now() + 60_000),
        createdAt: new Date(),
        scopes: JSON.stringify([AuthorizationScope.OBJECTS_READ]),
      },
      {
        id: 'other-refresh',
        token: 'hashed-other-refresh',
        clientId: 'other-client',
        userId,
        referenceId: orgId,
        expiresAt: new Date(Date.now() + 60_000),
        createdAt: new Date(),
        scopes: JSON.stringify([AuthorizationScope.OBJECTS_READ]),
      },
    ])
    await db.insert(authSchema.oauthAccessToken).values({
      id: 'access-1',
      token: 'hashed-access',
      clientId: AGENT_OAUTH_CLIENT_ID,
      userId,
      referenceId: orgId,
      refreshId: 'refresh-1',
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
      scopes: JSON.stringify([AuthorizationScope.OBJECTS_READ]),
    })
    await db.insert(authSchema.oauthAccessToken).values([
      {
        id: 'access-2',
        token: 'hashed-access-2',
        clientId: AGENT_OAUTH_CLIENT_ID,
        userId,
        referenceId: 'oauth-org-2',
        refreshId: 'refresh-2',
        expiresAt: new Date(Date.now() + 60_000),
        createdAt: new Date(),
        scopes: JSON.stringify([AuthorizationScope.OBJECTS_READ]),
      },
      {
        id: 'other-access',
        token: 'hashed-other-access',
        clientId: 'other-client',
        userId,
        referenceId: orgId,
        refreshId: 'other-refresh',
        expiresAt: new Date(Date.now() + 60_000),
        createdAt: new Date(),
        scopes: JSON.stringify([AuthorizationScope.OBJECTS_READ]),
      },
    ])

    const revoked = await createAgentOAuthGateway().revokeGrant(db, {
      userId,
      grantId: 'grant-1',
      now: new Date('2026-07-29T12:00:00.000Z'),
    })

    expect(revoked).toBe(true)
    expect((await db.select().from(authSchema.oauthConsent)).map((row) => row.id).sort()).toEqual([
      'grant-2',
      'other-grant',
    ])
    expect((await db.select().from(authSchema.oauthAccessToken)).map((row) => row.id).sort()).toEqual([
      'access-2',
      'other-access',
    ])
    const [refresh] = await db
      .select()
      .from(authSchema.oauthRefreshToken)
      .where(eq(authSchema.oauthRefreshToken.id, 'refresh-1'))
    expect(refresh.revoked?.toISOString()).toBe('2026-07-29T12:00:00.000Z')
    const liveRefreshes = await db
      .select()
      .from(authSchema.oauthRefreshToken)
      .where(isNull(authSchema.oauthRefreshToken.revoked))
    expect(liveRefreshes.map((row) => row.id).sort()).toEqual(['other-refresh', 'refresh-2'])
  })
})

async function insertUserAndOrg(db: Awaited<ReturnType<typeof createTestApp>>['db'], userId: string, orgId: string) {
  await db.insert(authSchema.user).values({
    id: userId,
    name: 'OAuth User',
    email: `${userId}@example.com`,
    emailVerified: true,
  })
  await db.insert(authSchema.organization).values({ id: orgId, name: 'OAuth Org', slug: orgId })
  await db.insert(authSchema.member).values({ id: `${orgId}-member`, organizationId: orgId, userId, role: 'owner' })
}

function hashStoredToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url')
}
