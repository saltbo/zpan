import { AGENT_OAUTH_CLIENT_ID, AGENT_OAUTH_CLIENT_NAME } from '@shared/agent-oauth'
import { AuthorizationScope } from '@shared/authorization'
import { describe, expect, it, vi } from 'vitest'
import { getAgentOAuthConsentContext } from './agent-oauth-consent'
import type { OrgRepo } from './ports'

function org(overrides: Partial<OrgRepo> = {}): OrgRepo {
  return {
    findPersonalOrg: vi.fn(),
    getMemberRole: vi.fn(),
    getOrgNames: vi.fn(async () => new Map([['org-1', 'Personal']])),
    canReadOrg: vi.fn(async () => true),
    canWriteToOrg: vi.fn(),
    canManageAgentAccess: vi.fn(),
    isPersonalOrg: vi.fn(),
    ...overrides,
  }
}

function oauthQuery(overrides: Record<string, string> = {}) {
  return new URLSearchParams({
    client_id: AGENT_OAUTH_CLIENT_ID,
    redirect_uri: 'http://127.0.0.1:8484/callback',
    response_type: 'code',
    scope: `openid offline_access ${AuthorizationScope.OBJECTS_READ} ${AuthorizationScope.QUOTA_READ}`,
    ...overrides,
  }).toString()
}

describe('Agent OAuth consent usecase', () => {
  it('builds server-owned consent context for the active workspace', async () => {
    await expect(
      getAgentOAuthConsentContext(
        { org: org() },
        {
          userId: 'user-1',
          orgId: 'org-1',
          requestUrl: 'https://zpan.example.test/api/agent-oauth-consent',
          oauthQuery: oauthQuery(),
        },
      ),
    ).resolves.toEqual({
      clientId: AGENT_OAUTH_CLIENT_ID,
      clientName: AGENT_OAUTH_CLIENT_NAME,
      instanceOrigin: 'https://zpan.example.test',
      workspace: { id: 'org-1', name: 'Personal' },
      scopes: [AuthorizationScope.OBJECTS_READ, AuthorizationScope.QUOTA_READ],
      standardScopes: ['openid', 'offline_access'],
      redirectUri: 'http://127.0.0.1:8484/callback',
      grantLifetime: {
        accessTokenSeconds: 900,
        refreshTokenSeconds: 2_592_000,
      },
    })
  })

  it('rejects untrusted redirect URIs and non-grantable scopes', async () => {
    await expect(
      getAgentOAuthConsentContext(
        { org: org() },
        {
          userId: 'user-1',
          orgId: 'org-1',
          requestUrl: 'https://zpan.example.test/api/agent-oauth-consent',
          oauthQuery: oauthQuery({ redirect_uri: 'https://evil.example/callback' }),
        },
      ),
    ).rejects.toMatchObject({ httpStatus: 400 })

    await expect(
      getAgentOAuthConsentContext(
        { org: org() },
        {
          userId: 'user-1',
          orgId: 'org-1',
          requestUrl: 'https://zpan.example.test/api/agent-oauth-consent',
          oauthQuery: oauthQuery({ scope: 'objects:purge' }),
        },
      ),
    ).rejects.toMatchObject({ httpStatus: 400 })
  })

  it('rejects missing or inaccessible workspaces', async () => {
    await expect(
      getAgentOAuthConsentContext(
        { org: org({ canReadOrg: vi.fn(async () => false) }) },
        {
          userId: 'user-1',
          orgId: 'org-1',
          requestUrl: 'https://zpan.example.test/api/agent-oauth-consent',
          oauthQuery: oauthQuery(),
        },
      ),
    ).rejects.toMatchObject({ httpStatus: 403 })
  })
})
