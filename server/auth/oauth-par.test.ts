import { WORKSPACE_AUTHORIZATION_DETAIL_TYPE } from '@shared/oauth'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { oauthPushedAuthorizationRequests, resolvePushedAuthorizationRequest } from './oauth-par'

const getOAuthProviderApi = vi.hoisted(() => vi.fn())

vi.mock('@better-auth/oauth-provider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@better-auth/oauth-provider')>()),
  getOAuthProviderApi,
}))

const requestUri = 'urn:ietf:params:oauth:request_uri:test'

function pushedRequest(overrides: Record<string, string> = {}) {
  return {
    client_id: 'client-1',
    redirect_uri: 'https://agent.example/callback',
    response_type: 'code',
    scope: 'openid',
    code_challenge_method: 'S256',
    code_challenge: 'a'.repeat(43),
    authorization_details: JSON.stringify([{ type: WORKSPACE_AUTHORIZATION_DETAIL_TYPE }]),
    ...overrides,
  }
}

function endpointContext(body: Record<string, string>) {
  return {
    body,
    context: { adapter: { create: vi.fn() } },
    setHeader: vi.fn(),
  } as never
}

async function submit(body: Record<string, string>) {
  const endpoint = oauthPushedAuthorizationRequests({ scopes: ['openid'] } as never).endpoints
    ?.oauth2PushedAuthorizationRequest
  if (!endpoint) throw new Error('PAR endpoint is not configured')
  return endpoint(endpointContext(body))
}

describe('OAuth pushed authorization requests', () => {
  beforeEach(() => {
    getOAuthProviderApi.mockReturnValue({
      getClient: vi.fn(async () => ({
        clientId: 'client-1',
        redirectUris: ['https://agent.example/callback'],
        responseTypes: ['code'],
        grantTypes: ['authorization_code'],
        scopes: ['openid'],
        public: true,
      })),
      authenticateClient: vi.fn(async () => ({ clientId: 'client-1' })),
    })
  })

  it.each([
    [{ response_type: 'token' }, 'Only the authorization code response type is supported'],
    [{ code_challenge: 'short' }, 'A valid S256 PKCE challenge is required'],
    [{ authorization_details: 'not-json' }, 'Invalid workspace authorization details'],
    [{ authorization_details: '[]' }, 'At least one workspace authorization request is required'],
  ])('rejects invalid pushed request parameters %#', async (overrides, message) => {
    await expect(submit(pushedRequest(overrides))).rejects.toMatchObject({
      body: expect.objectContaining({ error_description: message }),
    })
  })

  it('accepts multiple fixed workspace authorization details', async () => {
    const response = await submit(
      pushedRequest({
        authorization_details: JSON.stringify([
          { type: WORKSPACE_AUTHORIZATION_DETAIL_TYPE, identifier: 'workspace-1' },
          { type: WORKSPACE_AUTHORIZATION_DETAIL_TYPE, identifier: 'workspace-2' },
        ]),
      }),
    )

    expect(response.status).toBe(201)
  })

  it('rejects clients without the authorization code grant', async () => {
    getOAuthProviderApi.mockReturnValue({
      getClient: vi.fn(async () => ({
        clientId: 'client-1',
        redirectUris: ['https://agent.example/callback'],
        responseTypes: ['code'],
        grantTypes: ['refresh_token'],
        scopes: ['openid'],
        public: true,
      })),
      authenticateClient: vi.fn(async () => ({ clientId: 'client-1' })),
    })

    await expect(submit(pushedRequest())).rejects.toMatchObject({
      body: expect.objectContaining({ error_description: 'Client cannot use the authorization code grant' }),
    })
  })

  it('deletes an expired request before rejecting it', async () => {
    const adapter = {
      findOne: vi.fn(async () => ({
        id: 'par-1',
        clientId: 'client-1',
        parameters: { scope: 'openid' },
        expiresAt: new Date(0),
      })),
      delete: vi.fn(async () => undefined),
    }

    await expect(
      resolvePushedAuthorizationRequest({
        requestUri,
        clientId: 'client-1',
        ctx: { context: { adapter } } as never,
      }),
    ).resolves.toBeNull()
    expect(adapter.delete).toHaveBeenCalledWith({
      model: 'oauthPushedAuthorizationRequest',
      where: [{ field: 'id', value: 'par-1' }],
    })
  })
})
