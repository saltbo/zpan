import { AuthorizationScope } from '@shared/authorization'
import { WORKSPACE_AUTHORIZATION_DETAIL_TYPE } from '@shared/oauth'
import { describe, expect, it, vi } from 'vitest'
import { getOAuthConsentContext } from './oauth-consent'
import type { OAuthGateway, OrgRepo } from './ports'

const db = {} as never
const CLIENT_ID = 'dynamic-client'
const CLIENT_NAME = 'FlareAuth'

function org(overrides: Partial<OrgRepo> = {}): OrgRepo {
  return {
    listUserOrgs: vi.fn(async () => [{ id: 'org-1', name: 'Personal' }]),
    findPersonalOrg: vi.fn(),
    getMemberRole: vi.fn(),
    getOrgNames: vi.fn(async () => new Map([['org-1', 'Personal']])),
    canReadOrg: vi.fn(async () => true),
    canWriteToOrg: vi.fn(),
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
    oauth: {
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
    } as unknown as OAuthGateway,
  }
}

function oauthQuery(overrides: Record<string, string> = {}) {
  return new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: 'http://127.0.0.1:8484/callback',
    response_type: 'code',
    scope: `openid offline_access ${AuthorizationScope.OBJECTS_READ} ${AuthorizationScope.QUOTA_READ}`,
    authorization_details: JSON.stringify([{ type: WORKSPACE_AUTHORIZATION_DETAIL_TYPE }]),
    ...overrides,
  }).toString()
}

describe('OAuth consent usecase', () => {
  it('resolves a dynamically registered client instead of hard-coding its identity', async () => {
    const dynamicQuery = oauthQuery({
      client_id: 'dynamic-client',
      redirect_uri: 'https://broker.example.com/oauth/callback',
    })
    await expect(
      getOAuthConsentContext(
        deps(org(), {
          clientId: 'dynamic-client',
          clientName: 'Broker',
          redirectUris: ['https://broker.example.com/oauth/callback'],
        }),
        {
          db,
          userId: 'user-1',
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
      getOAuthConsentContext(deps(org()), {
        db,
        userId: 'user-1',
        oauthQuery: oauthQuery(),
      }),
    ).resolves.toEqual({
      clientId: CLIENT_ID,
      clientName: CLIENT_NAME,
      clientOrigin: 'http://127.0.0.1:8484',
      workspaces: [{ id: 'org-1', name: 'Personal' }],
      requestedWorkspaceIds: [],
      scopes: [AuthorizationScope.OBJECTS_READ, AuthorizationScope.QUOTA_READ],
      standardScopes: ['openid', 'offline_access'],
      redirectUri: 'http://127.0.0.1:8484/callback',
      grantLifetime: {
        accessTokenSeconds: 900,
        refreshTokenSeconds: 2_592_000,
      },
    })
  })

  it('honors a workspace identifier fixed by the client', async () => {
    await expect(
      getOAuthConsentContext(deps(org()), {
        db,
        userId: 'user-1',
        oauthQuery: oauthQuery({
          authorization_details: JSON.stringify([{ type: WORKSPACE_AUTHORIZATION_DETAIL_TYPE, identifier: 'org-1' }]),
        }),
      }),
    ).resolves.toMatchObject({
      workspaces: [{ id: 'org-1', name: 'Personal' }],
      requestedWorkspaceIds: ['org-1'],
    })
  })

  it('rejects requests that are not the managed authorization-code client flow', async () => {
    await expect(
      getOAuthConsentContext(deps(org()), {
        db,
        userId: 'user-1',
        oauthQuery: oauthQuery({ response_type: 'token' }),
      }),
    ).rejects.toMatchObject({ httpStatus: 400 })
  })

  it('rejects untrusted redirect URIs and non-grantable scopes', async () => {
    await expect(
      getOAuthConsentContext(deps(org()), {
        db,
        userId: 'user-1',
        oauthQuery: oauthQuery({ redirect_uri: 'https://evil.example/callback' }),
      }),
    ).rejects.toMatchObject({ httpStatus: 400 })

    await expect(
      getOAuthConsentContext(deps(org()), {
        db,
        userId: 'user-1',
        oauthQuery: oauthQuery({ scope: 'objects:purge' }),
      }),
    ).rejects.toMatchObject({ httpStatus: 400 })
  })

  it('rejects users without available workspaces', async () => {
    await expect(
      getOAuthConsentContext(deps(org({ listUserOrgs: vi.fn(async () => []) })), {
        db,
        userId: 'user-1',
        oauthQuery: oauthQuery(),
      }),
    ).rejects.toMatchObject({ httpStatus: 403 })
  })

  it('rejects malformed authorization details', async () => {
    await expect(
      getOAuthConsentContext(deps(org()), {
        db,
        userId: 'user-1',
        oauthQuery: oauthQuery({ authorization_details: 'not-json' }),
      }),
    ).rejects.toMatchObject({ httpStatus: 400, message: 'Invalid OAuth authorization details' })
  })
})
