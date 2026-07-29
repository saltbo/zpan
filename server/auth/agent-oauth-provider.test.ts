import { AGENT_OAUTH_ACCESS_TOKEN_SECONDS, AGENT_OAUTH_CLIENT_ID, AGENT_OAUTH_SCOPES } from '@shared/agent-oauth'
import { AuthorizationScope } from '@shared/authorization'
import { describe, expect, it, vi } from 'vitest'
import type { AgentOAuthGateway } from '../usecases/ports'
import { createAgentOAuthProviderOptions } from './agent-oauth-provider'

const db = {} as never

function createGateway(): AgentOAuthGateway {
  return {
    ensureSystemClient: vi.fn(),
    assertLiveGrant: vi.fn(),
    verifyAccessToken: vi.fn(),
    listGrants: vi.fn(),
    recordGrantUse: vi.fn(),
    revokeGrant: vi.fn(),
  }
}

function createOptions(input?: {
  findPersonalOrg?: (userId: string) => Promise<string | null>
  getMemberRole?: (orgId: string, userId: string) => Promise<string | null>
  gateway?: AgentOAuthGateway
}) {
  return createAgentOAuthProviderOptions({
    db,
    agentOAuth: input?.gateway ?? createGateway(),
    orgs: {
      findPersonalOrg: input?.findPersonalOrg ?? vi.fn(async () => 'personal-org'),
      getMemberRole: input?.getMemberRole ?? vi.fn(async () => 'owner'),
    },
  })
}

describe('createAgentOAuthProviderOptions', () => {
  it('configures the managed public native Agent OAuth provider contract', async () => {
    const options = createOptions()

    expect(options).toMatchObject({
      disableJwtPlugin: true,
      loginPage: '/sign-in',
      consentPage: '/settings/agent-access',
      accessTokenExpiresIn: AGENT_OAUTH_ACCESS_TOKEN_SECONDS,
      grantTypes: ['authorization_code', 'refresh_token'],
      postLogin: { page: '/settings/agent-access' },
    })
    expect(options.scopes).toEqual([...AGENT_OAUTH_SCOPES])
    expect(options.cachedTrustedClients?.has(AGENT_OAUTH_CLIENT_ID)).toBe(true)
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
      body: expect.objectContaining({ error_description: 'A workspace is required for Agent OAuth' }),
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
      body: expect.objectContaining({ error_description: 'Workspace access is required for Agent OAuth' }),
    })
  })

  it('adds ZPan Agent claims only for valid live grants', async () => {
    const gateway = createGateway()
    const options = createOptions({ gateway })

    await expect(
      options.customAccessTokenClaims?.({
        user: { id: 'user-1' },
        referenceId: 'team-org',
        scopes: [AuthorizationScope.OBJECTS_READ],
        metadata: {},
      } as never),
    ).resolves.toEqual({ zpan_org_id: 'team-org', zpan_actor: 'agent_oauth' })
    expect(gateway.assertLiveGrant).toHaveBeenCalledWith(db, {
      userId: 'user-1',
      clientId: AGENT_OAUTH_CLIENT_ID,
      orgId: 'team-org',
      scopes: [AuthorizationScope.OBJECTS_READ],
    })
  })

  it('skips non-agent clients and rejects missing user or workspace context', async () => {
    const options = createOptions()

    await expect(
      options.customAccessTokenClaims?.({ metadata: { client_id: 'other-client' }, scopes: [] } as never),
    ).resolves.toEqual({})
    await expect(
      options.customAccessTokenClaims?.({ user: { id: 'user-1' }, scopes: [] } as never),
    ).rejects.toMatchObject({
      body: expect.objectContaining({ error_description: 'Agent OAuth grant is missing workspace context' }),
    })
  })
})
