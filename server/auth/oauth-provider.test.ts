import { AuthorizationScope } from '@shared/authorization'
import {
  JWT_BEARER_GRANT_TYPE,
  OAUTH_ACCESS_TOKEN_SECONDS,
  OAUTH_ACCESS_TOKEN_TYPE,
  OAUTH_SCOPES,
  TOKEN_EXCHANGE_GRANT_TYPE,
  WORKSPACE_AUTHORIZATION_DETAIL_TYPE,
} from '@shared/oauth'
import { describe, expect, it, vi } from 'vitest'
import { createOAuthProviderOptions } from './oauth-provider'

const db = {} as never

function createOptions(input?: {
  canReadOrg?: (userId: string, orgId: string) => Promise<boolean>
  resourceAudience?: string
}) {
  return createOAuthProviderOptions({
    db,
    resourceAudience: input?.resourceAudience,
    orgs: {
      canReadOrg: input?.canReadOrg ?? vi.fn(async () => true),
    },
  })
}

describe('createOAuthProviderOptions', () => {
  it('configures a dynamic-client OAuth provider contract', async () => {
    const options = createOptions()

    expect(options).toMatchObject({
      loginPage: '/sign-in',
      consentPage: '/oauth/consent',
      accessTokenExpiresIn: OAUTH_ACCESS_TOKEN_SECONDS,
      grantTypes: ['authorization_code', 'refresh_token'],
      authorizationDetails: { typesSupported: [WORKSPACE_AUTHORIZATION_DETAIL_TYPE] },
    })
    expect(options.scopes).toEqual([...OAUTH_SCOPES])
    expect(options.cachedTrustedClients).toBeUndefined()
    expect(options.allowDynamicClientRegistration).toBe(true)
    expect(options.allowUnauthenticatedClientRegistration).toBe(true)
  })

  it('accepts one or more explicit workspaces during consent', async () => {
    const options = createOptions()
    await expect(
      options.authorizationDetails?.validate?.({
        ctx: {} as never,
        phase: 'consent',
        details: [
          { type: WORKSPACE_AUTHORIZATION_DETAIL_TYPE, identifier: 'org-1' },
          { type: WORKSPACE_AUTHORIZATION_DETAIL_TYPE, identifier: 'org-2' },
        ],
        requested: [{ type: WORKSPACE_AUTHORIZATION_DETAIL_TYPE }],
        user: { id: 'user-1' },
      } as never),
    ).resolves.toHaveLength(2)
  })

  it('rejects inaccessible workspaces during consent', async () => {
    const options = createOptions({ canReadOrg: vi.fn(async () => false) })
    await expect(
      options.authorizationDetails?.validate?.({
        ctx: {} as never,
        phase: 'consent',
        details: [{ type: WORKSPACE_AUTHORIZATION_DETAIL_TYPE, identifier: 'org-1' }],
        requested: [{ type: WORKSPACE_AUTHORIZATION_DETAIL_TYPE }],
        user: { id: 'user-1' },
      } as never),
    ).rejects.toMatchObject({
      body: expect.objectContaining({ error_description: 'Workspace access is required' }),
    })
  })

  it('does not allow consent to widen an explicitly requested workspace', async () => {
    const options = createOptions()
    await expect(
      options.authorizationDetails?.validate?.({
        ctx: {} as never,
        phase: 'consent',
        details: [{ type: WORKSPACE_AUTHORIZATION_DETAIL_TYPE, identifier: 'org-2' }],
        requested: [{ type: WORKSPACE_AUTHORIZATION_DETAIL_TYPE, identifier: 'org-1' }],
        user: { id: 'user-1' },
      } as never),
    ).rejects.toMatchObject({
      body: expect.objectContaining({ error_description: 'Workspace selection exceeds the authorization request' }),
    })
  })

  it('requires both requested and selected workspaces during consent', async () => {
    const options = createOptions()
    await expect(
      options.authorizationDetails?.validate?.({
        ctx: {} as never,
        phase: 'consent',
        details: [],
        requested: [{ type: WORKSPACE_AUTHORIZATION_DETAIL_TYPE }],
        user: { id: 'user-1' },
      } as never),
    ).rejects.toMatchObject({
      body: expect.objectContaining({ error_description: 'At least one workspace is required' }),
    })
  })

  it('rejects duplicate workspace selections during consent', async () => {
    const options = createOptions()
    const detail = { type: WORKSPACE_AUTHORIZATION_DETAIL_TYPE, identifier: 'org-1' }
    await expect(
      options.authorizationDetails?.validate?.({
        ctx: {} as never,
        phase: 'consent',
        details: [detail, detail],
        requested: [{ type: WORKSPACE_AUTHORIZATION_DETAIL_TYPE }],
        user: { id: 'user-1' },
      } as never),
    ).rejects.toMatchObject({
      body: expect.objectContaining({ error_description: 'Workspace authorization details must be unique' }),
    })
  })

  it('requires exactly one workspace detail in the authorization request', async () => {
    const options = createOptions()
    await expect(
      options.authorizationDetails?.validate?.({
        ctx: {} as never,
        phase: 'request',
        details: [
          { type: WORKSPACE_AUTHORIZATION_DETAIL_TYPE, identifier: 'org-1' },
          { type: WORKSPACE_AUTHORIZATION_DETAIL_TYPE, identifier: 'org-2' },
        ],
      } as never),
    ).rejects.toMatchObject({
      body: expect.objectContaining({ error_description: 'Exactly one workspace request is required' }),
    })
  })

  it('resolves a workspace chooser from the existing grant without widening explicit requests', async () => {
    const authorizationDetails = createOptions().authorizationDetails
    const granted = [
      { type: WORKSPACE_AUTHORIZATION_DETAIL_TYPE, identifier: 'org-1' },
      { type: WORKSPACE_AUTHORIZATION_DETAIL_TYPE, identifier: 'org-2' },
    ]

    expect(
      await authorizationDetails?.resolve?.({ requested: [{ type: WORKSPACE_AUTHORIZATION_DETAIL_TYPE }], granted }),
    ).toEqual(granted)
    expect(
      await authorizationDetails?.resolve?.({
        requested: [{ type: WORKSPACE_AUTHORIZATION_DETAIL_TYPE, identifier: 'org-1' }],
        granted,
      }),
    ).toEqual([{ type: WORKSPACE_AUTHORIZATION_DETAIL_TYPE, identifier: 'org-1' }])
  })

  it('does not encode workspace selection in custom claims', async () => {
    const options = createOptions()
    await expect(
      options.customAccessTokenClaims?.({
        user: { id: 'user-1' },
      } as never),
    ).resolves.toEqual({ zpan_actor: 'oauth' })
  })

  it('omits ZPan resource claims without user or workspace context', async () => {
    const options = createOptions()

    await expect(options.customAccessTokenClaims?.({ metadata: {}, scopes: [] } as never)).resolves.toEqual({})
    await expect(
      options.customAccessTokenClaims?.({
        user: { id: 'user-1' },
        scopes: [],
      } as never),
    ).resolves.toEqual({ zpan_actor: 'oauth' })
  })

  it.each([
    ['not-json', 'authorization_details must be valid JSON'],
    ['[]', 'Token exchange requires exactly one workspace'],
    [
      JSON.stringify([{ type: WORKSPACE_AUTHORIZATION_DETAIL_TYPE, identifier: 'org-2' }]),
      'Requested workspace is not authorized',
    ],
  ])('rejects invalid token-exchange authorization details %#', async (authorizationDetails, message) => {
    const resourceAudience = 'https://files.example/api'
    const options = createOptions({ resourceAudience })
    const extension = options.extensions?.find((candidate) => candidate.grants?.[TOKEN_EXCHANGE_GRANT_TYPE])
    const grant = extension?.grants?.[TOKEN_EXCHANGE_GRANT_TYPE]
    if (!grant) throw new Error('token exchange grant is not configured')
    const client = { clientId: 'client-1' }
    const provider = {
      authenticateClient: vi.fn(async () => ({ client })),
      requireActiveAccessToken: vi
        .fn()
        .mockResolvedValueOnce({
          sub: 'user-1',
          scope: AuthorizationScope.OBJECTS_READ,
          authorization_details: [{ type: WORKSPACE_AUTHORIZATION_DETAIL_TYPE, identifier: 'org-1' }],
        })
        .mockResolvedValueOnce({ sub: 'agent-1', zpan_actor_token: true }),
      issueTokens: vi.fn(),
    }
    const body = {
      scope: AuthorizationScope.OBJECTS_READ,
      subject_token: 'subject-token',
      subject_token_type: OAUTH_ACCESS_TOKEN_TYPE,
      actor_token: 'actor-token',
      actor_token_type: OAUTH_ACCESS_TOKEN_TYPE,
      requested_token_type: OAUTH_ACCESS_TOKEN_TYPE,
      resource: resourceAudience,
      authorization_details: authorizationDetails,
    }

    await expect(
      grant({
        ctx: {
          body,
          headers: new Headers({ DPoP: 'proof' }),
          context: { internalAdapter: { findUserById: vi.fn(async () => ({ id: 'user-1' })) } },
        },
        opts: {},
        provider,
      } as never),
    ).rejects.toMatchObject({ body: expect.objectContaining({ error_description: message }) })
  })

  it('advertises the JWT bearer grant alongside token exchange', () => {
    const options = createOptions({ resourceAudience: 'https://files.example/api' })
    const grants = options.extensions?.flatMap((extension) => Object.keys(extension.grants ?? {})) ?? []

    expect(grants).toEqual(expect.arrayContaining([JWT_BEARER_GRANT_TYPE, TOKEN_EXCHANGE_GRANT_TYPE]))
  })
})
