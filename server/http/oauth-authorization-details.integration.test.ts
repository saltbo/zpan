import { createHash } from 'node:crypto'
import { AuthorizationScope } from '@shared/authorization'
import { WORKSPACE_AUTHORIZATION_DETAIL_TYPE } from '@shared/oauth'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import * as authSchema from '../db/auth-schema'
import { createTestApp } from '../test/setup'

describe('OAuth authorization details catalog', () => {
  it('lists only the connected user current workspaces through the account credential', async () => {
    const { app, db } = await createTestApp()
    const token = await seedAccountToken(db, [AuthorizationScope.WORKSPACES_DISCOVER])
    await seedWorkspace(db, 'user-1', 'personal-1', 'Personal Files', 'owner', { type: 'personal' })
    await seedWorkspace(db, 'user-1', 'team-1', 'Build Team', 'editor')
    await seedWorkspace(db, 'other-user', 'other-1', 'Other Team', 'owner')

    const response = await app.request('/api/auth/oauth2/authorization-details/catalog', {
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    await expect(response.json()).resolves.toEqual({
      items: [
        {
          authorizationDetail: { type: WORKSPACE_AUTHORIZATION_DETAIL_TYPE, identifier: 'personal-1' },
          display: { label: 'Personal Files', metadata: { type: 'personal', role: 'owner' } },
        },
        {
          authorizationDetail: { type: WORKSPACE_AUTHORIZATION_DETAIL_TYPE, identifier: 'team-1' },
          display: { label: 'Build Team', metadata: { type: 'organization', role: 'editor' } },
        },
      ],
      pagination: { limit: 50, offset: 0, total: 2, hasMore: false, nextOffset: null },
    })

    const firstPage = await app.request('/api/auth/oauth2/authorization-details/catalog?limit=1&offset=0', {
      headers: { Authorization: `Bearer ${token}` },
    })
    await expect(firstPage.json()).resolves.toMatchObject({
      items: [{ authorizationDetail: { identifier: 'personal-1' } }],
      pagination: { limit: 1, offset: 0, total: 2, hasMore: true, nextOffset: 1 },
    })

    await db.delete(authSchema.member).where(eq(authSchema.member.organizationId, 'team-1'))
    const afterRevocation = await app.request('/api/auth/oauth2/authorization-details/catalog', {
      headers: { Authorization: `Bearer ${token}` },
    })
    const body = (await afterRevocation.json()) as { items: Array<{ authorizationDetail: { identifier: string } }> }
    expect(body.items.map((item) => item.authorizationDetail.identifier)).toEqual(['personal-1'])
  })

  it('rejects missing, expired, target, and under-scoped credentials', async () => {
    const { app, db } = await createTestApp()
    const underScoped = await seedAccountToken(db, [AuthorizationScope.OBJECTS_READ], 'under-scoped')
    const expired = await seedAccountToken(db, [AuthorizationScope.WORKSPACES_DISCOVER], 'expired', new Date(0))

    expect((await app.request('/api/auth/oauth2/authorization-details/catalog')).status).toBe(401)
    expect(
      (
        await app.request('/api/auth/oauth2/authorization-details/catalog', {
          headers: { Authorization: 'DPoP target-jwt' },
        })
      ).status,
    ).toBe(401)
    expect(
      (
        await app.request('/api/auth/oauth2/authorization-details/catalog', {
          headers: { Authorization: `Bearer ${underScoped}` },
        })
      ).status,
    ).toBe(403)
    expect(
      (
        await app.request('/api/auth/oauth2/authorization-details/catalog', {
          headers: { Authorization: `Bearer ${expired}` },
        })
      ).status,
    ).toBe(401)
  })
})

type TestDb = Awaited<ReturnType<typeof createTestApp>>['db']

async function seedAccountToken(
  db: TestDb,
  scopes: AuthorizationScope[],
  token = 'account-token',
  expiresAt = new Date(Date.now() + 60_000),
) {
  await db
    .insert(authSchema.user)
    .values({
      id: 'user-1',
      name: 'Connected User',
      email: 'connected@example.com',
      emailVerified: true,
    })
    .onConflictDoNothing()
  await db
    .insert(authSchema.oauthClient)
    .values({
      id: 'client-1',
      clientId: 'client-1',
      clientSecret: null,
      disabled: false,
      skipConsent: false,
      enableEndSession: false,
      subjectType: 'public',
      scopes: JSON.stringify(scopes),
      name: 'Realmroot',
      redirectUris: JSON.stringify(['https://realmroot.example/callback']),
      tokenEndpointAuthMethod: 'none',
      grantTypes: JSON.stringify(['authorization_code', 'refresh_token']),
      responseTypes: JSON.stringify(['code']),
      public: true,
      type: 'native',
      requirePKCE: true,
    })
    .onConflictDoNothing()
  await db.insert(authSchema.oauthAccessToken).values({
    id: `access-${token}`,
    token: createHash('sha256').update(token).digest('base64url'),
    clientId: 'client-1',
    userId: 'user-1',
    expiresAt,
    scopes: JSON.stringify(scopes),
  })
  return token
}

async function seedWorkspace(
  db: TestDb,
  userId: string,
  id: string,
  name: string,
  role: string,
  metadata?: { type: 'personal' },
) {
  await db
    .insert(authSchema.user)
    .values({
      id: userId,
      name: userId,
      email: `${userId}@example.com`,
      emailVerified: true,
    })
    .onConflictDoNothing()
  await db
    .insert(authSchema.organization)
    .values({ id, name, slug: id, metadata: metadata ? JSON.stringify(metadata) : null })
  await db.insert(authSchema.member).values({ id: `member-${id}`, organizationId: id, userId, role })
}
