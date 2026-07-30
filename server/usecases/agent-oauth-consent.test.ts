import { AuthorizationScope } from '@shared/authorization'
import { describe, expect, it, vi } from 'vitest'
import { getAgentOAuthConsentContext } from './agent-oauth-consent'
import type { AgentOAuthGateway, OrgRepo } from './ports'

const db = {} as never
const CLIENT_ID = 'dynamic-client'
const CLIENT_NAME = 'FlareAuth'

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

function deps(
  orgRepo: OrgRepo,
  client: {
    clientId?: string
    clientName?: string
    redirectUris?: string[]
    scopes?: string[]
  } = {},
) {
  return {
    org: orgRepo,
    agentOAuth: {
      findClient: vi.fn(async () => ({
        clientId: client.clientId ?? CLIENT_ID,
        clientName: client.clientName ?? CLIENT_NAME,
        disabled: false,
        redirectUris: client.redirectUris ?? ['http://127.0.0.1:8484/callback'],
        responseTypes: ['code'],
        scopes: client.scopes ?? [
          'openid',
          'offline_access',
          AuthorizationScope.OBJECTS_READ,
          AuthorizationScope.QUOTA_READ,
        ],
      })),
    } as unknown as AgentOAuthGateway,
  }
}

function oauthQuery(overrides: Record<string, string> = {}) {
  return new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: 'http://127.0.0.1:8484/callback',
    response_type: 'code',
    scope: `openid offline_access ${AuthorizationScope.OBJECTS_READ} ${AuthorizationScope.QUOTA_READ}`,
    ...overrides,
  }).toString()
}

describe('Agent OAuth consent usecase', () => {
  it('resolves a dynamically registered client instead of hard-coding its identity', async () => {
    const dynamicQuery = oauthQuery({
      client_id: 'dynamic-client',
      redirect_uri: 'https://broker.example.com/oauth/callback',
    })
    await expect(
      getAgentOAuthConsentContext(
        deps(org(), {
          clientId: 'dynamic-client',
          clientName: 'Broker',
          redirectUris: ['https://broker.example.com/oauth/callback'],
        }),
        {
          db,
          userId: 'user-1',
          orgId: 'org-1',
          requestUrl: 'https://zpan.example.test/api/agent-oauth-consent',
          oauthQuery: dynamicQuery,
        },
      ),
    ).resolves.toMatchObject({
      clientId: 'dynamic-client',
      clientName: 'Broker',
      redirectUri: 'https://broker.example.com/oauth/callback',
    })
  })

  it('builds server-owned consent context for the active workspace', async () => {
    await expect(
      getAgentOAuthConsentContext(deps(org()), {
        db,
        userId: 'user-1',
        orgId: 'org-1',
        requestUrl: 'https://zpan.example.test/api/agent-oauth-consent',
        oauthQuery: oauthQuery(),
      }),
    ).resolves.toEqual({
      clientId: CLIENT_ID,
      clientName: CLIENT_NAME,
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

  it('keeps the active workspace id when the workspace name is unavailable', async () => {
    await expect(
      getAgentOAuthConsentContext(deps(org({ getOrgNames: vi.fn(async () => new Map()) })), {
        db,
        userId: 'user-1',
        orgId: 'org-1',
        requestUrl: 'https://zpan.example.test/api/agent-oauth-consent',
        oauthQuery: oauthQuery(),
      }),
    ).resolves.toMatchObject({
      workspace: { id: 'org-1', name: null },
    })
  })

  it('rejects requests that are not the managed authorization-code client flow', async () => {
    await expect(
      getAgentOAuthConsentContext(deps(org()), {
        db,
        userId: 'user-1',
        orgId: 'org-1',
        requestUrl: 'https://zpan.example.test/api/agent-oauth-consent',
        oauthQuery: oauthQuery({ response_type: 'token' }),
      }),
    ).rejects.toMatchObject({ httpStatus: 400 })
  })

  it('rejects untrusted redirect URIs and non-grantable scopes', async () => {
    await expect(
      getAgentOAuthConsentContext(deps(org()), {
        db,
        userId: 'user-1',
        orgId: 'org-1',
        requestUrl: 'https://zpan.example.test/api/agent-oauth-consent',
        oauthQuery: oauthQuery({ redirect_uri: 'https://evil.example/callback' }),
      }),
    ).rejects.toMatchObject({ httpStatus: 400 })

    await expect(
      getAgentOAuthConsentContext(deps(org()), {
        db,
        userId: 'user-1',
        orgId: 'org-1',
        requestUrl: 'https://zpan.example.test/api/agent-oauth-consent',
        oauthQuery: oauthQuery({ scope: 'objects:purge' }),
      }),
    ).rejects.toMatchObject({ httpStatus: 400 })
  })

  it('rejects missing or inaccessible workspaces', async () => {
    await expect(
      getAgentOAuthConsentContext(deps(org({ canReadOrg: vi.fn(async () => false) })), {
        db,
        userId: 'user-1',
        orgId: 'org-1',
        requestUrl: 'https://zpan.example.test/api/agent-oauth-consent',
        oauthQuery: oauthQuery(),
      }),
    ).rejects.toMatchObject({ httpStatus: 403 })
  })
})
