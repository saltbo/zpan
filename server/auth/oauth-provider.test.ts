import { OAUTH_ACCESS_TOKEN_SECONDS, OAUTH_SCOPES, WORKSPACE_AUTHORIZATION_DETAIL_TYPE } from '@shared/oauth'
import { describe, expect, it, vi } from 'vitest'
import { createOAuthProviderOptions } from './oauth-provider'

const db = {} as never

function createOptions(input?: { canReadOrg?: (userId: string, orgId: string) => Promise<boolean> }) {
  return createOAuthProviderOptions({
    db,
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
})
