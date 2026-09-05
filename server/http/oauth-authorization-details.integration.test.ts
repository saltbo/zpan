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
          id: 'personal-1',
          authorizationDetail: { type: WORKSPACE_AUTHORIZATION_DETAIL_TYPE, identifier: 'personal-1' },
          display: { label: 'Personal Files', metadata: { type: 'personal', role: 'owner' } },
        },
        {
          id: 'team-1',
          authorizationDetail: { type: WORKSPACE_AUTHORIZATION_DETAIL_TYPE, identifier: 'team-1' },
          display: { label: 'Build Team', metadata: { type: 'organization', role: 'editor' } },
        },
      ],
      pagination: { page: 1, pageSize: 20, totalItems: 2, totalPages: 1 },
    })
    expect(response.headers.get('link')).toBeNull()

    const firstPage = await app.request(
      'https://zpan.example/api/auth/oauth2/authorization-details/catalog?page=1&pageSize=1',
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    )
    await expect(firstPage.json()).resolves.toMatchObject({
      items: [{ id: 'personal-1', authorizationDetail: { identifier: 'personal-1' } }],
      pagination: { page: 1, pageSize: 1, totalItems: 2, totalPages: 2 },
    })
    expect(firstPage.headers.get('link')).toBe(
      '<https://zpan.example/api/auth/oauth2/authorization-details/catalog?page=2&pageSize=1>; rel="next", <https://zpan.example/api/auth/oauth2/authorization-details/catalog?page=2&pageSize=1>; rel="last"',
    )

    const secondPage = await app.request(
      'https://zpan.example/api/auth/oauth2/authorization-details/catalog?page=2&pageSize=1',
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    )
    await expect(secondPage.json()).resolves.toEqual({
      items: [
        {
          id: 'team-1',
          authorizationDetail: { type: WORKSPACE_AUTHORIZATION_DETAIL_TYPE, identifier: 'team-1' },
          display: { label: 'Build Team', metadata: { type: 'organization', role: 'editor' } },
        },
      ],
      pagination: { page: 2, pageSize: 1, totalItems: 2, totalPages: 2 },
    })
    expect(secondPage.headers.get('link')).toBe(
      '<https://zpan.example/api/auth/oauth2/authorization-details/catalog?page=1&pageSize=1>; rel="first", <https://zpan.example/api/auth/oauth2/authorization-details/catalog?page=1&pageSize=1>; rel="prev"',
    )

    await db.delete(authSchema.member).where(eq(authSchema.member.organizationId, 'team-1'))
    const afterRevocation = await app.request('/api/auth/oauth2/authorization-details/catalog', {
      headers: { Authorization: `Bearer ${token}` },
    })
    const body = (await afterRevocation.json()) as { items: Array<{ authorizationDetail: { identifier: string } }> }
    expect(body.items.map((item) => item.authorizationDetail.identifier)).toEqual(['personal-1'])
  })

  it('publishes the standardized page catalog contract in OpenAPI', async () => {
    const { app } = await createTestApp()
    const response = await app.request('/api/openapi.json')
    type OpenApiSchema = { $ref?: string; properties?: Record<string, OpenApiSchema> }
    const document = (await response.json()) as {
      components?: { schemas?: Record<string, OpenApiSchema> }
      paths: Record<
        string,
        {
          get?: {
            parameters?: Array<{ name?: string; schema?: Record<string, unknown> }>
            responses?: Record<
              string,
              {
                headers?: Record<string, unknown>
                content?: { 'application/json'?: { schema?: OpenApiSchema } }
              }
            >
          }
        }
      >
    }
    const operation = document.paths['/api/auth/oauth2/authorization-details/catalog']?.get
    const queryParameters = Object.fromEntries(
      (operation?.parameters ?? []).map((parameter) => [parameter.name, parameter.schema]),
    )
    const responseSchema = operation?.responses?.['200']?.content?.['application/json']?.schema
    const responseSchemaName = responseSchema?.$ref?.split('/').at(-1)
    const catalogSchema = responseSchemaName ? document.components?.schemas?.[responseSchemaName] : responseSchema
    const pagination = catalogSchema?.properties?.pagination

    expect(queryParameters).toEqual({
      page: expect.objectContaining({ type: 'integer', default: 1, minimum: 1 }),
      pageSize: expect.objectContaining({ type: 'integer', default: 20, minimum: 1, maximum: 100 }),
    })
    expect(Object.keys(pagination?.properties ?? {})).toEqual(['page', 'pageSize', 'totalItems', 'totalPages'])
    expect(operation?.responses?.['200']?.headers).toHaveProperty('Link')
  })

  it('rejects page values outside the catalog contract', async () => {
    const { app, db } = await createTestApp()
    const token = await seedAccountToken(db, [AuthorizationScope.WORKSPACES_DISCOVER])
    const headers = { Authorization: `Bearer ${token}` }

    expect((await app.request('/api/auth/oauth2/authorization-details/catalog?page=0', { headers })).status).toBe(400)
    expect((await app.request('/api/auth/oauth2/authorization-details/catalog?pageSize=101', { headers })).status).toBe(
      400,
    )
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
