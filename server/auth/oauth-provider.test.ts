import { AuthorizationScope } from '@shared/authorization'
import { OAUTH_ACCESS_TOKEN_SECONDS, OAUTH_SCOPES } from '@shared/oauth'
import { describe, expect, it, vi } from 'vitest'
import { createOAuthProviderOptions } from './oauth-provider'

const db = {} as never

function createOptions(input?: {
  findPersonalOrg?: (userId: string) => Promise<string | null>
  getMemberRole?: (orgId: string, userId: string) => Promise<string | null>
}) {
  return createOAuthProviderOptions({
    db,
    orgs: {
      findPersonalOrg: input?.findPersonalOrg ?? vi.fn(async () => 'personal-org'),
      getMemberRole: input?.getMemberRole ?? vi.fn(async () => 'owner'),
    },
  })
}

describe('createOAuthProviderOptions', () => {
  it('configures a dynamic-client OAuth provider contract', async () => {
    const options = createOptions()

    expect(options).toMatchObject({
      loginPage: '/sign-in',
      consentPage: '/settings/oauth-apps',
      accessTokenExpiresIn: OAUTH_ACCESS_TOKEN_SECONDS,
      grantTypes: ['authorization_code', 'refresh_token'],
      postLogin: { page: '/settings/oauth-apps' },
    })
    expect(options.scopes).toEqual([...OAUTH_SCOPES])
    expect(options.cachedTrustedClients).toBeUndefined()
    expect(options.allowDynamicClientRegistration).toBe(true)
    expect(options.allowUnauthenticatedClientRegistration).toBe(true)
    await expect(options.postLogin?.shouldRedirect?.({} as never)).resolves.toBe(false)
  })

  it('binds consent to the active workspace when the user still has access', async () => {
    const options = createOptions()

    await expect(
      options.postLogin?.consentReferenceId?.({
        user: { id: 'user-1' },
        session: { activeOrganizationId: 'team-org' },
        scopes: ['openid', AuthorizationScope.OBJECTS_READ],
      } as never),
    ).resolves.toBe('team-org')
  })

  it('falls back to the personal workspace when no active workspace is set', async () => {
    const options = createOptions({
      findPersonalOrg: vi.fn(async () => 'personal-org'),
      getMemberRole: vi.fn(async () => null),
    })

    await expect(
      options.postLogin?.consentReferenceId?.({
        user: { id: 'user-1' },
        session: {},
        scopes: [AuthorizationScope.OBJECTS_READ],
      } as never),
    ).resolves.toBe('personal-org')
  })

  it('rejects ungrantable scopes, missing workspaces, and inaccessible active workspaces', async () => {
    await expect(
      createOptions().postLogin?.consentReferenceId?.({
        user: { id: 'user-1' },
        session: {},
        scopes: ['objects:read', 'admin:root'],
      } as never),
    ).rejects.toMatchObject({ body: expect.objectContaining({ error: 'invalid_scope' }) })

    await expect(
      createOptions({ findPersonalOrg: vi.fn(async () => null) }).postLogin?.consentReferenceId?.({
        user: { id: 'user-1' },
        session: {},
        scopes: [AuthorizationScope.OBJECTS_READ],
      } as never),
    ).rejects.toMatchObject({
      body: expect.objectContaining({ error_description: 'A workspace is required for OAuth' }),
    })

    await expect(
      createOptions({
        findPersonalOrg: vi.fn(async () => 'personal-org'),
        getMemberRole: vi.fn(async () => null),
      }).postLogin?.consentReferenceId?.({
        user: { id: 'user-1' },
        session: { activeOrganizationId: 'team-org' },
        scopes: [AuthorizationScope.OBJECTS_READ],
      } as never),
    ).rejects.toMatchObject({
      body: expect.objectContaining({ error_description: 'Workspace access is required for OAuth' }),
    })
  })

  it('adds ZPan resource claims to a consent-bound access token', async () => {
    const options = createOptions()
    await expect(
      options.customAccessTokenClaims?.({
        user: { id: 'user-1' },
        referenceId: 'team-org',
      } as never),
    ).resolves.toEqual({ zpan_org_id: 'team-org', zpan_actor: 'oauth' })
  })

  it('omits ZPan resource claims without user or workspace context', async () => {
    const options = createOptions()

    await expect(options.customAccessTokenClaims?.({ metadata: {}, scopes: [] } as never)).resolves.toEqual({})
    await expect(
      options.customAccessTokenClaims?.({
        user: { id: 'user-1' },
        scopes: [],
      } as never),
    ).resolves.toEqual({})
  })
})
