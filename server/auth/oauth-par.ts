import { getOAuthProviderApi, type oauthProvider } from '@better-auth/oauth-provider'
import { parseWorkspaceAuthorizationDetails } from '@shared/schemas'
import { APIError, type BetterAuthPlugin } from 'better-auth'
import { createAuthEndpoint } from 'better-auth/api'
import { z } from 'zod'
import { generateToken } from '../../shared/ids'

type OAuthProviderOptions = Parameters<typeof oauthProvider>[0]

const PAR_LIFETIME_SECONDS = 90
const PAR_REQUEST_URI_PREFIX = 'urn:ietf:params:oauth:request_uri:'

export function oauthPushedAuthorizationRequests(options: OAuthProviderOptions): BetterAuthPlugin {
  return {
    id: 'zpan-oauth-par',
    schema: {
      oauthPushedAuthorizationRequest: {
        fields: {
          requestUri: { type: 'string', required: true, unique: true },
          clientId: { type: 'string', required: true, index: true },
          parameters: { type: 'json', required: true },
          expiresAt: { type: 'date', required: true },
          createdAt: { type: 'date', required: true },
        },
      },
    },
    endpoints: {
      oauth2PushedAuthorizationRequest: createAuthEndpoint(
        '/oauth2/par',
        {
          method: 'POST',
          body: z.record(z.string(), z.string()),
          metadata: { noStore: true, allowedMediaTypes: ['application/x-www-form-urlencoded'] },
        },
        async (ctx) => {
          const clientId = ctx.body.client_id
          if (!clientId) throw oauthError('invalid_request', 'client_id is required')
          const provider = getOAuthProviderApi(ctx, options)
          const client = await provider.getClient(clientId)
          if (!client || client.disabled) throw oauthError('invalid_client', 'Unknown OAuth client')
          const authenticated = await provider.authenticateClient({ requireCredentials: !isPublicClient(client) })
          if (authenticated.clientId !== clientId)
            throw oauthError('invalid_client', 'Client credentials do not match client_id')
          await validatePushedAuthorizationRequest(ctx.body, client, options)

          const parameters = stripClientCredentials(ctx.body)
          const requestUri = `${PAR_REQUEST_URI_PREFIX}${generateToken(33)}`
          const now = new Date()
          await ctx.context.adapter.create({
            model: 'oauthPushedAuthorizationRequest',
            data: {
              requestUri,
              clientId,
              parameters,
              createdAt: now,
              expiresAt: new Date(now.getTime() + PAR_LIFETIME_SECONDS * 1000),
            },
          })
          return new Response(JSON.stringify({ request_uri: requestUri, expires_in: PAR_LIFETIME_SECONDS }), {
            status: 201,
            headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Pragma: 'no-cache' },
          })
        },
      ),
    },
  }
}

export async function resolvePushedAuthorizationRequest(input: {
  requestUri: string
  clientId: string
  ctx: Parameters<NonNullable<OAuthProviderOptions['requestUriResolver']>>[0]['ctx']
}): Promise<Record<string, string> | null> {
  if (!input.requestUri.startsWith(PAR_REQUEST_URI_PREFIX)) return null
  const row = await input.ctx.context.adapter.findOne<{
    id: string
    clientId: string
    parameters: Record<string, string>
    expiresAt: Date
  }>({
    model: 'oauthPushedAuthorizationRequest',
    where: [{ field: 'requestUri', value: input.requestUri }],
  })
  if (!row || row.clientId !== input.clientId) return null
  if (row.expiresAt <= new Date()) {
    await input.ctx.context.adapter.delete({
      model: 'oauthPushedAuthorizationRequest',
      where: [{ field: 'id', value: row.id }],
    })
    return null
  }
  await input.ctx.context.adapter.delete({
    model: 'oauthPushedAuthorizationRequest',
    where: [{ field: 'id', value: row.id }],
  })
  return row.parameters
}

function isPublicClient(client: { public?: boolean; tokenEndpointAuthMethod?: string }): boolean {
  return client.public === true || client.tokenEndpointAuthMethod === 'none'
}

async function validatePushedAuthorizationRequest(
  body: Record<string, string>,
  client: {
    redirectUris?: string[]
    responseTypes?: string[]
    grantTypes?: string[]
    scopes?: string[]
    public?: boolean
    tokenEndpointAuthMethod?: string
    requirePKCE?: boolean
  },
  options: OAuthProviderOptions,
) {
  if (body.request || body.request_uri) throw oauthError('invalid_request', 'Nested request objects are not supported')
  if (!body.redirect_uri || !client.redirectUris?.includes(body.redirect_uri)) {
    throw oauthError('invalid_request', 'redirect_uri is not registered')
  }
  if (body.response_type !== 'code' || (client.responseTypes && !client.responseTypes.includes('code'))) {
    throw oauthError('unsupported_response_type', 'Only the authorization code response type is supported')
  }
  if (client.grantTypes && !client.grantTypes.includes('authorization_code')) {
    throw oauthError('unauthorized_client', 'Client cannot use the authorization code grant')
  }

  const scopes = (body.scope ?? '').split(/\s+/).filter(Boolean)
  const allowedScopes = new Set(client.scopes ?? options.scopes ?? [])
  if (scopes.some((scope) => !allowedScopes.has(scope))) throw oauthError('invalid_scope', 'Scope is not registered')

  const requiresPkce = isPublicClient(client) || client.requirePKCE !== false || scopes.includes('offline_access')
  if (
    requiresPkce &&
    (body.code_challenge_method !== 'S256' ||
      !body.code_challenge ||
      !/^[A-Za-z0-9_-]{43,128}$/.test(body.code_challenge))
  ) {
    throw oauthError('invalid_request', 'A valid S256 PKCE challenge is required')
  }

  let details: ReturnType<typeof parseWorkspaceAuthorizationDetails>
  try {
    details = parseWorkspaceAuthorizationDetails(body.authorization_details)
  } catch {
    throw oauthError('invalid_authorization_details', 'Invalid workspace authorization details')
  }
  if (details.length === 0) {
    throw oauthError('invalid_authorization_details', 'At least one workspace authorization request is required')
  }
}

function stripClientCredentials(body: Record<string, string>): Record<string, string> {
  const parameters = { ...body }
  delete parameters.client_secret
  delete parameters.client_assertion
  delete parameters.client_assertion_type
  return parameters
}

function oauthError(error: string, errorDescription: string) {
  return new APIError('BAD_REQUEST', { error, error_description: errorDescription })
}
