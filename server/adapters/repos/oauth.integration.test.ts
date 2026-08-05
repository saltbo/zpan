import { createHash } from 'node:crypto'
import { AuthorizationScope } from '@shared/authorization'
import { WORKSPACE_AUTHORIZATION_DETAIL_TYPE } from '@shared/oauth'
import { eq, isNull } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import * as authSchema from '../../db/auth-schema'
import { createTestApp } from '../../test/setup'
import { createOAuthGateway } from './oauth'

const CLIENT_ID = 'dynamic-client'

describe('OAuth gateway', () => {
  it('finds and lists dynamically registered applications', async () => {
    const { db } = await createTestApp()
    await insertClient(db, CLIENT_ID, 'FlareAuth')
    await insertClient(db, 'retired-system-client', 'Retired', 'system')

    await expect(createOAuthGateway().findClient(db, CLIENT_ID)).resolves.toMatchObject({
      clientId: CLIENT_ID,
      clientName: 'FlareAuth',
      disabled: false,
      redirectUris: ['https://flareauth.example/callback'],
      responseTypes: ['code'],
    })
    await expect(createOAuthGateway().listRegisteredApplications(db)).resolves.toEqual([
      expect.objectContaining({ clientId: CLIENT_ID, name: 'FlareAuth' }),
    ])
    await expect(createOAuthGateway().findClient(db, 'retired-system-client')).resolves.toBeNull()
  })

  it('lists workspace-bound grants with their registered application names', async () => {
    const { db } = await createTestApp()
    await insertClient(db, CLIENT_ID, 'FlareAuth')
    const userId = 'oauth-user'
    const orgId = 'oauth-org'
    await insertUserAndOrg(db, userId, orgId)
    await db.insert(authSchema.oauthConsent).values([
      {
        id: 'grant-1',
        clientId: CLIENT_ID,
        userId,
        authorizationDetails: [{ type: WORKSPACE_AUTHORIZATION_DETAIL_TYPE, identifier: orgId }],
        scopes: JSON.stringify([AuthorizationScope.OBJECTS_READ]),
        createdAt: new Date('2026-07-29T12:00:00.000Z'),
        lastUsedAt: new Date('2026-07-29T12:20:00.000Z'),
        updatedAt: new Date('2026-07-29T12:01:00.000Z'),
      },
      {
        id: 'grant-without-workspace',
        clientId: CLIENT_ID,
        userId,
        authorizationDetails: null,
        scopes: JSON.stringify([AuthorizationScope.OBJECTS_READ]),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ])

    await expect(createOAuthGateway().listGrants(db, userId)).resolves.toEqual([
      {
        id: 'grant-1',
        clientId: CLIENT_ID,
        clientName: 'FlareAuth',
        userId,
        workspaceIds: [orgId],
        scopes: [AuthorizationScope.OBJECTS_READ],
        createdAt: '2026-07-29T12:00:00.000Z',
        lastUsedAt: '2026-07-29T12:20:00.000Z',
      },
    ])
  })

  it('resolves only live account access tokens from enabled clients', async () => {
    const { db } = await createTestApp()
    await insertClient(db, CLIENT_ID, 'FlareAuth')
    await insertUserAndOrg(db, 'oauth-user', 'oauth-org')
    await db.insert(authSchema.oauthAccessToken).values([
      {
        id: 'live',
        token: createHash('sha256').update('live-token').digest('base64url'),
        clientId: CLIENT_ID,
        userId: 'oauth-user',
        expiresAt: new Date('2026-08-03T00:00:00.000Z'),
        scopes: JSON.stringify([AuthorizationScope.WORKSPACES_DISCOVER]),
      },
      {
        id: 'expired',
        token: createHash('sha256').update('expired-token').digest('base64url'),
        clientId: CLIENT_ID,
        userId: 'oauth-user',
        expiresAt: new Date('2026-08-01T00:00:00.000Z'),
        scopes: JSON.stringify([AuthorizationScope.WORKSPACES_DISCOVER]),
      },
    ])
    const gateway = createOAuthGateway()

    await expect(
      gateway.resolveAccountAccessToken(db, 'live-token', new Date('2026-08-02T00:00:00.000Z')),
    ).resolves.toEqual({
      clientId: CLIENT_ID,
      userId: 'oauth-user',
      scopes: [AuthorizationScope.WORKSPACES_DISCOVER],
    })
    await expect(
      gateway.resolveAccountAccessToken(db, 'expired-token', new Date('2026-08-02T00:00:00.000Z')),
    ).resolves.toBeNull()
    await expect(gateway.resolveAccountAccessToken(db, 'unknown')).resolves.toBeNull()
    await db
      .update(authSchema.oauthClient)
      .set({ disabled: true })
      .where(eq(authSchema.oauthClient.clientId, CLIENT_ID))
    await expect(
      gateway.resolveAccountAccessToken(db, 'live-token', new Date('2026-08-02T00:00:00.000Z')),
    ).resolves.toBeNull()
  })

  it('revokes the selected dynamic-client grant family only', async () => {
    const { db } = await createTestApp()
    await insertClient(db, CLIENT_ID, 'FlareAuth')
    const userId = 'oauth-user'
    const orgId = 'oauth-org'
    await insertUserAndOrg(db, userId, orgId)
    await db.insert(authSchema.oauthConsent).values({
      id: 'grant-1',
      clientId: CLIENT_ID,
      userId,
      authorizationDetails: [{ type: WORKSPACE_AUTHORIZATION_DETAIL_TYPE, identifier: orgId }],
      scopes: JSON.stringify([AuthorizationScope.OBJECTS_READ]),
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    await db.insert(authSchema.oauthRefreshToken).values({
      id: 'refresh-1',
      token: 'hashed-refresh',
      clientId: CLIENT_ID,
      userId,
      authorizationDetails: [{ type: WORKSPACE_AUTHORIZATION_DETAIL_TYPE, identifier: orgId }],
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
      scopes: JSON.stringify([AuthorizationScope.OBJECTS_READ]),
    })
    await db.insert(authSchema.oauthAccessToken).values({
      id: 'access-1',
      token: 'hashed-access',
      clientId: CLIENT_ID,
      userId,
      authorizationDetails: [{ type: WORKSPACE_AUTHORIZATION_DETAIL_TYPE, identifier: orgId }],
      refreshId: 'refresh-1',
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
      scopes: JSON.stringify([AuthorizationScope.OBJECTS_READ]),
    })

    await expect(
      createOAuthGateway().revokeGrant(db, {
        userId,
        grantId: 'grant-1',
        now: new Date('2026-07-29T12:30:00.000Z'),
      }),
    ).resolves.toBe(true)
    expect(await db.select().from(authSchema.oauthConsent)).toHaveLength(0)
    expect(await db.select().from(authSchema.oauthAccessToken)).toHaveLength(0)
    const liveRefreshes = await db
      .select()
      .from(authSchema.oauthRefreshToken)
      .where(isNull(authSchema.oauthRefreshToken.revoked))
    expect(liveRefreshes).toHaveLength(0)
  })

  it('records and detects JWT access-token revocation by jti', async () => {
    const { db } = await createTestApp()
    const payload = Buffer.from(
      JSON.stringify({ jti: 'token-1', client_id: CLIENT_ID, exp: Math.floor(Date.now() / 1000) + 60 }),
    ).toString('base64url')
    const token = `e30.${payload}.signature`
    const gateway = createOAuthGateway()

    await gateway.revokeJwtAccessToken(db, token)

    await expect(gateway.isJwtAccessTokenRevoked(db, 'token-1')).resolves.toBe(true)
    await expect(gateway.isJwtAccessTokenRevoked(db, 'unknown')).resolves.toBe(false)
  })
})

async function insertClient(
  db: Awaited<ReturnType<typeof createTestApp>>['db'],
  clientId: string,
  name: string,
  referenceId?: string,
) {
  await db.insert(authSchema.oauthClient).values({
    id: clientId,
    clientId,
    clientSecret: null,
    disabled: false,
    skipConsent: false,
    enableEndSession: false,
    subjectType: 'public',
    scopes: JSON.stringify([AuthorizationScope.OBJECTS_READ]),
    name,
    uri: 'https://flareauth.example',
    redirectUris: JSON.stringify(['https://flareauth.example/callback']),
    tokenEndpointAuthMethod: 'none',
    grantTypes: JSON.stringify(['authorization_code', 'refresh_token']),
    responseTypes: JSON.stringify(['code']),
    public: true,
    type: 'native',
    requirePKCE: true,
    referenceId,
  })
}

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
